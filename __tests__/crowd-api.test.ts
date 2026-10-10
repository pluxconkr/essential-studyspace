/**
 * /api/crowd, the anonymous crowd relay. Exercised with the in-memory store.
 */
import { GET, POST, RATE_LIMIT, fresh, resetRateLimits, roundToMinute } from '@/app/api/crowd+api';
import { MAX_PER_VENUE, createMemoryStore, setStore } from '@/server/crowdStore';

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
    const res = await post({ venueId: 'alexander-library', zoneId: 'alex-2ab', level: 3, at, weight: 0.1, noise: 1, amenities: ['outlets', 'solo-desks'] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kept).toEqual({ kind: 'live', zoneId: 'alex-2ab', level: 3, at: roundToMinute(at), weight: 0.4, noise: 1, amenities: ['outlets', 'solo-desks'] });
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
    expect((await post({ venueId: 'alexander-library', level: 1, at, noise: 7 })).status).toBe(400);
    expect((await post({ venueId: 'alexander-library', level: 1, at, amenities: ['jacuzzi'] })).status).toBe(400);
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
    const at = new Date().toISOString();
    for (let i = 0; i < MAX_PER_VENUE + 5; i++) await s.push('x', { kind: 'live', zoneId: null, level: 1, at, weight: 1, noise: null, amenities: [] });
    expect(await s.list('x')).toHaveLength(MAX_PER_VENUE);
  });

  test('fresh() drops reports older than the retention window', () => {
    const now = Date.now();
    const list = [
      { kind: 'live' as const, zoneId: null, level: 1, at: new Date(now - 60_000).toISOString(), weight: 1, noise: null, amenities: [] },
      { kind: 'live' as const, zoneId: null, level: 1, at: new Date(now - 4 * 3600_000).toISOString(), weight: 1, noise: null, amenities: [] },
    ];
    expect(fresh(list, now)).toHaveLength(1);
  });
});

describe('POST retries', () => {
  test('a re-sent report (lost response, same body) is kept once', async () => {
    const body = { venueId: 'alexander-library', zoneId: null, level: 2, at: new Date().toISOString(), weight: 0.8, noise: 1, amenities: ['outlets'] };
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    const g = await (await get('alexander-library')).json();
    expect(g.reports['alexander-library']).toHaveLength(1);
  });
});

describe('report kinds', () => {
  test('remote reports are kept in the live list at a fixed low weight and labelled', async () => {
    const at = new Date().toISOString();
    const res = await post({ venueId: 'alexander-library', level: 4, at, weight: 1, kind: 'remote' });
    expect(res.status).toBe(200);
    expect((await res.json()).kept).toMatchObject({ kind: 'remote', weight: 0.25 });
    const g = await (await get('alexander-library')).json();
    expect(g.reports['alexander-library']).toHaveLength(1);
    expect(g.reports['alexander-library'][0].kind).toBe('remote');
  });

  test('past reports never reach the live list, carry weight 0.5, and must be within 7 days', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString();
    const res = await post({ venueId: 'alexander-library', level: 2, at: twoDaysAgo, weight: 1, kind: 'past' });
    expect(res.status).toBe(200);
    expect((await res.json()).kept).toMatchObject({ kind: 'past', weight: 0.5 });
    const g = await (await get('alexander-library')).json();
    expect(g.reports['alexander-library']).toEqual([]);
    expect((await post({ venueId: 'alexander-library', level: 2, at: new Date(Date.now() - 8 * 86400_000).toISOString(), kind: 'past' })).status).toBe(422);
    expect((await post({ venueId: 'alexander-library', level: 2, at: new Date(Date.now() + 3600_000).toISOString(), kind: 'past' })).status).toBe(422);
    expect((await post({ venueId: 'alexander-library', level: 2, at: twoDaysAgo, kind: 'rumour' })).status).toBe(400);
  });
});
