/**
 * /api/crowd — the ONE server function in this app: an anonymous relay for crowd check-ins.
 *
 *   GET  ?venues=a,b   → recent reports per venue (last 3 hours, minute-rounded, no identities)
 *   POST {venueId, zoneId?, level, at, weight} → stores one report
 *
 * Storage: an Upstash-compatible Redis REST database when CROWD_STORE_URL/TOKEN are set
 * (deployments), else an in-memory map (the Metro dev server — fine for a demo on one network,
 * gone on restart). The phone never needs a key. No notes, no user ids, no precise location are
 * accepted; what is not collected cannot leak. Fusion happens on the phone with the same
 * domain code, so this route is a dumb, replaceable pipe.
 */
import { z } from 'zod';

import { isLevel } from '@/domain/levels';

export const RETENTION_MS = 3 * 3600_000;
export const MAX_PER_VENUE = 200;
export const MAX_VENUES_PER_GET = 60;
/** Per-IP POST budget per 10 minutes. A phone checks in a few times an hour at most. */
export const RATE_LIMIT = { posts: 20, windowMs: 10 * 60_000 } as const;

const ReportSchema = z.object({
  venueId: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  zoneId: z.string().min(1).max(80).nullable().optional(),
  level: z.number().int().min(0).max(4),
  at: z.string().datetime({ offset: true }),
  weight: z.number().min(0).max(1).optional(),
});

export interface StoredReport {
  zoneId: string | null;
  level: number;
  /** ISO, rounded to the minute. */
  at: string;
  weight: number;
}

export interface CrowdStore {
  kind: 'memory' | 'redis';
  list(venueId: string): Promise<StoredReport[]>;
  push(venueId: string, r: StoredReport): Promise<void>;
}

// ---------- In-memory store (dev server / tests) ----------

export function createMemoryStore(): CrowdStore {
  const map = new Map<string, StoredReport[]>();
  return {
    kind: 'memory',
    async list(venueId) {
      return map.get(venueId) ?? [];
    },
    async push(venueId, r) {
      const list = [r, ...(map.get(venueId) ?? [])].slice(0, MAX_PER_VENUE);
      map.set(venueId, list);
    },
  };
}

// ---------- Redis REST store (Upstash-compatible) ----------

export function createRedisStore(url: string, token: string): CrowdStore {
  async function cmd(parts: (string | number)[]): Promise<unknown> {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(parts) });
    const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? `redis ${res.status}`);
    return body.result;
  }
  const key = (venueId: string) => `crowd:${venueId}`;
  return {
    kind: 'redis',
    async list(venueId) {
      const raw = (await cmd(['LRANGE', key(venueId), 0, MAX_PER_VENUE - 1])) as unknown;
      if (!Array.isArray(raw)) return [];
      const out: StoredReport[] = [];
      for (const s of raw) {
        try {
          const r = JSON.parse(String(s)) as StoredReport;
          if (r && typeof r.at === 'string' && isLevel(r.level)) out.push(r);
        } catch {
          /* skip bad row */
        }
      }
      return out;
    },
    async push(venueId, r) {
      await cmd(['LPUSH', key(venueId), JSON.stringify(r)]);
      await cmd(['LTRIM', key(venueId), 0, MAX_PER_VENUE - 1]);
      await cmd(['EXPIRE', key(venueId), Math.ceil(RETENTION_MS / 1000)]);
    },
  };
}

let store: CrowdStore | null = null;

export function getStore(): CrowdStore {
  if (store) return store;
  const url = process.env.CROWD_STORE_URL?.trim();
  const token = process.env.CROWD_STORE_TOKEN?.trim();
  store = url && token ? createRedisStore(url, token) : createMemoryStore();
  return store;
}

/** Tests swap the store. */
export function setStore(s: CrowdStore | null): void {
  store = s;
}

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
  const url = new URL(request.url);
  const ids = (url.searchParams.get('venues') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9-]{1,80}$/.test(s))
    .slice(0, MAX_VENUES_PER_GET);
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
  const t = Date.parse(body.at);
  if (now - t > RETENTION_MS || t > now + 5 * 60_000) return Response.json({ error: 'stale' }, { status: 422 });
  const r: StoredReport = { zoneId: body.zoneId ?? null, level: body.level, at: roundToMinute(body.at), weight: Math.min(1, Math.max(0.4, body.weight ?? 0.4)) };
  try {
    await getStore().push(body.venueId, r);
  } catch {
    return Response.json({ error: 'store-unavailable' }, { status: 503 });
  }
  return Response.json({ ok: true, kept: r });
}
