/**
 * Opening hours with exception calendars. Pure functions over the venue record and the clock.
 * Closing past midnight ("26:00") is handled by also checking yesterday's hours.
 * Hours are a first-class feed: a student who travels to a closed building deletes the app.
 *
 * How it fits: openState() answers "open now, until when, or when next" for the ranking (open now, open on
 * arrival, minutes of stay), the Now tab's closing-soon callout, the Map and the spot page; isOpenAt() gives
 * fusion and arrival predictions their open flag. hoursOn() resolves one date for the typical-day chart and
 * the earlier-visit hour list. hoursValid() screens a downloaded directory (repos.sanitizeVenues).
 * Dates and times are New Jersey wall-clock time (time.ts); labels come from the i18n dictionary.
 */
import { t } from '@/i18n';

import { dayName, formatMinutesShort, hhmmToMinutes, shiftDateKey, weekdayOf, zonedParts, zonedToEpoch } from './time';
import type { DayHours, HoursException, Venue } from './types';

/** One local date's hours after the exception calendar (hoursOn). */
export interface ResolvedDay {
  /** null = closed all day. */
  hours: DayHours | null;
  /** The exception that produced these hours (or a label-only exception), if any. */
  exception: HoursException | null;
}

/**
 * The exception whose inclusive date range covers `dateKey`, or null; the first match in list order wins.
 * "YYYY-MM-DD" keys compare correctly as plain strings.
 */
function exceptionFor(venue: Venue, dateKey: string): HoursException | null {
  for (const e of venue.exceptions) if (dateKey >= e.from && dateKey <= e.to) return e;
  return null;
}

/**
 * Hours in force on a local date, after applying the exception calendar. A label-only exception (hours: null)
 * keeps the regular hours but is still returned, so the UI can show its label; '24h' becomes 00:00–24:00.
 */
export function hoursOn(venue: Venue, dateKey: string): ResolvedDay {
  const ex = exceptionFor(venue, dateKey);
  const regular = venue.hours[weekdayOf(dateKey)];
  if (!ex || ex.hours === null) return { hours: regular, exception: ex };
  if (ex.hours === 'closed') return { hours: null, exception: ex };
  if (ex.hours === '24h') return { hours: { open: '00:00', close: '24:00' }, exception: ex };
  return { hours: ex.hours, exception: ex };
}

/** How far ahead to search for the next opening. */
export const NEXT_OPEN_LOOKAHEAD_DAYS = 90;

/** Open or closed at one instant, and when that changes next (openState). */
export interface OpenState {
  open: boolean;
  /** Epoch ms when the current open period ends (if open). */
  closesAt: number | null;
  /** Epoch ms when the next open period starts (if closed). */
  opensAt: number | null;
  /** Exception in force today, if any (shown as a labelled callout); yesterday's while still inside yesterday's past-midnight hours. */
  exception: HoursException | null;
  /** The day's hours as resolved (today's row, for display). */
  today: DayHours | null;
}

/**
 * Interval [start, end) in epoch ms for a day's hours. A close past "24:00" lands on the next day; null when the
 * times do not parse or close is not after open.
 */
function interval(dateKey: string, h: DayHours): [number, number] | null {
  const o = hhmmToMinutes(h.open);
  const c = hhmmToMinutes(h.close);
  if (!Number.isFinite(o) || !Number.isFinite(c) || c <= o) return null;
  return [zonedToEpoch(dateKey, o), zonedToEpoch(dateKey, c)];
}

/**
 * Open/closed at `now`, with the next transition. Looks back one day for late closings: at 1 a.m. a library whose
 * hours yesterday ran to "26:00" is still open. When it is closed for the rest of today, the next opening is searched
 * up to NEXT_OPEN_LOOKAHEAD_DAYS ahead (opensAt stays null if none is found). `today` is always today's resolved row.
 */
export function openState(venue: Venue, now: number): OpenState {
  const p = zonedParts(now);
  const today = hoursOn(venue, p.dateKey);
  const yesterday = hoursOn(venue, shiftDateKey(p.dateKey, -1));
  // Still inside yesterday's late-night period (e.g. open until 2 a.m.)?
  if (yesterday.hours) {
    const iv = interval(shiftDateKey(p.dateKey, -1), yesterday.hours);
    if (iv && now >= iv[0] && now < iv[1]) return { open: true, closesAt: iv[1], opensAt: null, exception: yesterday.exception, today: today.hours };
  }
  if (today.hours) {
    const iv = interval(p.dateKey, today.hours);
    if (iv) {
      if (now >= iv[0] && now < iv[1]) return { open: true, closesAt: iv[1], opensAt: null, exception: today.exception, today: today.hours };
      if (now < iv[0]) return { open: false, closesAt: null, opensAt: iv[0], exception: today.exception, today: today.hours };
    }
  }
  // Closed for the rest of today: find the next opening within 90 days (renovation closures last months).
  for (let i = 1; i <= NEXT_OPEN_LOOKAHEAD_DAYS; i++) {
    const key = shiftDateKey(p.dateKey, i);
    const d = hoursOn(venue, key);
    if (d.hours) {
      const iv = interval(key, d.hours);
      if (iv) return { open: false, closesAt: null, opensAt: iv[0], exception: today.exception, today: today.hours };
    }
  }
  return { open: false, closesAt: null, opensAt: null, exception: today.exception, today: today.hours };
}

/** Whether the venue is open at an arbitrary instant. Sets the open flag of a fused level and of the level at arrival; demo reports go only to open venues. */
export function isOpenAt(venue: Venue, at: number): boolean {
  return openState(venue, at).open;
}

/** Minutes until closing (rounded, never negative), or null when closed. */
export function minutesToClose(state: OpenState, now: number): number | null {
  if (!state.open || state.closesAt === null) return null;
  return Math.max(0, Math.round((state.closesAt - now) / 60_000));
}

/** A spot "opens late" when today's hours run to 11 PM or beyond (the commuter's question after dinner). */
export const LATE_CLOSE_MIN = 23 * 60;

/**
 * Whether today's hours (NJ date of `now`, exceptions applied) close at LATE_CLOSE_MIN or later, past-midnight
 * closings included; it does not ask whether the spot is open right now. Feeds the Map's "open late" layer and
 * the spot page's late-night safety numbers.
 */
export function opensLate(venue: Venue, now: number): boolean {
  const d = hoursOn(venue, zonedParts(now).dateKey).hours;
  return !!d && hhmmToMinutes(d.close) >= LATE_CLOSE_MIN;
}

/** "Closing soon" = open with an hour or less left. */
export const CLOSING_SOON_MIN = 60;

/** Whether the current open period ends within CLOSING_SOON_MIN minutes. Picks the spots for the Now tab's closing-soon callout. */
export function isClosingSoon(state: OpenState, now: number): boolean {
  const m = minutesToClose(state, now);
  return m !== null && m <= CLOSING_SOON_MIN;
}

/** True for a 00:00–24:00 day (an all-day exception). */
export function isAllDay(h: DayHours | null): boolean {
  return !!h && hhmmToMinutes(h.open) === 0 && hhmmToMinutes(h.close) === 1440;
}

/** "until 2 AM" / "until midnight" / "open 24 hours" — for one-line row subtitles (Now tab, Map, Why screen). Null when closed. */
export function untilLabel(state: OpenState): string | null {
  if (!state.open) return null;
  if (isAllDay(state.today)) return t('hours.open24lower');
  if (state.closesAt === null) return null;
  const m = zonedParts(state.closesAt).minutesOfDay;
  return m === 0 ? t('hours.untilMidnight') : t('hours.until', { time: formatMinutesShort(m) });
}

/** "8 AM – 2 AM (next day)" / "2:30 PM – 10 PM" / "Open 24 hours" / "Closed": one day's hours for display. */
export function formatDayHours(h: DayHours | null): string {
  if (!h) return t('hours.closed');
  const o = hhmmToMinutes(h.open);
  const c = hhmmToMinutes(h.close);
  if (o === 0 && c === 1440) return t('hours.open24');
  return `${formatMinutesShort(o)} – ${formatMinutesShort(c)}${c > 1440 ? ` ${t('hours.nextDay')}` : ''}`;
}

/**
 * Group identical consecutive days, Monday first: [{ days: "Mon–Thu", hours: "8 AM – 2 AM (next day)" },
 * { days: "Fri", hours: "8 AM – 9 PM" }, …]. Regular weekly hours only (exceptions are not applied); for the
 * spot page's week.
 */
export function describeWeek(venue: Venue): { days: string; hours: string }[] {
  const names = Array.from({ length: 7 }, (_, i) => dayName(i));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const out: { days: string; hours: string; first: number; last: number }[] = [];
  for (const d of order) {
    const txt = formatDayHours(venue.hours[d]);
    const prev = out[out.length - 1];
    if (prev && prev.hours === txt) {
      prev.last = d;
      prev.days = `${names[prev.first]}–${names[d]}`;
    } else out.push({ days: names[d], hours: txt, first: d, last: d });
  }
  return out.map(({ days, hours }) => ({ days, hours }));
}

/**
 * Validate a venue's hours table — used by the bundled-data test and the directory loader.
 * One message per problem, empty when valid: unparseable times, close not after open, close more than 12 h past
 * midnight, or an exception whose dates run backwards or whose hours close before they open.
 */
export function hoursValid(venue: Pick<Venue, 'hours' | 'exceptions'>): string[] {
  const errors: string[] = [];
  venue.hours.forEach((h, i) => {
    if (!h) return;
    const o = hhmmToMinutes(h.open);
    const c = hhmmToMinutes(h.close);
    if (!Number.isFinite(o) || !Number.isFinite(c)) errors.push(`day ${i}: unparseable ${h.open}–${h.close}`);
    else if (c <= o) errors.push(`day ${i}: close ${h.close} not after open ${h.open}`);
    else if (c > 1440 + 12 * 60) errors.push(`day ${i}: close ${h.close} more than 12 h past midnight`);
  });
  for (const e of venue.exceptions) {
    if (e.from > e.to) errors.push(`exception ${e.label}: from after to`);
    if (e.hours && e.hours !== 'closed' && e.hours !== '24h' && hhmmToMinutes(e.hours.close) <= hhmmToMinutes(e.hours.open)) errors.push(`exception ${e.label}: bad hours`);
  }
  return errors;
}
