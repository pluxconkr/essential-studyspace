/**
 * Storage behind the crowd relay, shared by /api/crowd and /api/pattern:
 *   - the 3-hour live list per venue (what "right now" is fused from)
 *   - the learned-baseline aggregates: venue × month × day type × hour, counts and weighted sums only
 *   - a 3-hour seen set per venue, so a re-sent earlier-visit report is counted once
 * Upstash-compatible Redis REST when CROWD_STORE_URL/TOKEN are set, else memory (the dev server).
 * Both backends implement CrowdStore with the same layout, so the routes treat them alike (they read
 * `kind` only to report it). Server-only: imported by the API routes and tests, never by app code;
 * fusion stays on the phone.
 * No raw report is retained for the baseline; what is not stored cannot leak.
 */
import { dayTypeOf } from '@/domain/curve';
import { isLevel } from '@/domain/levels';
import { zonedParts } from '@/domain/time';
import type { DayType, PatternBucket, ReportKind, VenuePattern } from '@/domain/types';

/**
 * How long a live or remote report counts as "right now" (the phone's fusion uses the same 3 hours, FUSION.maxAgeMin):
 * GET serves nothing older, POST rejects older live/remote reports, and the seen set remembers a re-sent
 * earlier-visit report this long. On Redis an idle live list also expires after it.
 */
export const RETENTION_MS = 3 * 3600_000;
/** Most rows a venue's live list keeps, latest arrival first; a push drops the earliest arrivals beyond it, bounding storage and the GET payload during a burst. */
export const MAX_PER_VENUE = 200;
/**
 * Most venue ids one GET (crowd or pattern) looks up; extra ids are ignored, bounding the store reads one request
 * can cause. The phone asks for one area's venues or its watched spots (crowd), or the whole directory, 19 bundled
 * venues today (pattern).
 */
export const MAX_VENUES_PER_GET = 60;
/** Aggregates are kept per month and read over this many months, so a new term takes over by itself. */
const PATTERN_MONTHS = 3;
/** Redis expiry of a month's aggregates, renewed on every write: outlives the three months that are read. The memory store never expires them. */
const MONTH_TTL_S = 120 * 86400;
/** RETENTION_MS in seconds, for Redis EXPIRE on the live list and the seen set. */
const LIVE_TTL_S = Math.ceil(RETENTION_MS / 1000);

/**
 * One anonymous report as the live list keeps it and GET /api/crowd serves it (the phone reads it as a CrowdReport).
 * The venue is the list it sits in; there is no note, no user or device id and no location.
 */
export interface StoredReport {
  /** 'live' or 'remote' in the live list; 'past' appears only in POST's echo, since earlier visits are never listed. */
  kind: ReportKind;
  zoneId: string | null;
  /** 0 Empty … 4 Full. */
  level: number;
  /** ISO, rounded to the minute. */
  at: string;
  /** Set by the server: the live report's proof clamped to 0.4–1, or KIND_WEIGHT for remote (0.25) and past (0.5). */
  weight: number;
  noise: number | null;
  amenities: string[];
}

/**
 * Where one report lands in the learned baseline, in New Jersey local time: month ("YYYY-MM"), day type, hour 0–23,
 * and the local date ("YYYY-MM-DD") that counts toward the bucket's distinct days. This is the address of an
 * aggregate cell; PatternBucket is the merged value the phone receives.
 */
export interface Bucket {
  month: string;
  dayType: DayType;
  hour: number;
  dateKey: string;
}

/** What both backends implement; the routes only ever talk to this. Every method may throw when the store is unreachable. */
export interface CrowdStore {
  /** Which backend answered: GET /api/crowd reports it, and the app labels 'memory' as the dev relay. */
  kind: 'memory' | 'redis';
  /**
   * The venue's live list, latest arrival first (a report queued offline arrives after its `at`), at most MAX_PER_VENUE
   * rows. It may still hold rows older than RETENTION_MS; GET filters them.
   */
  list(venueId: string): Promise<StoredReport[]>;
  /** Adds a live or remote report to the front of the venue's live list, dropping the earliest arrivals beyond MAX_PER_VENUE. */
  push(venueId: string, r: StoredReport): Promise<void>;
  /**
   * Marks `key` as counted for this venue and returns true if it already was: how a re-sent earlier-visit request
   * is recognised. A key is remembered for at least RETENTION_MS after it was last checked.
   */
  seen(venueId: string, key: string): Promise<boolean>;
  /**
   * Adds one report to its aggregate bucket: one more report, `weight` and `weight × pct` into the sums, and its
   * local date into the distinct days. `pct` is the reported level's mid-point share (LEVEL_MID).
   */
  record(venueId: string, b: Bucket, weight: number, pct: number): Promise<void>;
  /**
   * The venue's 3 × 24 baseline buckets merged over `months` ("YYYY-MM"); all empty for a venue nobody reported.
   * Distinct days add up exactly across months because bucketOf files each date under its own month.
   */
  pattern(venueId: string, months: string[]): Promise<VenuePattern>;
}

/**
 * The aggregate bucket a report belongs to, in New Jersey local time whatever the server's zone. It uses the local
 * wall-clock hour (so a 3 PM rush stays in hour 15 across DST) and the same dayTypeOf the phone uses to look buckets up.
 */
export function bucketOf(iso: string): Bucket {
  const p = zonedParts(Date.parse(iso));
  return { month: p.dateKey.slice(0, 7), dayType: dayTypeOf(p.weekday), hour: p.hour, dateKey: p.dateKey };
}

/**
 * The current local month and the ones before it, newest first: PATTERN_MONTHS "YYYY-MM" keys (e.g. 2026-10, 2026-09,
 * 2026-08) counted from the server's clock in New Jersey time. These are the months GET /api/pattern merges.
 */
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

/**
 * Venue ids from a `?venues=a,b` query value: trimmed, kept only when shaped like a venue id ([a-z0-9-], 1–80
 * characters, the rule POST applies), at most MAX_VENUES_PER_GET. Anything else is dropped silently, so an id can
 * only ever name a venue's own store keys.
 */
export function parseVenueIds(param: string | null): string[] {
  return (param ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9-]{1,80}$/.test(s))
    .slice(0, MAX_VENUES_PER_GET);
}

/** Running totals for one "dayType:hour" field while months are merged: reports, Σ weight × pct, Σ weight, distinct days. */
interface Acc {
  n: number;
  s: number;
  w: number;
  days: number;
}

/**
 * Shapes merged totals (keyed "wk:15") into the 3 × 24 VenuePattern the phone expects: every hour present,
 * pct = Σ(weight × pct) ÷ Σ weight, or null for an empty bucket. Fields that are not a valid day type and hour are ignored.
 */
function toPattern(acc: Map<string, Acc>): VenuePattern {
  /** 24 empty buckets; a new array per call, so the three day types never share rows. */
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

/** A bucket's field name within its month, "dayType:hour" (e.g. "wk:15"); the Redis hash prefixes it with n:, s:, w: or d:. */
const field = (b: Pick<Bucket, 'dayType' | 'hour'>) => `${b.dayType}:${b.hour}`;

// ---------- In-memory store (dev server / tests) ----------

/**
 * CrowdStore in process memory, for the Metro dev server and tests. Same layout as Redis (live lists, seen sets,
 * per-month buckets with date sets), but only seen keys expire, and everything is gone when the process restarts.
 */
export function createMemoryStore(): CrowdStore {
  const lists = new Map<string, StoredReport[]>();
  const seen = new Map<string, Map<string, number>>();
  const agg = new Map<string, Map<string, { n: number; s: number; w: number; dates: Set<string> }>>();
  return {
    kind: 'memory',
    /** The stored list itself, latest arrival first; rows past the retention window stay until pushed out. */
    async list(venueId) {
      return lists.get(venueId) ?? [];
    },
    /** Prepends the report and keeps the latest MAX_PER_VENUE arrivals. */
    async push(venueId, r) {
      lists.set(venueId, [r, ...(lists.get(venueId) ?? [])].slice(0, MAX_PER_VENUE));
    },
    /** Forgets this venue's keys not checked for RETENTION_MS, then stamps `key` with the current time; true if it was already there. */
    async seen(venueId, key) {
      const now = Date.now();
      const m = seen.get(venueId) ?? new Map<string, number>();
      for (const [k, t] of m) if (now - t > RETENTION_MS) m.delete(k);
      const was = m.has(key);
      m.set(key, now);
      seen.set(venueId, m);
      return was;
    },
    /** Adds the report to its month's bucket; the bucket's date set yields the distinct-day count. */
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
    /** Sums the requested months bucket by bucket, adding each month's date-set size to `days`. */
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

/**
 * CrowdStore over an Upstash-compatible Redis REST API (`url` and `token` are CROWD_STORE_URL/TOKEN). Every call
 * is a POST to that API, and multi-command steps go through `/pipeline` in one round trip. Any HTTP or
 * Redis error throws, which the routes answer with 503 store-unavailable.
 */
export function createRedisStore(url: string, token: string): CrowdStore {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  /** Runs one Redis command, e.g. ['LRANGE', key, 0, 199], and returns its result; throws on an HTTP or Redis error. */
  async function cmd(parts: (string | number)[]): Promise<unknown> {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(parts) });
    const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? `redis ${res.status}`);
    return body.result;
  }
  /**
   * Runs several commands in one request and returns their results in order. Throws if the request fails or any
   * command errored; a pipeline is not a transaction, so the other commands may still have run.
   */
  async function pipeline(cmds: (string | number)[][]): Promise<unknown[]> {
    const res = await fetch(`${url}/pipeline`, { method: 'POST', headers, body: JSON.stringify(cmds) });
    const body = (await res.json().catch(() => null)) as { result?: unknown; error?: string }[] | null;
    if (!res.ok || !Array.isArray(body)) throw new Error(`redis ${res.status}`);
    const bad = body.find((b) => b.error);
    if (bad) throw new Error(bad.error);
    return body.map((b) => b.result);
  }
  /** List of JSON StoredReport rows, latest arrival first; expires RETENTION_MS after the last push. */
  const liveKey = (venueId: string) => `crowd:${venueId}`;
  /** Set of keys of earlier-visit reports already counted; expires RETENTION_MS after the last check. */
  const seenKey = (venueId: string) => `crowd:${venueId}:past-seen`;
  /** Hash of one month's aggregates, fields n|s|w|d:{dayType}:{hour}; expires 120 days after the month's last write. */
  const hashKey = (venueId: string, month: string) => `pattern:${venueId}:${month}`;
  /** Set of the local dates behind one bucket's `d` count; 120-day expiry renewed by writes to that bucket. */
  const daysKey = (venueId: string, b: Bucket) => `pattern:${venueId}:${b.month}:days:${field(b)}`;
  return {
    kind: 'redis',
    /**
     * The latest MAX_PER_VENUE arrivals. A row that does not parse, has no time or has an invalid level is skipped;
     * any kind but 'remote' (e.g. a row written before report kinds existed) reads as 'live'.
     */
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
    /** One pipeline: LPUSH the row, LTRIM to MAX_PER_VENUE, and renew the 3-hour expiry so an idle venue's list disappears by itself. */
    async push(venueId, r) {
      await pipeline([
        ['LPUSH', liveKey(venueId), JSON.stringify(r)],
        ['LTRIM', liveKey(venueId), 0, MAX_PER_VENUE - 1],
        ['EXPIRE', liveKey(venueId), LIVE_TTL_S],
      ]);
    },
    /** SADD into the venue's seen set and renew its 3-hour expiry; SADD adding nothing means the key was already there. */
    async seen(venueId, key) {
      const [added] = await pipeline([
        ['SADD', seenKey(venueId), key],
        ['EXPIRE', seenKey(venueId), LIVE_TTL_S],
      ]);
      return Number(added) === 0;
    },
    /**
     * One pipeline bumps n, s and w, adds the local date to the bucket's date set and renews both expiries. `d` is
     * bumped in a second request, only when that date was new, because a pipeline cannot branch on SADD's reply.
     * Keeping `d` as a counter means a read needs one HGETALL per month instead of a set count per bucket.
     */
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
    /** One pipeline of HGETALL per month; the flat [field, value, …] replies are summed per "dayType:hour" by their n/s/w/d prefix. */
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

/** The store getStore() hands out, chosen on first use; tests replace it with setStore(). */
let store: CrowdStore | null = null;
// Each API route is bundled on its own, so the dev-server memory store lives on globalThis for both routes to share.
const shared = globalThis as { __studyspaceCrowdStore?: CrowdStore };

/**
 * The store both routes use, chosen on the first call: Redis REST when CROWD_STORE_URL and CROWD_STORE_TOKEN are both
 * set (server environment only, never in the phone bundle), else the process-wide memory store, which loses everything
 * on restart and which GET /api/crowd reports as not configured. The choice is kept, so changed values need a restart.
 */
export function getStore(): CrowdStore {
  if (store) return store;
  const url = process.env.CROWD_STORE_URL?.trim();
  const token = process.env.CROWD_STORE_TOKEN?.trim();
  store = url && token ? createRedisStore(url, token) : (shared.__studyspaceCrowdStore ??= createMemoryStore());
  return store;
}

/** Tests swap the store (a fresh memory store before each case); null makes the next getStore() choose from the environment again. */
export function setStore(s: CrowdStore | null): void {
  store = s;
}
