/**
 * /api/pattern — the learned baseline: per venue, 24 buckets for weekdays, Saturdays and Sundays,
 * each with how many reports it holds, over how many distinct days, and the weighted mean
 * occupancy. Merged over the last three months. The phone decides which buckets are trustworthy
 * (PATTERN_MIN in src/domain/curve.ts: 5 reports from 3 distinct days). Read-only: POST /api/crowd
 * writes the aggregates through src/server/crowdStore.ts. The phone's side is crowdClient.fetchPattern.
 */
import type { VenuePattern } from '@/domain/types';
import { getStore, parseVenueIds, recentMonths } from '@/server/crowdStore';

/**
 * GET /api/pattern?venues=a,b → { ok, months, serverTime, patterns: { [venueId]: VenuePattern } }. Every well-formed id
 * gets all 3 × 24 buckets, empty ones as { n: 0, days: 0, pct: null }; `months` are the "YYYY-MM" keys merged, newest
 * first, by the server's clock in New Jersey time. Cacheable for an hour (the phone asks at most every six hours).
 * 503 store-unavailable when the store fails.
 */
export async function GET(request: Request): Promise<Response> {
  const ids = parseVenueIds(new URL(request.url).searchParams.get('venues'));
  const s = getStore();
  const now = Date.now();
  const months = recentMonths(now);
  const patterns: Record<string, VenuePattern> = {};
  try {
    for (const id of ids) patterns[id] = await s.pattern(id, months);
  } catch {
    return Response.json({ error: 'store-unavailable' }, { status: 503 });
  }
  return Response.json({ ok: true, months, serverTime: new Date(now).toISOString(), patterns }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
