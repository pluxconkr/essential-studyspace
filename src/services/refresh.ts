/**
 * Cache-first refresh orchestration. Never throws, never blocks rendering, never runs offline.
 * The UI is already drawn from local data (hours, typical pattern, own check-ins) before any of this starts.
 */
import { cacheMetaRepo, dropLowPriority, isLowOnSpace, reportStorageNotice, sanitizeVenues, venueRepo } from '@/data/repos';
import { fuse, proofStrength } from '@/domain/levels';
import { nowIso, nowMs } from '@/domain/time';
import type { AssetKey, CrowdReport, LiveLevel, Venue } from '@/domain/types';
import { actions, getState, isOfflineNow } from '@/store/appStore';

import { fetchCrowd, postReport } from './crowdClient';
import { notifyWatchHits } from './notifications';

export interface RefreshResult {
  crowd: 'ok' | 'skipped' | 'failed' | 'not-configured';
  venues: 'ok' | 'skipped' | 'failed' | 'no-source';
  /** Own check-ins uploaded this run. */
  synced: number;
  watchHits: number;
}

/** Optional remote venue directory. Without it the bundled copy is the source. */
const VENUES_URL = process.env.EXPO_PUBLIC_VENUES_URL;

function stamp(key: AssetKey, bytes: number, version: string) {
  const meta = cacheMetaRepo.set({ key, fetchedAt: nowIso(), source: 'network', bytes, version });
  actions.setCacheMeta(meta);
}

/** Upload own check-ins that have not reached the relay yet (only when sharing is on). */
export async function syncCheckIns(): Promise<number> {
  const { settings, myCheckIns } = getState();
  if (isOfflineNow()) return 0;
  const pending = myCheckIns.filter((c) => !c.synced && c.source === 'me').slice(0, 10);
  if (pending.length === 0) return 0;
  if (!settings.shareCheckIns) {
    // Sharing off: mark as handled so they are not retried later if sharing is switched on (old reports are useless by then).
    actions.markCheckInsSynced(pending.map((c) => c.checkInId));
    return 0;
  }
  const done: string[] = [];
  for (const c of pending) {
    if (await postReport(c)) done.push(c.checkInId);
  }
  actions.markCheckInsSynced(done);
  return done.length;
}

export async function refreshCrowd(): Promise<RefreshResult['crowd']> {
  if (isOfflineNow()) return 'skipped';
  const { venues, prefs } = getState();
  const ids = venues.filter((v) => v.area === prefs.area).map((v) => v.venueId);
  const snap = await fetchCrowd(ids);
  if (!snap) return 'failed';
  actions.setCrowd(snap);
  stamp('crowd', JSON.stringify(snap).length, snap.storage ?? 'relay');
  return snap.configured ? 'ok' : 'not-configured';
}

export async function refreshVenues(): Promise<RefreshResult['venues']> {
  if (!VENUES_URL) return 'no-source';
  if (isOfflineNow()) return 'skipped';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(VENUES_URL, { headers: { Accept: 'application/json' }, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return 'failed';
    const body = (await res.json()) as { venues?: unknown; version?: string };
    const clean = sanitizeVenues(body.venues);
    if (clean.length === 0) return 'failed';
    const version = body.version ?? 'remote';
    const bytes = venueRepo.saveDownloaded({ venues: clean as Venue[], version });
    actions.setVenues(clean as Venue[], 'network', version);
    stamp('venues', bytes, version);
    return 'ok';
  } catch {
    return 'failed';
  }
}

/** Watched spots that are open and at/below the asked level right now (relay + own reports only; demo excluded). */
export function watchHits(): { venue: Venue; live: LiveLevel }[] {
  const { watches, venues, crowd, myCheckIns } = getState();
  const now = nowMs();
  const hits: { venue: Venue; live: LiveLevel }[] = [];
  for (const w of watches) {
    const v = venues.find((x) => x.venueId === w.venueId);
    if (!v) continue;
    const mine: CrowdReport[] = myCheckIns.filter((c) => c.venueId === v.venueId).map((c) => ({ venueId: c.venueId, zoneId: c.zoneId, level: c.level, at: c.at, weight: proofStrength(c.proof.distanceM, c.proof.gpsAccuracyM) }));
    const live = fuse({ venue: v, reports: [...mine, ...(crowd?.reports[v.venueId] ?? [])], now });
    if (live.open && live.confidence !== 'none' && live.level <= w.notifyAtOrBelow) hits.push({ venue: v, live });
  }
  return hits;
}

let inFlight: Promise<RefreshResult> | null = null;

/** Refresh everything that can be refreshed. Concurrent calls share one run. */
export function refreshAll(): Promise<RefreshResult> {
  if (inFlight) return inFlight;
  actions.setRefreshing(true);
  inFlight = (async () => {
    if (isLowOnSpace()) reportStorageNotice(dropLowPriority(), true);
    const total = VENUES_URL ? 3 : 2;
    let done = 0;
    actions.setRefreshProgress(0, total);
    const tick = <T,>(r: T): T => {
      done += 1;
      actions.setRefreshProgress(Math.min(done, total), total);
      return r;
    };
    const synced = await syncCheckIns().then(tick);
    const [crowd, venues] = await Promise.all([refreshCrowd().then(tick), VENUES_URL ? refreshVenues().then(tick) : refreshVenues()]);
    const hits = crowd === 'ok' ? watchHits() : [];
    if (hits.length > 0) await notifyWatchHits(hits, nowIso());
    actions.setRefreshing(false, Date.now());
    return { crowd, venues, synced, watchHits: hits.length };
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Foreground policy: refresh if the last attempt is older than `minAgeMs` (levels go stale in minutes). */
export function refreshIfStale(minAgeMs = 5 * 60_000): Promise<RefreshResult | null> {
  const last = getState().lastRefreshAt;
  if (last && Date.now() - last < minAgeMs) return Promise.resolve(null);
  return refreshAll();
}
