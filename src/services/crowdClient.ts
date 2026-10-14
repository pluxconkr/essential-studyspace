/**
 * Client for the relay routes: /api/crowd (GET recent venue-level reports, POST one) and
 * /api/pattern (GET the learned baseline). Any failure → null/'failed'; the UI already shows
 * the typical pattern and the student's own check-ins, so nothing waits on this.
 *
 * Every response is re-validated here (levels, kinds, weight floors, 24-hour rows), so a buggy or
 * outdated relay cannot hand fusion an impossible value. Every request gives up after 10 s.
 * Callers: services/refresh.ts (refresh, check-in upload) and services/backgroundPoll.ts.
 */
import { KIND_WEIGHT, isLevel, toReport } from '@/domain/levels';
import type { Amenity, CheckIn, CrowdReport, CrowdSnapshot, NoiseReport, PatternBucket, PatternSnapshot, VenuePattern } from '@/domain/types';

/** Per-request limit: a relay that stops answering ends as a failure instead of holding up the refresh. */
const TIMEOUT_MS = 10_000;

/**
 * Absolute URL of the deployed crowd route (EXPO_PUBLIC_CROWD_URL, ending in /api/crowd) for production builds;
 * the relative default reaches the Metro dev server in development. A store build without it has no relay.
 */
export const CROWD_URL = process.env.EXPO_PUBLIC_CROWD_URL ?? '/api/crowd';
/**
 * The learned-baseline route lives next to the crowd route (`…/crowd` → `…/pattern`), so it needs no variable of its own.
 * EXPO_PUBLIC_CROWD_URL must therefore end in `crowd` (no trailing slash or query); otherwise this stays the crowd URL.
 */
export const PATTERN_URL = CROWD_URL.replace(/crowd$/, 'pattern');

/** GET /api/crowd body as it may arrive: every field optional and checked before use. */
interface CrowdGetResponse {
  configured?: boolean;
  storage?: 'memory' | 'redis';
  reports?: Record<string, { kind?: string; zoneId?: string | null; level?: number; at?: string; weight?: number; noise?: number | null; amenities?: unknown }[]>;
}

/**
 * Outcome of one upload. 'ok' = stored (a re-send the relay already holds also counts).
 * 'stale' = HTTP 422: the report's time is outside what the relay accepts (too old, or more than 5 min ahead);
 * there is nothing to retry. 'failed' = anything else (offline, timeout, refusal); the next sync tries again.
 */
export type PostResult = 'ok' | 'stale' | 'failed';

/** An abort signal that fires after 10 s, plus `done()` to clear its timer (call it in `finally`). Also used by refreshVenues. */
export function withTimeout(): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

/** Type guard for the 0–3 noise scale (silent … loud). */
const isNoise = (n: unknown): n is NoiseReport => n === 0 || n === 1 || n === 2 || n === 3;

/**
 * The relay's recent reports (it serves the last 3 hours) for the given venues, re-checked row by row: rows
 * without a time or a valid level are dropped, any kind other than 'remote' reads as 'live', weight is clamped
 * to 0.4–1 (live) or 0.25–1 (remote) with the floor as default (the same floors the relay applies), noise
 * outside 0–3 becomes null and non-string amenities are dropped. `fetchedAt` is device time; `configured` is
 * false only when the relay says it keeps reports in dev-server memory. Null for an empty id list or on any
 * HTTP, network, timeout or JSON failure.
 */
export async function fetchCrowd(venueIds: string[]): Promise<CrowdSnapshot | null> {
  if (venueIds.length === 0) return null;
  const t = withTimeout();
  try {
    const res = await fetch(`${CROWD_URL}?venues=${encodeURIComponent(venueIds.join(','))}`, { headers: { Accept: 'application/json' }, signal: t.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as CrowdGetResponse;
    const reports: Record<string, CrowdReport[]> = {};
    for (const [venueId, list] of Object.entries(body.reports ?? {})) {
      reports[venueId] = (list ?? [])
        .filter((r) => typeof r.at === 'string' && isLevel(r.level))
        .map((r) => {
          const kind = r.kind === 'remote' ? ('remote' as const) : ('live' as const);
          const floor = kind === 'remote' ? KIND_WEIGHT.remote : 0.4;
          return {
          venueId,
          kind,
          zoneId: r.zoneId ?? null,
          level: r.level as CrowdReport['level'],
          at: r.at as string,
          weight: typeof r.weight === 'number' ? Math.min(1, Math.max(floor, r.weight)) : floor,
          noise: isNoise(r.noise) ? r.noise : null,
          amenities: Array.isArray(r.amenities) ? r.amenities.filter((a): a is Amenity => typeof a === 'string') : [],
          };
        });
    }
    return { fetchedAt: new Date().toISOString(), reports, configured: body.configured !== false, storage: body.storage ?? null };
  } catch {
    return null;
  } finally {
    t.done();
  }
}

/**
 * One day type's row from the relay, forced to exactly 24 hourly buckets: counts become whole numbers ≥ 0,
 * and pct is clamped to 0–1, or null when the bucket is empty or malformed.
 */
const bucketRow = (raw: unknown): PatternBucket[] =>
  Array.from({ length: 24 }, (_, h): PatternBucket => {
    const b = Array.isArray(raw) ? (raw[h] as { n?: unknown; days?: unknown; pct?: unknown } | undefined) : undefined;
    const n = typeof b?.n === 'number' && b.n > 0 ? Math.floor(b.n) : 0;
    const days = typeof b?.days === 'number' && b.days > 0 ? Math.floor(b.days) : 0;
    const pct = n > 0 && typeof b?.pct === 'number' && Number.isFinite(b.pct) ? Math.min(1, Math.max(0, b.pct)) : null;
    return { n, days, pct };
  });

/**
 * The learned baseline for the given venues: 24 × 3 buckets per venue (weekday, Saturday, Sunday), shape
 * enforced here. Venues the relay did not answer for are left out, so they stay on the estimate.
 * `fetchedAt` is device time; `months` lists the relay's merged month keys (YYYY-MM). Null for an empty id
 * list, on any HTTP, network, timeout or JSON failure, or when the body has no `patterns` object.
 */
export async function fetchPattern(venueIds: string[]): Promise<PatternSnapshot | null> {
  if (venueIds.length === 0) return null;
  const t = withTimeout();
  try {
    const res = await fetch(`${PATTERN_URL}?venues=${encodeURIComponent(venueIds.join(','))}`, { headers: { Accept: 'application/json' }, signal: t.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { months?: unknown; patterns?: Record<string, { wk?: unknown; sa?: unknown; su?: unknown }> };
    if (!body.patterns || typeof body.patterns !== 'object') return null;
    const patterns: Record<string, VenuePattern> = {};
    for (const id of venueIds) {
      const p = body.patterns[id];
      if (p && typeof p === 'object') patterns[id] = { wk: bucketRow(p.wk), sa: bucketRow(p.sa), su: bucketRow(p.su) };
    }
    const months = Array.isArray(body.months) ? body.months.filter((m): m is string => typeof m === 'string') : [];
    return { fetchedAt: new Date().toISOString(), months, patterns };
  } catch {
    return null;
  } finally {
    t.done();
  }
}

/**
 * Send the anonymous part of a check-in. Notes, identity and location never leave the phone.
 * The body is toReport(ci) (venue, kind, zone, level, time, weight, noise, amenities) plus the check-in's own
 * id (its creation time and a random part, nothing about the student), which the relay uses only to ignore a
 * re-sent earlier-visit report. Never throws; see PostResult for what each outcome means to the upload queue.
 */
export async function postReport(ci: CheckIn): Promise<PostResult> {
  const t = withTimeout();
  try {
    const res = await fetch(CROWD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...toReport(ci), id: ci.checkInId }),
      signal: t.signal,
    });
    if (res.ok) return 'ok';
    return res.status === 422 ? 'stale' : 'failed';
  } catch {
    return 'failed';
  } finally {
    t.done();
  }
}
