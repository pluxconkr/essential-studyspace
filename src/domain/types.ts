/**
 * Domain types for StudySpace.
 *
 * Everything here is plain data that can be JSON-serialised into local storage.
 * No Expo / React Native imports — this module is shared by unit tests, the
 * client app, and the server-side crowd relay route.
 */

export type Area = 'new-brunswick' | 'newark' | 'hoboken' | 'princeton';

export type VenueKind = 'library' | 'public-library' | 'student-center' | 'cafe';

/** Noise policy of a zone. Silent is the default and the point of the product. */
export type NoisePolicy = 'silent' | 'low' | 'chatty';

/** Five published crowd levels. Students think in these, never in percentages. */
export type Level = 0 | 1 | 2 | 3 | 4;

/** How much the published level can be trusted. 'none' = typical pattern only, no live report. */
export type Confidence = 'high' | 'medium' | 'low' | 'none';

/** Who can get in. 'students-late' = public during the day, student ID after a stated hour or during finals. */
export type Access = 'public' | 'students' | 'students-late';

/** "HH:MM" 24-hour local time. `close` may exceed "24:00" (e.g. "26:00" = 2 a.m. the next day). */
export interface DayHours {
  open: string;
  close: string;
}

/** Sunday-first (JS getDay order). null = closed that day. */
export type WeekHours = [DayHours | null, DayHours | null, DayHours | null, DayHours | null, DayHours | null, DayHours | null, DayHours | null];

/** A dated override of the regular hours: renovation closures, finals 24-hour periods, holidays. */
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

export interface Zone {
  zoneId: string;
  name: string;
  floor: string;
  noise: NoisePolicy;
  /** Published seat count, or null when the venue does not publish one (most do not). */
  seats: number | null;
  outlets: 'many' | 'some' | 'few' | null;
  groupRooms?: number;
  computers?: number;
  note?: string;
  source?: string;
}

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

export interface Accessibility {
  stepFree: boolean | null;
  accessibleRestroom: boolean | null;
  adjustableDesks: boolean | null;
  note?: string;
  source?: string;
}

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
  coordConfidence: 'high' | 'medium' | 'low';
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
  /** Stations this spot is ranked from (nearest first). Walk minutes are computed, never stored. */
  stationIds: string[];
  website?: string;
  phone?: string;
  notes?: string;
  verifiedBy: string;
  lastVerified: string;
}

export type TransitMode = 'NJ Transit' | 'Amtrak' | 'PATH' | 'HBLR' | 'Newark Light Rail' | 'Princeton Dinky';

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

/** A check-in made on THIS phone. Notes never leave the phone in v1. */
export interface CheckIn {
  checkInId: string;
  venueId: string;
  zoneId: string | null;
  level: Level;
  noise: NoiseReport | null;
  amenities: Amenity[];
  note: string | null;
  /** ISO 8601 device time. */
  at: string;
  proof: {
    /** Straight-line metres from the venue at check-in time, or null when location was off. */
    distanceM: number | null;
    gpsAccuracyM: number | null;
  };
  source: 'me' | 'demo';
  /** True once the anonymous copy reached the relay (or sharing was off). */
  synced: boolean;
}

/** Anonymous report as returned by the crowd relay. No ids, no notes, minute-rounded time. */
export interface CrowdReport {
  venueId: string;
  zoneId: string | null;
  level: Level;
  at: string;
  /** Proof strength 0.4..1.0 as judged by the reporting phone. */
  weight: number;
}

export interface CrowdSnapshot {
  fetchedAt: string;
  reports: Record<string, CrowdReport[]>;
  /** false when the relay has no store configured (reports live only in the Metro process). */
  configured: boolean;
  storage: 'memory' | 'redis' | null;
}

/** Fused, publishable level for one venue right now. */
export interface LiveLevel {
  venueId: string;
  level: Level;
  /** Upper end of the published range. Equal to `level` when the band is one level wide. */
  levelHigh: Level;
  pct: number;
  confidence: Confidence;
  /** Number of live reports that contributed (own + relay). */
  reports: number;
  newestAt: string | null;
  /** What filled the gaps: the per-kind estimate, a venue-declared curve, or nothing (closed). */
  prior: 'estimate' | 'venue' | null;
  /** True when the venue is open at the moment of computation. */
  open: boolean;
}

export type TimerShapeId = 'p25' | 'p50' | 'p90' | 'free';

export interface TimerShape {
  id: TimerShapeId;
  label: string;
  focusMin: number;
  breakMin: number;
  blocks: number;
  blurb: string;
}

export interface Goal {
  goalId: string;
  text: string;
  done: boolean;
}

/** A focus session: a one-person study table. Server-authoritative in spirit — absolute timestamps, never a ticking counter. */
export interface Session {
  sessionId: string;
  venueId: string | null;
  zoneId: string | null;
  shapeId: TimerShapeId;
  startedAt: string;
  pausedAt: string | null;
  /** Total milliseconds spent paused before `pausedAt`. */
  pausedMs: number;
  endedAt: string | null;
  goals: Goal[];
  checkInId: string | null;
  isDemo?: boolean;
}

export interface FocusEntry {
  sessionId: string;
  venueId: string | null;
  shapeId: TimerShapeId;
  startedAt: string;
  endedAt: string;
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

export interface Prefs {
  area: Area;
  homeStationId: string | null;
  noisePref: NoisePolicy;
  needOutlets: boolean;
  stepFree: boolean;
  blocks: FreeBlock[];
  /** ISO 8601 timestamp of the last edit (device clock). */
  updatedAt: string;
}

export interface Watch {
  venueId: string;
  /** Notify when the fused level is at or below this. */
  notifyAtOrBelow: Level;
  createdAt: string;
}

/** Demo scenario for judging/video. 'live' = real data only. */
export type DemoScenario = 'live' | 'finals' | 'quiet' | 'late';

export interface Settings {
  demoScenario: DemoScenario;
  /** Simulate offline in the UI regardless of the real network state (demo only). */
  simulateOffline: boolean;
  notificationsEnabled: boolean;
  /** Send anonymous venue-level check-ins to the relay so other students see them. */
  shareCheckIns: boolean;
  /** Milliseconds added to the device clock by a demo scenario (0 = real time). */
  demoClockOffsetMs: number;
}

export interface LocationFix {
  lat: number;
  lng: number;
  accuracyM: number | null;
  /** Epoch ms. */
  at: number;
}

export type AssetKey = 'venues' | 'crowd' | 'maps';

/** What the app gave up when the phone ran out of space (never silently). */
export type DroppedItem = 'crowd-cache' | 'old-checkins';
export interface StorageNotice {
  at: string;
  dropped: DroppedItem[];
  freeBytes: number | null;
  recovered: boolean;
}

/** Every cached blob carries a time stamp. A cache entry without one is a bug. */
export interface CacheMeta {
  key: AssetKey;
  fetchedAt: string | null;
  source: 'bundle' | 'network';
  bytes: number;
  version: string;
}

export type CacheMetaMap = Partial<Record<AssetKey, CacheMeta>>;
