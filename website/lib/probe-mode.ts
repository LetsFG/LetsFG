const TRUTHY_PROBE_VALUES = new Set(['1', 'true', 'yes', 'probe'])

export type ProbeModeScalar = string | number | boolean
export type ProbeModeValue = ProbeModeScalar | ProbeModeScalar[] | null | undefined

function normalizeProbeValue(value: ProbeModeScalar | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined
  }

  return String(value)
}

export function firstQueryValue(value: ProbeModeValue): string | undefined {
  if (Array.isArray(value)) {
    return normalizeProbeValue(value[0])
  }

  return normalizeProbeValue(value)
}

export function isProbeModeValue(value: ProbeModeValue): boolean {
  const resolved = firstQueryValue(value)
  if (!resolved) {
    return false
  }

  return TRUTHY_PROBE_VALUES.has(resolved.trim().toLowerCase())
}

export function getProbeAnalyticsSearchId(searchId: string): string {
  return `probe:${searchId}`
}

export function getTrackingSearchId(searchId: string | null | undefined, isProbe: boolean): string | null {
  if (!searchId) {
    return null
  }

  return isProbe ? getProbeAnalyticsSearchId(searchId) : searchId
}

export function getTrackedSourcePath(path: string, isProbe: boolean): string {
  if (!isProbe) {
    return path
  }

  return path.includes('?') ? `${path}&probe=1` : `${path}?probe=1`
}

export function appendProbeParam(params: URLSearchParams, isProbe: boolean) {
  if (isProbe) {
    params.set('probe', '1')
  }
}