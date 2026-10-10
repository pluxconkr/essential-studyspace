/**
 * Client for the relay routes: /api/crowd (GET recent venue-level reports, POST one) and
 * /api/pattern (GET the learned baseline). Any failure → null/'failed'; the UI already shows
 * the typical pattern and the student's own check-ins, so nothing waits on this.
 */
import { KIND_WEIGHT, isLevel, toReport } from '@/domain/levels';
import type { Amenity, CheckIn, CrowdReport, CrowdSnapshot, NoiseReport, PatternBucket, PatternSnapshot, VenuePattern } from '@/domain/types';

const TIMEOUT_MS = 10_000;

/** Optional absolute origin for production builds; relative URL works in development. */
export const CROWD_URL = process.env.EXPO_PUBLIC_CROWD_URL ?? '/api/crowd';
/** The learned-baseline route lives next to the crowd route. */
export const PATTERN_URL = CROWD_URL.replace(/crowd$/, 'pattern');

interface CrowdGetResponse {
  configured?: boolean;
  storage?: 'memory' | 'redis';
  reports?: Record<string, { kind?: string; zoneId?: string | null; level?: number; at?: string; weight?: number; noise?: number | null; amenities?: unknown }[]>;
}

/** 'stale' = the relay rejected the report as too old; there is nothing to retry. */
export type PostResult = 'ok' | 'stale' | 'failed';

export function withTimeout(): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

const isNoise = (n: unknown): n is NoiseReport => n === 0 || n === 1 || n === 2 || n === 3;

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

const bucketRow = (raw: unknown): PatternBucket[] =>
  Array.from({ length: 24 }, (_, h): PatternBucket => {
    const b = Array.isArray(raw) ? (raw[h] as { n?: unknown; days?: unknown; pct?: unknown } | undefined) : undefined;
    const n = typeof b?.n === 'number' && b.n > 0 ? Math.floor(b.n) : 0;
    const days = typeof b?.days === 'number' && b.days > 0 ? Math.floor(b.days) : 0;
    const pct = n > 0 && typeof b?.pct === 'number' && Number.isFinite(b.pct) ? Math.min(1, Math.max(0, b.pct)) : null;
    return { n, days, pct };
  });

/** The learned baseline for every venue the relay knows; 24 × 3 buckets per venue, shape enforced here. */
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

/** Send the anonymous part of a check-in. Notes, identity and location never leave the phone. */
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
