/**
 * Domain types for StudySpace.
 *
 * Everything here is plain data that can be JSON-serialised into local storage.
 * No Expo / React Native imports — this module is shared by unit tests, the
 * client app, and the server-side crowd relay route.
 *
 * Reading order: the directory (Venue with its hours, zones and stations); crowd evidence (CheckIn on this
 * phone, CrowdReport on the wire, the learned VenuePattern) and the LiveLevel fused from it; focus sessions
 * (Session, then FocusEntry in the log); the student's own choices (Prefs, Watch, Settings); and storage
 * bookkeeping (CacheMeta, StorageNotice). Instants are ISO 8601 strings unless a field says epoch ms; times
 * of day are New Jersey wall-clock time.
 */

/** The four pilot areas. The student picks one (Prefs.area): the Now tab ranks its venues and live levels are fetched for them only. */
export type Area = 'new-brunswick' | 'newark' | 'hoboken' | 'princeton';

/**
 * What sort of place a venue is. Picks its typical-day estimate curve when the venue declares none (curve.ts), its
 * icon in lists, and whether campus safety contacts apply (safety.ts: libraries and student centers only).
 */
export type VenueKind = 'library' | 'public-library' | 'student-center' | 'cafe';

/** Noise policy of a zone. Silent is the default and the point of the product. Also the student's preference (Prefs.noisePref). */
export type NoisePolicy = 'silent' | 'low' | 'chatty';

/** Five published crowd levels: 0 Empty, 1 Chill, 2 Filling, 3 Packed, 4 Full. Students think in these, never in percentages. */
export type Level = 0 | 1 | 2 | 3 | 4;

/**
 * How much the published level can be trusted. 'none' = no usable report, so the typical pattern alone sets the
 * level. The rules live in levels.ts fuse(); reports from students not at the spot never lift it above 'low'.
 */
export type Confidence = 'high' | 'medium' | 'low' | 'none';

/** Who can get in. 'students-late' = public during the day, student ID after a stated hour or during finals. */
export type Access = 'public' | 'students' | 'students-late';

/**
 * "HH:MM" 24-hour local time. `close` may exceed "24:00" (e.g. "26:00" = 2 a.m. the next day).
 * hours.ts hoursValid() requires close after open and at most 12 h past midnight.
 */
export interface DayHours {
  open: string;
  close: string;
}

/** Sunday-first (JS getDay order). null = closed that day. */
export type WeekHours = [DayHours | null, DayHours | null, DayHours | null, DayHours | null, DayHours | null, DayHours | null, DayHours | null];

/** A dated override of the regular hours: renovation closures, finals 24-hour periods, holidays. When several cover a day, the first listed wins. */
export interface HoursException {
  /** Inclusive ISO dates (local). */
  from: string;
  to: string;
  label: string;
  /** 'closed', '24h', explicit hours, or null = regular hours apply but the label is shown. */
  hours: DayHours | 'closed' | '24h' | null;
  source: string;
  /** Marks a hypothetical exception injected by a demo scenario. Always labelled in the UI. */
  isDemo?: boolean;
}

/**
 * A named part of a venue (a floor, wing or room) with its own noise policy. A check-in may name one, and the spot
 * page shows a zone's own level once it has a report from the last 90 minutes.
 */
export interface Zone {
  zoneId: string;
  name: string;
  floor: string;
  noise: NoisePolicy;
  /** Published seat count, or null when the venue does not publish one (most do not). */
  seats: number | null;
  /** Wheelchair-accessible seats, tracked separately and never counted as general capacity. */
  accessibleSeats?: number | null;
  outlets: 'many' | 'some' | 'few' | null;
  groupRooms?: number;
  computers?: number;
  note?: string;
  source?: string;
}

/** Something a venue offers (directory), or that a student found available at check-in. The relay accepts the same list. */
export type Amenity =
  | 'outlets'
  | 'wifi-eduroam'
  | 'wifi-public'
  | 'group-rooms'
  | 'computers'
  | 'printing'
  | 'cafe'
  | 'food-nearby'
  | 'late-night'
  | 'solo-desks'
  | 'big-tables';

/** Accessibility facts as the venue publishes them; null = not published. The step-free preference counts only `stepFree === true`. */
export interface Accessibility {
  stepFree: boolean | null;
  accessibleRestroom: boolean | null;
  adjustableDesks: boolean | null;
  note?: string;
  source?: string;
}

/**
 * One study spot in the directory: the bundled assets/data/venues.json, or a downloaded feed that replaces it
 * (feed rows that fail hoursValid are dropped). What a venue does not publish stays null; nothing is invented.
 */
export interface Venue {
  venueId: string;
  name: string;
  shortName: string;
  kind: VenueKind;
  area: Area;
  /** Campus or neighbourhood label, e.g. "College Avenue", "Downtown". */
  campus: string | null;
  address: string;
  town: string;
  lat: number;
  lng: number;
  /** How exact `lat`/`lng` are; below 'high' the spot page marks the address as approximate. */
  coordConfidence: 'high' | 'medium' | 'low';
  /** Regular weekly hours; `exceptions` override them on given dates. */
  hours: WeekHours;
  hoursNote?: string;
  hoursSource: string;
  /** ISO date the hours were last checked against the source. Wrong hours destroy trust faster than wrong levels. */
  hoursVerified: string;
  exceptions: HoursException[];
  access: Access;
  accessNote?: string;
  /** Published total seats, or null. Levels are relative, so null is fine. */
  capacity: number | null;
  zones: Zone[];
  amenities: Amenity[];
  accessibility: Accessibility;
  /** Optional venue-declared 24-value occupancy curve (0..1 by hour). null = use the per-kind estimate. */
  typicalCurve: number[] | null;
  curveSource: 'estimate' | 'venue';
  /**
   * Nearby stations, nearest first; the first is the spot's primary station ("N min from …" on the spot page, Map
   * and Why screen). The ranking walks from its own origin instead. Walk minutes are computed, never stored.
   */
  stationIds: string[];
  website?: string;
  phone?: string;
  notes?: string;
  /** Evidence trail, publisher first; the spot page shows its publisher part as the source. */
  verifiedBy: string;
  lastVerified: string;
}

/** Transit systems a station serves, listed under its name (transit.ts formatModes). */
export type TransitMode = 'NJ Transit' | 'Amtrak' | 'PATH' | 'HBLR' | 'Newark Light Rail' | 'Princeton Dinky';

/**
 * A rail or light-rail station (bundled assets/data/stations.json). The student's home station is the walking
 * origin when there is no GPS fix in the area, and each venue names a primary station.
 */
export interface Station {
  stationId: string;
  name: string;
  lat: number;
  lng: number;
  modes: TransitMode[];
  area: Area;
  lines?: string[];
}

/** Noise as reported by a student: silent / low murmur / chatty / loud. */
export type NoiseReport = 0 | 1 | 2 | 3;

/** `live` = at the spot now (proof-weighted); `remote` = now, not at the spot; `past` = an earlier visit, baseline only. */
export type ReportKind = 'live' | 'remote' | 'past';

/**
 * A check-in made on THIS phone. Notes never leave the phone in v1.
 * Any kind: an earlier-visit report is a `past` check-in. Kept in local storage: live and remote ones count in
 * this phone's fusion at once, and every kind is listed under "your check-ins" on the spot page and counted on
 * Your week. With sharing on, only the anonymous part is uploaded (levels.ts toReport, plus the id).
 */
export interface CheckIn {
  /** newId('ci'). Also sent with the upload as the per-report retry key. */
  checkInId: string;
  kind: ReportKind;
  venueId: string;
  zoneId: string | null;
  level: Level;
  noise: NoiseReport | null;
  amenities: Amenity[];
  note: string | null;
  /**
   * ISO 8601 on the app clock: device time unless a demo scenario shifts it (demo check-ins are never uploaded).
   * For a `past` report, the start of the chosen hour.
   */
  at: string;
  proof: {
    /**
     * Straight-line metres from the venue at check-in time, or null without a fresh fix (location off, no fix
     * yet, or an earlier-visit report). Stays on the phone; a live report uploads only the proof strength derived from it.
     */
    distanceM: number | null;
    /** The fix's accuracy radius in metres, null when unknown; proof strength gives this much benefit of the doubt. */
    gpsAccuracyM: number | null;
  };
  /** 'demo' when made while a demo scenario runs; such check-ins are never uploaded. */
  source: 'me' | 'demo';
  /**
   * True once the relay has settled the anonymous copy (stored it, or refused it as too old), or without an upload
   * when sharing was off (at check-in or at the next sync) or a demo was running. False = still queued for upload.
   */
  synced: boolean;
  /** The level the app was showing for this spot when the check-in was posted — the wasted-trip metric. Null when the spot showed as closed or had no level, and for earlier visits. */
  shownLevel?: Level | null;
}

/**
 * Anonymous report as returned by the crowd relay. No ids, no notes, minute-rounded time.
 * Fusion also gets this shape from the phone's own check-ins (levels.ts toReport, which is also the upload body)
 * and from demo scenarios.
 */
export interface CrowdReport {
  venueId: string;
  /** Absent = live. */
  kind?: ReportKind;
  zoneId: string | null;
  level: Level;
  /** ISO 8601; the relay floors it to the minute. */
  at: string;
  /**
   * Proof strength 0.4..1.0 as judged by the reporting phone, for a live report. Remote and past reports carry
   * the fixed KIND_WEIGHT (0.25 / 0.5), which the relay forces whatever the phone sent.
   */
  weight: number;
  noise?: NoiseReport | null;
  amenities?: Amenity[];
}

/** What the phone keeps from GET /api/crowd (the crowd cache): recent reports per venue of the student's area. */
export interface CrowdSnapshot {
  /** Device time of the download, never the demo clock. */
  fetchedAt: string;
  reports: Record<string, CrowdReport[]>;
  /** false when the relay has no store configured (reports live only in the Metro process). */
  configured: boolean;
  /** The relay's store as it reported it; null when it did not say. */
  storage: 'memory' | 'redis' | null;
}

/** Day type of the learned baseline: 'wk' Monday–Friday, 'sa' Saturday, 'su' Sunday (curve.ts dayTypeOf, shared with the relay). */
export type DayType = 'wk' | 'sa' | 'su';

/** One learned-baseline bucket: how many reports, over how many distinct days, and their weighted mean occupancy. */
export interface PatternBucket {
  n: number;
  days: number;
  /** On the 0..1 scale of the level mid-points; null when empty. Used only once n ≥ 5 and days ≥ 3 (curve.ts PATTERN_MIN). */
  pct: number | null;
}

/** 24 buckets for weekdays, Saturdays and Sundays. Index = NJ local hour. */
export interface VenuePattern {
  wk: PatternBucket[];
  sa: PatternBucket[];
  su: PatternBucket[];
}

/** What the phone keeps from GET /api/pattern (the pattern cache, refreshed at most every 6 hours). */
export interface PatternSnapshot {
  /** Device time of the download, never the demo clock. */
  fetchedAt: string;
  /** The "YYYY-MM" months the relay merged (the three most recent). */
  months: string[];
  /** By venue id; a venue the relay left out stays on the estimate. */
  patterns: Record<string, VenuePattern>;
}

/** Fused, publishable level for one venue right now (or for one zone, via fuseZones). Built by levels.ts fuse(). */
export interface LiveLevel {
  venueId: string;
  level: Level;
  /** Upper end of the published range. Equal to `level` when the band is one level wide. */
  levelHigh: Level;
  /** The fused 0..1 share that `level` is bucketed from; only the Why screen prints it ("% of a busy day"). */
  pct: number;
  confidence: Confidence;
  /**
   * Number of reports that went into the fusion (own, relay and demo alike); remote ones only when no one at the spot
   * has reported, earlier-visit (`past`) ones never.
   */
  reports: number;
  /** Reports within the "fresh" window — the ones a high-confidence verdict rests on. */
  fresh: number;
  /** Time of the newest report used, for the honesty line; null with no report. */
  newestAt: string | null;
  /** What filled the gaps: the per-kind estimate, a venue-declared curve, the learned student pattern, or nothing (closed). */
  prior: 'estimate' | 'venue' | 'reports' | null;
  /** Reports from students not at the spot that were used; they count only while no live report exists. */
  remote: number;
  /** True when the venue is open at the moment of computation. */
  open: boolean;
}

/** Focus-timer presets: 25/5 × 4, 50/10 × 3, 90/15 × 2, or 'free' (one open-ended block). */
export type TimerShapeId = 'p25' | 'p50' | 'p90' | 'free';

/** A focus-timer preset (timer.ts TIMER_SHAPES): `blocks` focus blocks of `focusMin` minutes with `breakMin`-minute breaks between them. */
export interface TimerShape {
  id: TimerShapeId;
  /** e.g. "25 / 5 × 4"; the free shape's label is translated at display (timer.ts shapeLabel). */
  label: string;
  focusMin: number;
  breakMin: number;
  blocks: number;
}

/** A goal declared for a focus session; done ones feed the goal rate on Your week. */
export interface Goal {
  goalId: string;
  text: string;
  done: boolean;
}

/**
 * A focus session: a one-person study table. Server-authoritative in spirit — absolute timestamps, never a ticking counter.
 * The running session is kept in local storage, so a killed app rejoins the right block (timer.ts blockAt).
 */
export interface Session {
  sessionId: string;
  /** Where the student studies; null = "Somewhere else" (not a listed spot). */
  venueId: string | null;
  zoneId: string | null;
  shapeId: TimerShapeId;
  startedAt: string;
  /** Set while paused; null while running. */
  pausedAt: string | null;
  /** Total milliseconds spent paused before `pausedAt`. */
  pausedMs: number;
  endedAt: string | null;
  goals: Goal[];
  /** The check-in this session was started from ("post and start a session here"), else null. */
  checkInId: string | null;
  isDemo?: boolean;
}

/** One finished session in the focus log (newest first). Feeds Your week: streak, focused time, goal rate, focus by hour and by place. Never uploaded. */
export interface FocusEntry {
  sessionId: string;
  venueId: string | null;
  shapeId: TimerShapeId;
  startedAt: string;
  endedAt: string;
  /** Time in focus blocks only (breaks and pauses excluded), capped at the plan; a free session counts all its active time. */
  focusSeconds: number;
  goalsDone: number;
  goalsTotal: number;
  isDemo?: boolean;
}

/** A recurring free block in the student's week, entered by hand. Minutes from local midnight. */
export interface FreeBlock {
  blockId: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  startMin: number;
  endMin: number;
}

/** The student's own choices from onboarding and Preferences. Stored on the phone only; they steer the ranking. */
export interface Prefs {
  area: Area;
  /** Walking origin when there is no GPS fix in the area; null or unknown falls back to the area's default station. */
  homeStationId: string | null;
  /** Preferred zone noise; the ranking's noise term matches the venue's zones against it. */
  noisePref: NoisePolicy;
  /** Outlets wanted: scored in the ranking's amenity term (ranking.ts amenityFit), not a filter. */
  needOutlets: boolean;
  /** Step-free access wanted: scored in the same amenity term, not a filter; only venues confirmed step-free count as meeting it. */
  stepFree: boolean;
  blocks: FreeBlock[];
  /** ISO 8601 timestamp of the last save, on the app clock (device time unless a demo scenario shifts it). */
  updatedAt: string;
}

/**
 * A watched spot: after a refresh, a local notification fires when its fused level is at or below `notifyAtOrBelow`
 * while it is open and rests on a report from someone at the spot (refresh.ts watchHits); at most one per venue per hour.
 */
export interface Watch {
  venueId: string;
  /** Notify when the fused level is at or below this. */
  notifyAtOrBelow: Level;
  createdAt: string;
}

/** Demo scenario for judging/video. 'live' = real data only. The clock time each one shows is in services/demo.ts. */
export type DemoScenario = 'live' | 'finals' | 'quiet' | 'late';

/** App-wide switches, set on the Offline data screen (sharing also on the check-in and privacy screens). Stored, except the clock offset. */
export interface Settings {
  demoScenario: DemoScenario;
  /**
   * Simulate offline regardless of the real network state (demo only): the app shows the OFFLINE banner and every
   * network call is skipped (isOfflineNow).
   */
  simulateOffline: boolean;
  /** Master switch for local notifications: focus block changes and watched spots. */
  notificationsEnabled: boolean;
  /** Send anonymous venue-level check-ins to the relay so other students see them. */
  shareCheckIns: boolean;
  /**
   * Milliseconds added to the device clock by a demo scenario (0 = real time). Never stored: it is recomputed from
   * the scenario at boot, because it is relative to today.
   */
  demoClockOffsetMs: number;
}

/** One GPS reading, held in memory only (never stored, never uploaded): it measures presence at a spot, picks the walking origin and places the map's dot. */
export interface LocationFix {
  lat: number;
  lng: number;
  accuracyM: number | null;
  /** Epoch ms, device time of the fix: compare it with Date.now(), never the demo clock. */
  at: number;
}

/**
 * Data sets tracked in CacheMeta: 'venues' (directory feed), 'crowd' (relay reports) and 'pattern' (learned
 * baseline) are stamped on each download; 'maps' ships in the bundle and is never downloaded.
 */
export type AssetKey = 'venues' | 'crowd' | 'maps' | 'pattern';

/** What the app gave up when the phone ran out of space (never silently). */
export type DroppedItem = 'pattern-cache' | 'crowd-cache' | 'old-checkins';
/**
 * What the storage guard gave up when space ran out (a write failed, or free space was low before a refresh).
 * Kept in storage and shown on the Offline data screen until dismissed.
 */
export interface StorageNotice {
  at: string;
  dropped: DroppedItem[];
  /** Free space at the time, null when the platform cannot tell. */
  freeBytes: number | null;
  /** False when a write still failed after dropping ("Storage is full"); true otherwise ("almost full"). */
  recovered: boolean;
}

/** Every cached blob carries a time stamp. A cache entry without one is a bug. */
export interface CacheMeta {
  key: AssetKey;
  /** Device time of the download. */
  fetchedAt: string | null;
  source: 'bundle' | 'network';
  bytes: number;
  /** What was downloaded: the directory's version, the relay's storage kind, or the pattern's months. */
  version: string;
}

/** Cache metadata by asset; a missing key = never downloaded, or dropped by the storage guard. */
export type CacheMetaMap = Partial<Record<AssetKey, CacheMeta>>;
