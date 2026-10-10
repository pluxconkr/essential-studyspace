/**
 * Storage behind the crowd relay, shared by /api/crowd and /api/pattern:
 *   - the 3-hour live list per venue (what "right now" is fused from)
 *   - the learned-baseline aggregates: venue × month × day type × hour, counts and weighted sums only
 * Upstash-compatible Redis REST when CROWD_STORE_URL/TOKEN are set, else memory (the dev server).
 * No raw report is retained for the baseline; what is not stored cannot leak.
 */
import { dayTypeOf } from '@/domain/curve';
import { isLevel } from '@/domain/levels';
import { zonedParts } from '@/domain/time';
import type { DayType, PatternBucket, ReportKind, VenuePattern } from '@/domain/types';

export const RETENTION_MS = 3 * 3600_000;
export const MAX_PER_VENUE = 200;
export const MAX_VENUES_PER_GET = 60;
/** Aggregates are kept per month and read over this many months, so a new term takes over by itself. */
const PATTERN_MONTHS = 3;
const MONTH_TTL_S = 120 * 86400;
const LIVE_TTL_S = Math.ceil(RETENTION_MS / 1000);

export interface StoredReport {
  kind: ReportKind;
  zoneId: string | null;
  level: number;
  /** ISO, rounded to the minute. */
  at: string;
  weight: number;
  noise: number | null;
  amenities: string[];
}

export interface Bucket {
  month: string;
  dayType: DayType;
  hour: number;
  dateKey: string;
}

export interface CrowdStore {
  kind: 'memory' | 'redis';
  list(venueId: string): Promise<StoredReport[]>;
  push(venueId: string, r: StoredReport): Promise<void>;
  /** True when this exact past report was already counted within the live window (a re-sent request). */
  seen(venueId: string, key: string): Promise<boolean>;
  record(venueId: string, b: Bucket, weight: number, pct: number): Promise<void>;
  pattern(venueId: string, months: string[]): Promise<VenuePattern>;
}

/** The aggregate bucket a report belongs to, in New Jersey local time. */
export function bucketOf(iso: string): Bucket {
  const p = zonedParts(Date.parse(iso));
  return { month: p.dateKey.slice(0, 7), dayType: dayTypeOf(p.weekday), hour: p.hour, dateKey: p.dateKey };
}

/** The current local month and the ones before it, newest first. */
export function recentMonths(now: number): string[] {
  const p = zonedParts(now);
  let y = Number(p.dateKey.slice(0, 4));
  let m = Number(p.dateKey.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < PATTERN_MONTHS; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export function parseVenueIds(param: string | null): string[] {
  return (param ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9-]{1,80}$/.test(s))
    .slice(0, MAX_VENUES_PER_GET);
}

interface Acc {
  n: number;
  s: number;
  w: number;
  days: number;
}

function toPattern(acc: Map<string, Acc>): VenuePattern {
  const empty = () => Array.from({ length: 24 }, (): PatternBucket => ({ n: 0, days: 0, pct: null }));
  const out: VenuePattern = { wk: empty(), sa: empty(), su: empty() };
  for (const [field, a] of acc) {
    const [dt, h] = field.split(':');
    const hour = Number(h);
    if ((dt !== 'wk' && dt !== 'sa' && dt !== 'su') || !(hour >= 0 && hour < 24)) continue;
    out[dt][hour] = { n: a.n, days: a.days, pct: a.w > 0 ? a.s / a.w : null };
  }
  return out;
}

const field = (b: Pick<Bucket, 'dayType' | 'hour'>) => `${b.dayType}:${b.hour}`;

// ---------- In-memory store (dev server / tests) ----------

export function createMemoryStore(): CrowdStore {
  const lists = new Map<string, StoredReport[]>();
  const seen = new Map<string, Map<string, number>>();
  const agg = new Map<string, Map<string, { n: number; s: number; w: number; dates: Set<string> }>>();
  return {
    kind: 'memory',
    async list(venueId) {
      return lists.get(venueId) ?? [];
    },
    async push(venueId, r) {
      lists.set(venueId, [r, ...(lists.get(venueId) ?? [])].slice(0, MAX_PER_VENUE));
    },
    async seen(venueId, key) {
      const now = Date.now();
      const m = seen.get(venueId) ?? new Map<string, number>();
      for (const [k, t] of m) if (now - t > RETENTION_MS) m.delete(k);
      const was = m.has(key);
      m.set(key, now);
      seen.set(venueId, m);
      return was;
    },
    async record(venueId, b, weight, pct) {
      const h = agg.get(`${venueId}:${b.month}`) ?? new Map();
      const a = h.get(field(b)) ?? { n: 0, s: 0, w: 0, dates: new Set<string>() };
      a.n += 1;
      a.s += weight * pct;
      a.w += weight;
      a.dates.add(b.dateKey);
      h.set(field(b), a);
      agg.set(`${venueId}:${b.month}`, h);
    },
    async pattern(venueId, months) {
      const acc = new Map<string, Acc>();
      for (const month of months) {
        for (const [f, a] of agg.get(`${venueId}:${month}`) ?? []) {
          const x = acc.get(f) ?? { n: 0, s: 0, w: 0, days: 0 };
          x.n += a.n;
          x.s += a.s;
          x.w += a.w;
          x.days += a.dates.size;
          acc.set(f, x);
        }
      }
      return toPattern(acc);
    },
  };
}

// ---------- Redis REST store (Upstash-compatible) ----------

export function createRedisStore(url: string, token: string): CrowdStore {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  async function cmd(parts: (string | number)[]): Promise<unknown> {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(parts) });
    const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? `redis ${res.status}`);
    return body.result;
  }
  async function pipeline(cmds: (string | number)[][]): Promise<unknown[]> {
    const res = await fetch(`${url}/pipeline`, { method: 'POST', headers, body: JSON.stringify(cmds) });
    const body = (await res.json().catch(() => null)) as { result?: unknown; error?: string }[] | null;
    if (!res.ok || !Array.isArray(body)) throw new Error(`redis ${res.status}`);
    const bad = body.find((b) => b.error);
    if (bad) throw new Error(bad.error);
    return body.map((b) => b.result);
  }
  const liveKey = (venueId: string) => `crowd:${venueId}`;
  const seenKey = (venueId: string) => `crowd:${venueId}:past-seen`;
  const hashKey = (venueId: string, month: string) => `pattern:${venueId}:${month}`;
  const daysKey = (venueId: string, b: Bucket) => `pattern:${venueId}:${b.month}:days:${field(b)}`;
  return {
    kind: 'redis',
    async list(venueId) {
      const raw = (await cmd(['LRANGE', liveKey(venueId), 0, MAX_PER_VENUE - 1])) as unknown;
      if (!Array.isArray(raw)) return [];
      const out: StoredReport[] = [];
      for (const s of raw) {
        try {
          const r = JSON.parse(String(s)) as StoredReport;
          if (r && typeof r.at === 'string' && isLevel(r.level)) out.push({ ...r, kind: r.kind === 'remote' ? 'remote' : 'live' });
        } catch {
          /* skip bad row */
        }
      }
      return out;
    },
    async push(venueId, r) {
      await pipeline([
        ['LPUSH', liveKey(venueId), JSON.stringify(r)],
        ['LTRIM', liveKey(venueId), 0, MAX_PER_VENUE - 1],
        ['EXPIRE', liveKey(venueId), LIVE_TTL_S],
      ]);
    },
    async seen(venueId, key) {
      const [added] = await pipeline([
        ['SADD', seenKey(venueId), key],
        ['EXPIRE', seenKey(venueId), LIVE_TTL_S],
      ]);
      return Number(added) === 0;
    },
    async record(venueId, b, weight, pct) {
      const h = hashKey(venueId, b.month);
      const f = field(b);
      const [, , , added] = await pipeline([
        ['HINCRBY', h, `n:${f}`, 1],
        ['HINCRBYFLOAT', h, `s:${f}`, weight * pct],
        ['HINCRBYFLOAT', h, `w:${f}`, weight],
        ['SADD', daysKey(venueId, b), b.dateKey],
        ['EXPIRE', h, MONTH_TTL_S],
        ['EXPIRE', daysKey(venueId, b), MONTH_TTL_S],
      ]);
      if (Number(added) === 1) await cmd(['HINCRBY', h, `d:${f}`, 1]);
    },
    async pattern(venueId, months) {
      const rows = await pipeline(months.map((m) => ['HGETALL', hashKey(venueId, m)]));
      const acc = new Map<string, Acc>();
      for (const raw of rows) {
        if (!Array.isArray(raw)) continue;
        for (let i = 0; i + 1 < raw.length; i += 2) {
          const [kind, dt, h] = String(raw[i]).split(':');
          const f = `${dt}:${h}`;
          const x = acc.get(f) ?? { n: 0, s: 0, w: 0, days: 0 };
          const val = Number(raw[i + 1]);
          if (kind === 'n') x.n += val;
          else if (kind === 's') x.s += val;
          else if (kind === 'w') x.w += val;
          else if (kind === 'd') x.days += val;
          acc.set(f, x);
        }
      }
      return toPattern(acc);
    },
  };
}

let store: CrowdStore | null = null;
// Each API route is bundled on its own, so the dev-server memory store lives on globalThis for both routes to share.
const shared = globalThis as { __studyspaceCrowdStore?: CrowdStore };

export function getStore(): CrowdStore {
  if (store) return store;
  const url = process.env.CROWD_STORE_URL?.trim();
  const token = process.env.CROWD_STORE_TOKEN?.trim();
  store = url && token ? createRedisStore(url, token) : (shared.__studyspaceCrowdStore ??= createMemoryStore());
  return store;
}

/** Tests swap the store. */
export function setStore(s: CrowdStore | null): void {
  store = s;
}
