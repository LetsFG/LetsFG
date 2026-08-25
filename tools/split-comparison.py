#!/usr/bin/env python3
"""Measure real split-ticket savings and emit the README comparison table.

The table in the README makes a price claim, so it has to come from real
searches, be dated, and be reproducible by anyone who doubts it. That is what
this script is for: it runs the same public search an ordinary user runs, reads
the offers back, and prints the table plus a JSON sidecar holding the raw
evidence for every row.

    LETSFG_BEARER_TOKEN=...  python tools/split-comparison.py
    LETSFG_PROBE_SECRET=...  python tools/split-comparison.py --routes 8

Nothing here invents a number. A route that produces no split says so in the
output and is dropped from the table rather than being filled in with an
estimate -- most searches never fire a split probe, and a table that hides that
would misrepresent how often this happens.

Costs real money upstream: one full search per route. Default is 8 routes.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

BASE = os.environ.get("LETSFG_BASE_URL", "https://letsfg.co").rstrip("/")
BEARER = os.environ.get("LETSFG_BEARER_TOKEN", "").strip()
PROBE = os.environ.get("LETSFG_PROBE_SECRET", "").strip()
UA = "letsfg-split-comparison/1.0"

# Long-haul, one-plus stop, expensive enough to clear the gate: these are the
# routes the split engine is actually allowed to fire on. Lifted from the
# flight-search-worker calibration set so the sample is not cherry-picked here.
# (split_gate: MIN_THROUGH_USD=250, MIN_STOPS_ON_BEST=1, MIN_DURATION_HOURS=10)
ROUTES = [
    ("CKG", "GDN"), ("CAN", "RIX"), ("PVG", "VNO"), ("HAN", "KRK"),
    ("BKK", "BUD"), ("PEK", "LHR"), ("BKK", "CDG"), ("SIN", "FRA"),
    ("GRU", "LIS"), ("JFK", "WAW"), ("YVR", "AMS"), ("LIM", "MAD"),
]

# The API reports in-progress as `searching`; anything else is terminal. But a
# terminal search is NOT a finished one -- see keep_polling below.
IN_PROGRESS = ("pending", "running", "searching")
POLL_S = 2
LATE_MERGE_POLL_S = 3
LATE_MERGE_GRACE_S = 90        # tracks the server's own SETTLE_MS
SEARCH_TIMEOUT_S = 180


def headers(json_body: bool = False) -> dict:
    h = {"User-Agent": UA}
    if json_body:
        h["Content-Type"] = "application/json"
    if BEARER:
        h["Authorization"] = f"Bearer {BEARER}"
    if PROBE:
        h["x-probe-secret"] = PROBE
    return h


def post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}{path}", data=json.dumps(body).encode(),
        headers=headers(json_body=True), method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def get(path: str) -> dict:
    req = urllib.request.Request(f"{BASE}{path}", headers=headers(), method="GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def run_search(origin: str, destination: str, dep: str, currency: str) -> tuple[dict, float]:
    """One search, polled to genuinely finished. Returns (result, seconds)."""
    t0 = time.time()
    started = post("/api/search", {
        "origin": origin, "destination": destination,
        "date_from": dep, "adults": 1, "currency": currency,
    })
    search_id = started.get("search_id") or started.get("id")
    if not search_id:
        raise RuntimeError(f"no search_id in response: {str(started)[:200]}")

    # Phase 1 -- poll immediately, then on the interval, until terminal.
    result = None
    deadline = time.time() + SEARCH_TIMEOUT_S
    while time.time() < deadline:
        try:
            data = get(f"/api/results/{search_id}")
        except urllib.error.HTTPError as exc:
            if exc.code in (404, 425):
                time.sleep(POLL_S)
                continue
            raise
        if data.get("status", "") not in IN_PROGRESS:
            result = data
            break
        time.sleep(POLL_S)
    if result is None:
        raise TimeoutError(f"{origin}-{destination} never reached a terminal status")
    terminal_s = time.time() - t0

    # Phase 2 -- terminal is not finished. The split probe merges in after the
    # status turns terminal; `split_ticket_pending` says so. This is the whole
    # reason the table can show a split at all.
    waited = 0
    while waited < LATE_MERGE_GRACE_S and (
            result.get("split_ticket_pending") or result.get("gf_enrich_pending")):
        time.sleep(LATE_MERGE_POLL_S)
        waited += LATE_MERGE_POLL_S
        merged = get(f"/api/results/{search_id}")
        if merged.get("status", "") not in IN_PROGRESS:
            result = merged

    result["_terminal_seconds"] = round(terminal_s, 1)
    result["_total_seconds"] = round(time.time() - t0, 1)
    result["_search_id"] = search_id
    return result, terminal_s


def is_split(o: dict) -> bool:
    cond = o.get("conditions") or {}
    return o.get("split_ticket") is True or str(cond.get("split_ticket")) == "true"


def price(o: dict) -> float:
    try:
        return float(o.get("price") or 0)
    except (TypeError, ValueError):
        return 0.0


def analyse(route: tuple[str, str], dep: str, result: dict) -> dict:
    offers = [o for o in (result.get("offers") or []) if price(o) > 0]
    splits = [o for o in offers if is_split(o)]
    through = [o for o in offers if not is_split(o)]

    row: dict = {
        "route": f"{route[0]}-{route[1]}",
        "date": dep,
        "search_id": result.get("_search_id"),
        "offers": len(offers),
        "terminal_seconds": result.get("_terminal_seconds"),
        "total_seconds": result.get("_total_seconds"),
        "split_found": bool(splits),
    }
    if not through:
        row["note"] = "no priced through-fare"
        return row

    best_through = min(through, key=price)
    row["through_price"] = round(price(best_through), 2)
    row["through_currency"] = best_through.get("currency")
    row["through_source"] = best_through.get("source")
    row["through_airline"] = best_through.get("owner_airline") or best_through.get("airline")

    if not splits:
        row["note"] = "no split beat the through-fare on this route"
        return row

    best_split = min(splits, key=price)
    cond = best_split.get("conditions") or {}
    row["split_price"] = round(price(best_split), 2)
    row["split_source"] = best_split.get("source")          # "split:<a>+<b>"
    row["split_hub"] = cond.get("split_hub")
    row["connect_hours"] = cond.get("split_connect_hours")
    row["self_transfer"] = cond.get("self_transfer")
    row["saving"] = round(row["through_price"] - row["split_price"], 2)
    row["saving_pct"] = round(row["saving"] / row["through_price"] * 100, 1) if row["through_price"] else 0
    return row


def sellers(split_source: str | None) -> str:
    """'split:kiwi+skyscanner' -> 'Kiwi + Skyscanner'."""
    if not split_source or not split_source.startswith("split:"):
        return "-"
    parts = split_source[len("split:"):].split("+")
    pretty = {"kiwi": "Kiwi", "skyscanner": "Skyscanner", "kayak_meta": "Kayak",
              "momondo": "Momondo", "cheapflights": "Cheapflights",
              "priceline_meta": "Priceline", "google_flights": "Google Flights"}
    return " + ".join(pretty.get(p, p.replace("_", " ").title()) for p in parts if p)


def markdown(rows: list[dict], currency: str) -> str:
    won = [r for r in rows if r.get("split_found") and r.get("saving", 0) > 0]
    if not won:
        return "_No route in this run produced a split cheaper than its through-fare._"

    out = [
        "| Route | Date | Best single ticket | Split total | You save | Via | Sold by |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in won:
        out.append(
            f"| {r['route']} | {r['date']} | "
            f"{r['through_price']:.0f} {r.get('through_currency') or currency} | "
            f"**{r['split_price']:.0f} {r.get('through_currency') or currency}** | "
            f"**{r['saving']:.0f} ({r['saving_pct']:.0f}%)** | "
            f"{r.get('split_hub') or '-'} | {sellers(r.get('split_source'))} |"
        )
    tried = len(rows)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out += [
        "",
        f"<sub>Measured {stamp} on live searches, one adult, one way. "
        f"{len(won)} of {tried} routes searched produced a split cheaper than the best "
        f"single ticket in the same result set; the rest are listed in "
        f"`split-comparison.json`. Prices move constantly and these will not "
        f"reproduce exactly — rerun `tools/split-comparison.py` for current numbers. "
        f"Every split is **two separate tickets with an unprotected self-transfer**: "
        f"if the first flight is late, the second airline owes you nothing.</sub>",
    ]
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--routes", type=int, default=8, help="how many routes to search")
    ap.add_argument("--days-out", type=int, default=60, help="departure this many days ahead")
    ap.add_argument("--currency", default="USD")
    ap.add_argument("--out", default="split-comparison.json")
    args = ap.parse_args()

    if not BEARER and not PROBE:
        print("error: set LETSFG_BEARER_TOKEN (from `letsfg auth`) or LETSFG_PROBE_SECRET.",
              file=sys.stderr)
        return 2

    dep = (date.today() + timedelta(days=args.days_out)).isoformat()
    rows: list[dict] = []
    for origin, destination in ROUTES[: args.routes]:
        print(f"  {origin}-{destination} {dep} ... ", end="", flush=True)
        try:
            result, _ = run_search(origin, destination, dep, args.currency)
            row = analyse((origin, destination), dep, result)
        except Exception as exc:                                  # noqa: BLE001
            row = {"route": f"{origin}-{destination}", "date": dep,
                   "error": f"{type(exc).__name__}: {exc}"[:200]}
            print(f"FAILED ({row['error']})")
            rows.append(row)
            continue
        if row.get("split_found") and row.get("saving", 0) > 0:
            print(f"split {row['split_price']:.0f} vs {row['through_price']:.0f} "
                  f"(-{row['saving_pct']:.0f}%) via {row.get('split_hub')}")
        else:
            print(row.get("note", "no split"))
        rows.append(row)

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"generated_utc": datetime.now(timezone.utc).isoformat(),
                   "base_url": BASE, "currency": args.currency, "rows": rows},
                  fh, indent=2)

    print("\n" + markdown(rows, args.currency))
    print(f"\nraw evidence: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
