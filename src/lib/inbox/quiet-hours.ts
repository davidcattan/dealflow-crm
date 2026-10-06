// The automatic inbox check pauses overnight (Eastern time, so it follows
// daylight saving). The first run after the pause catches up on
// everything that arrived overnight.
export const QUIET_START_HOUR = 22 // 10pm
export const QUIET_END_HOUR = 7 // 7am
export const QUIET_TIMEZONE = 'America/New_York'

export function easternHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: QUIET_TIMEZONE, hour: 'numeric', hour12: false }).format(date)) % 24
}

export function isQuietHours(date = new Date()) {
  const h = easternHour(date)
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR
}

export const QUIET_LABEL = '10pm–7am ET'
