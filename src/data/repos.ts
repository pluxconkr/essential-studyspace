/**
 * Local-first repositories. Every read is synchronous and starts from local storage
 * (or the bundled fallback). Nothing here touches the network.
 */
import bundledStations from '@/assets/data/stations.json';
import bundledVenues from '@/assets/data/venues.json';
import { AREAS } from '@/domain/areas';
import { hoursValid } from '@/domain/hours';
import { toEpoch } from '@/domain/time';
import type {
  AssetKey,
  CacheMeta,
  CacheMetaMap,
  CheckIn,
  CrowdSnapshot,
  DroppedItem,
  FocusEntry,
  LocationFix,
  Prefs,
  Session,
  Settings,
  Station,
  StorageNotice,
  Venue,
  Watch,
} from '@/domain/types';
import { files } from './files';
import { kv } from './kv';

export const KEYS = {
  schema: 'meta:schemaVersion',
  onboarded: 'onboarded:v1',
  prefs: 'prefs:v1',
  settings: 'settings:v1',
  checkins: 'checkins:v1',
  crowd: 'crowd:v1',
  session: 'session:v1',
  focusLog: 'focusLog:v1',
  watches: 'watches:v1',
  cacheMeta: 'cacheMeta:v1',
  lastFix: 'location:lastFix:v1',
  watchNotified: 'watchNotified:v1',
  storageNotice: 'storageNotice:v1',
} as const;

export const SCHEMA_VERSION = 1;

/** Call once at startup, synchronously, before any async storage access. */
export function initStorage(): void {
  const v = kv.get<number>(KEYS.schema);
  if (v !== SCHEMA_VERSION) kv.set(KEYS.schema, SCHEMA_VERSION);
}

// ---------- Storage guard: drop by priority, say what was dropped ----------

export const LOW_SPACE_BYTES = 5 * 1024 * 1024;
/** Own check-ins kept when space runs out: the newest ones. */
export const LOW_SPACE_CHECKIN_KEEP = 50;
/** Own check-ins are kept this long for the "your check-ins here" list. */
export const CHECKIN_RETENTION_DAYS = 30;
export const CHECKIN_RETENTION_MAX = 300;

type NoticeListener = (n: StorageNotice) => void;
let noticeListener: NoticeListener | null = null;
export function onStorageNotice(l: NoticeListener | null): void {
  noticeListener = l;
}

export function isLowOnSpace(): boolean {
  const free = files.availableBytes();
  return Number.isFinite(free) && free < LOW_SPACE_BYTES;
}

/** Give up re-downloadable data first (crowd cache), then older own check-ins. Prefs, session, focus log, watches are never dropped. */
export function dropLowPriority(): DroppedItem[] {
  const dropped: DroppedItem[] = [];
  if (kv.get<CrowdSnapshot>(KEYS.crowd) != null) {
    kv.remove(KEYS.crowd);
    kv.update<CacheMetaMap>(KEYS.cacheMeta, (prev) => {
      const next = { ...(prev ?? {}) };
      delete next.crowd;
      return next;
    });
    dropped.push('crowd-cache');
  }
  const cis = kv.get<CheckIn[]>(KEYS.checkins) ?? [];
  if (cis.length > LOW_SPACE_CHECKIN_KEEP) {
    kv.set(KEYS.checkins, pruneCheckIns(cis).slice(0, LOW_SPACE_CHECKIN_KEEP));
    dropped.push('old-checkins');
  }
  return dropped;
}

export function reportStorageNotice(dropped: DroppedItem[], recovered: boolean): StorageNotice | null {
  if (dropped.length === 0 && recovered) return null;
  const free = files.availableBytes();
  const notice: StorageNotice = { at: new Date().toISOString(), dropped, freeBytes: Number.isFinite(free) ? free : null, recovered };
  kv.set(KEYS.storageNotice, notice);
  noticeListener?.(notice);
  return notice;
}

function guardedSet<T>(key: string, value: T, shrink?: (v: T) => T): T {
  if (kv.set(key, value)) return value;
  const dropped = dropLowPriority();
  const retry = shrink ? shrink(value) : value;
  const ok = kv.set(key, retry);
  reportStorageNotice(dropped, ok);
  return retry;
}

function guardedUpdate<T>(key: string, fn: (prev: T | null) => T, shrink?: (v: T) => T): T {
  const next = kv.update<T>(key, fn);
  if (kv.lastWriteOk) return next;
  const dropped = dropLowPriority();
  const retried = kv.update<T>(key, (prev) => (shrink ? shrink(fn(prev)) : fn(prev)));
  reportStorageNotice(dropped, kv.lastWriteOk);
  return retried;
}

export const storageNoticeRepo = {
  get(): StorageNotice | null {
    return kv.get<StorageNotice>(KEYS.storageNotice);
  },
  clear(): void {
    kv.remove(KEYS.storageNotice);
  },
};

// ---------- Prefs / onboarding ----------

export const DEFAULT_PREFS: Prefs = {
  area: 'new-brunswick',
  homeStationId: 'new-brunswick',
  noisePref: 'silent',
  needOutlets: true,
  stepFree: false,
  blocks: [],
  updatedAt: '1970-01-01T00:00:00.000Z',
};

/** Coerce stored data into a valid Prefs (defensive against old versions). */
export function sanitizePrefs(input: Partial<Prefs> | null | undefined): Prefs {
  const p = { ...DEFAULT_PREFS, ...(input ?? {}) };
  const area = (AREAS as readonly string[]).includes(p.area) ? p.area : DEFAULT_PREFS.area;
  const blocks = Array.isArray(p.blocks)
    ? p.blocks.filter((b) => b && typeof b.blockId === 'string' && Number.isInteger(b.weekday) && b.weekday >= 0 && b.weekday <= 6 && Number.isFinite(b.startMin) && Number.isFinite(b.endMin) && b.endMin > b.startMin)
    : [];
  return {
    area,
    homeStationId: typeof p.homeStationId === 'string' ? p.homeStationId : null,
    noisePref: p.noisePref === 'low' || p.noisePref === 'chatty' ? p.noisePref : 'silent',
    needOutlets: p.needOutlets !== false,
    stepFree: p.stepFree === true,
    blocks,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : DEFAULT_PREFS.updatedAt,
  };
}

export const prefsRepo = {
  get(): Prefs {
    return sanitizePrefs(kv.get<Prefs>(KEYS.prefs));
  },
  set(p: Prefs): Prefs {
    const clean = sanitizePrefs(p);
    guardedSet(KEYS.prefs, clean);
    return clean;
  },
  isOnboarded(): boolean {
    return kv.get<boolean>(KEYS.onboarded) === true;
  },
  setOnboarded(v: boolean): void {
    guardedSet(KEYS.onboarded, v);
  },
};

// ---------- Settings ----------

export const DEFAULT_SETTINGS: Settings = { demoScenario: 'live', simulateOffline: false, notificationsEnabled: true, shareCheckIns: true, demoClockOffsetMs: 0 };

export const settingsRepo = {
  get(): Settings {
    const s = { ...DEFAULT_SETTINGS, ...(kv.get<Partial<Settings>>(KEYS.settings) ?? {}) };
    // The clock offset is recomputed from the scenario at boot; never trust a stored one.
    return { ...s, demoClockOffsetMs: 0 };
  },
  patch(p: Partial<Settings>): Settings {
    const { demoClockOffsetMs: _skip, ...persist } = p;
    const stored = guardedUpdate<Settings>(KEYS.settings, (prev) => ({ ...DEFAULT_SETTINGS, ...(prev ?? {}), ...persist }));
    return { ...stored, demoClockOffsetMs: p.demoClockOffsetMs ?? 0 };
  },
};

// ---------- Venues & stations (downloaded copy → bundled fallback) ----------

const VENUES_FILE = 'venues.json';

export interface VenueSource {
  venues: Venue[];
  version: string;
  source: 'bundle' | 'network';
}

/** Keep only venues that pass the hours validator; a bad row must never crash the directory. */
export function sanitizeVenues(list: unknown): Venue[] {
  if (!Array.isArray(list)) return [];
  return (list as Venue[]).filter((v) => v && typeof v.venueId === 'string' && Array.isArray(v.hours) && v.hours.length === 7 && hoursValid({ hours: v.hours, exceptions: v.exceptions ?? [] }).length === 0);
}

export const venueRepo = {
  get(): VenueSource {
    const downloaded = files.readJsonSync<{ venues?: unknown; version?: string }>(VENUES_FILE);
    const clean = downloaded ? sanitizeVenues(downloaded.venues) : [];
    if (clean.length > 0) return { venues: clean, version: downloaded?.version ?? 'remote', source: 'network' };
    return { venues: bundledVenues.venues as unknown as Venue[], version: bundledVenues.version, source: 'bundle' };
  },
  bundledVersion(): string {
    return bundledVenues.version;
  },
  saveDownloaded(payload: { venues: Venue[]; version: string }): number {
    return files.writeJson(VENUES_FILE, payload);
  },
  removeDownloaded(): void {
    files.remove(VENUES_FILE);
  },
  bytes(): number {
    return files.bytesOf(VENUES_FILE);
  },
};

export const stationRepo = {
  get(): Station[] {
    return bundledStations.stations as Station[];
  },
};

// ---------- Own check-ins ----------

export function pruneCheckIns(list: CheckIn[], now: number = Date.now()): CheckIn[] {
  const cutoff = now - CHECKIN_RETENTION_DAYS * 24 * 3600_000;
  return [...list]
    .sort((a, b) => toEpoch(b.at) - toEpoch(a.at))
    .filter((c) => {
      const t = toEpoch(c.at);
      return !Number.isFinite(t) || t >= cutoff;
    })
    .slice(0, CHECKIN_RETENTION_MAX);
}

const keepNewestCheckIns = (list: CheckIn[]) => list.slice(0, LOW_SPACE_CHECKIN_KEEP);

export const checkInRepo = {
  getAll(): CheckIn[] {
    return kv.get<CheckIn[]>(KEYS.checkins) ?? [];
  },
  add(ci: CheckIn, now: number = Date.now()): CheckIn[] {
    return guardedUpdate<CheckIn[]>(KEYS.checkins, (prev) => pruneCheckIns([ci, ...(prev ?? []).filter((c) => c.checkInId !== ci.checkInId)], now), keepNewestCheckIns);
  },
  markSynced(ids: string[]): CheckIn[] {
    const set = new Set(ids);
    return guardedUpdate<CheckIn[]>(KEYS.checkins, (prev) => (prev ?? []).map((c) => (set.has(c.checkInId) ? { ...c, synced: true } : c)), keepNewestCheckIns);
  },
  replaceAll(list: CheckIn[]): CheckIn[] {
    return guardedSet(KEYS.checkins, pruneCheckIns(list), keepNewestCheckIns);
  },
};

// ---------- Crowd snapshot (the only re-downloadable cache) ----------

export const crowdRepo = {
  get(): CrowdSnapshot | null {
    return kv.get<CrowdSnapshot>(KEYS.crowd);
  },
  /** First thing given up when space runs out, so a failed write is reported, not retried. */
  set(s: CrowdSnapshot): boolean {
    if (kv.set(KEYS.crowd, s)) return true;
    reportStorageNotice(['crowd-cache'], true);
    return false;
  },
};

// ---------- Session & focus log ----------

export const sessionRepo = {
  get(): Session | null {
    return kv.get<Session>(KEYS.session);
  },
  set(s: Session | null): void {
    if (s) guardedSet(KEYS.session, s);
    else kv.remove(KEYS.session);
  },
};

export const FOCUS_LOG_MAX = 2000;

export const focusLogRepo = {
  getAll(): FocusEntry[] {
    return kv.get<FocusEntry[]>(KEYS.focusLog) ?? [];
  },
  add(e: FocusEntry): FocusEntry[] {
    return guardedUpdate<FocusEntry[]>(KEYS.focusLog, (prev) => [e, ...(prev ?? []).filter((x) => x.sessionId !== e.sessionId)].slice(0, FOCUS_LOG_MAX));
  },
  replaceAll(list: FocusEntry[]): FocusEntry[] {
    return guardedSet(KEYS.focusLog, list.slice(0, FOCUS_LOG_MAX));
  },
};

// ---------- Watches ----------

export const watchRepo = {
  getAll(): Watch[] {
    return kv.get<Watch[]>(KEYS.watches) ?? [];
  },
  replaceAll(list: Watch[]): Watch[] {
    return guardedSet(KEYS.watches, list);
  },
  /** venueId → ISO time of the last notification, so a watch fires at most once per hour. */
  getNotified(): Record<string, string> {
    return kv.get<Record<string, string>>(KEYS.watchNotified) ?? {};
  },
  markNotified(venueId: string, at: string): void {
    kv.update<Record<string, string>>(KEYS.watchNotified, (prev) => ({ ...(prev ?? {}), [venueId]: at }));
  },
};

// ---------- Cache metadata ----------

export const cacheMetaRepo = {
  getAll(): CacheMetaMap {
    return kv.get<CacheMetaMap>(KEYS.cacheMeta) ?? {};
  },
  set(meta: CacheMeta): CacheMetaMap {
    return guardedUpdate<CacheMetaMap>(KEYS.cacheMeta, (prev) => ({ ...(prev ?? {}), [meta.key]: meta }));
  },
  remove(key: AssetKey): CacheMetaMap {
    return kv.update<CacheMetaMap>(KEYS.cacheMeta, (prev) => {
      const next = { ...(prev ?? {}) };
      delete next[key];
      return next;
    });
  },
};

// ---------- Last GPS fix ----------

export const locationRepo = {
  get(): LocationFix | null {
    return kv.get<LocationFix>(KEYS.lastFix);
  },
  set(fix: LocationFix): void {
    kv.set(KEYS.lastFix, fix);
  },
};

/** Wipe everything (Offline data screen → "Reset app data"). */
export function resetAllData(): void {
  kv.clear();
  venueRepo.removeDownloaded();
  initStorage();
}
