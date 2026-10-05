/**
 * Focus-log statistics: streak, hours by hour-of-day, best block, where you focus.
 * Derived on device from the student-owned log. Never shared with venues or schools.
 */
import { t } from '@/i18n';

import { shiftDateKey, toEpoch, zonedParts, zonedToEpoch } from './time';
import type { FocusEntry, Venue } from './types';

/** A day counts toward the streak with at least this much focus. */
export const STREAK_MIN_SECONDS = 25 * 60;

export function focusByDay(log: readonly FocusEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of log) {
    const k = zonedParts(toEpoch(e.startedAt)).dateKey;
    m.set(k, (m.get(k) ?? 0) + e.focusSeconds);
  }
  return m;
}

/** Consecutive days (ending today or yesterday) with ≥ 25 min of focus. */
export function streakDays(log: readonly FocusEntry[], now: number): number {
  const byDay = focusByDay(log);
  const today = zonedParts(now).dateKey;
  let day = (byDay.get(today) ?? 0) >= STREAK_MIN_SECONDS ? today : shiftDateKey(today, -1);
  let n = 0;
  while ((byDay.get(day) ?? 0) >= STREAK_MIN_SECONDS) {
    n++;
    day = shiftDateKey(day, -1);
    if (n > 365) break;
  }
  return n;
}

export interface WeekSummary {
  focusSeconds: number;
  sessions: number;
  goalsDone: number;
  goalsTotal: number;
}

/** Last 7 local days including today. */
export function weekSummary(log: readonly FocusEntry[], now: number): WeekSummary {
  const from = shiftDateKey(zonedParts(now).dateKey, -6);
  const fromMs = zonedToEpoch(from, 0);
  const out: WeekSummary = { focusSeconds: 0, sessions: 0, goalsDone: 0, goalsTotal: 0 };
  for (const e of log) {
    if (toEpoch(e.startedAt) < fromMs) continue;
    out.focusSeconds += e.focusSeconds;
    out.sessions += 1;
    out.goalsDone += e.goalsDone;
    out.goalsTotal += e.goalsTotal;
  }
  return out;
}

/** Focus seconds attributed to each local hour of day (0..23), spreading a session across the hours it covered. */
export function focusByHour(log: readonly FocusEntry[]): number[] {
  const out = new Array<number>(24).fill(0);
  for (const e of log) {
    const start = toEpoch(e.startedAt);
    const end = toEpoch(e.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || e.focusSeconds <= 0) continue;
    const span = end - start;
    // Walk hour by hour and give each hour its share of focus seconds.
    let t = start;
    while (t < end) {
      const p = zonedParts(t);
      const nextHour = t + (60 - p.minute) * 60_000 - (t % 60_000);
      const slice = Math.min(end, nextHour) - t;
      out[p.hour] += (e.focusSeconds * slice) / span;
      t = Math.min(end, nextHour);
    }
  }
  return out.map((s) => Math.round(s));
}

/** The 2-hour window with the most focus time, e.g. { startHour: 9, seconds: 7200 }. null when empty. */
export function bestWindow(byHour: readonly number[]): { startHour: number; seconds: number } | null {
  let best: { startHour: number; seconds: number } | null = null;
  for (let h = 0; h < 24; h++) {
    const s = byHour[h] + byHour[(h + 1) % 24];
    if (s > 0 && (!best || s > best.seconds)) best = { startHour: h, seconds: s };
  }
  return best;
}

export function focusByVenue(log: readonly FocusEntry[], venues: readonly Venue[]): { venueId: string | null; name: string; seconds: number; sessions: number }[] {
  const m = new Map<string | null, { seconds: number; sessions: number }>();
  for (const e of log) {
    const cur = m.get(e.venueId) ?? { seconds: 0, sessions: 0 };
    cur.seconds += e.focusSeconds;
    cur.sessions += 1;
    m.set(e.venueId, cur);
  }
  return Array.from(m.entries())
    .map(([venueId, v]) => ({ venueId, name: venueId ? (venues.find((x) => x.venueId === venueId)?.shortName ?? t('focus.removedSpot')) : t('focus.elsewhere'), ...v }))
    .sort((a, b) => b.seconds - a.seconds);
}

export function goalRate(s: Pick<WeekSummary, 'goalsDone' | 'goalsTotal'>): number | null {
  return s.goalsTotal === 0 ? null : Math.round((s.goalsDone / s.goalsTotal) * 100);
}

/** "9–11 AM" */
export function formatHourBand(startHour: number, hours = 2): string {
  const f = (h: number) => {
    const hh = ((h % 24) + 24) % 24;
    return `${hh % 12 === 0 ? 12 : hh % 12}`;
  };
  const endH = startHour + hours;
  const ampm = (h: number) => (((h % 24) + 24) % 24 < 12 ? t('time.am') : t('time.pm'));
  return ampm(startHour) === ampm(endH) ? `${f(startHour)}–${f(endH)} ${ampm(endH)}` : `${f(startHour)} ${ampm(startHour)}–${f(endH)} ${ampm(endH)}`;
}
