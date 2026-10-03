/**
 * Time helpers for New Jersey (America/New_York, with daylight saving). Formatting goes through
 * Intl with an explicit time zone so a commuter whose phone is set to another zone still sees
 * library hours in library time. A demo clock offset can shift "now" for the late-night scenario.
 */

export const TZ = 'America/New_York';

let clockOffsetMs = 0;

/** Set by the demo scenario loader. 0 = real time. */
export function setClockOffset(ms: number): void {
  clockOffsetMs = Number.isFinite(ms) ? ms : 0;
}
export function getClockOffset(): number {
  return clockOffsetMs;
}
/** The app's notion of now (device clock + demo offset). Every time-based derivation uses this. */
export function nowMs(): number {
  return Date.now() + clockOffsetMs;
}
export function nowIso(now: number = nowMs()): string {
  return new Date(now).toISOString();
}

/** Parse an ISO 8601 string (with or without offset) to epoch ms; NaN if invalid. */
export function toEpoch(iso: string | number | null | undefined): number {
  if (iso === null || iso === undefined) return NaN;
  if (typeof iso === 'number') return iso;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
}

export interface ZonedParts {
  year: number;
  month: number; // 1..12
  day: number;
  weekday: number; // 0 = Sunday
  hour: number;
  minute: number;
  /** "YYYY-MM-DD" in the zone. */
  dateKey: string;
  /** Minutes since local midnight. */
  minutesOfDay: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

/** Break an instant into local (NJ) calendar parts. */
export function zonedParts(epochMs: number): ZonedParts {
  const parts = fmt({ weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epochMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = Number(get('hour')) % 24; // some engines emit "24" at midnight
  const minute = Number(get('minute'));
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  return {
    year,
    month,
    day,
    weekday: WEEKDAY_INDEX[get('weekday')] ?? new Date(epochMs).getDay(),
    hour,
    minute,
    dateKey: `${year}-${pad2(month)}-${pad2(day)}`,
    minutesOfDay: hour * 60 + minute,
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Offset of the zone (ms east of UTC) at a given instant. */
function offsetAt(epochMs: number): number {
  const p = zonedParts(epochMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  const truncated = epochMs - (epochMs % 60_000);
  return asUtc - truncated;
}

/** Local calendar date + minutes since midnight → epoch ms. Minutes may exceed 1440 (spills into the next day). */
export function zonedToEpoch(dateKey: string, minutesOfDay: number): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + minutesOfDay * 60_000;
  // Two passes handle the DST transition days.
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

/** "YYYY-MM-DD" for the local day `days` after the given day. */
export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d + days, 12);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Weekday (0 = Sunday) of a local date key. */
export function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/** Parse "HH:MM" (hours may exceed 23) to minutes. NaN if invalid. */
export function hhmmToMinutes(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes since midnight → "2:30 PM" / "12:00 AM". Minutes ≥ 1440 wrap (2 a.m. next day → "2:00 AM"). */
export function formatMinutes(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad2(mm)} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** "2:30 PM" in NJ time. */
export function formatClock(input: string | number | null | undefined): string {
  const ms = toEpoch(input);
  if (!Number.isFinite(ms)) return '—';
  return formatMinutes(zonedParts(ms).minutesOfDay);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAY_NAME = DAYS;
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Mon 2:30 PM" */
export function formatShort(input: string | number | null | undefined): string {
  const ms = toEpoch(input);
  if (!Number.isFinite(ms)) return '—';
  const p = zonedParts(ms);
  return `${DAYS[p.weekday]} ${formatMinutes(p.minutesOfDay)}`;
}

/** "2026-10-03 14:02 ET" — compact stamp for provenance rows. */
export function formatStamp(input: string | number | null | undefined): string {
  const ms = toEpoch(input);
  if (!Number.isFinite(ms)) return '—';
  const p = zonedParts(ms);
  return `${p.dateKey} ${pad2(p.hour)}:${pad2(p.minute)} ET`;
}

/** "Sat 3 Oct" */
export function formatDate(input: string | number | null | undefined): string {
  const ms = toEpoch(input);
  if (!Number.isFinite(ms)) return '—';
  const p = zonedParts(ms);
  return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}`;
}

/** Relative age: "just now", "5 min ago", "3 hours ago", "2 days ago". */
export function relativeAgo(input: string | number | null | undefined, now: number = nowMs()): string {
  const ms = toEpoch(input);
  if (!Number.isFinite(ms)) return 'never';
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** "in 25 min" / "in 2 h 10 min". Never negative. */
export function formatIn(msAhead: number): string {
  const min = Math.max(0, Math.round(msAhead / 60_000));
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `in ${h} h` : `in ${h} h ${m} min`;
}

/** "14h 20m" / "45m" */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${pad2(m)}m`;
}

/** "24:59" for timers. */
export function formatMMSS(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

/** Cached venue directories older than this are flagged amber. */
export const STALE_AFTER_DAYS = 30;

export function isStale(fetchedAt: string | number | null | undefined, now: number = nowMs(), days = STALE_AFTER_DAYS): boolean {
  const ms = toEpoch(fetchedAt);
  if (!Number.isFinite(ms)) return true;
  return now - ms > days * 24 * 3600_000;
}

export function isWeekend(epochMs: number): boolean {
  const w = zonedParts(epochMs).weekday;
  return w === 0 || w === 6;
}
