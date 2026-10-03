/**
 * The one server function: anonymous crowd relay. Exercised with the in-memory store.
 */
import { GET, MAX_PER_VENUE, POST, RATE_LIMIT, createMemoryStore, fresh, resetRateLimits, roundToMinute, setStore } from '@/app/api/crowd+api';

const url = 'http://localhost/api/crowd';
const post = (body: unknown, ip = '1.2.3.4') => POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) }));
const get = (venues: string) => GET(new Request(`${url}?venues=${venues}`));

beforeEach(() => {
  setStore(createMemoryStore());
  resetRateLimits();
});

describe('POST /api/crowd', () => {
  test('stores a valid report with a minute-rounded time and clamped weight', async () => {
    const at = new Date().toISOString();
    const res = await post({ venueId: 'alexander-library', zoneId: 'alex-2ab', level: 3, at, weight: 0.1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kept).toEqual({ zoneId: 'alex-2ab', level: 3, at: roundToMinute(at), weight: 0.4 });
    const g = await (await get('alexander-library,carr-library')).json();
    expect(g.configured).toBe(false);
    expect(g.storage).toBe('memory');
    expect(g.reports['alexander-library']).toHaveLength(1);
    expect(g.reports['carr-library']).toEqual([]);
    expect(JSON.stringify(g)).not.toMatch(/note|user|lat|lng/);
  });

  test('rejects bad levels, bad ids, and stale or future times', async () => {
    const at = new Date().toISOString();
    expect((await post({ venueId: 'alexander-library', level: 5, at })).status).toBe(400);
    expect((await post({ venueId: 'Alexander Library!', level: 1, at })).status).toBe(400);
    expect((await post({ venueId: 'alexander-library', level: 1, at: 'yesterday' })).status).toBe(400);
    expect((await post({ venueId: 'alexander-library', level: 1, at: new Date(Date.now() - 4 * 3600_000).toISOString() })).status).toBe(422);
    expect((await post({ venueId: 'alexander-library', level: 1, at: new Date(Date.now() + 3600_000).toISOString() })).status).toBe(422);
  });

  test('rate limits a chatty client without affecting others', async () => {
    const at = new Date().toISOString();
    for (let i = 0; i < RATE_LIMIT.posts; i++) expect((await post({ venueId: 'lsm', level: 1, at }, '9.9.9.9')).status).toBe(200);
    expect((await post({ venueId: 'lsm', level: 1, at }, '9.9.9.9')).status).toBe(429);
    expect((await post({ venueId: 'lsm', level: 1, at }, '8.8.8.8')).status).toBe(200);
  });

  test('memory store keeps the newest reports per venue', async () => {
    const s = createMemoryStore();
    setStore(s);
    const at = new Date().toISOString();
    for (let i = 0; i < MAX_PER_VENUE + 5; i++) await s.push('x', { zoneId: null, level: 1, at, weight: 1 });
    expect(await s.list('x')).toHaveLength(MAX_PER_VENUE);
  });

  test('fresh() drops reports older than the retention window', () => {
    const now = Date.now();
    const list = [
      { zoneId: null, level: 1, at: new Date(now - 60_000).toISOString(), weight: 1 },
      { zoneId: null, level: 1, at: new Date(now - 4 * 3600_000).toISOString(), weight: 1 },
    ];
    expect(fresh(list, now)).toHaveLength(1);
  });
});
