import { bestWindow, focusByHour, formatHourBand, goalRate, streakDays, weekSummary } from '@/domain/focus';
import { fuse } from '@/domain/levels';
import { explainRank, rankVenues } from '@/domain/ranking';
import { zonedToEpoch } from '@/domain/time';
import { TIMER_SHAPES, activeMs, blockAt, focusSeconds, remainingBoundaries, scheduleOf, shapeById, toFocusEntry } from '@/domain/timer';
import type { FocusEntry, LiveLevel, Prefs, Session, Venue } from '@/domain/types';
import venues from '@/assets/data/venues.json';
import stations from '@/assets/data/stations.json';

const all = venues.venues as unknown as Venue[];
const nb = stations.stations.find((s) => s.stationId === 'new-brunswick')!;
const prefs: Prefs = { area: 'new-brunswick', homeStationId: 'new-brunswick', noisePref: 'silent', needOutlets: true, stepFree: false, blocks: [], updatedAt: 'x' };
const NOW = zonedToEpoch('2026-10-07', 14 * 60); // Wed 2 PM

describe('ranking', () => {
  const levels: Record<string, LiveLevel> = Object.fromEntries(all.map((v) => [v.venueId, fuse({ venue: v, reports: [], now: NOW })]));
  const ctx = { origin: nb, originLabel: 'New Brunswick', prefs, now: NOW, gapEndsAt: null };

  test('only the chosen area is ranked; closed spots are listed separately by next opening', () => {
    const r = rankVenues(all, levels, ctx);
    const ids = [...r.open, ...r.closed].map((x) => x.venue.venueId);
    expect(ids.every((id) => all.find((v) => v.venueId === id)!.area === 'new-brunswick')).toBe(true);
    expect(r.open.length).toBeGreaterThan(5);
    for (let i = 1; i < r.open.length; i++) expect(r.open[i - 1].score).toBeGreaterThanOrEqual(r.open[i].score);
    for (let i = 1; i < r.closed.length; i++) expect(r.closed[i - 1].state.opensAt ?? Infinity).toBeLessThanOrEqual(r.closed[i].state.opensAt ?? Infinity);
  });

  test('a Full library ranks below the same library when Chill', () => {
    const alex = all.find((v) => v.venueId === 'alexander-library')!;
    const chill = fuse({ venue: alex, reports: [{ venueId: alex.venueId, zoneId: null, level: 1, at: new Date(NOW - 60_000).toISOString(), weight: 1 }, { venueId: alex.venueId, zoneId: null, level: 1, at: new Date(NOW - 120_000).toISOString(), weight: 1 }], now: NOW });
    const full = fuse({ venue: alex, reports: [{ venueId: alex.venueId, zoneId: null, level: 4, at: new Date(NOW - 60_000).toISOString(), weight: 1 }, { venueId: alex.venueId, zoneId: null, level: 4, at: new Date(NOW - 120_000).toISOString(), weight: 1 }], now: NOW });
    const a = rankVenues([alex], { [alex.venueId]: chill }, ctx).open[0];
    const b = rankVenues([alex], { [alex.venueId]: full }, ctx).open[0];
    expect(a.score).toBeGreaterThan(b.score);
    expect(explainRank(a).find((r) => r.k === 'Score')!.v).toBe(a.score.toFixed(2));
  });

  test('late at night only late venues are open and closing-soon shows in stayMin', () => {
    const late = zonedToEpoch('2026-10-07', 23 * 60 + 40);
    const lv: Record<string, LiveLevel> = Object.fromEntries(all.map((v) => [v.venueId, fuse({ venue: v, reports: [], now: late })]));
    const r = rankVenues(all, lv, { ...ctx, now: late });
    const openIds = r.open.map((x) => x.venue.venueId);
    expect(openIds).toContain('alexander-library');
    expect(openIds).not.toContain('nbfpl');
    expect(r.closed.map((x) => x.venue.venueId)).toContain('carr-library');
  });
});

describe('timer', () => {
  const start = NOW;
  const base: Session = { sessionId: 's1', venueId: null, zoneId: null, shapeId: 'p25', startedAt: new Date(start).toISOString(), pausedAt: null, pausedMs: 0, endedAt: null, goals: [], checkInId: null };

  test('schedule shape', () => {
    const p25 = shapeById('p25');
    expect(scheduleOf(p25)).toHaveLength(7); // 4 focus + 3 breaks
    expect(TIMER_SHAPES.map((s) => s.id)).toEqual(['p25', 'p50', 'p90', 'free']);
  });

  test('blockAt walks focus → break → focus … → done from absolute timestamps', () => {
    expect(blockAt(base, start + 10 * 60_000)).toMatchObject({ kind: 'focus', blockNo: 1, blocks: 4, remainingMs: 15 * 60_000 });
    expect(blockAt(base, start + 27 * 60_000)).toMatchObject({ kind: 'break', blockNo: 1, remainingMs: 3 * 60_000 });
    expect(blockAt(base, start + 31 * 60_000)).toMatchObject({ kind: 'focus', blockNo: 2 });
    expect(blockAt(base, start + 200 * 60_000)).toMatchObject({ kind: 'done', blockNo: 4 });
  });

  test('pauses stop the clock', () => {
    const paused: Session = { ...base, pausedAt: new Date(start + 10 * 60_000).toISOString() };
    expect(activeMs(paused, start + 30 * 60_000)).toBe(10 * 60_000);
    expect(blockAt(paused, start + 30 * 60_000)).toMatchObject({ kind: 'focus', blockNo: 1, paused: true, remainingMs: 15 * 60_000 });
    const resumed: Session = { ...base, pausedMs: 20 * 60_000 };
    expect(blockAt(resumed, start + 30 * 60_000)).toMatchObject({ kind: 'focus', blockNo: 1, remainingMs: 15 * 60_000, paused: false });
  });

  test('focus seconds exclude breaks and cap at the plan', () => {
    expect(focusSeconds(base, start + 27 * 60_000)).toBe(25 * 60);
    expect(focusSeconds(base, start + 10 * 3600_000)).toBe(100 * 60);
    const free: Session = { ...base, shapeId: 'free' };
    expect(focusSeconds(free, start + 95 * 60_000)).toBe(95 * 60);
    expect(blockAt(free, start + 95 * 60_000).remainingMs).toBeNull();
  });

  test('remaining boundaries become notifications; free sessions have none', () => {
    const b = remainingBoundaries(base, start + 10 * 60_000);
    expect(b).toHaveLength(7);
    expect(b[0]).toMatchObject({ kind: 'focus', blockNo: 1, at: start + 25 * 60_000, last: false });
    expect(b[6]).toMatchObject({ kind: 'focus', blockNo: 4, last: true });
    expect(remainingBoundaries({ ...base, shapeId: 'free' }, start)).toEqual([]);
    expect(remainingBoundaries({ ...base, pausedAt: base.startedAt }, start)).toEqual([]);
  });

  test('toFocusEntry logs focus seconds and goals', () => {
    const s: Session = { ...base, goals: [{ goalId: 'a', text: 'x', done: true }, { goalId: 'b', text: 'y', done: false }] };
    const e = toFocusEntry(s, start + 27 * 60_000);
    expect(e).toMatchObject({ sessionId: 's1', focusSeconds: 25 * 60, goalsDone: 1, goalsTotal: 2, shapeId: 'p25' });
  });
});

describe('focus statistics', () => {
  const day = (key: string, hour: number, minutes: number, venueId: string | null = 'alexander-library'): FocusEntry => {
    const s = zonedToEpoch(key, hour * 60);
    return { sessionId: `${key}-${hour}`, venueId, shapeId: 'p50', startedAt: new Date(s).toISOString(), endedAt: new Date(s + minutes * 60_000).toISOString(), focusSeconds: minutes * 60, goalsDone: 1, goalsTotal: 2 };
  };
  const now = zonedToEpoch('2026-10-07', 20 * 60);
  const log = [day('2026-10-07', 9, 50), day('2026-10-06', 14, 100), day('2026-10-05', 9, 30), day('2026-10-03', 10, 60), day('2026-09-20', 10, 60, null)];

  test('streak counts consecutive days with 25+ minutes ending today', () => {
    expect(streakDays(log, now)).toBe(3);
    expect(streakDays(log, zonedToEpoch('2026-10-08', 20 * 60))).toBe(3); // yesterday still counts
    expect(streakDays(log, zonedToEpoch('2026-10-09', 20 * 60))).toBe(0);
    expect(streakDays([day('2026-10-07', 9, 10)], now)).toBe(0);
  });

  test('week summary covers the last 7 local days', () => {
    const w = weekSummary(log, now);
    expect(w.sessions).toBe(4);
    expect(w.focusSeconds).toBe((50 + 100 + 30 + 60) * 60);
    expect(goalRate(w)).toBe(50);
    expect(goalRate({ goalsDone: 0, goalsTotal: 0 })).toBeNull();
  });

  test('focus by hour spreads a session over the hours it covered and finds the best window', () => {
    const h = focusByHour([day('2026-10-07', 9, 120)]);
    expect(h[9]).toBe(3600);
    expect(h[10]).toBe(3600);
    expect(h[11]).toBe(0);
    expect(bestWindow(h)).toEqual({ startHour: 9, seconds: 7200 });
    expect(bestWindow(new Array(24).fill(0))).toBeNull();
    expect(formatHourBand(9)).toBe('9–11 AM');
    expect(formatHourBand(11)).toBe('11 AM–1 PM');
    expect(formatHourBand(22)).toBe('10 PM–12 AM');
  });
});
