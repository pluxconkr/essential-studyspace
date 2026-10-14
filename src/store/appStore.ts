/**
 * Zero-dependency app store built on useSyncExternalStore: one in-memory AppState for the whole app.
 *
 * Screens read it through useAppState(selector) and the derived hooks in ./derived; services and event
 * handlers read it with getState() and change it through `actions`. The repositories in src/data/repos
 * do the actual storage.
 *
 * Hydration is synchronous from local storage, so the first frame already shows real data.
 * Writes go to storage first, then notify subscribers. Network state, the GPS fix, demo reports and
 * refresh progress live in memory only. No network here.
 */
import { useSyncExternalStore } from 'react';

import {
  cacheMetaRepo,
  checkInRepo,
  crowdRepo,
  focusLogRepo,
  initStorage,
  onStorageNotice,
  patternRepo,
  prefsRepo,
  sessionRepo,
  settingsRepo,
  stationRepo,
  storageNoticeRepo,
  venueRepo,
  watchRepo,
} from '@/data/repos';
import { nowIso, nowMs, setClockOffset } from '@/domain/time';
import { toFocusEntry } from '@/domain/timer';
import type {
  CacheMetaMap,
  CheckIn,
  CrowdReport,
  CrowdSnapshot,
  FocusEntry,
  Level,
  LocationFix,
  PatternSnapshot,
  Prefs,
  Session,
  Settings,
  Station,
  StorageNotice,
  Venue,
  Watch,
} from '@/domain/types';

/** Connectivity as last reported by expo-network (src/services/network.ts). Read it through isOfflineNow(), which also honours "Simulate no signal". */
export interface NetworkInfo {
  /** true = online, false = offline, null = not determined yet. */
  online: boolean | null;
  /** expo-network connection type ('WIFI', 'CELLULAR', 'NONE', …); null when unknown. */
  type: string | null;
}

/**
 * Everything the screens render from. Slices backed by storage are loaded by hydrate(); demoReports,
 * network, location, locationStatus and the refresh fields live in memory only.
 * Not React Native's AppState (foreground/background), which the root layout also uses.
 */
export interface AppState {
  /** True once hydrate() has read local storage. */
  hydrated: boolean;
  /** Onboarding is finished; until then the root layout shows only the onboarding screen. */
  onboarded: boolean;
  prefs: Prefs;
  settings: Settings;
  /** The venue directory: a valid downloaded copy when one is saved, else the bundled one. */
  venues: Venue[];
  /** Which copy `venues` is; venueVersion is its version label (both shown on the Offline data screen). */
  venueSource: 'bundle' | 'network';
  venueVersion: string;
  /** Bundled transit stations, the origins for walking times. */
  stations: Station[];
  /** Check-ins made on this phone (live, remote and earlier-visit), newest first, pruned to 30 days / 300. */
  myCheckIns: CheckIn[];
  /** The relay's recent reports (last 3 hours) for the student's area, as last downloaded; cached on disk. */
  crowd: CrowdSnapshot | null;
  /** The learned baseline from the relay, when downloaded. */
  pattern: PatternSnapshot | null;
  /** Simulated reports from the active demo scenario (never persisted; regenerated at boot). */
  demoReports: Record<string, CrowdReport[]>;
  /** The focus session in progress (running or paused); saved so a killed app rejoins it. */
  session: Session | null;
  /** Finished focus sessions, newest first. */
  focusLog: FocusEntry[];
  /** Spots the student wants a notification for once they are quiet enough (at or below a chosen level). */
  watches: Watch[];
  /** What each downloaded asset is, how big, and when it was fetched (device time). */
  cacheMeta: CacheMetaMap;
  network: NetworkInfo;
  /** Last GPS fix. Memory only: never saved and never uploaded. */
  location: LocationFix | null;
  locationStatus: 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';
  /** Device-time ms at which the last refresh that could reach the network started; refreshIfStale measures from it. */
  lastRefreshAt: number | null;
  refreshing: boolean;
  /** Steps done of total while a refresh runs (null otherwise), for the Offline data screen. */
  refreshProgress: { done: number; total: number } | null;
  /** The last storage-full report (what was given up, whether the write then succeeded); saved until dismissed. */
  storageNotice: StorageNotice | null;
}

/** A subscriber notified after every state change; React's useSyncExternalStore registers one per mounted hook. */
type Listener = () => void;

/**
 * The single state object. Replaced, never mutated, on every change, so selectors can compare slices
 * by reference. Before hydrate() it holds prefs and settings read from disk and the bundled venue version; everything else is empty.
 */
let state: AppState = {
  hydrated: false,
  onboarded: false,
  prefs: prefsRepo.get(),
  settings: settingsRepo.get(),
  venues: [],
  venueSource: 'bundle',
  venueVersion: venueRepo.bundledVersion(),
  stations: [],
  myCheckIns: [],
  crowd: null,
  pattern: null,
  demoReports: {},
  session: null,
  focusLog: [],
  watches: [],
  cacheMeta: {},
  network: { online: null, type: null },
  location: null,
  locationStatus: 'idle',
  lastRefreshAt: null,
  refreshing: false,
  refreshProgress: null,
  storageNotice: null,
};

const listeners = new Set<Listener>();

/** Calls every subscriber synchronously; React then re-reads each selector and re-renders only where the selected value changed. */
function emit() {
  for (const l of listeners) l();
}

/**
 * Shallow-merges `patch` into a new state object and notifies subscribers. Memory only: nothing is
 * written to storage, so app code goes through `actions`; tests call it directly to stage a state.
 */
export function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  emit();
}

/** The current state, for services and event handlers that need the latest value at call time without subscribing. */
export function getState(): AppState {
  return state;
}

/** Registers a change listener and returns its unsubscribe function; useAppState hands it to useSyncExternalStore. */
export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * Synchronous hydration from disk. Safe to call more than once: the root layout calls it at module scope
 * before the first render, and the Offline data screen again after "Reset app data". Re-reads every
 * persisted slice and keeps the memory-only ones. Settings come back with a zero demo clock offset;
 * restoreDemoScenario re-applies the scenario's offset afterwards. Writes only the storage schema marker.
 */
export function hydrate(): AppState {
  initStorage();
  const src = venueRepo.get();
  state = {
    ...state,
    hydrated: true,
    onboarded: prefsRepo.isOnboarded(),
    prefs: prefsRepo.get(),
    settings: settingsRepo.get(),
    venues: src.venues,
    venueSource: src.source,
    venueVersion: src.version,
    stations: stationRepo.get(),
    myCheckIns: checkInRepo.getAll(),
    crowd: crowdRepo.get(),
    pattern: patternRepo.get(),
    session: sessionRepo.get(),
    focusLog: focusLogRepo.getAll(),
    watches: watchRepo.getAll(),
    cacheMeta: cacheMetaRepo.getAll(),
    storageNotice: storageNoticeRepo.get(),
  };
  emit();
  return state;
}

// The storage guard (src/data/repos) reports here, through its single listener registered at import time,
// whenever low space made it give something up or a write failed. Re-read the slices it may have dropped
// (pattern and crowd caches with their cache metadata, older own check-ins) so memory matches disk, and
// publish the notice for the Offline data screen.
onStorageNotice((notice) => {
  setState({ storageNotice: notice, crowd: crowdRepo.get(), pattern: patternRepo.get(), myCheckIns: checkInRepo.getAll(), cacheMeta: cacheMetaRepo.getAll() });
});

// ---------- Selectors / hooks ----------

/**
 * Subscribes a component to one slice of the store; it re-renders only when the selector's result
 * changes (Object.is). Return a slice of state or a primitive, never a freshly built object or array:
 * a new value on every read makes useSyncExternalStore re-render in a loop.
 */
export function useAppState<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

// ---------- Actions (local-first) ----------

/**
 * Every app-side state change. Persisting actions write through the repositories first (whose storage
 * guard handles a full disk), then publish; the others only publish. None of them touch the network or
 * notifications: their callers (services/refresh, the Focus and check-in screens) do that around these calls.
 */
export const actions = {
  /**
   * Saves the student's preferences (area, home station, noise, outlets, step-free, free blocks), sanitised
   * and stamped with `updatedAt`, and returns the cleaned copy. `finishOnboarding` also marks onboarding
   * done, which switches the root layout from onboarding to the tabs.
   */
  savePrefs(p: Prefs, opts: { finishOnboarding?: boolean } = {}) {
    const clean = prefsRepo.set({ ...p, updatedAt: nowIso() });
    if (opts.finishOnboarding) prefsRepo.setOnboarded(true);
    setState({ prefs: clean, onboarded: opts.finishOnboarding ? true : state.onboarded });
    return clean;
  },
  /** Saves an own check-in of any kind and publishes the pruned list. Uploading happens in services/refresh (submitCheckIn, syncCheckIns). */
  addCheckIn(ci: CheckIn) {
    setState({ myCheckIns: checkInRepo.add(ci, nowMs()) });
  },
  /** Flags own check-ins as handled (uploaded, refused as too old, or skipped because sharing was off) so they are never sent again. */
  markCheckInsSynced(ids: string[]) {
    if (ids.length === 0) return;
    setState({ myCheckIns: checkInRepo.markSynced(ids) });
  },
  /** Caches and publishes the relay's recent reports; a failed cache write is reported by the storage guard and the snapshot is still shown. Null clears memory only. */
  setCrowd(s: CrowdSnapshot | null) {
    if (s) crowdRepo.set(s);
    setState({ crowd: s });
  },
  /**
   * Caches and publishes the learned typical-day baseline from /api/pattern.
   * False when the cache could not be written (the UI still shows it; the next refresh retries).
   */
  setPattern(p: PatternSnapshot): boolean {
    const saved = patternRepo.set(p);
    setState({ pattern: p });
    return saved;
  },
  /** Publishes the demo scenario's simulated reports by venue id. Memory only: never saved or uploaded; rebuilt from the saved scenario at boot. */
  setDemoReports(r: Record<string, CrowdReport[]>) {
    setState({ demoReports: r });
  },
  /** Publishes a venue directory. Memory only: refreshVenues has already saved the downloaded file. */
  setVenues(venues: Venue[], source: 'bundle' | 'network', version: string) {
    setState({ venues, venueSource: source, venueVersion: version });
  },
  /** Saves and publishes a new focus session. Its absolute timestamps let a killed or locked app rejoin the right block; the caller schedules block notifications. */
  startSession(s: Session) {
    sessionRepo.set(s);
    setState({ session: s });
  },
  /** Applies `fn` to the session in progress (pause, resume, skip, goals), then saves and publishes it. No-op without a session. */
  updateSession(fn: (s: Session) => Session) {
    if (!state.session) return;
    const next = fn(state.session);
    sessionRepo.set(next);
    setState({ session: next });
  },
  /**
   * Close the live session into the focus log. Returns the entry (or null when nothing was running).
   * Focus time counts focus blocks only, not breaks; the saved session is cleared. `now` defaults to the app clock.
   */
  endSession(now: number = nowMs()): FocusEntry | null {
    const s = state.session;
    if (!s) return null;
    const ended = { ...s, endedAt: new Date(now).toISOString() };
    const entry = toFocusEntry(ended, now);
    const log = focusLogRepo.add(entry);
    sessionRepo.set(null);
    setState({ session: null, focusLog: log });
    return entry;
  },
  /** Drops the session in progress without logging it: no focus-log entry, nothing in the stats. */
  discardSession() {
    sessionRepo.set(null);
    setState({ session: null });
  },
  /**
   * Starts or stops watching a spot and saves the list (the background poll reads watches from storage).
   * A watch asks for a local notification when the spot is open and relay reports from students at the spot
   * (no remote ones) put its fused level at or below `notifyAtOrBelow` (default 1, Chill); services/refresh
   * (watchHits) and the background poll do the check.
   */
  toggleWatch(venueId: string, notifyAtOrBelow: Level = 1) {
    const has = state.watches.some((w) => w.venueId === venueId);
    const next = has ? state.watches.filter((w) => w.venueId !== venueId) : [...state.watches, { venueId, notifyAtOrBelow, createdAt: nowIso() }];
    setState({ watches: watchRepo.replaceAll(next) });
  },
  /** Publishes the whole cache-metadata map. Memory only: the caller has already saved it with cacheMetaRepo. */
  setCacheMeta(meta: CacheMetaMap) {
    setState({ cacheMeta: meta });
  },
  /**
   * Saves a settings change (sharing, notifications, simulated offline, demo scenario) and publishes it.
   * The demo clock offset is never stored, because it is relative to today (restoreDemoScenario recomputes
   * it at boot), and settingsRepo.patch returns 0 for it unless the patch carries one, so the current
   * offset is carried over here. Also points the domain clock (nowMs) at that offset.
   */
  patchSettings(p: Partial<Settings>) {
    const next = settingsRepo.patch(p);
    const offset = p.demoClockOffsetMs ?? state.settings.demoClockOffsetMs;
    setClockOffset(offset);
    setState({ settings: { ...next, demoClockOffsetMs: offset } });
  },
  /** Publishes connectivity from services/network. Memory only. */
  setNetwork(n: NetworkInfo) {
    setState({ network: n });
  },
  /**
   * The fix lives in memory only: it is compared with a spot and then forgotten with the process.
   * Ranking and the map also use it as "you". A null fix updates only the status and keeps the last fix.
   */
  setLocation(fix: LocationFix | null, status: AppState['locationStatus']) {
    setState({ location: fix ?? state.location, locationStatus: status });
  },
  /**
   * Marks a refresh run as started or finished; finishing clears the progress steps. `lastRefreshAt`
   * (device ms) is passed only when a run that may use the network starts.
   */
  setRefreshing(refreshing: boolean, lastRefreshAt?: number) {
    setState({ refreshing, ...(refreshing ? {} : { refreshProgress: null }), ...(lastRefreshAt !== undefined ? { lastRefreshAt } : {}) });
  },
  /** Publishes "step done of total" for the refresh progress bar on the Offline data screen. */
  setRefreshProgress(done: number, total: number) {
    setState({ refreshProgress: { done, total } });
  },
  /** Clears the storage-full notice from disk and memory (its OK button on the Offline data screen). */
  dismissStorageNotice() {
    storageNoticeRepo.clear();
    setState({ storageNotice: null });
  },
};

/**
 * Effective "offline" flag: real network state, or the demo override ("Simulate no signal").
 * Unknown (null) counts as online. Takes the state as a parameter so selectors can call it.
 */
export function isOfflineNow(s: AppState = state): boolean {
  if (s.settings.simulateOffline) return true;
  return s.network.online === false;
}
