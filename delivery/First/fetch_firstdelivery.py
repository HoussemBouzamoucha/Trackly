#!/usr/bin/env python3
"""
First Delivery Group — list ALL provider data (READ-ONLY).

Reverse-engineered from the provider SPA at
https://fournisseur.firstdeliverygroup.com

Auth
----
POST /provider/v1/authenticate  {email, password, issuer:"PROVIDER"}
-> sets an HTTP-only session cookie (this is the ONLY POST that "logs in";
   it creates/updates/deletes nothing).

All data is then read via cookie-authenticated requests.

What it lists
-------------
* /provider/stats              -> counts per parcel state (POST, no body, read-only)
* /provider/info               -> provider banner/info (POST, read-only)
* /provider/details-by-state   -> full parcel list for EACH state (POST {state}, read-only)
* /agency                      -> agencies (GET, read-only)

NOTE on POST: this API uses POST to *read/query* data (query-by-POST design).
These POSTs only fetch/filter; the script NEVER calls any write endpoint
(create-parcel, update-*, delete-*, cancel-delivery, sendback, import, ...).

Outputs
-------
* firstdelivery_data.json   -> everything (stats, info, agencies, parcels by state)
* firstdelivery_parcels.csv -> flat list of all parcels (one row each, with state)

Usage
-----
    python3 fetch_firstdelivery.py            # credentials built in -> just run
    python3 fetch_firstdelivery.py --state DELIVERED_PAID   # one state only
"""

from __future__ import annotations

import argparse
import csv
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://fournisseur.firstdeliverygroup.com/provider/v1"

# Built-in credentials (override with --email/--password or env vars).
EMAIL = os.environ.get("FDG_EMAIL", "Shopitounsi26@first.com")
PASSWORD = os.environ.get("FDG_PASSWORD", "20080244")

# All parcel states exposed by the SPA (rs enum).
STATES = [
    "WAITING",                       # Mes colis en attente
    "WAITING_RETRIEVAL",             # Colis à enlever
    "RETRIEVED",                     # Colis enlevé
    "STORED",                        # Colis au dépôt
    "IN_PROGRESS",                   # Colis en cours
    "SEND_BACK",                     # Colis en retour dépôt
    "DELIVERED",                     # Colis livrés
    "DELIVERED_PAID",                # Colis livrés payés
    "SEND_BACK_DEFINITIVE",          # Retour définitif
    "SEND_BACK_AGENCY",              # Retour client/agence
    "SEND_BACK_SENDER",              # Retour expéditeur
    "SEND_BACK_SENDER_IN_PROGRESS",  # Retour en cours d'expédition
    "SEND_BACK_RECEIVED",            # Retour reçu
    "DELETED",                       # Supprimés
    "REFUNDED",                      # Remboursés
    "TO_VERIFY",                     # Retour provisoire (provisional)
]

UA = "Mozilla/5.0 (firstdelivery-export/1.0)"


class Session:
    """Cookie-aware session that re-authenticates automatically on 401."""

    def __init__(self, email: str, password: str):
        self.email = email
        self.password = password
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )
        self.opener.addheaders = [("User-Agent", UA), ("Accept", "application/json")]

    # -- low level ------------------------------------------------------- #
    def _request(self, method: str, path: str, body=None, timeout=90):
        data = None
        headers = {}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            BASE + path, data=data, method=method, headers=headers
        )
        with self.opener.open(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", errors="replace")
        return json.loads(raw)

    # -- auth ------------------------------------------------------------ #
    def login(self, retries=5):
        last = None
        for attempt in range(retries):
            try:
                resp = self._request(
                    "POST",
                    "/authenticate",
                    {"email": self.email, "password": self.password, "issuer": "PROVIDER"},
                )
            except Exception as e:  # transient connection drops / timeouts
                last = e
                time.sleep(2.0 * (attempt + 1))
                continue
            if resp.get("isError") or resp.get("status") != 200:
                raise RuntimeError(f"Login failed: {resp.get('message')}")
            return resp["result"]
        raise RuntimeError(f"Login failed after {retries} tries: {last}")

    # -- read with auto re-login ---------------------------------------- #
    def read(self, method: str, path: str, body=None, retries=4):
        last = None
        for attempt in range(retries):
            try:
                resp = self._request(method, path, body)
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    self.login()
                    continue
                last = e
                time.sleep(1.5)
                continue
            except (TimeoutError, OSError) as e:
                # network / SSL / read timeout -> back off and retry
                last = e
                time.sleep(2.0)
                continue
            if isinstance(resp, dict) and resp.get("status") == 401:
                self.login()
                time.sleep(0.3)
                continue
            return resp
        raise RuntimeError(f"Failed {path} after {retries} tries: {last}")


# --------------------------------------------------------------------------- #
def fetch_all(sess: Session, only_state: str | None = None) -> dict:
    out: dict = {}

    print("[*] Logging in ...")
    user = sess.login()
    out["provider"] = {
        "name": (user.get("user") or {}).get("name"),
        "customerId": (user.get("user") or {}).get("customerId"),
        "telephone": (user.get("user") or {}).get("telephone"),
        "address": (user.get("user") or {}).get("address"),
        "agency": (user.get("user") or {}).get("agency"),
    }
    print(f"[+] Logged in as {out['provider'].get('name')}")

    # stats (counts per state)
    try:
        out["stats"] = sess.read("POST", "/provider/stats").get("result")
        print("[+] stats fetched")
    except Exception as e:
        print(f"    [!] stats: {e}", file=sys.stderr)

    # provider info
    try:
        out["info"] = sess.read("POST", "/provider/info").get("result")
        print("[+] info fetched")
    except Exception as e:
        print(f"    [!] info: {e}", file=sys.stderr)

    # agencies  (and build id -> name map for resolution)
    agency_map: dict[int, str] = {}
    try:
        agencies = sess.read("GET", "/agency").get("result") or []
        out["agencies"] = agencies
        for a in agencies:
            try:
                agency_map[int(a["id"])] = a.get("agence", "")
            except (KeyError, ValueError, TypeError):
                pass
        print(f"[+] agencies fetched ({len(agencies)})")
    except Exception as e:
        print(f"    [!] agencies: {e}", file=sys.stderr)
    out["agency_map"] = {str(k): v for k, v in agency_map.items()}

    def ag_name(v):
        try:
            return agency_map.get(int(v), "")
        except (ValueError, TypeError):
            return ""

    # parcels per state
    states = [only_state] if only_state else STATES
    out["parcels_by_state"] = {}
    total = 0
    for st in states:
        try:
            resp = sess.read("POST", "/provider/details-by-state", {"state": st})
            rows = resp.get("result") or []
            if not isinstance(rows, list):
                rows = []
            # enrich each parcel with human-readable agency names
            for p in rows:
                p["departureAgencyName"] = ag_name(p.get("departureAgency"))
                p["destinationAgencyName"] = ag_name(p.get("destinationAgency"))
                p["currentAgencyName"] = ag_name(p.get("current_agency"))
            out["parcels_by_state"][st] = rows
            total += len(rows)
            print(f"    [{st:<30}] {len(rows)} parcels")
        except Exception as e:
            out["parcels_by_state"][st] = []
            print(f"    [{st:<30}] ERROR {e}", file=sys.stderr)
        time.sleep(0.2)
    out["total_parcels"] = total
    print(f"[+] Total parcels across all states: {total}")
    return out


def save_json(data: dict, path: str):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[+] {path}")


# Columns that Excel would otherwise mangle into scientific notation / drop
# leading characters. We force them to be treated as text.
TEXT_COLS = {"barCode", "phone", "phone2", "rowId"}


def _excel_text(value) -> str:
    """Wrap a value so spreadsheets keep it as literal text (e.g. barcodes)."""
    s = "" if value is None else str(value)
    if s == "":
        return s
    # ="..."  forces Excel/LibreOffice to treat it as text, preserving digits
    return f'="{s}"'


def save_csv(data: dict, path: str):
    rows = []
    for st, parcels in (data.get("parcels_by_state") or {}).items():
        for p in parcels:
            r = {"state_label": st}
            r.update(p)
            rows.append(r)
    if not rows:
        print("[!] no parcels to write to CSV")
        return

    # preferred column order (agency names right after their IDs)
    preferred = [
        "state_label", "state", "rowId", "barCode", "client", "phone", "phone2",
        "governorate", "city", "address", "price", "designation",
        "date_add", "pickupDate", "endDeliveryCycleDate",
        "departureAgency", "departureAgencyName",
        "destinationAgency", "destinationAgencyName",
        "current_agency", "currentAgencyName",
    ]
    cols = [c for c in preferred if any(c in r for r in rows)]
    for r in rows:  # append any unexpected extra fields
        for k in r:
            if k not in cols:
                cols.append(k)

    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            row = dict(r)
            for c in TEXT_COLS:
                if c in row:
                    row[c] = _excel_text(row[c])
            w.writerow(row)
    print(f"[+] {path}  ({len(rows)} parcels)")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="List all First Delivery provider data (read-only).")
    ap.add_argument("--email", default=EMAIL)
    ap.add_argument("--password", default=PASSWORD)
    ap.add_argument("--state", help="fetch only one state (e.g. DELIVERED_PAID)")
    ap.add_argument("--json", default="firstdelivery_data.json")
    ap.add_argument("--csv", default="firstdelivery_parcels.csv")
    args = ap.parse_args(argv)

    sess = Session(args.email, args.password)
    data = fetch_all(sess, args.state)
    save_json(data, args.json)
    save_csv(data, args.csv)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
