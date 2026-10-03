/**
 * Zero-dependency app store built on useSyncExternalStore.
 *
 * Hydration is synchronous from local storage, so the first frame already shows real data.
 * Writes go to storage first, then notify subscribers. No network here.
 */
import { useSyncExternalStore } from 'react';

import {
  cacheMetaRepo,
  checkInRepo,
  crowdRepo,
  focusLogRepo,
  initStorage,
  locationRepo,
  onStorageNotice,
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
  Prefs,
  Session,
  Settings,
  Station,
  StorageNotice,
  Venue,
  Watch,
} from '@/domain/types';

export interface NetworkInfo {
  /** true = online, false = offline, null = not determined yet. */
  online: boolean | null;
  type: string | null;
}

export interface AppState {
  hydrated: boolean;
  onboarded: boolean;
  prefs: Prefs;
  settings: Settings;
  venues: Venue[];
  venueSource: 'bundle' | 'network';
  venueVersion: string;
  stations: Station[];
  myCheckIns: CheckIn[];
  crowd: CrowdSnapshot | null;
  /** Simulated reports from the active demo scenario (never persisted; regenerated at boot). */
  demoReports: Record<string, CrowdReport[]>;
  session: Session | null;
  focusLog: FocusEntry[];
  watches: Watch[];
  cacheMeta: CacheMetaMap;
  network: NetworkInfo;
  location: LocationFix | null;
  locationStatus: 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';
  lastRefreshAt: number | null;
  refreshing: boolean;
  refreshProgress: { done: number; total: number } | null;
  storageNotice: StorageNotice | null;
}

type Listener = () => void;

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

function emit() {
  for (const l of listeners) l();
}

export function setState(patch: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  emit();
}

export function getState(): AppState {
  return state;
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Synchronous hydration from disk. Safe to call more than once. */
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
    session: sessionRepo.get(),
    focusLog: focusLogRepo.getAll(),
    watches: watchRepo.getAll(),
    cacheMeta: cacheMetaRepo.getAll(),
    location: locationRepo.get(),
    storageNotice: storageNoticeRepo.get(),
  };
  emit();
  return state;
}

onStorageNotice((notice) => {
  setState({ storageNotice: notice, crowd: crowdRepo.get(), myCheckIns: checkInRepo.getAll(), cacheMeta: cacheMetaRepo.getAll() });
});

// ---------- Selectors / hooks ----------

export function useAppState<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

export function useAppStore(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// ---------- Actions (local-first) ----------

export const actions = {
  savePrefs(p: Prefs, opts: { finishOnboarding?: boolean } = {}) {
    const clean = prefsRepo.set({ ...p, updatedAt: nowIso() });
    if (opts.finishOnboarding) prefsRepo.setOnboarded(true);
    setState({ prefs: clean, onboarded: opts.finishOnboarding ? true : state.onboarded });
    return clean;
  },
  skipOnboarding() {
    prefsRepo.setOnboarded(true);
    setState({ onboarded: true });
  },
  addCheckIn(ci: CheckIn) {
    setState({ myCheckIns: checkInRepo.add(ci, nowMs()) });
  },
  markCheckInsSynced(ids: string[]) {
    if (ids.length === 0) return;
    setState({ myCheckIns: checkInRepo.markSynced(ids) });
  },
  setCrowd(s: CrowdSnapshot | null) {
    if (s) crowdRepo.set(s);
    setState({ crowd: s });
  },
  setDemoReports(r: Record<string, CrowdReport[]>) {
    setState({ demoReports: r });
  },
  setVenues(venues: Venue[], source: 'bundle' | 'network', version: string) {
    setState({ venues, venueSource: source, venueVersion: version });
  },
  startSession(s: Session) {
    sessionRepo.set(s);
    setState({ session: s });
  },
  updateSession(fn: (s: Session) => Session) {
    if (!state.session) return;
    const next = fn(state.session);
    sessionRepo.set(next);
    setState({ session: next });
  },
  /** Close the live session into the focus log. Returns the entry (or null when nothing was running). */
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
  discardSession() {
    sessionRepo.set(null);
    setState({ session: null });
  },
  setFocusLog(log: FocusEntry[]) {
    setState({ focusLog: focusLogRepo.replaceAll(log) });
  },
  toggleWatch(venueId: string, notifyAtOrBelow: Level = 1) {
    const has = state.watches.some((w) => w.venueId === venueId);
    const next = has ? state.watches.filter((w) => w.venueId !== venueId) : [...state.watches, { venueId, notifyAtOrBelow, createdAt: nowIso() }];
    setState({ watches: watchRepo.replaceAll(next) });
  },
  setCacheMeta(meta: CacheMetaMap) {
    setState({ cacheMeta: meta });
  },
  patchSettings(p: Partial<Settings>) {
    const next = settingsRepo.patch(p);
    const offset = p.demoClockOffsetMs ?? state.settings.demoClockOffsetMs;
    setClockOffset(offset);
    setState({ settings: { ...next, demoClockOffsetMs: offset } });
  },
  setNetwork(n: NetworkInfo) {
    setState({ network: n });
  },
  setLocation(fix: LocationFix | null, status: AppState['locationStatus']) {
    if (fix) locationRepo.set(fix);
    setState({ location: fix ?? state.location, locationStatus: status });
  },
  setRefreshing(refreshing: boolean, lastRefreshAt?: number) {
    setState({ refreshing, ...(refreshing ? {} : { refreshProgress: null }), ...(lastRefreshAt !== undefined ? { lastRefreshAt } : {}) });
  },
  setRefreshProgress(done: number, total: number) {
    setState({ refreshProgress: { done, total } });
  },
  dismissStorageNotice() {
    storageNoticeRepo.clear();
    setState({ storageNotice: null });
  },
  rehydrate() {
    hydrate();
  },
};

/** Effective "offline" flag: real network state, or the demo override. */
export function isOfflineNow(s: AppState = state): boolean {
  if (s.settings.simulateOffline) return true;
  return s.network.online === false;
}
