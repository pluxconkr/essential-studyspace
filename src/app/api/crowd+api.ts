/**
 * /api/crowd — the anonymous relay for crowd reports.
 *
 *   GET  ?venues=a,b   → recent reports per venue (last 3 hours, minute-rounded, no identities)
 *   POST {venueId, zoneId?, level, at, weight?, noise?, amenities?, kind?, id?} → stores one report
 *
 * Three kinds of report: `live` (at the spot now; weight = the phone's presence proof),
 * `remote` (now, not at the spot; fixed low weight, shown as such) and `past` (an earlier visit
 * within 7 days; feeds only the learned baseline, never "right now"). Every new report, of
 * any kind, is also added to the learned-baseline aggregates that /api/pattern serves. Storage lives in
 * src/server/crowdStore.ts. No notes, no user ids, no precise location are accepted; what is not
 * collected cannot leak. Fusion happens on the phone with the same domain code, so this route is a
 * dumb, replaceable pipe. The phone's side is src/services/crowdClient.ts (fetchCrowd, postReport).
 */
import { z } from 'zod';

import { KIND_WEIGHT, LEVEL_MID } from '@/domain/levels';
import type { Level, ReportKind } from '@/domain/types';
import { RETENTION_MS, bucketOf, getStore, parseVenueIds, type StoredReport } from '@/server/crowdStore';
/** Per-IP POST budget per 10 minutes. A whole library behind campus NAT shares one address, so this is generous; it still stops a script. */
export const RATE_LIMIT = { posts: 300, windowMs: 10 * 60_000 } as const;
/** How far back an earlier-visit report may reach. */
export const PAST_WINDOW_MS = 7 * 86400_000;

/** Amenity ids a report may carry: the same list as the Amenity type in src/domain/types.ts. */
const AMENITIES = ['outlets', 'wifi-eduroam', 'wifi-public', 'group-rooms', 'computers', 'printing', 'cafe', 'food-nearby', 'late-night', 'solo-desks', 'big-tables'] as const;

/**
 * The POST body. A value outside these rules is a 400; a field not listed here (a note, coordinates) is dropped
 * by zod and never stored.
 */
const ReportSchema = z.object({
  venueId: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  zoneId: z.string().min(1).max(80).nullable().optional(),
  /** 0 Empty … 4 Full. */
  level: z.number().int().min(0).max(4),
  /** ISO 8601 with Z or an offset; a bare local time is rejected. */
  at: z.string().datetime({ offset: true }),
  /** The phone's presence-proof strength; counts only for live reports (clamped to 0.4–1), remote and past get KIND_WEIGHT. */
  weight: z.number().min(0).max(1).optional(),
  noise: z.number().int().min(0).max(3).nullable().optional(),
  amenities: z.array(z.enum(AMENITIES)).max(AMENITIES.length).optional(),
  /** Absent = live, as sent by clients from before report kinds. */
  kind: z.enum(['live', 'remote', 'past']).optional(),
  /** Random per-report id from the phone, used only to ignore a re-sent earlier-visit report; never stored with it. */
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
});

// ---------- Helpers ----------

/**
 * Floors an ISO time to its minute, returned as a UTC ISO string. Stored and served times carry no seconds, part of
 * keeping a report from being tied to one person. Expects a validated time (an unparsable one throws).
 */
export function roundToMinute(iso: string): string {
  const t = Date.parse(iso);
  return new Date(Math.floor(t / 60_000) * 60_000).toISOString();
}

/**
 * The rows GET may serve: a parsable time no older than RETENTION_MS and no more than 5 minutes ahead of `now`
 * (the clock skew POST also allows). Needed because a stored list can still hold older rows.
 */
export function fresh(list: StoredReport[], now: number): StoredReport[] {
  return list.filter((r) => {
    const t = Date.parse(r.at);
    return Number.isFinite(t) && now - t <= RETENTION_MS && t <= now + 5 * 60_000;
  });
}

/** Recent POST times per client IP. In-process memory: each server instance counts on its own, and a restart clears it. */
const hits = new Map<string, number[]>();

/**
 * Sliding-window limiter: true when `ip` already made RATE_LIMIT.posts POSTs in the last 10 minutes; otherwise counts
 * this POST and returns false. Refused attempts are not counted, so a blocked client gets back in as its old posts age out.
 */
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

/** Forgets every IP's POST history; tests call it before each case. */
export function resetRateLimits(): void {
  hits.clear();
}

/**
 * The caller's address for rate limiting: the first x-forwarded-for entry, else x-real-ip, else 'local', so every
 * request that arrives with neither header shares one budget.
 */
function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
}

// ---------- Handlers ----------

/**
 * GET /api/crowd?venues=a,b: each well-formed id's live and remote reports from the last RETENTION_MS, latest
 * arrival first ([] when it has none; earlier visits are never listed). Also says which store answered: `configured`
 * is false for the memory dev relay, which the app labels. 503 store-unavailable when the store fails. Called through
 * crowdClient.fetchCrowd with the venues of the student's chosen area (refreshCrowd) or the watched spots (background poll).
 */
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

/**
 * POST /api/crowd: checks and stores one anonymous report; answers { ok, kept } with the stored form, also for a re-sent
 * report, which is counted once. 429 over the per-IP limit · 400 a body outside ReportSchema · 422 stale: a live or remote
 * time older than RETENTION_MS, a past one older than PAST_WINDOW_MS, or any more than 5 minutes ahead (final for the
 * phone, which retries every other failure) · 503 store failure.
 * The server sets the weight: a live report's claimed proof clamped to proofStrength's 0.4–1 range, 0.4 when absent
 * (the server cannot verify the claim, only bound it),
 * KIND_WEIGHT for remote and past. Live and remote reports join the live list, past ones never do; every kind then
 * goes into its NJ-local baseline bucket at the level's mid-point share (LEVEL_MID).
 */
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
      // Past reports leave no live-list row to compare against, so the store's seen set remembers them instead.
      // Identical earlier visits from different students are expected, so retries are told apart by the phone's id
      // (the report itself when a client sends none).
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
