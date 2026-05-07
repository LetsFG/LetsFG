const FLIGHT_DATETIME_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/

interface FlightDateTimeParts {
  year: number
  month: number
  day: number
  hour?: number
  minute?: number
}

function parseFlightDateTimeParts(value: string): FlightDateTimeParts | null {
  const match = value.match(FLIGHT_DATETIME_PREFIX_RE)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = match[4] === undefined ? undefined : Number(match[4])
  const minute = match[5] === undefined ? undefined : Number(match[5])

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }
  if (hour !== undefined && (!Number.isInteger(hour) || hour < 0 || hour > 23)) {
    return null
  }
  if (minute !== undefined && (!Number.isInteger(minute) || minute < 0 || minute > 59)) {
    return null
  }

  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null
  }

  return { year, month, day, hour, minute }
}

export function hasExplicitFlightTime(value: string): boolean {
  const parts = parseFlightDateTimeParts(value)
  if (parts) {
    return parts.hour !== undefined && parts.minute !== undefined
  }

  return /(?:T|\s)\d{2}:\d{2}/.test(value)
}

export function formatFlightTime(value: string): string {
  const parts = parseFlightDateTimeParts(value)
  if (parts) {
    if (parts.hour !== undefined && parts.minute !== undefined) {
      return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
    }

    return '--:--'
  }

  if (!hasExplicitFlightTime(value)) {
    return '--:--'
  }

  try {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
      }).format(date)
    }
  } catch {
    // Fall through to returning the original value.
  }

  return value
}

export function formatFlightDateCompact(value: string): string {
  const parts = parseFlightDateTimeParts(value)
  if (parts) {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)))
  }

  try {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      }).format(date)
    }
  } catch {
    // Fall through.
  }

  return ''
}

export interface FlightTimeContext {
  /** Calendar days arrival is after departure (0 = same day, 1 = next day, etc.) */
  dayOffset: number
  /** Net timezone shift in minutes: destination_tz - origin_tz.
   *  Negative = destination clocks are behind (e.g. LAX→HNL = -180). */
  tzOffsetMins: number
}

/**
 * Given departure datetime, arrival datetime (both as local airport times),
 * and the actual flight duration in minutes, compute the day offset and
 * net timezone shift so the UI can display context to the user.
 */
export function computeFlightTimeContext(
  departureDt: string,
  arrivalDt: string,
  durationMins: number,
): FlightTimeContext {
  const dep = parseFlightDateTimeParts(departureDt)
  const arr = parseFlightDateTimeParts(arrivalDt)

  if (!dep || !arr) return { dayOffset: 0, tzOffsetMins: 0 }

  const depDate = Date.UTC(dep.year, dep.month - 1, dep.day)
  const arrDate = Date.UTC(arr.year, arr.month - 1, arr.day)
  const dayOffset = Math.round((arrDate - depDate) / 86400000)

  if (
    dep.hour === undefined || dep.minute === undefined ||
    arr.hour === undefined || arr.minute === undefined ||
    durationMins <= 0
  ) {
    return { dayOffset, tzOffsetMins: 0 }
  }

  const depMins = dep.hour * 60 + dep.minute
  const arrMins = arr.hour * 60 + arr.minute
  // tzOffsetMins = how far destination clock is shifted vs origin clock
  const tzOffsetMins = (arrMins - depMins + dayOffset * 1440) - durationMins

  return { dayOffset, tzOffsetMins }
}

export function extractFlightClockMinutes(value: string): number {
  const parts = parseFlightDateTimeParts(value)
  if (parts?.hour !== undefined && parts.minute !== undefined) {
    return parts.hour * 60 + parts.minute
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 0
  }

  return date.getUTCHours() * 60 + date.getUTCMinutes()
}