/**
 * Client for the one and only server function: the anonymous crowd relay (/api/crowd).
 * GET returns recent venue-level reports; POST sends one. Any failure → null/'failed'; the UI
 * already shows the typical pattern and the student's own check-ins, so nothing waits on this.
 */
import { proofStrength } from '@/domain/levels';
import type { Amenity, CheckIn, CrowdReport, CrowdSnapshot, NoiseReport } from '@/domain/types';

const TIMEOUT_MS = 10_000;

/** Optional absolute origin for production builds; relative URL works in development. */
export const CROWD_URL = process.env.EXPO_PUBLIC_CROWD_URL ?? '/api/crowd';

interface CrowdGetResponse {
  configured?: boolean;
  storage?: 'memory' | 'redis';
  reports?: Record<string, { venueId?: string; zoneId?: string | null; level?: number; at?: string; weight?: number; noise?: number | null; amenities?: unknown }[]>;
}

/** 'stale' = the relay rejected the report as too old; there is nothing to retry. */
export type PostResult = 'ok' | 'stale' | 'failed';

function withTimeout(): { signal: AbortSignal; done: () => void } {
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
        .filter((r) => typeof r.at === 'string' && typeof r.level === 'number' && r.level >= 0 && r.level <= 4)
        .map((r) => ({
          venueId,
          zoneId: r.zoneId ?? null,
          level: r.level as CrowdReport['level'],
          at: r.at as string,
          weight: typeof r.weight === 'number' ? Math.min(1, Math.max(0.4, r.weight)) : 0.4,
          noise: isNoise(r.noise) ? r.noise : null,
          amenities: Array.isArray(r.amenities) ? (r.amenities.filter((a): a is Amenity => typeof a === 'string') as Amenity[]) : [],
        }));
    }
    return { fetchedAt: new Date().toISOString(), reports, configured: body.configured !== false, storage: body.storage ?? null };
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
      body: JSON.stringify({ venueId: ci.venueId, zoneId: ci.zoneId, level: ci.level, at: ci.at, weight: proofStrength(ci.proof.distanceM, ci.proof.gpsAccuracyM), noise: ci.noise, amenities: ci.amenities }),
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
