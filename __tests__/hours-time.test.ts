import { currentOrNextGap, formatBlock } from '@/domain/blocks';
import { describeWeek, formatDayHours, hoursOn, hoursValid, isClosingSoon, minutesToClose, openState } from '@/domain/hours';
import { formatClock, formatDuration, formatIn, formatMMSS, formatMinutes, formatShort, formatStamp, hhmmToMinutes, relativeAgo, shiftDateKey, weekdayOf, zonedParts, zonedToEpoch } from '@/domain/time';
import { STREET_FACTOR, WALK_M_PER_MIN, walkFormula, walkMinutes } from '@/domain/transit';
import type { Venue } from '@/domain/types';
import venues from '@/assets/data/venues.json';
import stations from '@/assets/data/stations.json';

const byId = (id: string) => (venues.venues as unknown as Venue[]).find((v) => v.venueId === id)!;
const alexander = byId('alexander-library');
const carr = byId('carr-library');
const hoboken = byId('hoboken-public-library');

describe('New Jersey time (America/New_York)', () => {
  test('zonedParts converts UTC to Eastern Daylight Time', () => {
    const p = zonedParts(Date.parse('2026-10-03T18:02:00Z')); // Saturday 2:02 PM EDT
    expect(p).toMatchObject({ year: 2026, month: 10, day: 3, weekday: 6, hour: 14, minute: 2, dateKey: '2026-10-03', minutesOfDay: 14 * 60 + 2 });
  });

  test('zonedToEpoch round-trips, including across the DST change (1 Nov 2026) and spring forward (8 Mar 2026)', () => {
    for (const [key, min] of [
      ['2026-10-03', 14 * 60 + 2],
      ['2026-11-01', 0],
      ['2026-11-01', 1 * 60 + 30],
      ['2026-11-01', 9 * 60],
      ['2026-11-02', 9 * 60],
      ['2026-03-08', 9 * 60],
      ['2026-03-07', 23 * 60 + 59],
      ['2026-12-25', 12 * 60],
    ] as const) {
      const p = zonedParts(zonedToEpoch(key, min));
      expect([p.dateKey, p.minutesOfDay]).toEqual([key, min]);
    }
    // 2 AM Eastern the next day (minutes ≥ 1440) lands on the next local date.
    expect(zonedParts(zonedToEpoch('2026-10-03', 26 * 60)).dateKey).toBe('2026-10-04');
    // Fall-back day has 25 hours: 9 AM is 25 hours after 8 AM the previous day... but 24 hours after midnight is 11 PM.
    expect(zonedToEpoch('2026-11-02', 0) - zonedToEpoch('2026-11-01', 0)).toBe(25 * 3600_000);
  });

  test('date-key helpers', () => {
    expect(shiftDateKey('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(weekdayOf('2026-10-03')).toBe(6);
    expect(weekdayOf('2026-10-05')).toBe(1);
  });

  test('formatters', () => {
    expect(hhmmToMinutes('26:00')).toBe(1560);
    expect(hhmmToMinutes('8:05')).toBe(485);
    expect(formatMinutes(0)).toBe('12:00 AM');
    expect(formatMinutes(14 * 60 + 30)).toBe('2:30 PM');
    expect(formatMinutes(26 * 60)).toBe('2:00 AM');
    expect(formatClock('2026-10-03T18:02:00Z')).toBe('2:02 PM');
    expect(formatShort('2026-10-03T18:02:00Z')).toBe('Sat 2:02 PM');
    expect(formatStamp('2026-10-03T18:02:00Z')).toBe('2026-10-03 14:02 ET');
    expect(formatIn(25 * 60_000)).toBe('in 25 min');
    expect(formatIn(130 * 60_000)).toBe('in 2 h 10 min');
    expect(formatDuration(14 * 3600 + 20 * 60)).toBe('14h 20m');
    expect(formatDuration(45 * 60)).toBe('45m');
    expect(formatMMSS(24 * 60_000 + 59_000)).toBe('24:59');
    const now = Date.parse('2026-10-03T18:00:00Z');
    expect(relativeAgo(now - 30_000, now)).toBe('just now');
    expect(relativeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(relativeAgo(now - 3 * 3600_000, now)).toBe('3 hours ago');
    expect(relativeAgo(null, now)).toBe('never');
  });
});

describe('opening hours', () => {
  test('Alexander: Monday 1 AM is still Sunday night (open until 2 AM)', () => {
    const mon1am = zonedToEpoch('2026-10-05', 60);
    const st = openState(alexander, mon1am);
    expect(st.open).toBe(true);
    expect(zonedParts(st.closesAt!).minutesOfDay).toBe(2 * 60);
    expect(minutesToClose(st, mon1am)).toBe(60);
    expect(isClosingSoon(st, mon1am)).toBe(true);
  });

  test('Alexander: Friday 10 PM is closed (closes 9 PM) and the next opening is Saturday 1 PM', () => {
    const fri10pm = zonedToEpoch('2026-10-09', 22 * 60);
    const st = openState(alexander, fri10pm);
    expect(st.open).toBe(false);
    expect(zonedParts(st.opensAt!)).toMatchObject({ dateKey: '2026-10-10', minutesOfDay: 13 * 60 });
  });

  test('Carr closes at midnight on weeknights; 11:35 PM is "closing soon"', () => {
    const t = zonedToEpoch('2026-10-06', 23 * 60 + 35);
    const st = openState(carr, t);
    expect(st.open).toBe(true);
    expect(minutesToClose(st, t)).toBe(25);
  });

  test('exception calendar: Hoboken main library closed for renovation until 4 Oct 2026, label-only exception after', () => {
    const closed = hoursOn(hoboken, '2026-09-15');
    expect(closed.hours).toBeNull();
    expect(closed.exception?.label).toMatch(/renovation/);
    const reopened = hoursOn(hoboken, '2026-10-06');
    expect(reopened.hours).toEqual({ open: '10:00', close: '20:00' });
    expect(reopened.exception?.label).toMatch(/Floors 2–3/);
    const st = openState(hoboken, zonedToEpoch('2026-09-15', 12 * 60));
    expect(st.open).toBe(false);
    expect(zonedParts(st.opensAt!).dateKey).toBe('2026-10-05');
  });

  test('formatting and grouping', () => {
    expect(formatDayHours({ open: '08:00', close: '26:00' })).toBe('8 AM – 2 AM (next day)');
    expect(formatDayHours({ open: '14:30', close: '22:00' })).toBe('2:30 PM – 10 PM');
    expect(formatDayHours(null)).toBe('Closed');
    expect(formatDayHours({ open: '00:00', close: '24:00' })).toBe('Open 24 hours');
    const week = describeWeek(carr);
    expect(week[0]).toEqual({ days: 'Mon–Thu', hours: '8 AM – 12 AM' });
    expect(week.map((w) => w.days)).toEqual(['Mon–Thu', 'Fri', 'Sat', 'Sun']);
  });

  test('validator rejects close-before-open and far-past-midnight closes', () => {
    expect(hoursValid({ hours: alexander.hours, exceptions: alexander.exceptions })).toEqual([]);
    expect(hoursValid({ hours: [null, { open: '10:00', close: '09:00' }, null, null, null, null, null], exceptions: [] })).toHaveLength(1);
    expect(hoursValid({ hours: [null, { open: '10:00', close: '37:00' }, null, null, null, null, null], exceptions: [] })).toHaveLength(1);
  });
});

describe('walking time and free blocks', () => {
  test('walk minutes = ceil(metres × street factor ÷ pace)', () => {
    const nb = stations.stations.find((s) => s.stationId === 'new-brunswick')!;
    const min = walkMinutes(nb, alexander);
    expect(min).toBeGreaterThanOrEqual(10);
    expect(min).toBeLessThanOrEqual(20);
    expect(walkFormula(nb, alexander)).toMatch(new RegExp(`m straight line × ${STREET_FACTOR} street factor ÷ ${WALK_M_PER_MIN} m/min = ${min} min$`));
    expect(walkMinutes(nb, nb)).toBe(1);
  });

  test('current or next gap today', () => {
    const blocks = [
      { blockId: 'a', weekday: 3, startMin: 14 * 60, endMin: 17 * 60 },
      { blockId: 'b', weekday: 3, startMin: 9 * 60, endMin: 10 * 60 },
    ];
    const wed3pm = zonedToEpoch('2026-10-07', 15 * 60);
    const g = currentOrNextGap(blocks, wed3pm)!;
    expect(g.now).toBe(true);
    expect(g.block.blockId).toBe('a');
    expect(formatBlock(g.block)).toBe('2:00 PM – 5:00 PM');
    const wed8am = zonedToEpoch('2026-10-07', 8 * 60);
    expect(currentOrNextGap(blocks, wed8am)!.block.blockId).toBe('b');
    expect(currentOrNextGap(blocks, zonedToEpoch('2026-10-07', 18 * 60))).toBeNull();
    expect(currentOrNextGap(blocks, zonedToEpoch('2026-10-08', 15 * 60))).toBeNull();
  });
});
