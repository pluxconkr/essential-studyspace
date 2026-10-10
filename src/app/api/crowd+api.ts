/**
 * /api/crowd — the anonymous relay for crowd reports.
 *
 *   GET  ?venues=a,b   → recent reports per venue (last 3 hours, minute-rounded, no identities)
 *   POST {venueId, zoneId?, level, at, weight?, kind?} → stores one report
 *
 * Three kinds of report: `live` (at the spot now; weight = the phone's presence proof),
 * `remote` (now, not at the spot; fixed low weight, shown as such) and `past` (an earlier visit
 * within 7 days; feeds only the learned baseline, never "right now"). Storage lives in
 * src/server/crowdStore.ts. No notes, no user ids, no precise location are accepted; what is not
 * collected cannot leak. Fusion happens on the phone with the same domain code, so this route is a
 * dumb, replaceable pipe.
 */
import { z } from 'zod';

import { KIND_WEIGHT, LEVEL_MID } from '@/domain/levels';
import type { Level, ReportKind } from '@/domain/types';
import { RETENTION_MS, bucketOf, getStore, parseVenueIds, type StoredReport } from '@/server/crowdStore';
/** Per-IP POST budget per 10 minutes. A whole library behind campus NAT shares one address, so this is generous; it still stops a script. */
export const RATE_LIMIT = { posts: 300, windowMs: 10 * 60_000 } as const;
/** How far back an earlier-visit report may reach. */
export const PAST_WINDOW_MS = 7 * 86400_000;

const AMENITIES = ['outlets', 'wifi-eduroam', 'wifi-public', 'group-rooms', 'computers', 'printing', 'cafe', 'food-nearby', 'late-night', 'solo-desks', 'big-tables'] as const;

const ReportSchema = z.object({
  venueId: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  zoneId: z.string().min(1).max(80).nullable().optional(),
  level: z.number().int().min(0).max(4),
  at: z.string().datetime({ offset: true }),
  weight: z.number().min(0).max(1).optional(),
  noise: z.number().int().min(0).max(3).nullable().optional(),
  amenities: z.array(z.enum(AMENITIES)).max(AMENITIES.length).optional(),
  kind: z.enum(['live', 'remote', 'past']).optional(),
  /** Random per-report id from the phone, used only to ignore a re-sent earlier-visit report; never stored with it. */
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
});

// ---------- Helpers ----------

export function roundToMinute(iso: string): string {
  const t = Date.parse(iso);
  return new Date(Math.floor(t / 60_000) * 60_000).toISOString();
}

export function fresh(list: StoredReport[], now: number): StoredReport[] {
  return list.filter((r) => {
    const t = Date.parse(r.at);
    return Number.isFinite(t) && now - t <= RETENTION_MS && t <= now + 5 * 60_000;
  });
}

const hits = new Map<string, number[]>();

export function rateLimited(ip: string, now: number): boolean {
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (list.length >= RATE_LIMIT.posts) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  return false;
}

export function resetRateLimits(): void {
  hits.clear();
}

function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
}

// ---------- Handlers ----------

export async function GET(request: Request): Promise<Response> {
  const ids = parseVenueIds(new URL(request.url).searchParams.get('venues'));
  const s = getStore();
  const now = Date.now();
  const reports: Record<string, StoredReport[]> = {};
  try {
    for (const id of ids) reports[id] = fresh(await s.list(id), now);
  } catch {
    return Response.json({ error: 'store-unavailable' }, { status: 503 });
  }
  return Response.json({ ok: true, configured: s.kind === 'redis', storage: s.kind, retentionHours: RETENTION_MS / 3600_000, serverTime: new Date(now).toISOString(), reports });
}

export async function POST(request: Request): Promise<Response> {
  const now = Date.now();
  if (rateLimited(clientIp(request), now)) return Response.json({ error: 'rate-limited' }, { status: 429 });
  let body: z.infer<typeof ReportSchema>;
  try {
    body = ReportSchema.parse(await request.json());
  } catch {
    return Response.json({ error: 'bad-request' }, { status: 400 });
  }
  const kind: ReportKind = body.kind ?? 'live';
  const t = Date.parse(body.at);
  const tooOld = now - t > (kind === 'past' ? PAST_WINDOW_MS : RETENTION_MS);
  if (tooOld || t > now + 5 * 60_000) return Response.json({ error: 'stale' }, { status: 422 });
  const weight = kind === 'live' ? Math.min(1, Math.max(0.4, body.weight ?? 0.4)) : KIND_WEIGHT[kind];
  const r: StoredReport = { kind, zoneId: body.zoneId ?? null, level: body.level, at: roundToMinute(body.at), weight, noise: body.noise ?? null, amenities: body.amenities ?? [] };
  try {
    const s = getStore();
    // A phone that lost the response re-sends the same body; count it once.
    const key = JSON.stringify(r);
    if (kind === 'past') {
      // Identical earlier visits from different students are expected, so retries are told apart by the phone's id.
      if (await s.seen(body.venueId, body.id ?? key)) return Response.json({ ok: true, kept: r });
    } else {
      if ((await s.list(body.venueId)).some((h) => JSON.stringify(h) === key)) return Response.json({ ok: true, kept: r });
      await s.push(body.venueId, r);
    }
    await s.record(body.venueId, bucketOf(r.at), weight, LEVEL_MID[body.level as Level]);
  } catch {
    return Response.json({ error: 'store-unavailable' }, { status: 503 });
  }
  return Response.json({ ok: true, kept: r });
}
