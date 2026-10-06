/**
 * Asia/Kolkata calendar helpers. The server may run in UTC; campus rules
 * (quiet hours, "tomorrow's class") are stated in IST, so they are computed
 * here explicitly rather than from the host clock's zone.
 */
export const IST_OFFSET_MINUTES = 330;

/** { y, m, d, hour, minute, weekday } of an instant, in IST. */
export function istParts(at = new Date()) {
  const shifted = new Date(new Date(at).getTime() + IST_OFFSET_MINUTES * 60000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay()
  };
}

const pad = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the IST calendar day containing `at`, offset by `addDays`. */
export function istDateKey(at = new Date(), addDays = 0) {
  const p = istParts(new Date(new Date(at).getTime() + addDays * 864e5));
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Weekday (0 = Sunday) of an IST date key. */
export function weekdayOf(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The instant of HH:MM IST on an IST date key. */
export function istInstant(dateKey, hhmm = "00:00") {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, min) - IST_OFFSET_MINUTES * 60000);
}

export function isValidDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Round-trip, so 2026-13-40 (which Date would silently roll over) is refused.
  const at = istInstant(value);
  return !Number.isNaN(at.getTime()) && istDateKey(at) === value;
}

// ---- quiet hours -----------------------------------------------------------
export const QUIET_HOURS = { start: "22:00", end: "07:00", digestAt: "07:30" };

/** True between 22:00 and 07:00 IST. */
export function inQuietHours(at = new Date()) {
  const { hour } = istParts(at);
  return hour >= 22 || hour < 7;
}

/** The 07:30 IST digest instant that follows `at`. */
export function nextDigestAt(at = new Date()) {
  const { hour } = istParts(at);
  // After 22:00 the digest is tomorrow morning; before 07:30 it is today.
  const key = hour >= 22 ? istDateKey(at, 1) : istDateKey(at);
  const candidate = istInstant(key, QUIET_HOURS.digestAt);
  return candidate.getTime() > new Date(at).getTime() ? candidate : istInstant(istDateKey(at, 1), QUIET_HOURS.digestAt);
}
