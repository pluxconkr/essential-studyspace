/**
 * Cache-first refresh orchestration. Never throws, never blocks rendering, never runs offline.
 * The UI is already drawn from local data (hours, typical pattern, own check-ins) before any of this starts.
 */
import { cacheMetaRepo, dropLowPriority, isLowOnSpace, reportStorageNotice, sanitizeVenues, venueRepo } from '@/data/repos';
import { fuse } from '@/domain/levels';
import { nowIso, nowMs } from '@/domain/time';
import type { AssetKey, CheckIn, CrowdReport, LiveLevel, Venue, VenuePattern, Watch } from '@/domain/types';
import { actions, getState, isOfflineNow } from '@/store/appStore';

import { fetchCrowd, fetchPattern, postReport, withTimeout } from './crowdClient';
import { notifyWatchHits } from './notifications';

export interface RefreshResult {
  crowd: 'ok' | 'skipped' | 'failed' | 'not-configured';
  venues: 'ok' | 'skipped' | 'failed' | 'no-source';
  /** 'skipped' also when the cached baseline is younger than six hours. */
  pattern: 'ok' | 'skipped' | 'failed';
  /** Own check-ins uploaded this run. */
  synced: number;
  watchHits: number;
}

/** Optional remote venue directory. Without it the bundled copy is the source. */
const VENUES_URL = process.env.EXPO_PUBLIC_VENUES_URL;
/** The learned baseline changes slowly; six hours between downloads is plenty. */
const PATTERN_MAX_AGE_MS = 6 * 3600_000;

function stamp(key: AssetKey, bytes: number, version: string) {
  // Device time on purpose: a demo scenario shifts the app clock, but a download happened when it happened.
  const meta = cacheMetaRepo.set({ key, fetchedAt: new Date().toISOString(), source: 'network', bytes, version });
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
    // 'stale' = older than the relay keeps; it will never be accepted, so stop retrying it.
    if ((await postReport(c)) !== 'failed') done.push(c.checkInId);
  }
  actions.markCheckInsSynced(done);
  return done.length;
}

/** Save an own check-in and, when sharing is on and the relay is reachable, upload it right away. */
export async function submitCheckIn(ci: CheckIn): Promise<void> {
  actions.addCheckIn(ci);
  if (getState().settings.shareCheckIns && !isOfflineNow() && ci.source !== 'demo') {
    if ((await postReport(ci)) !== 'failed') actions.markCheckInsSynced([ci.checkInId]);
  }
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

/** The learned baseline for every venue, at most once every six hours. */
export async function refreshPattern(): Promise<RefreshResult['pattern']> {
  if (isOfflineNow()) return 'skipped';
  const { venues, cacheMeta } = getState();
  const last = cacheMeta.pattern?.fetchedAt;
  if (last && Date.now() - Date.parse(last) < PATTERN_MAX_AGE_MS) return 'skipped';
  const snap = await fetchPattern(venues.map((v) => v.venueId));
  if (!snap) return 'failed';
  if (!actions.setPattern(snap)) return 'failed';
  stamp('pattern', JSON.stringify(snap).length, snap.months.join(','));
  return 'ok';
}

export async function refreshVenues(): Promise<RefreshResult['venues']> {
  if (!VENUES_URL) return 'no-source';
  if (isOfflineNow()) return 'skipped';
  const t = withTimeout();
  try {
    const res = await fetch(VENUES_URL, { headers: { Accept: 'application/json' }, signal: t.signal });
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
  } finally {
    t.done();
  }
}

/** Watched spots that are open and at/below the asked level right now. Other students' reports only — a watch must not fire on your own check-in. */
export function watchHits(watches: Watch[], venues: Venue[], reports: Record<string, CrowdReport[]>, now: number, patterns?: Record<string, VenuePattern>): { venue: Venue; live: LiveLevel }[] {
  const hits: { venue: Venue; live: LiveLevel }[] = [];
  for (const w of watches) {
    const v = venues.find((x) => x.venueId === w.venueId);
    if (!v) continue;
    const live = fuse({ venue: v, reports: reports[v.venueId] ?? [], now, pattern: patterns?.[v.venueId] ?? null });
    if (live.open && live.confidence !== 'none' && live.remote === 0 && live.level <= w.notifyAtOrBelow) hits.push({ venue: v, live });
  }
  return hits;
}

let inFlight: Promise<RefreshResult> | null = null;

/** Refresh everything that can be refreshed. Concurrent calls share one run. */
export function refreshAll(): Promise<RefreshResult> {
  if (inFlight) return inFlight;
  // The stamp means "a network attempt started now": never offline, never at the end of the run.
  actions.setRefreshing(true, isOfflineNow() ? undefined : Date.now());
  inFlight = (async () => {
    if (isLowOnSpace()) reportStorageNotice(dropLowPriority(), true);
    const total = VENUES_URL ? 4 : 3;
    let done = 0;
    actions.setRefreshProgress(0, total);
    const tick = <T,>(r: T): T => {
      done += 1;
      actions.setRefreshProgress(Math.min(done, total), total);
      return r;
    };
    const synced = await syncCheckIns().then(tick);
    const [crowd, venues, pattern] = await Promise.all([refreshCrowd().then(tick), VENUES_URL ? refreshVenues().then(tick) : refreshVenues(), refreshPattern().then(tick)]);
    const s = getState();
    const hits = crowd === 'ok' || crowd === 'not-configured' ? watchHits(s.watches, s.venues, s.crowd?.reports ?? {}, nowMs(), s.pattern?.patterns) : [];
    if (hits.length > 0) await notifyWatchHits(hits, nowIso());
    actions.setRefreshing(false);
    return { crowd, venues, pattern, synced, watchHits: hits.length };
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
