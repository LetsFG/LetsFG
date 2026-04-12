"""
TEMPLATE: Playwright-based airline connector.

This is a reference template for converting httpx-based connectors to Playwright.
Three proven patterns exist:

Pattern A — "Page Data Extraction" (EasyJet style):
  Navigate to homepage → fill search form → submit → wait for JS data in page
  Extract: window.someGlobal.searchResult or similar
  Best for: SPAs that store results in global state

Pattern B — "API Response Interception" (Norwegian / Wizzair style):
  Navigate to homepage → set up route interception → fill search form → submit
  Intercept: specific API URL pattern (e.g. /api/search/*)
  Best for: SPAs that call REST/GraphQL APIs

Pattern C — "DOM Scraping" (fallback):
  Navigate to homepage → fill search form → submit → scrape result cards from DOM
  Extract: flight cards, prices, times from HTML elements
  Best for: Server-rendered pages or when API/global data isn't accessible

Common elements across all patterns:
- Shared headed Chrome browser singleton (reused across searches)
- playwright-stealth for anti-detection
- Cookie/consent banner dismissal
- Random viewport/locale/timezone rotation
- Form filling: airport autocomplete + date picker + search button
- Timeout handling with graceful degradation (return empty, don't crash)

KEY LESSONS LEARNED:
1. ALL airline APIs are behind WAF (Cloudflare/Akamai/Datadome) — direct HTTP always 403
2. Cookie banners BLOCK CLICKS if not dismissed — always handle first
3. The "Accept" button text varies: "Accept", "Accept All Cookies", "Accept all", etc.
4. Airport autocomplete suggestions may be: links, radio buttons, listbox options, or divs
5. Date picker formats vary wildly: "15 April 2026", "April 15, 2026", "2026-04-15"
6. Month headings may be uppercase ("APRIL 2026") or title case ("April 2026")
7. One-way vs return trip toggles differ per airline
8. Always select outbound date BEFORE toggling one-way
9. Use `page.wait_for_url()` after clicking search to confirm navigation
10. Increase timeouts for suggestions/dropdowns (2-3s), allow 5s+ for API responses

ROUTE COVERAGE — MANDATORY FOR ALL NEW connectors:
After building/fixing a connector, you MUST add its airline to the route coverage
registry in `travel-cli/api/services/airline_routes.py`. This is how the provider
decides which connectors to call for a given route. Without it, the connector still
works but runs on EVERY search (wastes resources).

In `airline_routes.py`, add your airline to the `AIRLINE_COUNTRIES` dict:

    "myairline": {"US", "CA", "MX"},  # countries where this airline flies

The key is derived from the connector filename:
  - `myairline.py` → key is `"myairline"`
  - `airindiaexpress.py` → key is `"airindiaexpress"`

The provider strips `_direct` and `_connector` from the source name in
`_DIRECT_AIRLINE_connectorS` to get the lookup key. If your airline is not in the
dict, it will run on ALL routes (safe but wasteful).

Also add any airports your airline uses to `AIRPORT_COUNTRY` if they're missing.
"""
