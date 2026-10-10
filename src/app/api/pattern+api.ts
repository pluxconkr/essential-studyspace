/**
 * /api/pattern — the learned baseline: per venue, 24 buckets for weekdays, Saturdays and Sundays,
 * each with how many reports it holds, over how many distinct days, and the weighted mean
 * occupancy. Merged over the last three months. The phone decides which buckets are trustworthy.
 */
import type { VenuePattern } from '@/domain/types';
import { getStore, parseVenueIds, recentMonths } from '@/server/crowdStore';

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
