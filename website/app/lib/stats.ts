/**
 * In-memory stats singleton — shared between the page server component and
 * the /api/search route handler (same Node.js process, same module instance).
 *
 * Starts at 0 — no fake seed values. Once the backend deploys, getPublicStats()
 * in page.tsx will prefer real API data. This module is only a local fallback.
 */

interface SiteStats {
  totalSearches: number
  savingsSum: number
  savingsCount: number
  airlinesCheckedSum: number
  airlinesCheckedCount: number
}

const _stats: SiteStats = {
  totalSearches: 0,
  savingsSum: 0,
  savingsCount: 0,
  airlinesCheckedSum: 0,
  airlinesCheckedCount: 0,
}

export function getLocalStats() {
  return {
    totalSearches: _stats.totalSearches,
    avgSavings: _stats.savingsCount > 0
      ? Math.round(_stats.savingsSum / _stats.savingsCount)
      : null,
    avgAirlinesChecked: _stats.airlinesCheckedCount > 0
      ? Math.round(_stats.airlinesCheckedSum / _stats.airlinesCheckedCount)
      : null,
  }
}

export function recordLocalSearch(savingsUsd?: number, airlinesChecked?: number) {
  _stats.totalSearches += 1
  if (typeof savingsUsd === 'number' && savingsUsd >= 0) {
    _stats.savingsSum += savingsUsd
    _stats.savingsCount += 1
  }
  if (typeof airlinesChecked === 'number' && airlinesChecked > 0) {
    _stats.airlinesCheckedSum += airlinesChecked
    _stats.airlinesCheckedCount += 1
  }
}
