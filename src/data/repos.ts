/**
 * Local-first repositories. Every read is synchronous and starts from local storage
 * (or the bundled fallback). Nothing here touches the network.
 *
 * One small object per kind of record (prefs, settings, venues, stations, own check-ins, the crowd and pattern
 * caches, the focus session, the focus log, watches, cache metadata, storage notices) over `kv` (SQLite;
 * localStorage on web) and `files` (the downloaded directory). The app store hydrates from these at boot and writes
 * through them before it updates its state; the refresh service, the background poll, notifications and a few
 * screens (Offline data, onboarding, Privacy) also use some directly.
 *
 * Storage guard: when a guarded write fails (the phone is full), the re-downloadable caches and then older check-ins
 * are dropped, the write is retried once, and a StorageNotice says what was dropped and whether the retry worked.
 * The caller gets the new value either way, so the UI keeps the change even when it could not be saved. Cache
 * writes are only reported, never retried (see cacheRepo).
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
  PatternSnapshot,
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

/** The kv key of each kind of record (the downloaded directory is a file instead, see VENUES_FILE). */
export const KEYS = {
  schema: 'meta:schemaVersion',
  onboarded: 'onboarded:v1',
  prefs: 'prefs:v1',
  settings: 'settings:v1',
  checkins: 'checkins:v1',
  crowd: 'crowd:v1',
  pattern: 'pattern:v1',
  session: 'session:v1',
  focusLog: 'focusLog:v1',
  watches: 'watches:v1',
  cacheMeta: 'cacheMeta:v1',
  watchNotified: 'watchNotified:v1',
  storageNotice: 'storageNotice:v1',
} as const;

/** Version of the stored layout. No migration exists yet: readers sanitize older shapes instead (sanitizePrefs, withKind). */
export const SCHEMA_VERSION = 1;

/**
 * Records SCHEMA_VERSION under KEYS.schema (nothing else reads it yet). Synchronous and idempotent:
 * hydrate() calls it first at boot, and resetAllData() calls it again after a wipe.
 */
export function initStorage(): void {
  const v = kv.get<number>(KEYS.schema);
  if (v !== SCHEMA_VERSION) kv.set(KEYS.schema, SCHEMA_VERSION);
}

// ---------- Storage guard: drop by priority, say what was dropped ----------

/** Below this much free disk (5 MiB), refreshAll runs dropLowPriority() before downloading anything. */
export const LOW_SPACE_BYTES = 5 * 1024 * 1024;
/** Own check-ins kept when space runs out: the newest ones. */
export const LOW_SPACE_CHECKIN_KEEP = 50;
/** Own check-ins are kept this long for the "your check-ins here" list (the Privacy screen quotes this number). */
export const CHECKIN_RETENTION_DAYS = 30;
/** At most this many own check-ins are kept, newest first, whatever their age. */
export const CHECKIN_RETENTION_MAX = 300;

/** Callback that receives each StorageNotice as it is raised. */
type NoticeListener = (n: StorageNotice) => void;
/** One slot, not a list: the app store is the only subscriber in the app. */
let noticeListener: NoticeListener | null = null;
/**
 * Sets the storage-notice listener, replacing any previous one (null clears it). The app store registers at load,
 * to show the notice and re-read the caches and check-ins the guard may have dropped.
 */
export function onStorageNotice(l: NoticeListener | null): void {
  noticeListener = l;
}

/** True when the device reports less than LOW_SPACE_BYTES free; false when free space is unknown (web, or the query failed). */
export function isLowOnSpace(): boolean {
  const free = files.availableBytes();
  return Number.isFinite(free) && free < LOW_SPACE_BYTES;
}

/**
 * Give up re-downloadable data first (pattern and crowd caches), then older own check-ins. Prefs, session, focus log,
 * watches are never dropped. Everything droppable goes in one call, without re-checking free space in between: each
 * cache with its cache-metadata row, then check-ins pruned to the newest LOW_SPACE_CHECKIN_KEEP. Returns what was
 * dropped, in that order. Called after a failed guarded write, and by refreshAll when the phone is low on space.
 */
export function dropLowPriority(): DroppedItem[] {
  const dropped: DroppedItem[] = [];
  patternRepo.drop(dropped);
  crowdRepo.drop(dropped);
  const cis = kv.get<CheckIn[]>(KEYS.checkins) ?? [];
  if (cis.length > LOW_SPACE_CHECKIN_KEEP) {
    kv.set(KEYS.checkins, pruneCheckIns(cis).slice(0, LOW_SPACE_CHECKIN_KEEP));
    dropped.push('old-checkins');
  }
  return dropped;
}

/**
 * Raises a StorageNotice: saves it (best effort; the Offline data screen shows it until dismissed) and hands it to
 * the listener. `recovered` is false only when a guarded write could still not be saved; the screen then says the
 * last change could not be saved. Returns null, raising nothing, when nothing was dropped and the write recovered.
 */
export function reportStorageNotice(dropped: DroppedItem[], recovered: boolean): StorageNotice | null {
  if (dropped.length === 0 && recovered) return null;
  const free = files.availableBytes();
  const notice: StorageNotice = { at: new Date().toISOString(), dropped, freeBytes: Number.isFinite(free) ? free : null, recovered };
  kv.set(KEYS.storageNotice, notice);
  noticeListener?.(notice);
  return notice;
}

/**
 * Storage-guarded kv.set. If the write fails: dropLowPriority(), retry once (with `shrink(value)` when a shrink is
 * given), then report a notice. Returns the value the caller should keep in memory (the shrunk one after a failure),
 * even if the retry failed too.
 */
function guardedSet<T>(key: string, value: T, shrink?: (v: T) => T): T {
  if (kv.set(key, value)) return value;
  const dropped = dropLowPriority();
  const retry = shrink ? shrink(value) : value;
  const ok = kv.set(key, retry);
  reportStorageNotice(dropped, ok);
  return retry;
}

/**
 * Storage-guarded kv.update (atomic read-modify-write). If the write fails: dropLowPriority(), rerun `fn` (then
 * `shrink`) on what is stored now, which the drop may have changed, and report a notice. Returns the new value even
 * if it could not be saved. `fn` must be pure: it can run several times.
 */
function guardedUpdate<T>(key: string, fn: (prev: T | null) => T, shrink?: (v: T) => T): T {
  const next = kv.update<T>(key, fn);
  if (kv.lastWriteOk) return next;
  const dropped = dropLowPriority();
  const retried = kv.update<T>(key, (prev) => (shrink ? shrink(fn(prev)) : fn(prev)));
  reportStorageNotice(dropped, kv.lastWriteOk);
  return retried;
}

/** The last storage notice, kept on disk so the Offline data screen still shows it after a restart, until dismissed. */
export const storageNoticeRepo = {
  /** The saved notice, or null. */
  get(): StorageNotice | null {
    return kv.get<StorageNotice>(KEYS.storageNotice);
  },
  /** Forgets the notice (the student tapped OK on the Offline data screen). */
  clear(): void {
    kv.remove(KEYS.storageNotice);
  },
};

// ---------- Prefs / onboarding ----------

/**
 * Prefs for a fresh install and for onboarding's Skip. Stored prefs are merged over them, so a missing field takes
 * its default: New Brunswick with its station as home, silent zones, outlets needed, no free blocks.
 */
export const DEFAULT_PREFS: Prefs = {
  area: 'new-brunswick',
  homeStationId: 'new-brunswick',
  noisePref: 'silent',
  needOutlets: true,
  stepFree: false,
  blocks: [],
  updatedAt: '1970-01-01T00:00:00.000Z',
};

/**
 * Coerce stored data into a valid Prefs (defensive against old versions). Missing fields take DEFAULT_PREFS, an
 * unknown area falls back to New Brunswick, malformed free blocks are dropped, only an explicit false turns
 * needOutlets off and only an explicit true turns stepFree on. Writes go through it too (prefsRepo.set).
 */
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

/** The student's preferences (area, home station, noise, outlets, step-free, weekly free blocks) and the onboarding flag. */
export const prefsRepo = {
  /** Stored prefs, sanitized; DEFAULT_PREFS when nothing is stored yet. */
  get(): Prefs {
    return sanitizePrefs(kv.get<Prefs>(KEYS.prefs));
  },
  /** Sanitizes and saves (storage-guarded); returns the clean prefs, also when the save failed. */
  set(p: Prefs): Prefs {
    const clean = sanitizePrefs(p);
    guardedSet(KEYS.prefs, clean);
    return clean;
  },
  /** Whether onboarding was finished (saved or skipped); the root layout shows onboarding until it is. */
  isOnboarded(): boolean {
    return kv.get<boolean>(KEYS.onboarded) === true;
  },
  /** Saves the onboarding flag (storage-guarded); onboarding's Save and Skip both set it to true. */
  setOnboarded(v: boolean): void {
    guardedSet(KEYS.onboarded, v);
  },
};

// ---------- Settings ----------

/** Settings for a fresh install: real data on the real clock (scenario 'live'), real network state, notifications on, check-ins shared. */
export const DEFAULT_SETTINGS: Settings = { demoScenario: 'live', simulateOffline: false, notificationsEnabled: true, shareCheckIns: true, demoClockOffsetMs: 0 };

/** App settings: demo scenario, simulated offline, notifications, sharing. The demo clock offset is never taken from disk. */
export const settingsRepo = {
  /** Stored settings merged over DEFAULT_SETTINGS, with demoClockOffsetMs always 0; the store keeps the live offset in memory. */
  get(): Settings {
    const s = { ...DEFAULT_SETTINGS, ...(kv.get<Partial<Settings>>(KEYS.settings) ?? {}) };
    // The clock offset is recomputed from the scenario at boot; never trust a stored one.
    return { ...s, demoClockOffsetMs: 0 };
  },
  /**
   * Merges `p` into the stored settings (atomic, storage-guarded) and returns the result. An offset in `p` is not
   * written, because offsets are relative to today (restoreDemoScenario recomputes one at boot), but the result
   * echoes it (0 when absent).
   */
  patch(p: Partial<Settings>): Settings {
    const { demoClockOffsetMs: _skip, ...persist } = p;
    const stored = guardedUpdate<Settings>(KEYS.settings, (prev) => ({ ...DEFAULT_SETTINGS, ...(prev ?? {}), ...persist }));
    return { ...stored, demoClockOffsetMs: p.demoClockOffsetMs ?? 0 };
  },
};

// ---------- Venues & stations (downloaded copy → bundled fallback) ----------

/** File name of the downloaded venue directory in the offline folder. */
const VENUES_FILE = 'venues.json';

/**
 * The venue directory in use and where it came from: the downloaded feed ('network') or the copy bundled with
 * the app ('bundle'). `version` is that copy's version string ('remote' when a feed gave none).
 */
export interface VenueSource {
  venues: Venue[];
  version: string;
  source: 'bundle' | 'network';
}

/**
 * Keep only venues that pass the hours validator; a bad row must never crash the directory.
 * A row also needs a string venueId and seven days of hours; anything but an array gives []. Applied to a feed
 * before it is saved (refreshVenues) and to the saved file on every read (venueRepo.get).
 */
export function sanitizeVenues(list: unknown): Venue[] {
  if (!Array.isArray(list)) return [];
  return (list as Venue[]).filter((v) => v && typeof v.venueId === 'string' && Array.isArray(v.hours) && v.hours.length === 7 && hoursValid({ hours: v.hours, exceptions: v.exceptions ?? [] }).length === 0);
}

/**
 * The venue directory: the downloaded feed (optional EXPO_PUBLIC_VENUES_URL) when its file holds at least one valid
 * venue, else the copy bundled in assets/data/venues.json.
 */
export const venueRepo = {
  /** Reads the downloaded file synchronously and keeps its valid venues; the bundle when the file is missing, unreadable or has no valid row. */
  get(): VenueSource {
    const downloaded = files.readJsonSync<{ venues?: unknown; version?: string }>(VENUES_FILE);
    const clean = downloaded ? sanitizeVenues(downloaded.venues) : [];
    if (clean.length > 0) return { venues: clean, version: downloaded?.version ?? 'remote', source: 'network' };
    return { venues: bundledVenues.venues as unknown as Venue[], version: bundledVenues.version, source: 'bundle' };
  },
  /** Version of the bundled directory; the store's initial state uses it until hydration. */
  bundledVersion(): string {
    return bundledVenues.version;
  },
  /** Saves a downloaded directory as the offline file. Returns its size in bytes, 0 when the write failed (not covered by the storage guard). */
  saveDownloaded(payload: { venues: Venue[]; version: string }): number {
    return files.writeJson(VENUES_FILE, payload);
  },
  /** Deletes the downloaded file, so the bundled directory is used again (part of resetAllData). */
  removeDownloaded(): void {
    files.remove(VENUES_FILE);
  },
  /** Size of the downloaded file in bytes, 0 when there is none (shown on the Offline data screen). */
  bytes(): number {
    return files.bytesOf(VENUES_FILE);
  },
};

/** Transit stations, used as walking-time origins and map pins. Bundled only: there is no station feed. */
export const stationRepo = {
  /** The bundled stations (assets/data/stations.json). */
  get(): Station[] {
    return bundledStations.stations as Station[];
  },
};

// ---------- Own check-ins ----------

/**
 * Retention for own check-ins: sorted newest first by report time, nothing older than CHECKIN_RETENTION_DAYS before
 * `now`, at most CHECKIN_RETENTION_MAX. A record whose time does not parse is kept. `now` defaults to device time
 * (the store passes the app clock).
 */
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

/** Shrink step for check-in writes on a full disk: the newest LOW_SPACE_CHECKIN_KEEP of a newest-first list. */
const keepNewestCheckIns = (list: CheckIn[]) => list.slice(0, LOW_SPACE_CHECKIN_KEEP);

/** Records saved before report kinds existed were all made at the spot, so a record without `kind` reads as 'live'. No list reads as []. */
const withKind = (list: CheckIn[] | null) => (list ?? []).map((c) => (c.kind ? c : { ...c, kind: 'live' as const }));

/**
 * The student's own reports (at the spot, not at the spot, earlier visit), newest first by report time and pruned
 * on every add. The full records, notes included, stay on this phone (with sharing on, only the anonymous part is
 * uploaded: levels.ts toReport); `synced` marks the ones the upload queue is done with.
 */
export const checkInRepo = {
  /** All own reports in stored order (newest first); old records read as kind 'live'. */
  getAll(): CheckIn[] {
    return withKind(kv.get<CheckIn[]>(KEYS.checkins));
  },
  /**
   * Adds a report (replacing one with the same checkInId), re-sorts and prunes. Atomic and storage-guarded: on a
   * full disk the newest LOW_SPACE_CHECKIN_KEEP are kept. Returns the new list for the store.
   */
  add(ci: CheckIn, now: number = Date.now()): CheckIn[] {
    return guardedUpdate<CheckIn[]>(KEYS.checkins, (prev) => pruneCheckIns([ci, ...withKind(prev).filter((c) => c.checkInId !== ci.checkInId)], now), keepNewestCheckIns);
  },
  /** Marks these reports as done with the upload queue (sent, refused as too old, or sharing was off); returns the new list. */
  markSynced(ids: string[]): CheckIn[] {
    const set = new Set(ids);
    return guardedUpdate<CheckIn[]>(KEYS.checkins, (prev) => withKind(prev).map((c) => (set.has(c.checkInId) ? { ...c, synced: true } : c)), keepNewestCheckIns);
  },
  /** Replaces the whole list (pruned, storage-guarded like add); returns what was kept. */
  replaceAll(list: CheckIn[]): CheckIn[] {
    return guardedSet(KEYS.checkins, pruneCheckIns(list), keepNewestCheckIns);
  },
};

// ---------- Re-downloadable caches: crowd snapshot and learned pattern ----------

/**
 * Repository for a re-downloadable cache stored under `key`; `asset` names its cache-metadata row and `item` is how a
 * storage notice calls it. First things given up when space runs out, so a failed write is reported, not retried.
 */
function cacheRepo<T>(key: string, asset: AssetKey, item: DroppedItem) {
  return {
    /** The cached value, or null. */
    get(): T | null {
      return kv.get<T>(key);
    },
    /** Saves the value. On failure the previous copy stays on disk, a notice names this cache, and it returns false. */
    set(v: T): boolean {
      if (kv.set(key, v)) return true;
      reportStorageNotice([item], true);
      return false;
    },
    /** If a value is stored, deletes it and its cache-metadata row and appends `item` to `into` (for dropLowPriority). */
    drop(into: DroppedItem[]): void {
      if (kv.get<T>(key) != null) {
        kv.remove(key);
        cacheMetaRepo.remove(asset);
        into.push(item);
      }
    },
  };
}

/** The last relay snapshot of live reports for the student's area (GET /api/crowd); given up second when space runs out. */
export const crowdRepo = cacheRepo<CrowdSnapshot>(KEYS.crowd, 'crowd', 'crowd-cache');
/**
 * The learned baseline from the relay (GET /api/pattern, downloaded at most every six hours); given up first when
 * space runs out. Without it the typical pattern falls back to each venue's declared curve or its per-kind estimate.
 */
export const patternRepo = cacheRepo<PatternSnapshot>(KEYS.pattern, 'pattern', 'pattern-cache');

// ---------- Session & focus log ----------

/** The focus session in progress (running or paused). It holds absolute timestamps, so a restart rejoins the right block. */
export const sessionRepo = {
  /** The stored session, or null when none is in progress. */
  get(): Session | null {
    return kv.get<Session>(KEYS.session);
  },
  /** Saves the session (storage-guarded), or deletes it when `s` is null (ended or discarded). */
  set(s: Session | null): void {
    if (s) guardedSet(KEYS.session, s);
    else kv.remove(KEYS.session);
  },
};

/** Focus-log entries kept; beyond this the oldest fall off. */
export const FOCUS_LOG_MAX = 2000;

/** Finished focus sessions, newest first; they feed the streak, the week summary and the hour-of-day chart. Never dropped for space. */
export const focusLogRepo = {
  /** All entries, newest first. */
  getAll(): FocusEntry[] {
    return kv.get<FocusEntry[]>(KEYS.focusLog) ?? [];
  },
  /** Prepends a finished session (replacing one with the same sessionId), capped at FOCUS_LOG_MAX and storage-guarded; returns the new log. */
  add(e: FocusEntry): FocusEntry[] {
    return guardedUpdate<FocusEntry[]>(KEYS.focusLog, (prev) => [e, ...(prev ?? []).filter((x) => x.sessionId !== e.sessionId)].slice(0, FOCUS_LOG_MAX));
  },
};

// ---------- Watches ----------

/** Spots the student watches (notify when the level is at or below a chosen one), and when each last notified. */
export const watchRepo = {
  /** The watch list. */
  getAll(): Watch[] {
    return kv.get<Watch[]>(KEYS.watches) ?? [];
  },
  /** Saves the whole watch list (storage-guarded) and returns it; the spot page's watch toggle writes through here. */
  replaceAll(list: Watch[]): Watch[] {
    return guardedSet(KEYS.watches, list);
  },
  /** venueId → ISO time of the last notification, so a watch fires at most once per hour. */
  getNotified(): Record<string, string> {
    return kv.get<Record<string, string>>(KEYS.watchNotified) ?? {};
  },
  /** Records when `venueId` was last notified. Plain kv.update, not storage-guarded: a failed write is ignored. */
  markNotified(venueId: string, at: string): void {
    kv.update<Record<string, string>>(KEYS.watchNotified, (prev) => ({ ...(prev ?? {}), [venueId]: at }));
  },
};

// ---------- Cache metadata ----------

/**
 * When each downloaded asset (directory, crowd snapshot, pattern) was fetched, its size and version. The Offline
 * data screen shows these, and refreshPattern reads the pattern's age from the store's copy of them.
 */
export const cacheMetaRepo = {
  /** Every entry, keyed by asset. */
  getAll(): CacheMetaMap {
    return kv.get<CacheMetaMap>(KEYS.cacheMeta) ?? {};
  },
  /** Saves one asset's entry (atomic, storage-guarded) and returns the whole map; the refresh service calls it after each download. */
  set(meta: CacheMeta): CacheMetaMap {
    return guardedUpdate<CacheMetaMap>(KEYS.cacheMeta, (prev) => ({ ...(prev ?? {}), [meta.key]: meta }));
  },
  /** Deletes one asset's entry when its cache is dropped. Plain kv.update rather than the guard, because it runs inside dropLowPriority. */
  remove(key: AssetKey): CacheMetaMap {
    return kv.update<CacheMetaMap>(KEYS.cacheMeta, (prev) => {
      const next = { ...(prev ?? {}) };
      delete next[key];
      return next;
    });
  },
};

/**
 * Wipe everything (Offline data screen → "Reset app data"): every kv key (prefs, onboarding flag, settings, check-ins,
 * caches, session, focus log, watches) and the downloaded directory, then re-stamp the schema version.
 * In-memory state is untouched; the caller re-hydrates the store.
 */
export function resetAllData(): void {
  kv.clear();
  venueRepo.removeDownloaded();
  initStorage();
}
