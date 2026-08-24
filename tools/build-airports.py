"""Distil the website's airport tables into the dataset the plugin bundles.

The search bar has to resolve "gdan" to Gdansk (GDN) with no round trip: the
Bearer lane has no place-lookup endpoint, and asking the network on every
keystroke would be the wrong design even if it did. letsfg.co already solves
this client-side in app/airports.ts + app/lib/generated-locations.ts, so the
plugin uses the same data rather than a second, drifting copy.

Only what the picker actually renders is kept -- code, English name, country,
and whether the entry is a multi-airport metro (LON, NYC, PAR). Locale name
tables, aliases and airport-type metadata are dropped, which is most of the
weight.

    python tools/build-airports.py [path-to-website]

Re-run it when the website's tables change. The output is committed so the
plugin builds with no dependency on the private repo.
"""
import io
import json
import os
import re
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "airports.json")

# The website source is not in this repository, so there is no default that
# could be right: pass the path, or set LETSFG_WEBSITE_DIR. Guessing one would
# only produce a confusing failure three functions later.
website = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("LETSFG_WEBSITE_DIR", "")
if not website:
    sys.exit(
        "usage: build-airports.py <path-to-website-dir>
"
        "   or: LETSFG_WEBSITE_DIR=<path> build-airports.py
"
        "The directory must contain app/airports.ts."
    )

# ---- The curated list: 200-odd majors, with localised names we reduce to `en`.
airports = {}
src = io.open(os.path.join(website, "app", "airports.ts"), encoding="utf-8").read()
ENTRY = re.compile(
    r"\{\s*code:\s*'([A-Z0-9]{3})'\s*,\s*names:\s*\{(.*?)\}\s*,\s*country:\s*'([A-Z]{2})'(.*?)\}",
    re.S)
EN = re.compile(r"\ben\s*:\s*'((?:[^'\\]|\\.)*)'")
for m in ENTRY.finditer(src):
    code, names, country, tail = m.group(1), m.group(2), m.group(3), m.group(4)
    en = EN.search(names)
    if not en:
        continue
    airports[code] = {
        "c": code,
        "n": en.group(1).replace("\\'", "'"),
        "y": country,
        # Metro entries expand to every airport in the city (LON -> LHR/LGW/...).
        "city": 1 if "isCity: true" in tail else 0,
    }
curated = len(airports)
# The website's importance bonus keys off precisely this set:
#   const CURATED_AIRPORT_CODES = new Set(AIRPORTS.map(a => a.code))
curated_codes = set(airports)

# Private/business-aviation airports the website demotes rather than hides.
non_commercial = set()
_nc_src = os.path.join(website, "app", "lib", "nearby-airports.ts")
if os.path.exists(_nc_src):
    _nc_text = io.open(_nc_src, encoding="utf-8").read()
    _m = re.search(r"KNOWN_NON_COMMERCIAL_IATAS[^=]*=\s*new Set\(\[(.*?)\]\)", _nc_text, re.S)
    if _m:
        non_commercial = set(re.findall(r"'([A-Z0-9]{3})'", _m.group(1)))
print("  %-38s %6d curated, %d private-aviation" % ("source sets", len(curated_codes), len(non_commercial)))

# ---- The generated tables: everything else worth offering. These are plain
#      JSON objects inside a TS file, so they parse once the wrapper is cut off
#      and `undefined` is turned into null.
def load_generated(path):
    if not os.path.exists(path):
        return []
    text = io.open(path, encoding="utf-8").read()
    start = text.index("= [", text.index("export const")) + 2
    # Scan to the bracket that actually closes this array. rindex("]") grabbed
    # the last bracket in the FILE, which in a module with more than one export
    # swallows the code between them and fails as "Extra data".
    depth, i = 0, start
    while i < len(text):
        ch = text[i]
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                break
        elif ch in "\"'":
            quote = ch
            i += 1
            while i < len(text) and text[i] != quote:
                i += 2 if text[i] == "\\" else 1
        i += 1
    body = text[start:i + 1]
    body = re.sub(r":\s*undefined", ": null", body)
    try:
        return json.loads(body)
    except ValueError as exc:
        print("  ! could not parse %s (%s)" % (os.path.basename(path), exc))
        return []


# A handful of metros cannot be resolved from the member data because some
# members carry no city at all (LGA has none, so "New York" ties with "Newark"
# at one vote and the shortest-label tiebreak picks the wrong one). These are
# the names travellers actually use; everything else is derived.
METRO_OVERRIDES = {
    "NYC": "New York", "MIL": "Milan", "SPK": "Sapporo", "YMQ": "Montreal",
    "DKR": "Dakar", "TCI": "Tenerife", "RIO": "Rio de Janeiro",
    "SAO": "Sao Paulo", "BHZ": "Belo Horizonte",
}


def norm(v):
    return re.sub(r"[^a-z0-9 ]", "", (v or "").lower()).strip()


def resolve_metro_name(entry, by_code):
    """Port of the website's resolveLocationDisplayName.

    The raw table names a metro after whichever member airport happened to be
    first -- NYC comes through as "Newark", PAR as "Beauvais/Tille". The site
    recovers the real name by taking the most common member CITY, preferring
    one that matches the metro's own name or an alias, then the shortest.
    """
    if entry.get("code") in METRO_OVERRIDES:
        return METRO_OVERRIDES[entry["code"]]
    if entry.get("type") != "city" or not entry.get("airports"):
        return entry.get("name") or ""
    aliases = set(norm(a) for a in (entry.get("aliases") or []))
    entry_name = norm(entry.get("name"))
    cands = {}
    for code in entry["airports"]:
        member = by_code.get(code)
        label = ((member or {}).get("city") or "").strip()
        key = norm(label)
        if not key:
            continue
        if key in cands:
            cands[key]["count"] += 1
            continue
        cands[key] = {
            "label": label, "count": 1,
            "alias": key in aliases,
            # The metro's own name wins ties: San Francisco (SFO/OAK/SJC all
            # tie on count) must not display as "Oakland".
            "name": key == entry_name or entry_name.startswith(key + " "),
        }
    best = None
    for c in cands.values():
        if best is None or (c["count"], c["name"], c["alias"], -len(c["label"])) >                            (best["count"], best["name"], best["alias"], -len(best["label"])):
            best = c
    return (best or {}).get("label") or entry.get("name") or ""


for rel in (("app", "lib", "generated-locations.ts"),
            ("app", "lib", "generated-airport-supplement.ts")):
    path = os.path.join(website, *rel)
    entries = load_generated(path)
    print("  %-38s %6d entries" % (rel[-1], len(entries)))
    by_code = {e.get("code"): e for e in entries if e.get("code")}
    for e in entries:
        code = (e.get("code") or "").upper()
        if not re.match(r"^[A-Z0-9]{3}$", code):
            continue
        # The curated list wins: its names are the ones the site shows.
        if code in airports and airports[code].get("_curated", True) and code in airports:
            if airports[code]["n"]:
                continue
        # A metro's `city` field names one of its MEMBER cities, so taking it
        # turned NYC into "Newark" and PAR into "Beauvais/Tille". For a metro
        # the display name is `name`; for a single airport, `city` is the
        # better label ("Anaa" rather than "Anaa Airport").
        if e.get("type") == "city":
            name = resolve_metro_name(e, by_code)
        else:
            name = e.get("city") or e.get("name") or ""
        # "Anaa Airport" -> "Anaa": the picker shows a place, not a facility.
        name = re.sub(r"\s*\b(International|Intl\.?|Regional|Municipal|Airport|Apt)\b", "", name).strip()
        name = name.split(" / ")[0].strip(" -,")
        if not name:
            continue
        airports.setdefault(code, {
            "c": code,
            "n": name,
            "y": (e.get("country") or "").upper(),
            "city": 1 if e.get("type") == "city" else 0,
        })

# ---- Coordinates, for the results map. AIRPORTS_DB is OurAirports data
#      (public domain) already vendored by the website as JSON-in-TS.
coord_path = os.path.join(website, "app", "lib", "airports-db.generated.ts")
coords = 0
if os.path.exists(coord_path):
    text = io.open(coord_path, encoding="utf-8").read()
    start = text.index("= [", text.index("AIRPORTS_DB")) + 2
    depth, i = 0, start
    while i < len(text):
        ch = text[i]
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                break
        elif ch in "\"'":
            q = ch
            i += 1
            while i < len(text) and text[i] != q:
                i += 2 if text[i] == "\\" else 1
        i += 1
    try:
        db = json.loads(text[start:i + 1])
    except ValueError as exc:
        print("  ! could not parse airports-db (%s)" % exc)
        db = []
    print("  %-38s %6d entries" % ("airports-db.generated.ts", len(db)))
    # Presence in AIRPORTS_DB is exactly how the website decides an airport is
    # flyable: `const USABLE_IATAS = new Set(AIRPORTS_DB.map(a => a.c))`. Without
    # this flag the picker ranked "Stuttgart SGT (US)" -- a strip in Arkansas
    # with no scheduled service -- above Stuttgart STR, because both match the
    # name equally well and nothing said which one you can actually fly from.
    for e in db:
        code = (e.get("c") or "").upper()
        row = airports.get(code)
        if not row:
            continue
        row["u"] = 1
        lat, lon = e.get("lat"), e.get("lon")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            # Rounded to ~11 m, which is far finer than a map pin needs and
            # keeps the file small.
            row["lat"] = round(float(lat), 4)
            row["lon"] = round(float(lon), 4)
            coords += 1

# A metro has no coordinates of its own; borrow its busiest member so the map
# still centres somewhere sensible for "London (LON)".
METRO_ANCHOR = {
    "LON": "LHR", "NYC": "JFK", "PAR": "CDG", "TYO": "HND", "MIL": "MXP",
    "ROM": "FCO", "MOW": "SVO", "SEL": "ICN", "OSA": "KIX", "SAO": "GRU",
    "RIO": "GIG", "BUE": "EZE", "WAS": "IAD", "CHI": "ORD", "TCI": "TFS",
    "STO": "ARN", "BJS": "PEK", "SHA": "PVG", "YTO": "YYZ", "YMQ": "YUL",
    "JKT": "CGK", "DKR": "DSS", "REK": "KEF", "SPK": "CTS", "IZM": "ADB",
    "ANK": "ESB", "BHZ": "CNF",
}
for metro, anchor in METRO_ANCHOR.items():
    row, src_row = airports.get(metro), airports.get(anchor)
    if row and src_row and "lat" in src_row and "lat" not in row:
        row["lat"], row["lon"] = src_row["lat"], src_row["lon"]
        coords += 1

# Multi-airport metros (LON, NYC, PAR) are not in OurAirports' airport list but
# ARE flyable everywhere -- the website whitelists them the same way.
for row in airports.values():
    if row.get("city"):
        row["u"] = 1

# The curated top-200 list carries the website's importance bonus (+30), which
# is what makes a major beat an obscure same-name match.
for code in curated_codes:
    row = airports.get(code)
    if row:
        row["cur"] = 1

# Real but private/business-aviation airports: shown, ranked last, never hidden.
for code in non_commercial:
    row = airports.get(code)
    if row:
        row["p"] = 1
        row.pop("u", None)

print("  %-38s %6d usable, %d curated, %d private" % (
    "flags", sum(1 for r in airports.values() if r.get("u")),
    sum(1 for r in airports.values() if r.get("cur")),
    sum(1 for r in airports.values() if r.get("p"))))

rows = sorted(airports.values(), key=lambda a: a["c"])
os.makedirs(os.path.dirname(OUT), exist_ok=True)
io.open(OUT, "w", encoding="utf-8", newline="").write(
    json.dumps(rows, ensure_ascii=False, separators=(",", ":")))
print("curated %d, total %d, with coords %d -> %s (%.0f KB)"
      % (curated, len(rows), coords, os.path.relpath(OUT), os.path.getsize(OUT) / 1024.0))
