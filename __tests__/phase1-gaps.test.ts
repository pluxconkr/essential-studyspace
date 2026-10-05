import { ARRIVAL_RADIUS_M, arrivalCandidate } from '@/domain/arrival';
import { wastedTrips } from '@/domain/honesty';
import { opensLate } from '@/domain/hours';
import { safetyFor } from '@/domain/safety';
import { zonedToEpoch } from '@/domain/time';
import type { CheckIn, Venue } from '@/domain/types';
import venues from '@/assets/data/venues.json';

const all = venues.venues as unknown as Venue[];
const byId = (id: string) => all.find((v) => v.venueId === id)!;
const alexander = byId('alexander-library');

describe('arrival prompt', () => {
  const now = Date.parse('2026-10-07T18:00:00Z');
  const atAlex = { lat: alexander.lat, lng: alexander.lng, accuracyM: 10, at: now };
  const ci = (venueId: string, minAgo: number): CheckIn => ({ checkInId: 'c', venueId, zoneId: null, level: 1, noise: null, amenities: [], note: null, at: new Date(now - minAgo * 60_000).toISOString(), proof: { distanceM: 10, gpsAccuracyM: 10 }, source: 'me', synced: true });

  test('offers the spot you are standing at, once per 30 minutes', () => {
    expect(arrivalCandidate(all, atAlex, [], now)?.venueId).toBe('alexander-library');
    expect(arrivalCandidate(all, atAlex, [ci('alexander-library', 10)], now)).toBeNull();
    expect(arrivalCandidate(all, atAlex, [ci('alexander-library', 45)], now)?.venueId).toBe('alexander-library');
    expect(arrivalCandidate(all, atAlex, [ci('carr-library', 1)], now)?.venueId).toBe('alexander-library');
  });

  test('no prompt without a fresh fix or when nothing is within the radius', () => {
    expect(arrivalCandidate(all, null, [], now)).toBeNull();
    expect(arrivalCandidate(all, { ...atAlex, at: now - 11 * 60_000 }, [], now)).toBeNull();
    expect(arrivalCandidate(all, { ...atAlex, lat: alexander.lat + 0.003 }, [], now)).toBeNull(); // ~330 m north
    expect(ARRIVAL_RADIUS_M).toBe(75);
  });

  test('GPS accuracy is forgiven up to 50 m', () => {
    const fuzzy = { ...atAlex, lat: alexander.lat + 0.0009, accuracyM: 40 }; // ~100 m away, ±40 m
    expect(arrivalCandidate(all, fuzzy, [], now)?.venueId).toBe('alexander-library');
  });
});

describe('wasted-trip honesty metric', () => {
  const c = (level: 0 | 1 | 2 | 3 | 4, shown: 0 | 1 | 2 | 3 | 4 | null | undefined): CheckIn => ({ checkInId: 'x', venueId: 'v', zoneId: null, level, noise: null, amenities: [], note: null, at: 'now', proof: { distanceM: null, gpsAccuracyM: null }, source: 'me', synced: true, shownLevel: shown });
  test('counts only check-ins that recorded what was shown; two steps off is a wasted trip', () => {
    expect(wastedTrips([c(1, 1), c(3, 2), c(4, 1), c(0, 4), c(2, null), c(2, undefined)])).toEqual({ total: 4, withinOne: 2, wasted: 2 });
    expect(wastedTrips([])).toEqual({ total: 0, withinOne: 0, wasted: 0 });
  });
});

describe('open late', () => {
  test('a spot is "late" when today\'s hours run to 11 PM or beyond', () => {
    const wed = zonedToEpoch('2026-10-07', 15 * 60);
    const fri = zonedToEpoch('2026-10-09', 15 * 60);
    expect(opensLate(alexander, wed)).toBe(true); // 2 AM
    expect(opensLate(alexander, fri)).toBe(false); // 9 PM
    expect(opensLate(byId('carr-library'), wed)).toBe(true); // midnight
    expect(opensLate(byId('hidden-grounds-easton'), wed)).toBe(false); // 6 PM
    expect(opensLate(byId('hoboken-public-library'), zonedToEpoch('2026-09-15', 15 * 60))).toBe(false); // closed for renovation
  });
});

describe('campus safety numbers', () => {
  test('Rutgers, NJIT and Stevens spots get escort numbers; public libraries and cafés do not', () => {
    expect(safetyFor(alexander).map((s) => s.display)).toEqual(['732-932-7211', '732-932-7433']);
    expect(safetyFor(byId('njit-van-houten'))[0].display).toBe('(973) 596-3120');
    expect(safetyFor(byId('stevens-williams-library'))[0].display).toBe('201-216-5105');
    expect(safetyFor(byId('newark-public-library'))).toEqual([]);
    expect(safetyFor(byId('hidden-grounds-easton'))).toEqual([]);
    for (const list of [alexander, byId('njit-van-houten'), byId('stevens-williams-library')].map(safetyFor)) for (const s of list) expect(s.e164).toMatch(/^\+1\d{10}$/);
  });
});
