# Google Flights — Date Grid scraping

How to extract the **±3 outbound × ±3 return** price grid (49 round-trip combos
in one shot) directly from `google.com/travel/flights`.

This document is the result of live R&D in a Playwright browser session.
The selectors below are confirmed working as of 2026-05-25 against
`google.com/travel/flights` with locale=PL, currency=PLN.

---

## 1. Open a search

URL pattern that pre-fills the search form (no clicks needed):

```
https://www.google.com/travel/flights?q=Flights from {ORIGIN_IATA} to {DEST_IATA} on {YYYY-MM-DD} through {YYYY-MM-DD}
```

Example (Gdańsk → London, Jun 10 → Jun 14):

```
https://www.google.com/travel/flights?q=Flights%20from%20GDN%20to%20LTN%20on%202026-06-10%20through%202026-06-14
```

The page lands on results and auto-runs the search. No login needed.

### Consent gate

On a fresh profile Google will redirect to `consent.google.com`. Click the
button with `textContent === "Reject all"` (or "Accept all") to dismiss it.

```python
await page.locator("button:has-text('Reject all')").click()
```

---

## 2. Open the Date grid

On the results page there is a button labelled **"Date grid"** in the toolbar
(see screenshot — top-right area, next to "Price graph").

```python
await page.locator("button:has-text('Date grid')").click()
```

A modal opens with a 7×7 (or smaller, depending on filters) grid showing
PLN-formatted prices for every (outbound, return) date combination within
±3 days of the originally selected dates.

---

## 3. Scrape the prices

**Critical gotcha:** the visible grid is rendered to a `<canvas>` element
(class `Nk9ZY`, `role="grid"`, `aria-label="Date grid"`). The canvas itself
is unscrapable.

**The fix:** Google ships a parallel **DOM accessibility layer** for screen
readers as a sibling div with class `mrywM`. Every cell in there has:

- `role="button"`
- `data-row` and `data-col` attributes (integer grid coordinates)
- `aria-label="PLN 578, Jun 7 to Jun 11"` — currency, price, outbound date, return date
- `class*="pIviAd"` when the cell is among the cheaper options (visual styling marker)

### Selector

```css
.mrywM [role="button"][data-row][data-col]
```

### Aria-label parse regex

```regex
^(?:[A-Z]{3})\s+(\d[\d,.]*),\s*(\w+\s+\d+)\s+to\s+(\w+\s+\d+)$
```

Capture groups:
1. price (int, may have thousand-separator comma/dot)
2. outbound date (e.g. "Jun 7")
3. return date (e.g. "Jun 11")

### "No flights" cells

Cells where Google has no round-trip combo have `aria-label="no flights, Jun 11 to Jun 11"`.
Ignore these (price is null).

### Header row (dates without prices)

The first row of `mrywM` is the column headers (Sun Jun 7, Mon Jun 8, ...).
These are `<div class="pJYzRb DmxQAb">` and DON'T have `data-row`/`data-col`
or `role="button"`, so the selector above already excludes them.

---

## 4. Output shape

Suggested structured return from the connector:

```python
{
    "origin": "GDN",
    "destination": "LTN",
    "currency": "PLN",
    "selected_outbound": "2026-06-10",
    "selected_return": "2026-06-14",
    "scraped_at": "2026-05-25T15:07:30Z",
    "grid": [
        {"outbound": "2026-06-07", "return": "2026-06-11", "price": 578, "is_cheaper": False},
        {"outbound": "2026-06-08", "return": "2026-06-11", "price": 758, "is_cheaper": False},
        # ... up to 49 entries
        {"outbound": "2026-06-11", "return": "2026-06-11", "price": None},  # "no flights"
    ],
}
```

Date strings in the grid are abbreviations ("Jun 7") — the connector needs
to combine them with the known year context from the search to emit full
ISO dates. Use the column-header row in `mrywM` to anchor years.

---

## 5. Currency

The currency code comes from the `aria-label` prefix on every cell ("PLN", "EUR", ...).
Google Flights shows prices in the country's locale currency by default.
Force a specific currency by setting `&curr={ISO}` on the search URL OR by changing
the footer's "Currency" picker (currency.google.com cookie).

---

## 6. Limits & notes

- **±3 days only** — you cannot widen the grid window from the UI. For wider
  flexibility (e.g. "whole month"), use the date-input calendar instead
  (each month has all-day prices visible — see `google_flights_calendar.md`
  if/when we add that connector).
- The grid loads asynchronously — wait for at least one `[role="button"][data-row]`
  in `.mrywM` before reading.
- Initial render shows `"Loading prices"` placeholders. Wait for them to disappear,
  or simply re-query until count of cells with parseable PLN labels ≥ expected (≤49).
- One-way searches only show a 1-row × 7-col grid (no return-date dimension).

---

## 7. Playwright sketch

```python
async def scrape_date_grid(origin: str, destination: str, dep_date: str, ret_date: str) -> dict:
    url = (
        f"https://www.google.com/travel/flights?q="
        f"Flights%20from%20{origin}%20to%20{destination}"
        f"%20on%20{dep_date}%20through%20{ret_date}"
    )
    async with chromium.launch() as browser:
        page = await browser.new_page()
        await page.goto(url)
        # Consent
        if await page.locator("button:has-text('Reject all')").count():
            await page.locator("button:has-text('Reject all')").click()
        # Open grid
        await page.locator("button:has-text('Date grid')").click()
        # Wait for cells
        await page.wait_for_selector(
            ".mrywM [role='button'][data-row][data-col]", state="attached"
        )
        # Extract
        cells = await page.eval_on_selector_all(
            ".mrywM [role='button'][data-row][data-col]",
            """nodes => nodes.map(n => ({
                row: parseInt(n.dataset.row),
                col: parseInt(n.dataset.col),
                label: n.getAttribute('aria-label'),
            }))""",
        )
        return parse_cells(cells)
```

---

## Verified data from session 2026-05-25

Search: Gdańsk → London, Jun 10 → Jun 14, locale=PL, currency=PLN.

- 46 priced cells, 3 "no flights" cells (Jun 11 → Jun 11, Jun 13 → Jun 13, Sat Jun 13 col empty)
- Outbound range: Jun 7 → Jun 13 (selected center: Jun 10)
- Return range: Jun 11 → Jun 17 (selected center: Jun 14)
- Cheapest: PLN 268 (multiple combos)
