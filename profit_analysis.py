#!/usr/bin/env python3
"""
PROFIT & PERFORMANCE ANALYSIS — Meta Ads x Converty orders.

Combines:
  meta_data.json        (campaigns + DAILY ad spend/engagement/purchases)
  converty_orders.json  (real orders + product cost/price)

Per product (= Converty product, linked to Meta campaigns by name):
  * ad spend, impressions, clicks, CTR, CPC, reach, engagement, Meta purchases
  * REAL sales = DELIVERED orders only (units, revenue)
  * profit = Σ(selling_price − product_cost) over delivered orders  − LAGGED ad spend
  * ROAS, delivery rate, cost-per-purchase
  * verdict: WINNER / LOSER / NEUTRAL (with reasons) + daily/weekly/monthly reports

AD-SPEND LAG RULE (per your spec):
  a day's revenue is charged the SAME day's ad spend PLUS the immediately
  preceding non-selling day(s). Default non-selling day = Sunday, so:
     Monday  revenue  <- Monday + Sunday ad spend
     other days       <- same-day ad spend
  Configurable via NON_SELLING_WEEKDAYS.

PRODUCT COST:
  taken from Converty catalog 'cost'. Where missing/zero, falls back to
  cost_overrides.json (edit that file to provide real costs).

CAMPAIGN<->PRODUCT MAPPING:
  auto fuzzy match by name; writes mapping_review.csv for you to correct.
  If mapping_overrides.csv exists, it takes precedence.
"""
from __future__ import annotations
import csv, json, os, re, datetime
from collections import defaultdict

DELIVERED_STATUSES = {"delivered"}          # what counts as a real sale
NON_SELLING_WEEKDAYS = {6}                   # 0=Mon ... 6=Sun  (Sunday rolls into Monday)
MATCH_THRESHOLD = 0.34

ENGAGEMENT_ACTIONS = {
    "post_engagement", "page_engagement", "post_reaction", "comment",
    "link_click", "video_view", "onsite_conversion.post_save",
}
PURCHASE_ACTIONS = {"omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"}
LEAD_ACTIONS = {"lead", "onsite_conversion.lead",
                "onsite_conversion.messaging_conversation_started_7d"}

NOISE = set("cbo abo msg new test copy old final edited static ads camp campaign "
            "sales ad adv pub promo tn all the la le les de du".split())


# --------------------------------------------------------------------------- #
def norm_tokens(s):
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9\u0600-\u06ff ]", " ", s)
    return [t for t in s.split() if t and t not in NOISE and not t.isdigit()]


def load_cost_overrides():
    if os.path.exists("cost_overrides.json"):
        return json.load(open("cost_overrides.json", encoding="utf-8"))
    return {}


def load_mapping_overrides():
    """campaign_name(lower) -> product_name."""
    m = {}
    if os.path.exists("mapping_overrides.csv"):
        for row in csv.DictReader(open("mapping_overrides.csv", encoding="utf-8-sig")):
            c = (row.get("campaign") or "").strip().lower()
            p = (row.get("product") or "").strip()
            if c and p:
                m[c] = p
    return m


# --------------------------------------------------------------------------- #
def build_products(conv):
    """name -> {name, cost, price, store, tokens}."""
    overrides = load_cost_overrides()
    products = {}
    for s in conv["stores"]:
        for n, info in s["products"].items():
            name = info["name"]
            cost = info.get("cost")
            if cost in (None, 0, "0", ""):
                cost = overrides.get(name, overrides.get(name.lower()))
            products[name] = {
                "name": name, "store": s["name"],
                "cost": float(cost) if cost not in (None, "") else None,
                "price": float(info["price"]) if info.get("price") not in (None, "") else None,
                "tokens": set(norm_tokens(name)),
            }
    return products


def match_campaign(camp_name, products, override_map):
    key = (camp_name or "").strip().lower()
    if key in override_map and override_map[key] in products:
        return override_map[key], 1.0, "override"
    ct = set(norm_tokens(camp_name))
    if not ct:
        return None, 0.0, "empty"
    best, score = None, 0.0
    for pname, p in products.items():
        pt = p["tokens"]
        if not pt:
            continue
        j = len(ct & pt) / len(ct | pt)
        if j > score:
            best, score = pname, j
    if score >= MATCH_THRESHOLD:
        return best, round(score, 3), "fuzzy"
    return None, round(score, 3), "unmatched"


# --------------------------------------------------------------------------- #
def parse_actions(actions, wanted):
    total = 0.0
    for a in actions or []:
        if a.get("action_type") in wanted:
            try:
                total += float(a.get("value", 0))
            except ValueError:
                pass
    return total


def lag_target_date(d: datetime.date) -> datetime.date:
    """Map an ad-spend date to the REVENUE date it should be charged to.
    Same-day normally; a non-selling day's spend rolls forward to the next
    selling day (e.g. Sunday -> Monday)."""
    cur = d
    while cur.weekday() in NON_SELLING_WEEKDAYS:
        cur = cur + datetime.timedelta(days=1)
    return cur


# --------------------------------------------------------------------------- #
def analyze():
    meta = json.load(open("meta_data.json", encoding="utf-8"))
    conv = json.load(open("converty_orders.json", encoding="utf-8"))
    products = build_products(conv)
    override_map = load_mapping_overrides()

    # ---- 1) Campaign -> product mapping (+ review file) ----
    mapping = {}          # (acct, campaign_id) -> product_name
    review_rows = []
    for a in meta["accounts"]:
        for c in a["campaigns"]:
            pname, score, how = match_campaign(c["name"], products, override_map)
            mapping[(a["id"], c["id"])] = pname
            review_rows.append({
                "account": a["name"], "campaign": c["name"],
                "campaign_status": c.get("effective_status"),
                "matched_product": pname or "", "score": score, "method": how,
            })
    with open("mapping_review.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(review_rows[0].keys()))
        w.writeheader(); w.writerows(review_rows)

    # ---- 2) Ad metrics per product per DAY (with lag applied) ----
    # raw[(product, date)] = {spend, impressions, clicks, reach, engagement, fb_purchases}
    ad_daily = defaultdict(lambda: defaultdict(float))   # product -> date -> spend (LAGGED)
    ad_tot = defaultdict(lambda: defaultdict(float))     # product -> metric -> value
    camp_name_by_cid = {}
    for a in meta["accounts"]:
        for c in a["campaigns"]:
            camp_name_by_cid[(a["id"], c["id"])] = c["name"]
        for r in a["daily_insights"]:
            cid = (a["id"], r.get("campaign_id"))
            pname = mapping.get(cid)
            if not pname:
                # try match by campaign_name directly (insights may include deleted camps)
                pn2, sc, how = match_campaign(r.get("campaign_name"), products, override_map)
                pname = pn2
            if not pname:
                pname = "__UNMATCHED__"
            spend = float(r.get("spend", 0) or 0)
            d = datetime.date.fromisoformat(r["date_start"])
            tgt = lag_target_date(d)
            ad_daily[pname][tgt.isoformat()] += spend
            t = ad_tot[pname]
            t["spend"] += spend
            t["impressions"] += float(r.get("impressions", 0) or 0)
            t["clicks"] += float(r.get("clicks", 0) or 0)
            t["reach"] += float(r.get("reach", 0) or 0)
            t["engagement"] += parse_actions(r.get("actions"), ENGAGEMENT_ACTIONS)
            t["fb_purchases"] += parse_actions(r.get("actions"), PURCHASE_ACTIONS)
            t["leads"] += parse_actions(r.get("actions"), LEAD_ACTIONS)
            t["fb_revenue"] += parse_actions(r.get("action_values"), PURCHASE_ACTIONS)

    # ---- 3) Real sales per product per DAY (delivered only) ----
    sales_daily = defaultdict(lambda: defaultdict(lambda: {"units": 0, "revenue": 0.0,
                                                           "margin": 0.0, "orders": 0}))
    sales_tot = defaultdict(lambda: {"delivered": 0, "all_orders": 0, "units": 0,
                                     "revenue": 0.0, "margin": 0.0,
                                     "status_counts": defaultdict(int)})
    # product cost lookup
    def pcost(pname):
        p = products.get(pname)
        return p["cost"] if p and p["cost"] is not None else None

    for s in conv["stores"]:
        for o in s["orders"]:
            if o.get("isTest"):
                continue
            day = (o.get("createdAt") or "")[:10]
            status = (o.get("status") or "").lower()
            for it in o["items"]:
                pname = it["name"]
                if pname not in products:
                    # keep anyway under its own name
                    products.setdefault(pname, {"name": pname, "store": s["name"],
                                                "cost": None, "price": None,
                                                "tokens": set(norm_tokens(pname))})
                st = sales_tot[pname]
                st["all_orders"] += 1
                st["status_counts"][status] += 1
                if status in DELIVERED_STATUSES:
                    qty = it.get("qty", 1) or 1
                    unit = it.get("pricePerUnit") or it.get("product_price") or 0
                    unit = float(unit or 0)
                    cost = pcost(pname)
                    margin = (unit - cost) * qty if cost is not None else None
                    st["delivered"] += 1
                    st["units"] += qty
                    st["revenue"] += unit * qty
                    if margin is not None:
                        st["margin"] += margin
                    sd = sales_daily[pname][day]
                    sd["units"] += qty
                    sd["orders"] += 1
                    sd["revenue"] += unit * qty
                    if margin is not None:
                        sd["margin"] += margin

    # ---- 4) Combine -> per-product profit with lagged spend, + period reports ----
    today = datetime.date.today()
    def period_bounds():
        return {
            "daily": (today - datetime.timedelta(days=1), today - datetime.timedelta(days=1)),
            "weekly": (today - datetime.timedelta(days=7), today - datetime.timedelta(days=1)),
            "monthly": (today - datetime.timedelta(days=30), today - datetime.timedelta(days=1)),
        }
    bounds = period_bounds()

    all_products = set(ad_tot) | set(sales_tot)
    all_products.discard("__UNMATCHED__")
    results = []
    for pname in sorted(all_products):
        st = sales_tot.get(pname, {})
        at = ad_tot.get(pname, {})
        # period figures
        periods = {}
        for label, (d0, d1) in bounds.items():
            spend = sum(v for day, v in ad_daily.get(pname, {}).items()
                        if d0.isoformat() <= day <= d1.isoformat())
            sd = sales_daily.get(pname, {})
            units = sum(x["units"] for day, x in sd.items() if d0.isoformat() <= day <= d1.isoformat())
            revenue = sum(x["revenue"] for day, x in sd.items() if d0.isoformat() <= day <= d1.isoformat())
            margin = sum(x["margin"] for day, x in sd.items() if d0.isoformat() <= day <= d1.isoformat())
            profit = margin - spend
            periods[label] = {
                "ad_spend_lagged": round(spend, 2),
                "delivered_units": units,
                "revenue": round(revenue, 2),
                "gross_margin": round(margin, 2),
                "net_profit": round(profit, 2),
                "roas": round(revenue / spend, 2) if spend else None,
            }

        delivered = st.get("delivered", 0)
        all_orders = st.get("all_orders", 0)
        spend_tot = at.get("spend", 0.0)
        margin_tot = st.get("margin", 0.0)
        net_tot = margin_tot - spend_tot
        roas_tot = (st.get("revenue", 0) / spend_tot) if spend_tot else None
        delivery_rate = (delivered / all_orders) if all_orders else None
        cpp = (spend_tot / delivered) if delivered else None
        cost_known = products.get(pname, {}).get("cost") is not None

        # verdict
        verdict, reasons = "NEUTRAL", []
        if spend_tot > 0 and delivered == 0:
            verdict = "LOSER"; reasons.append("ad spend but 0 delivered sales")
        elif spend_tot == 0 and delivered > 0:
            verdict = "ORGANIC"; reasons.append("sales with no ad spend")
        elif spend_tot > 0 and cost_known:
            if net_tot > 0 and (roas_tot or 0) >= 1.5:
                verdict = "WINNER"; reasons.append(f"net +{net_tot:.0f}, ROAS {roas_tot:.1f}")
            elif net_tot < 0:
                verdict = "LOSER"; reasons.append(f"net {net_tot:.0f}")
            else:
                reasons.append("marginal")
        if not cost_known and delivered > 0:
            reasons.append("⚠ cost unknown (margin excludes cost)")

        results.append({
            "product": pname,
            "store": products.get(pname, {}).get("store"),
            "cost": products.get(pname, {}).get("cost"),
            "price": products.get(pname, {}).get("price"),
            "verdict": verdict,
            "reasons": "; ".join(reasons),
            "ad_spend": round(spend_tot, 2),
            "impressions": int(at.get("impressions", 0)),
            "clicks": int(at.get("clicks", 0)),
            "ctr_pct": round(at.get("clicks", 0) / at.get("impressions", 1) * 100, 2) if at.get("impressions") else None,
            "cpc": round(spend_tot / at.get("clicks", 1), 3) if at.get("clicks") else None,
            "reach": int(at.get("reach", 0)),
            "engagement": int(at.get("engagement", 0)),
            "fb_purchases": int(at.get("fb_purchases", 0)),
            "fb_reported_revenue": round(at.get("fb_revenue", 0), 2),
            "orders_total": all_orders,
            "delivered": delivered,
            "delivery_rate_pct": round(delivery_rate * 100, 1) if delivery_rate is not None else None,
            "units_sold": st.get("units", 0),
            "real_revenue": round(st.get("revenue", 0), 2),
            "gross_margin": round(margin_tot, 2),
            "net_profit": round(net_tot, 2),
            "roas": round(roas_tot, 2) if roas_tot else None,
            "cost_per_purchase": round(cpp, 2) if cpp else None,
            "daily": periods["daily"],
            "weekly": periods["weekly"],
            "monthly": periods["monthly"],
        })

    results.sort(key=lambda r: (r["net_profit"]), reverse=True)
    return results, meta


# --------------------------------------------------------------------------- #
def write_outputs(results, meta):
    json.dump({"generated": datetime.datetime.now().isoformat(),
               "products": results},
              open("profit_report.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)

    flat_cols = ["product", "store", "verdict", "reasons", "cost", "price",
                 "ad_spend", "impressions", "clicks", "ctr_pct", "cpc", "reach",
                 "engagement", "fb_purchases", "fb_reported_revenue",
                 "orders_total", "delivered", "delivery_rate_pct", "units_sold",
                 "real_revenue", "gross_margin", "net_profit", "roas",
                 "cost_per_purchase"]
    with open("profit_report.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=flat_cols, extrasaction="ignore")
        w.writeheader()
        for r in results:
            w.writerow(r)

    # period CSVs
    for label in ("daily", "weekly", "monthly"):
        with open(f"report_{label}.csv", "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["product", "store", "ad_spend_lagged", "delivered_units",
                        "revenue", "gross_margin", "net_profit", "roas"])
            rows = []
            for r in results:
                p = r[label]
                if p["ad_spend_lagged"] or p["delivered_units"]:
                    rows.append([r["product"], r["store"], p["ad_spend_lagged"],
                                 p["delivered_units"], p["revenue"], p["gross_margin"],
                                 p["net_profit"], p["roas"]])
            rows.sort(key=lambda x: x[6], reverse=True)
            w.writerows(rows)


def print_summary(results):
    spent = sum(r["ad_spend"] for r in results)
    profit = sum(r["net_profit"] for r in results)
    winners = [r for r in results if r["verdict"] == "WINNER"]
    losers = [r for r in results if r["verdict"] == "LOSER"]
    print("\n" + "=" * 64)
    print(f"  TOTAL ad spend (window): ${spent:,.2f}")
    print(f"  TOTAL net profit:        ${profit:,.2f}")
    print(f"  Winners: {len(winners)} | Losers: {len(losers)} | products: {len(results)}")
    print("=" * 64)
    print("\n  TOP 8 by net profit:")
    for r in results[:8]:
        print(f"   {r['verdict']:7} {r['product'][:26]:26} spend ${r['ad_spend']:7.0f}"
              f"  deliv {r['delivered']:3}  net ${r['net_profit']:8.0f}  ROAS {r['roas']}")
    print("\n  WORST 6 (ad spend, weak sales):")
    for r in sorted(results, key=lambda x: x["net_profit"])[:6]:
        print(f"   {r['verdict']:7} {r['product'][:26]:26} spend ${r['ad_spend']:7.0f}"
              f"  deliv {r['delivered']:3}  net ${r['net_profit']:8.0f}")


if __name__ == "__main__":
    res, meta = analyze()
    write_outputs(res, meta)
    print_summary(res)
    print("\n[+] profit_report.json / .csv, report_daily/weekly/monthly.csv, mapping_review.csv")
