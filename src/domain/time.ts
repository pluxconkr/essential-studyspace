/**
 * Time helpers for New Jersey (America/New_York, with daylight saving). Formatting goes through
 * Intl with an explicit time zone so a commuter whose phone is set to another zone still sees
 * library hours in library time. A demo clock offset can shift "now" for the demo scenarios.
 *
 * How it fits: this module owns the app clock. nowMs() is device time plus the demo offset, and hours, levels,
 * ranking and sessions are computed against it; facts stamped in device time (a GPS fix, a cache download) are
 * compared with Date.now() instead. zonedParts() and zonedToEpoch() are the only bridge between instants and
 * NJ dates / minutes of day, used by hours, typical curves, free blocks, focus stats and the relay's report
 * buckets. The formatters return display strings in the current language. Pure apart from the clock offset
 * and a per-minute memo.
 */

import { t, tlist, tn } from '@/i18n';

/** The one time zone the app reasons in: library hours are New Jersey time whatever the phone is set to. */
export const TZ = 'America/New_York';

/** Demo-scenario shift of the app clock in ms (0 = real time). Memory only: settings never persist it. */
let clockOffsetMs = 0;

/**
 * Set by the demo scenario loader. 0 = real time; a non-finite value counts as 0. Shifts nowMs() app-wide.
 * Called by services/demo.ts and by actions.patchSettings, which keeps it equal to settings.demoClockOffsetMs.
 */
export function setClockOffset(ms: number): void {
  clockOffsetMs = Number.isFinite(ms) ? ms : 0;
}
/**
 * The app's notion of now (device clock + demo offset). Hours, levels, ranking, check-in times and sessions use it.
 * Facts stamped in device time (GPS fixes, cache downloads) are compared with Date.now() instead, so a demo shift
 * cannot make them look fresh or stale.
 */
export function nowMs(): number {
  return Date.now() + clockOffsetMs;
}
/** ISO 8601 string for an instant, by default the app clock's now. Stamps check-ins, watches and watch notices, prefs saves and session pauses. */
export function nowIso(now: number = nowMs()): string {
  return new Date(now).toISOString();
}

/** Parse an ISO 8601 string (with or without offset) to epoch ms; NaN if invalid. A number passes through as epoch ms; null/undefined give NaN. */
export function toEpoch(iso: string | number | null | undefined): number {
  if (iso === null || iso === undefined) return NaN;
  if (typeof iso === 'number') return iso;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
}

/** An instant as New Jersey wall-clock parts (zonedParts). */
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

/** Intl's short English weekday names → JS getDay numbers (0 = Sunday). */
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** One shared formatter for NJ parts. 'en-US' keeps weekday names in the form WEEKDAY_INDEX expects; h23 asks for a 0–23 hour. */
const PARTS_FMT = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** zonedParts results keyed by epoch minute; cleared wholesale once it passes 512 entries. */
const zpCache = new Map<number, ZonedParts>();
/** Break an instant into local (NJ) calendar parts. Memoised per minute: the parts carry no seconds, and one ranking tick asks for the same minute hundreds of times. */
export function zonedParts(epochMs: number): ZonedParts {
  const key = Math.floor(epochMs / 60_000);
  const hit = zpCache.get(key);
  if (hit) return hit;
  if (zpCache.size > 512) zpCache.clear();
  const out = computeZonedParts(epochMs);
  zpCache.set(key, out);
  return out;
}

/** The uncached work behind zonedParts: one formatToParts call in the NJ zone. Falls back to the device's weekday if Intl's name is unknown. */
function computeZonedParts(epochMs: number): ZonedParts {
  const parts = PARTS_FMT.formatToParts(new Date(epochMs));
  // The value of one formatted part, '' when absent.
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

/** Zero-pads to two digits: 7 → "07". */
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Offset of the zone (ms east of UTC) at a given instant: −4 h in EDT, −5 h in EST. Minute precision. */
function offsetAt(epochMs: number): number {
  const p = zonedParts(epochMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  const truncated = epochMs - (epochMs % 60_000);
  return asUtc - truncated;
}

/**
 * Local calendar date + minutes since midnight → epoch ms. Minutes may exceed 1440 (spills into the next day).
 * On DST days a wall time that does not exist (the skipped spring-forward hour) lands one hour earlier, and a
 * repeated fall-back hour resolves to its first (daylight-time) occurrence.
 */
export function zonedToEpoch(dateKey: string, minutesOfDay: number): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + minutesOfDay * 60_000;
  // Two passes handle the DST transition days.
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

/** "YYYY-MM-DD" for the local day `days` after the given day (negative goes back). Calendar arithmetic only, so DST cannot shift it. */
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
  return `${h12}:${pad2(mm)} ${h24 < 12 ? t('time.am') : t('time.pm')}`;
}

/** "8 AM" / "2:30 PM" — drops ":00" like iOS does in hour tables. */
export function formatMinutesShort(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ap = h24 < 12 ? t('time.am') : t('time.pm');
  return mm === 0 ? `${h12} ${ap}` : `${h12}:${pad2(mm)} ${ap}`;
}

/** "2:30 PM" in NJ time; "—" for a missing or invalid time. */
export function formatClock(input: string | number | null | undefined): string {
  const ms = toEpoch(input);
  if (!Number.isFinite(ms)) return '—';
  return formatMinutes(zonedParts(ms).minutesOfDay);
}

/** Short weekday name (0 = Sunday) in the current language. */
export const dayName = (i: number) => tlist('time.days')[((i % 7) + 7) % 7];
/** Full weekday name (0 = Sunday) in the current language, e.g. "Wednesday". */
export const dayLong = (i: number) => tlist('time.daysLong')[((i % 7) + 7) % 7];
/** Short month name (0 = January) in the current language. */
const monthName = (i: number) => tlist('time.months')[i];

/** "Mon 2:30 PM" in NJ time; "—" when invalid. */
export function formatShort(input: string | number | null | undefined): string {
  const ms = toEpoch(input);
  if (!Number.isFinite(ms)) return '—';
  const p = zonedParts(ms);
  return `${dayName(p.weekday)} ${formatMinutes(p.minutesOfDay)}`;
}

/** "2026-10-03 14:02 ET" — compact stamp for provenance rows. */
export function formatStamp(input: string | number | null | undefined): string {
  const ms = toEpoch(input);
  if (!Number.isFinite(ms)) return '—';
  const p = zonedParts(ms);
  return `${p.dateKey} ${pad2(p.hour)}:${pad2(p.minute)} ET`;
}

/** "Sat 3 Oct" in NJ time; "—" when invalid. */
export function formatDate(input: string | number | null | undefined): string {
  const ms = toEpoch(input);
  if (!Number.isFinite(ms)) return '—';
  const p = zonedParts(ms);
  return `${dayName(p.weekday)} ${p.day} ${monthName(p.month - 1)}`;
}

/**
 * Relative age: "just now", "5 min ago", "3 hours ago", "2 days ago"; "never" for a missing or invalid time, "just now"
 * for a future one. `now` defaults to the app clock; pass device time for device-stamped facts such as cache ages.
 */
export function relativeAgo(input: string | number | null | undefined, now: number = nowMs()): string {
  const ms = toEpoch(input);
  if (!Number.isFinite(ms)) return t('time.never');
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('time.justNow');
  if (min < 60) return t('time.minAgo', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return tn(h, 'time.hoursAgo');
  return tn(Math.floor(h / 24), 'time.daysAgo');
}

/** "in 25 min" / "in 2 h 10 min", rounded to the minute. Never negative. */
export function formatIn(msAhead: number): string {
  const min = Math.max(0, Math.round(msAhead / 60_000));
  if (min < 60) return t('time.inMin', { n: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? t('time.inH', { h }) : t('time.inHM', { h, m });
}

/** "14h 20m" / "45m" from seconds, rounded to whole minutes (so 1 h 59 min 59 s reads "2h 00m"). */
export function formatDuration(seconds: number): string {
  const totalMin = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return t('focus.durationM', { m });
  return t('focus.durationH', { h, m: pad2(m) });
}

/** "24:59" for timers. Rounds up, so a countdown reads 0:00 only when its time is up. */
export function formatMMSS(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

/** Cached venue directories older than this are flagged amber. */
export const STALE_AFTER_DAYS = 30;

/**
 * True when `fetchedAt` is missing, unparseable or more than `days` days before `now`. The Offline data screen
 * passes device time with 30 days for the directory, 1/24 (one hour) for live levels and 7 for typical patterns.
 */
export function isStale(fetchedAt: string | number | null | undefined, now: number = nowMs(), days = STALE_AFTER_DAYS): boolean {
  const ms = toEpoch(fetchedAt);
  if (!Number.isFinite(ms)) return true;
  return now - ms > days * 24 * 3600_000;
}

/** Saturday or Sunday on the NJ calendar. Fusion uses it to pick the slower weekend half-life. */
export function isWeekend(epochMs: number): boolean {
  const w = zonedParts(epochMs).weekday;
  return w === 0 || w === 6;
}
