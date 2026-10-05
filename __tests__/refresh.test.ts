/**
 * Foreground refresh policy: the "last attempt" stamp must mean a real network attempt, taken when it starts.
 */
import { refreshAll, refreshIfStale } from '@/services/refresh';
import { actions, getState, hydrate } from '@/store/appStore';

const ok = () => new Response(JSON.stringify({ ok: true, configured: false, storage: 'memory', reports: {} }), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  jest.useFakeTimers();
  hydrate();
  // The relay answers after 200 ms of network time.
  globalThis.fetch = jest.fn(() => new Promise<Response>((resolve) => setTimeout(() => resolve(ok()), 200))) as unknown as typeof fetch;
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
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
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
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});
