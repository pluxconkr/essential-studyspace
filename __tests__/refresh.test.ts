/**
 * Foreground refresh policy: the "last attempt" stamp must mean a real network attempt, taken when it starts.
 */
import { kv } from '@/data/kv';
import { refreshAll, refreshIfStale, watchHits } from '@/services/refresh';
import { actions, getState, hydrate } from '@/store/appStore';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const crowdBody = { ok: true, configured: false, storage: 'memory', reports: {} };
const emptyRow = () => Array.from({ length: 24 }, () => ({ n: 0, days: 0, pct: null }));
const patternBody = { ok: true, months: ['2026-10', '2026-09', '2026-08'], patterns: { 'alexander-library': { wk: emptyRow(), sa: emptyRow(), su: emptyRow() } } };
const calls = (route: string) => (globalThis.fetch as jest.Mock).mock.calls.filter((c) => String(c[0]).includes(route)).length;
const patternCalls = () => calls('/api/pattern');

beforeEach(() => {
  jest.useFakeTimers();
  kv.clear();
  hydrate();
  // The relay answers after 200 ms of network time; the pattern route lives next to it.
  globalThis.fetch = jest.fn((input: RequestInfo | URL) => new Promise<Response>((resolve) => setTimeout(() => resolve(json(String(input).includes('/api/pattern') ? patternBody : crowdBody)), 200))) as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

test('an offline refresh is not an attempt: nothing is stamped, so the first online refresh runs', async () => {
  actions.setNetwork({ online: false, type: null });
  const r = await refreshAll();
  expect(r.crowd).toBe('skipped');
  expect(getState().lastRefreshAt).toBeNull();
  expect(globalThis.fetch).not.toHaveBeenCalled();

  actions.setNetwork({ online: true, type: 'wifi' });
  const p = refreshIfStale();
  await jest.advanceTimersByTimeAsync(300);
  expect(await p).not.toBeNull();
  expect(calls('/api/crowd')).toBe(1);
});

test('the stamp is the start of the attempt, so a 5-minute interval refreshes every 5 minutes', async () => {
  actions.setNetwork({ online: true, type: 'wifi' });
  const first = refreshAll();
  await jest.advanceTimersByTimeAsync(300);
  await first;
  expect(getState().lastRefreshAt).not.toBeNull();

  await jest.advanceTimersByTimeAsync(5 * 60_000 - 300);
  const second = refreshIfStale();
  await jest.advanceTimersByTimeAsync(300);
  expect(await second).not.toBeNull();
  expect(calls('/api/crowd')).toBe(2);
});

test('the learned baseline is downloaded with the first refresh and then at most every six hours', async () => {
  actions.setNetwork({ online: true, type: 'wifi' });
  const first = refreshAll();
  await jest.advanceTimersByTimeAsync(300);
  expect((await first).pattern).toBe('ok');
  expect(getState().pattern?.months).toEqual(['2026-10', '2026-09', '2026-08']);
  expect(getState().pattern?.patterns['alexander-library'].wk).toHaveLength(24);
  expect(getState().cacheMeta.pattern?.version).toBe('2026-10,2026-09,2026-08');
  expect(patternCalls()).toBe(1);

  const second = refreshAll();
  await jest.advanceTimersByTimeAsync(300);
  expect((await second).pattern).toBe('skipped');
  expect(patternCalls()).toBe(1);

  await jest.advanceTimersByTimeAsync(6 * 3600_000);
  const third = refreshAll();
  await jest.advanceTimersByTimeAsync(300);
  expect((await third).pattern).toBe('ok');
  expect(patternCalls()).toBe(2);
});

test('a malformed baseline response changes nothing', async () => {
  actions.setNetwork({ online: true, type: 'wifi' });
  globalThis.fetch = jest.fn((input: RequestInfo | URL) => Promise.resolve(json(String(input).includes('/api/pattern') ? { nonsense: true } : crowdBody))) as unknown as typeof fetch;
  const r = refreshAll();
  await jest.advanceTimersByTimeAsync(10);
  expect((await r).pattern).toBe('failed');
  expect(getState().pattern).toBeNull();
  expect(getState().cacheMeta.pattern).toBeUndefined();
});

test('a watch never fires on reports from students who are not at the spot', () => {
  const { venues } = getState();
  const alex = venues.find((v) => v.venueId === 'alexander-library')!;
  // Wednesday 7 Oct 2026, 2:00 PM EDT: Alexander is open.
  const now = Date.parse('2026-10-07T18:00:00Z');
  const at = new Date(now - 60_000).toISOString();
  const watches = [{ venueId: alex.venueId, notifyAtOrBelow: 1 as const, createdAt: at }];
  expect(watchHits(watches, venues, { [alex.venueId]: [{ venueId: alex.venueId, kind: 'remote', zoneId: null, level: 0, at, weight: 0.25 }] }, now)).toEqual([]);
  expect(watchHits(watches, venues, { [alex.venueId]: [{ venueId: alex.venueId, zoneId: null, level: 0, at, weight: 1 }] }, now)).toHaveLength(1);
});
