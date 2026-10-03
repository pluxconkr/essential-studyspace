/**
 * Client for the one and only server function: the anonymous crowd relay (/api/crowd).
 * GET returns recent venue-level reports; POST sends one. Any failure → null/false; the UI
 * already shows the typical pattern and the student's own check-ins, so nothing waits on this.
 */
import { proofStrength } from '@/domain/levels';
import type { CheckIn, CrowdReport, CrowdSnapshot } from '@/domain/types';

const TIMEOUT_MS = 10_000;

/** Optional absolute origin for production builds; relative URL works in development. */
export const CROWD_URL = process.env.EXPO_PUBLIC_CROWD_URL ?? '/api/crowd';

interface CrowdGetResponse {
  configured?: boolean;
  storage?: 'memory' | 'redis';
  reports?: Record<string, { venueId?: string; zoneId?: string | null; level?: number; at?: string; weight?: number }[]>;
}

function withTimeout(): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

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
        .map((r) => ({ venueId, zoneId: r.zoneId ?? null, level: r.level as CrowdReport['level'], at: r.at as string, weight: typeof r.weight === 'number' ? Math.min(1, Math.max(0.4, r.weight)) : 0.4 }));
    }
    return { fetchedAt: new Date().toISOString(), reports, configured: body.configured !== false, storage: body.storage ?? null };
  } catch {
    return null;
  } finally {
    t.done();
  }
}

/** Send the anonymous part of a check-in. Notes, zone details beyond the id, and identity never leave the phone. */
export async function postReport(ci: CheckIn): Promise<boolean> {
  const t = withTimeout();
  try {
    const res = await fetch(CROWD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ venueId: ci.venueId, zoneId: ci.zoneId, level: ci.level, at: ci.at, weight: proofStrength(ci.proof.distanceM, ci.proof.gpsAccuracyM) }),
      signal: t.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    t.done();
  }
}
