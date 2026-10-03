/**
 * Opening hours with exception calendars. Pure functions over the venue record and the clock.
 * Closing past midnight ("26:00") is handled by also checking yesterday's hours.
 * Hours are a first-class feed: a student who travels to a closed building deletes the app.
 */
import { hhmmToMinutes, shiftDateKey, weekdayOf, zonedParts, zonedToEpoch } from './time';
import type { DayHours, HoursException, Venue } from './types';

export interface ResolvedDay {
  /** null = closed all day. */
  hours: DayHours | null;
  /** The exception that produced these hours (or a label-only exception), if any. */
  exception: HoursException | null;
}

function exceptionFor(venue: Venue, dateKey: string): HoursException | null {
  for (const e of venue.exceptions) if (dateKey >= e.from && dateKey <= e.to) return e;
  return null;
}

/** Hours in force on a local date, after applying the exception calendar. */
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

export interface OpenState {
  open: boolean;
  /** Epoch ms when the current open period ends (if open). */
  closesAt: number | null;
  /** Epoch ms when the next open period starts (if closed). */
  opensAt: number | null;
  /** Exception in force today, if any (shown as a labelled callout). */
  exception: HoursException | null;
  /** The day's hours as resolved (today's row, for display). */
  today: DayHours | null;
}

/** Interval [start, end) in epoch ms for a day's hours. */
function interval(dateKey: string, h: DayHours): [number, number] | null {
  const o = hhmmToMinutes(h.open);
  const c = hhmmToMinutes(h.close);
  if (!Number.isFinite(o) || !Number.isFinite(c) || c <= o) return null;
  return [zonedToEpoch(dateKey, o), zonedToEpoch(dateKey, c)];
}

/** Open/closed at `now`, with the next transition. Looks back one day for late closings. */
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

/** Whether the venue is open at an arbitrary instant (used for "level at arrival"). */
export function isOpenAt(venue: Venue, at: number): boolean {
  return openState(venue, at).open;
}

/** Minutes until closing, or null when closed. */
export function minutesToClose(state: OpenState, now: number): number | null {
  if (!state.open || state.closesAt === null) return null;
  return Math.max(0, Math.round((state.closesAt - now) / 60_000));
}

/** "Closing soon" = open and under an hour left. */
export const CLOSING_SOON_MIN = 60;

export function isClosingSoon(state: OpenState, now: number): boolean {
  const m = minutesToClose(state, now);
  return m !== null && m <= CLOSING_SOON_MIN;
}

/** "8:00 AM – 2:00 AM" / "Closed" */
export function formatDayHours(h: DayHours | null): string {
  if (!h) return 'Closed';
  const o = hhmmToMinutes(h.open);
  const c = hhmmToMinutes(h.close);
  if (o === 0 && c === 1440) return 'Open 24 hours';
  return `${fmt(o)} – ${fmt(c)}${c > 1440 ? ' (next day)' : ''}`;
}

function fmt(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return mm === 0 ? `${h12} ${h24 < 12 ? 'AM' : 'PM'}` : `${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** Group identical consecutive days: "Mon–Thu 8 AM – 2 AM · Fri 8 AM – 9 PM · …" */
export function describeWeek(venue: Venue): { days: string; hours: string }[] {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

/** Validate a venue's hours table — used by the bundled-data test and the directory loader. */
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
