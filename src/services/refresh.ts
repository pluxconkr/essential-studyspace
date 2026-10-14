/**
 * Cache-first refresh orchestration. Never throws, never blocks rendering, never runs offline.
 * The UI is already drawn from local data (hours, typical pattern, own check-ins) before any of this starts.
 *
 * One run (refreshAll): upload pending own check-ins, then fetch the area's crowd reports, the optional venue
 * directory and (at most every six hours) the learned baseline in parallel, then check watched spots and notify.
 * "Offline" is isOfflineNow(): the real network state or the "Simulate no signal" switch.
 * Triggers: the root layout (refreshIfStale), pull-to-refresh on Now and the Offline data screen's "Refresh live
 * levels now" button (refreshAll); the check-in and earlier-visit screens save through submitCheckIn.
 * The background poll (services/backgroundPoll.ts) reuses watchHits.
 */
import { cacheMetaRepo, dropLowPriority, isLowOnSpace, reportStorageNotice, sanitizeVenues, venueRepo } from '@/data/repos';
import { fuse } from '@/domain/levels';
import { nowIso, nowMs } from '@/domain/time';
import type { AssetKey, CheckIn, CrowdReport, LiveLevel, Venue, VenuePattern, Watch } from '@/domain/types';
import { actions, getState, isOfflineNow } from '@/store/appStore';

import { fetchCrowd, fetchPattern, postReport, withTimeout } from './crowdClient';
import { notifyWatchHits } from './notifications';

/** What one refreshAll run did, step by step; the Offline data screen prints a summary of it after a manual refresh. */
export interface RefreshResult {
  /** 'skipped' = offline; 'not-configured' = it worked, but the relay keeps reports in dev-server memory. */
  crowd: 'ok' | 'skipped' | 'failed' | 'not-configured';
  /** 'no-source' = no EXPO_PUBLIC_VENUES_URL, so the bundled directory stays the source. */
  venues: 'ok' | 'skipped' | 'failed' | 'no-source';
  /** 'skipped' also when the cached baseline is younger than six hours. */
  pattern: 'ok' | 'skipped' | 'failed';
  /** Own check-ins taken off the upload queue this run: accepted by the relay, or refused as too old. */
  synced: number;
  /** Watched spots that qualified this run (notifyWatchHits may still hold some back). */
  watchHits: number;
}

/** Optional remote venue directory. Without it the bundled copy is the source. */
const VENUES_URL = process.env.EXPO_PUBLIC_VENUES_URL;
/** The learned baseline changes slowly; six hours between downloads is plenty. */
const PATTERN_MAX_AGE_MS = 6 * 3600_000;

/**
 * Record a finished download (time, size, version) in the cache metadata on disk and in the store. The Offline
 * data screen shows every stamp, the tab status line shows the crowd one ("Live levels checked 5 min ago"), and
 * refreshPattern reads the baseline's age from it.
 */
function stamp(key: AssetKey, bytes: number, version: string) {
  // Device time on purpose: a demo scenario shifts the app clock, but a download happened when it happened.
  const meta = cacheMetaRepo.set({ key, fetchedAt: new Date().toISOString(), source: 'network', bytes, version });
  actions.setCacheMeta(meta);
}

/**
 * Upload own check-ins that have not reached the relay yet (only when sharing is on; with sharing off they are
 * marked handled without being sent). At most 10 per run, newest first; demo check-ins are never sent.
 * Returns how many the relay settled (accepted, or refused as too old); 0 when offline.
 */
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

/**
 * Save an own check-in (storage + store) and, when sharing is on and the phone is not offline, upload it
 * right away. Demo check-ins are never uploaded; a failed upload stays queued for the next syncCheckIns.
 */
export async function submitCheckIn(ci: CheckIn): Promise<void> {
  actions.addCheckIn(ci);
  if (getState().settings.shareCheckIns && !isOfflineNow() && ci.source !== 'demo') {
    if ((await postReport(ci)) !== 'failed') actions.markCheckInsSynced([ci.checkInId]);
  }
}

/** Fetch relay reports for the venues in the student's chosen area, then cache them (crowd cache + metadata) and publish them to the store. */
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

/**
 * The learned baseline for every venue in the directory, at most once every six hours (device time, counted
 * from the last successful download). A cache write that fails (phone full) is 'failed' and not stamped, so the
 * next refresh retries; the store still gets the new baseline meanwhile.
 */
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

/**
 * Download the optional venue directory (EXPO_PUBLIC_VENUES_URL), keep only rows that pass the hours validator,
 * save it as a file and swap it into the store. An empty or invalid feed, or an HTTP, network or timeout failure,
 * is 'failed' and the current directory stays. A failed file write is not checked: the store still swaps (stamped 0 bytes).
 */
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

/**
 * Watched spots that are open and at/below the asked level at `now`, fused from the given relay reports and the
 * learned baseline. Pure. A hit needs someone at the spot: a level resting on the typical pattern alone
 * (confidence 'none') or on reports from elsewhere (`remote` > 0) never fires.
 * Callers pass relay reports only, never the phone's own check-ins or demo reports, so a check-in does not set
 * off its own watch; once shared, though, it comes back from the relay like anyone else's.
 */
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

/** The running refreshAll, shared by concurrent callers; cleared when it settles. */
let inFlight: Promise<RefreshResult> | null = null;

/**
 * Refresh everything that can be refreshed. Concurrent calls share one run.
 * Order: storage guard (under 5 MiB free: drop the baseline cache, then the crowd cache, then keep only the newest
 * 50 own check-ins, and leave a notice for the Offline data screen if anything went), upload pending check-ins,
 * then crowd + directory + baseline in parallel with progress per step. If crowd data arrived, watches are
 * checked on the app clock and notified. Sets `refreshing` in the store for the duration of the run.
 */
export function refreshAll(): Promise<RefreshResult> {
  if (inFlight) return inFlight;
  // The stamp means "a network attempt started now": never offline, never at the end of the run.
  actions.setRefreshing(true, isOfflineNow() ? undefined : Date.now());
  inFlight = (async () => {
    if (isLowOnSpace()) reportStorageNotice(dropLowPriority(), true);
    // Progress steps: sync, crowd, baseline, plus the directory only when a feed is configured.
    const total = VENUES_URL ? 4 : 3;
    let done = 0;
    actions.setRefreshProgress(0, total);
    // Count one finished step and publish the progress (shown on the Offline data screen).
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

/**
 * Foreground policy: refresh if the last attempt is older than `minAgeMs` (levels go stale in minutes).
 * Only attempts that start online are stamped (see refreshAll), so runs made offline never hold off an online one.
 * Device time, like the stamp. Null when skipped. The root layout calls it whenever a network reading says online
 * (the first one and every later change), when the app returns to the foreground, and every five minutes while it is open.
 */
export function refreshIfStale(minAgeMs = 5 * 60_000): Promise<RefreshResult | null> {
  const last = getState().lastRefreshAt;
  if (last && Date.now() - last < minAgeMs) return Promise.resolve(null);
  return refreshAll();
}
