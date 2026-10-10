/**
 * The relay client: what goes on the wire (report kinds) and what is accepted back (shape enforcement).
 */
import type { CheckIn } from '@/domain/types';
import { fetchCrowd, fetchPattern, postReport } from '@/services/crowdClient';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const ci: CheckIn = { checkInId: 'c1', kind: 'past', venueId: 'alexander-library', zoneId: null, level: 2, noise: 1, amenities: ['outlets'], note: 'private', at: '2026-10-07T18:00:00.000Z', proof: { distanceM: null, gpsAccuracyM: null }, source: 'me', synced: false };

afterEach(() => {
  jest.restoreAllMocks();
});

test('postReport sends the kind and nothing private', async () => {
  const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ok: true }));
  expect(await postReport(ci)).toBe('ok');
  const body = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body));
  expect(body).toEqual({ venueId: 'alexander-library', kind: 'past', zoneId: null, level: 2, at: ci.at, weight: 0.5, noise: 1, amenities: ['outlets'], id: 'c1' });
  expect(JSON.stringify(body)).not.toMatch(/note|private/);
});

test('fetchCrowd keeps the relay kind and treats everything else as live', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ok: true, reports: { a: [{ kind: 'remote', level: 1, at: ci.at, weight: 0.25 }, { level: 3, at: ci.at, weight: 1 }, { kind: 'past', level: 4, at: ci.at }] } }));
  const snap = await fetchCrowd(['a']);
  expect(snap?.reports.a.map((r) => r.kind)).toEqual(['remote', 'live', 'live']);
  expect(snap?.reports.a.map((r) => r.weight)).toEqual([0.25, 1, 0.4]);
});

test('fetchPattern enforces 24 buckets per day type, clamps values and skips venues the relay did not answer for', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(json({ months: ['2026-10', 7, 'x'], patterns: { a: { wk: [{ n: 2.9, days: 1, pct: 1.7 }, { n: 0, days: 0, pct: 0.5 }], sa: 'bad', su: [] }, b: null } }));
  const snap = await fetchPattern(['a', 'b', 'c']);
  expect(snap?.months).toEqual(['2026-10', 'x']);
  expect(Object.keys(snap?.patterns ?? {})).toEqual(['a']);
  const a = snap!.patterns.a;
  expect(a.wk).toHaveLength(24);
  expect(a.wk[0]).toEqual({ n: 2, days: 1, pct: 1 });
  expect(a.wk[1]).toEqual({ n: 0, days: 0, pct: null });
  expect(a.sa.every((b) => b.n === 0 && b.pct === null)).toBe(true);
  expect(a.su).toHaveLength(24);
});
