# Critical Test Suites

The following test suites guard against regressions in search result quality.
They **must all pass** before any deploy to `letsfg-website-preview`.

| Suite | File | What it guards |
|---|---|---|
| `rank-offers-timezone` | `tests/rank-offers-timezone.test.ts` | `isoToMins` uses local airport time (not server UTC). Deduplification and slot assignment are consistent for offset vs no-offset timestamps from different connectors. |
| `rank-offers-dedupe` | `tests/rank-offers-dedupe.test.ts` | Dedup key includes intermediate airport codes so LHR→FRA→JFK and LHR→CDG→JFK are kept as distinct offers. Duration outlier pre-filter removes impossible short/long offers from scoring. |
| `results-offer-count-accuracy` | `tests/results-offer-count-accuracy.test.ts` | `raw_offers_analyzed` reflects the raw connector scan count; `total_results` reflects the post-filter display count. The two must differ when invalid offers are filtered. |
| `trusted-offer-duration` | `tests/trusted-offer-duration.test.ts` | Duration fallback only trusts epoch diff when both timestamps carry explicit timezone info (Z or ±HH:MM). Cross-timezone routes must not produce wrong durations. |
| `offer-validation` | `tests/offer-validation.test.ts` | All 5 suspect-detection rules in `validateOfferBatch`/`detectSuspectReason`: duration plausibility, time ordering, timezone drift, price outlier, layover anomaly. |

## Running the suites

```bash
cd LetsFG/website
npx tsx --test tests/rank-offers-timezone.test.ts
npx tsx --test tests/rank-offers-dedupe.test.ts
npx tsx --test tests/results-offer-count-accuracy.test.ts
npx tsx --test tests/trusted-offer-duration.test.ts
npx tsx --test tests/offer-validation.test.ts
```

Or all at once:

```bash
cd LetsFG/website
npx tsx --test tests/*.test.ts
```
