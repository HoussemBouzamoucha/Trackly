#!/usr/bin/env python3
"""
Tic-Tac Delivery — Fetch ALL factures (invoices) WITH their colis/products.

This reproduces the website's structure:
    Finance  ->  list of factures (invoices)
    click a facture (finance_f_h?num=XXXX)  ->  its colis / products

How it works
------------
1. Logs into the client portal (client.tic-tac-delivery.com) using the
   phone + password (a session login -- the ONE required POST, used only to
   authenticate; it creates/modifies/deletes nothing).
2. Reads /finance  -> the list of every facture (num, date, totals).
3. For each facture, reads /finance_f_h?num=NUM  (read-only GET) and parses
   its colis table: Code à barre, Client, Téléphone, Ville, Etat,
   Désignation (product), COD.
4. Exports everything organized BY FACTURE:
      - factures.json   : structured  [{facture..., colis:[...]}, ...]
      - factures.csv    : flat (one row per colis, with its facture number)
      - factures/index.html + factures/facture_<num>.html
        -> open index.html and click a facture to see its products,
           exactly like the website.

Usage
-----
    python3 fetch_factures.py            # credentials are built in -> just run it
    python3 fetch_factures.py --limit 5  # only first 5 factures (test)
    python3 fetch_factures.py --no-html  # skip HTML generation

    # to use a different account, override the built-in credentials:
    python3 fetch_factures.py --phone 22707538 --password WROIMU
    PHONE=22707538 PASSWORD=WROIMU python3 fetch_factures.py
"""

from __future__ import annotations

import argparse
import csv
import html
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://client.tic-tac-delivery.com"
LOGIN_URL = f"{BASE}/login"
FINANCE_URL = f"{BASE}/finance"
FACTURE_URL = f"{BASE}/finance_f_h?num="

UA = "Mozilla/5.0 (factures-export/1.0)"

# --------------------------------------------------------------------------- #
# Hardcoded credentials (so the script runs with NO arguments).
# Override anytime with --phone / --password or PHONE / PASSWORD env vars.
# --------------------------------------------------------------------------- #
DEFAULT_PHONE = "22707538"
DEFAULT_PASSWORD = "WROIMU"

# Columns of the colis table inside each facture detail page
COLIS_COLS = ["code_barre", "client", "telephone", "ville", "etat", "designation", "cod"]


# --------------------------------------------------------------------------- #
# HTTP helpers (cookie-aware session)
# --------------------------------------------------------------------------- #
def make_opener() -> urllib.request.OpenerDirector:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar),
        urllib.request.HTTPRedirectHandler(),
    )
    opener.addheaders = [("User-Agent", UA)]
    return opener


def get(opener, url: str, timeout: int = 30) -> str:
    with opener.open(url, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def login(opener, phone: str, password: str, timeout: int = 30) -> None:
    # prime session cookie
    get(opener, LOGIN_URL, timeout)
    data = urllib.parse.urlencode(
        {"phone": phone, "password": password, "login": ""}
    ).encode("utf-8")
    req = urllib.request.Request(LOGIN_URL, data=data, method="POST")
    with opener.open(req, timeout=timeout) as r:
        page = r.read().decode("utf-8", errors="replace")
        final = r.geturl()
    if final.rstrip("/").endswith("/login") or "name=\"password\"" in page:
        raise RuntimeError("Login failed — check phone/password.")


# --------------------------------------------------------------------------- #
# HTML parsing
# --------------------------------------------------------------------------- #
def _cells(row_html: str) -> list[str]:
    cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, re.S | re.I)
    out = []
    for c in cells:
        c = re.sub(r"<[^>]+>", "", c)
        c = html.unescape(re.sub(r"\s+", " ", c)).strip()
        out.append(c)
    return out


def _rows(page_html: str) -> list[list[str]]:
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", page_html, re.S | re.I)
    return [_cells(r) for r in rows]


def parse_facture_list(page_html: str) -> list[dict]:
    """Parse /finance into a list of facture summaries."""
    factures = {}
    # facture numbers come from the links; the table gives the summary
    for row in _rows(page_html):
        if len(row) >= 8 and re.fullmatch(r"\d+", row[0] or ""):
            num = row[0]
            factures[num] = {
                "num": num,
                "date": row[1],
                "livre": row[2],
                "livre_autre": row[3],
                "retour_source": row[4],
                "total_cod": row[5],
                "total_hfl": row[6],
                "cout_livraison": row[7],
            }
    # also capture any nums only present as links (safety)
    for num in re.findall(r"finance_f_h\?num=(\d+)", page_html):
        factures.setdefault(num, {"num": num})
    # sort numerically
    return [factures[k] for k in sorted(factures, key=lambda x: int(x))]


def parse_facture_detail(page_html: str) -> dict:
    """Parse a /finance_f_h?num= page -> header info + list of colis."""
    # header bits
    info = {}
    m = re.search(r"N°\s*:\s*(\d+)\s*-\s*([\d/]+)", page_html)
    if m:
        info["num"] = m.group(1)
        info["date"] = m.group(2)
    m = re.search(r"Fournisseur\s*:\s*([^<\n]+)", page_html)
    if m:
        info["fournisseur"] = html.unescape(m.group(1).strip())

    colis = []
    for row in _rows(page_html):
        # the colis rows start with a barcode (long digit string) and have 7 cells
        if len(row) >= 7 and re.fullmatch(r"\d{6,}", row[0] or ""):
            colis.append(dict(zip(COLIS_COLS, row[:7])))
    info["colis"] = colis
    info["nb_colis"] = len(colis)
    return info


# --------------------------------------------------------------------------- #
# HTML report generation (offline, self-contained)
# --------------------------------------------------------------------------- #
def write_html_reports(factures: list[dict], outdir: str) -> None:
    os.makedirs(outdir, exist_ok=True)
    style = (
        "<style>body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#222}"
        "h1{color:#2f4b7c}table{border-collapse:collapse;width:100%;margin-top:12px}"
        "th,td{border:1px solid #ccc;padding:6px 8px;font-size:13px;text-align:left}"
        "th{background:#2f4b7c;color:#fff}tr:nth-child(even){background:#f4f6fa}"
        "a{color:#2f4b7c;text-decoration:none}a:hover{text-decoration:underline}"
        ".pill{background:#e8eef7;border-radius:10px;padding:2px 8px;font-size:12px}"
        ".tot{text-align:right;font-weight:bold}</style>"
    )

    # index page
    rows = []
    for f in factures:
        num = f.get("num", "")
        rows.append(
            f"<tr><td><a href='facture_{num}.html'>{num}</a></td>"
            f"<td>{html.escape(f.get('date',''))}</td>"
            f"<td>{f.get('nb_colis', len(f.get('colis',[])))}</td>"
            f"<td class='tot'>{html.escape(f.get('total_cod',''))}</td>"
            f"<td class='tot'>{html.escape(f.get('total_hfl',''))}</td>"
            f"<td class='tot'>{html.escape(f.get('cout_livraison',''))}</td></tr>"
        )
    index = (
        f"<!doctype html><html><head><meta charset='utf-8'>{style}"
        f"<title>Factures</title></head><body>"
        f"<h1>Factures ({len(factures)})</h1>"
        f"<p>Cliquez sur un numéro de facture pour voir ses produits/colis.</p>"
        f"<table><tr><th>Numéro</th><th>Date</th><th>Nb colis</th>"
        f"<th>Total COD</th><th>Total HFL</th><th>Coût livraison</th></tr>"
        f"{''.join(rows)}</table></body></html>"
    )
    with open(os.path.join(outdir, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(index)

    # per-facture pages
    for f in factures:
        num = f.get("num", "")
        crows = []
        for c in f.get("colis", []):
            crows.append(
                "<tr>"
                f"<td>{html.escape(c.get('code_barre',''))}</td>"
                f"<td>{html.escape(c.get('client',''))}</td>"
                f"<td>{html.escape(c.get('telephone',''))}</td>"
                f"<td>{html.escape(c.get('ville',''))}</td>"
                f"<td>{html.escape(c.get('etat',''))}</td>"
                f"<td>{html.escape(c.get('designation',''))}</td>"
                f"<td class='tot'>{html.escape(c.get('cod',''))}</td>"
                "</tr>"
            )
        page = (
            f"<!doctype html><html><head><meta charset='utf-8'>{style}"
            f"<title>Facture {num}</title></head><body>"
            f"<p><a href='index.html'>&larr; Toutes les factures</a></p>"
            f"<h1>Facture N° {num}</h1>"
            f"<p><span class='pill'>Date: {html.escape(f.get('date',''))}</span> "
            f"<span class='pill'>Fournisseur: {html.escape(f.get('fournisseur',''))}</span> "
            f"<span class='pill'>Total COD: {html.escape(f.get('total_cod',''))}</span> "
            f"<span class='pill'>Nb colis: {f.get('nb_colis', len(f.get('colis',[])))}</span></p>"
            f"<table><tr><th>Code à barre</th><th>Client</th><th>Téléphone</th>"
            f"<th>Ville</th><th>Etat</th><th>Désignation</th><th>COD</th></tr>"
            f"{''.join(crows)}</table></body></html>"
        )
        with open(os.path.join(outdir, f"facture_{num}.html"), "w", encoding="utf-8") as fh:
            fh.write(page)


# --------------------------------------------------------------------------- #
# CSV / JSON
# --------------------------------------------------------------------------- #
def write_json(factures: list[dict], path: str) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(factures, fh, ensure_ascii=False, indent=2)
    print(f"[+] {path}  ({len(factures)} factures)")


def write_csv(factures: list[dict], path: str) -> None:
    cols = ["facture_num", "facture_date", "facture_total_cod"] + COLIS_COLS
    n = 0
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for f in factures:
            for c in f.get("colis", []):
                row = {
                    "facture_num": f.get("num", ""),
                    "facture_date": f.get("date", ""),
                    "facture_total_cod": f.get("total_cod", ""),
                }
                row.update({k: c.get(k, "") for k in COLIS_COLS})
                w.writerow(row)
                n += 1
    print(f"[+] {path}  ({n} colis rows)")


# --------------------------------------------------------------------------- #
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Fetch all Tic-Tac factures with their colis.")
    ap.add_argument("--phone", default=os.environ.get("PHONE", DEFAULT_PHONE))
    ap.add_argument("--password", default=os.environ.get("PASSWORD", DEFAULT_PASSWORD))
    ap.add_argument("--json", default="factures.json")
    ap.add_argument("--csv", default="factures.csv")
    ap.add_argument("--html-dir", default="factures")
    ap.add_argument("--no-html", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="limit number of factures (testing)")
    ap.add_argument("--delay", type=float, default=0.2, help="delay between requests (s)")
    args = ap.parse_args(argv)

    if not args.phone or not args.password:
        print("[ERROR] provide --phone and --password (or PHONE/PASSWORD env).", file=sys.stderr)
        return 2

    opener = make_opener()
    print("[*] Logging in ...")
    login(opener, args.phone, args.password)
    print("[+] Logged in.")

    print("[*] Loading facture list (/finance) ...")
    summaries = parse_facture_list(get(opener, FINANCE_URL))
    if args.limit:
        summaries = summaries[: args.limit]
    print(f"[+] Found {len(summaries)} factures.")

    factures = []
    for i, s in enumerate(summaries, 1):
        num = s["num"]
        try:
            detail = parse_facture_detail(get(opener, FACTURE_URL + num))
        except Exception as e:
            print(f"    [!] facture {num}: {e}", file=sys.stderr)
            detail = {"colis": [], "nb_colis": 0}
        merged = {**s, **{k: v for k, v in detail.items() if k != "num"}}
        factures.append(merged)
        print(f"    [{i}/{len(summaries)}] facture {num}: {merged.get('nb_colis',0)} colis")
        if args.delay:
            time.sleep(args.delay)

    total_colis = sum(f.get("nb_colis", 0) for f in factures)
    print(f"[+] Done. {len(factures)} factures, {total_colis} colis total.")

    write_json(factures, args.json)
    write_csv(factures, args.csv)
    if not args.no_html:
        write_html_reports(factures, args.html_dir)
        print(f"[+] HTML report -> {args.html_dir}/index.html (click a facture to see products)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
