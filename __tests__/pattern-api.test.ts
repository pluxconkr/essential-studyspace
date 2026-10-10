/**
 * Learned-baseline aggregates: every report lands in a venue × month × day-type × hour bucket;
 * GET /api/pattern merges the last three months. Memory store and the Redis REST store (fake server).
 */
import { POST, resetRateLimits } from '@/app/api/crowd+api';
import { GET as GET_PATTERN } from '@/app/api/pattern+api';
import { bucketOf, createMemoryStore, createRedisStore, recentMonths, setStore, type CrowdStore } from '@/server/crowdStore';
import { LEVEL_MID } from '@/domain/levels';

const url = 'http://localhost/api/crowd';
const post = (body: unknown) => POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify(body) }));
const pattern = async (venues: string) => (await GET_PATTERN(new Request(`http://localhost/api/pattern?venues=${venues}`))).json();

beforeEach(() => {
  setStore(createMemoryStore());
  resetRateLimits();
});

describe('buckets', () => {
  test('bucketOf uses the New Jersey local day type, hour, month and date', () => {
    // Mon 5 Oct 2026 15:00 EDT = 19:00 UTC
    expect(bucketOf('2026-10-05T19:00:00.000Z')).toEqual({ month: '2026-10', dayType: 'wk', hour: 15, dateKey: '2026-10-05' });
    // Sat 10 Oct 2026 00:30 EDT = 04:30 UTC
    expect(bucketOf('2026-10-10T04:30:00.000Z')).toEqual({ month: '2026-10', dayType: 'sa', hour: 0, dateKey: '2026-10-10' });
    // Sun 1 Nov 2026 (fall-back day) 01:30 EST
    expect(bucketOf('2026-11-01T06:30:00.000Z')).toEqual({ month: '2026-11', dayType: 'su', hour: 1, dateKey: '2026-11-01' });
  });

  test('recentMonths lists the current month and the two before it', () => {
    expect(recentMonths(Date.parse('2026-10-05T19:00:00.000Z'))).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(recentMonths(Date.parse('2026-01-15T19:00:00.000Z'))).toEqual(['2026-01', '2025-12', '2025-11']);
  });
});

async function aggregateScenario(store: CrowdStore) {
  // Five reports in one bucket over four distinct days across two months, mixed weights; one report in another bucket.
  await store.record('alexander-library', { month: '2026-10', dayType: 'wk', hour: 15, dateKey: '2026-10-05' }, 1, LEVEL_MID[3]);
  await store.record('alexander-library', { month: '2026-10', dayType: 'wk', hour: 15, dateKey: '2026-10-05' }, 1, LEVEL_MID[3]);
  await store.record('alexander-library', { month: '2026-10', dayType: 'wk', hour: 15, dateKey: '2026-10-06' }, 0.5, LEVEL_MID[1]);
  await store.record('alexander-library', { month: '2026-10', dayType: 'wk', hour: 15, dateKey: '2026-10-07' }, 0.25, LEVEL_MID[4]);
  await store.record('alexander-library', { month: '2026-09', dayType: 'wk', hour: 15, dateKey: '2026-09-30' }, 1, LEVEL_MID[2]);
  await store.record('alexander-library', { month: '2026-10', dayType: 'sa', hour: 11, dateKey: '2026-10-10' }, 0.5, LEVEL_MID[0]);
  const p = await store.pattern('alexander-library', ['2026-10', '2026-09', '2026-08']);
  const b = p.wk[15];
  expect(b.n).toBe(5);
  expect(b.days).toBe(4);
  const expected = (1 * LEVEL_MID[3] + 1 * LEVEL_MID[3] + 0.5 * LEVEL_MID[1] + 0.25 * LEVEL_MID[4] + 1 * LEVEL_MID[2]) / (1 + 1 + 0.5 + 0.25 + 1);
  expect(b.pct).toBeCloseTo(expected, 6);
  expect(p.sa[11]).toEqual({ n: 1, days: 1, pct: LEVEL_MID[0] });
  expect(p.su[11]).toEqual({ n: 0, days: 0, pct: null });
  expect(p.wk).toHaveLength(24);
  const empty = await store.pattern('nobody', ['2026-10']);
  expect(empty.wk.every((x) => x.n === 0 && x.pct === null)).toBe(true);
}

describe('aggregates', () => {
  test('memory store sums weights and counts distinct days across months', async () => {
    await aggregateScenario(createMemoryStore());
  });

  test('Redis REST store does the same through pipelined commands', async () => {
    const hashes = new Map<string, Map<string, string>>();
    const sets = new Map<string, Set<string>>();
    const lists = new Map<string, string[]>();
    const exec = (c: unknown[]): unknown => {
      const [cmd, key, ...a] = c.map(String);
      switch (cmd) {
        case 'HINCRBY':
        case 'HINCRBYFLOAT': {
          const h = hashes.get(key) ?? new Map<string, string>();
          const next = Number(h.get(a[0]) ?? 0) + Number(a[1]);
          h.set(a[0], String(next));
          hashes.set(key, h);
          return cmd === 'HINCRBY' ? next : String(next);
        }
        case 'HGETALL': {
          const h = hashes.get(key);
          return h ? [...h.entries()].flat() : [];
        }
        case 'SADD': {
          const s = sets.get(key) ?? new Set<string>();
          const added = s.has(a[0]) ? 0 : 1;
          s.add(a[0]);
          sets.set(key, s);
          return added;
        }
        case 'EXPIRE':
          return 1;
        case 'LPUSH':
          lists.set(key, [a[0], ...(lists.get(key) ?? [])]);
          return (lists.get(key) ?? []).length;
        case 'LTRIM':
          lists.set(key, (lists.get(key) ?? []).slice(Number(a[0]), Number(a[1]) + 1));
          return 'OK';
        case 'LRANGE':
          return (lists.get(key) ?? []).slice(Number(a[0]), Number(a[1]) + 1);
        default:
          throw new Error(`unexpected ${cmd}`);
      }
    };
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    const calls: string[] = [];
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      calls.push(u);
      const body = JSON.parse(String(init?.body));
      if (u.endsWith('/pipeline')) return json((body as unknown[][]).map((c) => ({ result: exec(c) })));
      return json({ result: exec(body as unknown[]) });
    }) as unknown as typeof fetch;
    await aggregateScenario(createRedisStore('https://db.example.upstash.io', 'tok'));
    expect(calls.some((u) => u.endsWith('/pipeline'))).toBe(true);
    expect(calls.length).toBeLessThan(40);
  });
});

describe('GET /api/pattern', () => {
  test('a past report lands in its bucket; the same body twice counts once; unknown venues are empty', async () => {
    const at = new Date(Date.now() - 2 * 86400_000);
    at.setUTCMinutes(0, 0, 0);
    const body = { venueId: 'alexander-library', level: 2, at: at.toISOString(), kind: 'past' };
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    const res = await pattern('alexander-library,nobody');
    expect(res.ok).toBe(true);
    expect(res.months).toHaveLength(3);
    const b = bucketOf(at.toISOString());
    expect(res.patterns['alexander-library'][b.dayType][b.hour]).toEqual({ n: 1, days: 1, pct: LEVEL_MID[2] });
    expect(res.patterns.nobody.wk.every((x: { n: number }) => x.n === 0)).toBe(true);
    expect(JSON.stringify(res)).not.toMatch(/note|user|lat|lng/);
  });

  test('earlier visits are told apart by the phone id, so identical reports from different students all count', async () => {
    const at = new Date(Date.now() - 3 * 86400_000);
    at.setUTCMinutes(0, 0, 0);
    const body = { venueId: 'nbfpl', level: 3, at: at.toISOString(), kind: 'past' };
    expect((await post({ ...body, id: 'ci_a' })).status).toBe(200);
    expect((await post({ ...body, id: 'ci_a' })).status).toBe(200);
    expect((await post({ ...body, id: 'ci_b' })).status).toBe(200);
    expect((await post({ ...body, id: 'ci_c', level: 1 })).status).toBe(200);
    const b = bucketOf(at.toISOString());
    const x = (await pattern('nbfpl')).patterns.nbfpl[b.dayType][b.hour];
    expect(x.n).toBe(3);
    expect(x.days).toBe(1);
    expect(x.pct).toBeCloseTo((0.5 * LEVEL_MID[3] * 2 + 0.5 * LEVEL_MID[1]) / 1.5, 6);
  });

  test('live and remote reports feed the baseline with their stored weights', async () => {
    const at = new Date();
    at.setUTCMinutes(0, 0, 0);
    expect((await post({ venueId: 'carr-library', level: 3, at: at.toISOString(), weight: 1 })).status).toBe(200);
    expect((await post({ venueId: 'carr-library', level: 1, at: at.toISOString(), kind: 'remote' })).status).toBe(200);
    const b = bucketOf(at.toISOString());
    const res = await pattern('carr-library');
    const x = res.patterns['carr-library'][b.dayType][b.hour];
    expect(x.n).toBe(2);
    expect(x.pct).toBeCloseTo((1 * LEVEL_MID[3] + 0.25 * LEVEL_MID[1]) / 1.25, 6);
  });
});
