/**
 * Crowd level, fusion and confidence — the ONLY place a level number comes from. No AI.
 *
 * Five published levels, one confidence badge, and a hard rule against false precision:
 * one weak report never prints a percentage, and when the band is wider than one level the
 * app shows a range ("Filling to Packed"). Weights live in one table (FUSION), apart from the
 * logic, so they can be re-fit later against ground truth (door counters) once a venue has them.
 *
 * How it fits: store/derived.ts turns the student's own check-ins into reports (toReport), merges
 * them with relay and demo reports (dedupeReports) and calls fuse() for every venue on each clock
 * tick. refresh.watchHits (also run by the background poll) fuses relay reports alone to decide
 * watch notifications, and ranking.ts asks predictAt() for the level at arrival. The relay route
 * reuses KIND_WEIGHT and LEVEL_MID, so phone and server weigh a report the same way.
 * Pure functions: no storage, network or React; strings come from the i18n dictionary.
 */
import { t, tn } from '@/i18n';

import type { TermPhase } from './curve';
import { learnedBucket, typicalPct } from './curve';
import { isOpenAt } from './hours';
import { isWeekend, toEpoch } from './time';
import type { Amenity, CheckIn, Confidence, CrowdReport, Level, LiveLevel, NoiseReport, ReportKind, Venue, VenuePattern } from './types';

/** Display metadata for one level: the traffic-light tone its bars and label are drawn in. */
export interface LevelMeta {
  level: Level;
  tone: 'green' | 'amber' | 'red';
}

/** Indexed by level: Empty and Chill are green, Filling amber, Packed and Full red (read by ui/level-widgets `levelTone`). */
export const LEVELS: readonly LevelMeta[] = [
  { level: 0, tone: 'green' },
  { level: 1, tone: 'green' },
  { level: 2, tone: 'amber' },
  { level: 3, tone: 'red' },
  { level: 4, tone: 'red' },
] as const;

/** The five levels in order, for the level rows of the check-in and earlier-visit forms. */
export const ALL_LEVELS: readonly Level[] = [0, 1, 2, 3, 4];

/** "Packed" — in the current language. */
export const levelLabel = (l: Level) => t(`level.${l}` as const);
/** What a level means for a student, e.g. "you'll be hunting": shown under the level hero and on the report forms' level rows. */
export const levelBlurb = (l: Level) => t(`level.blurb.${l}` as const);
/** A student's noise report (0 silent … 3 loud) as words, e.g. "low murmur", for the spot page's "reported" line. */
export const noiseLabel = (n: NoiseReport) => t(`noise.${n}` as const);

/**
 * A report whose phone was close enough to be sure it was there (proofStrength ≥ 0.65: within 300 m once GPS
 * accuracy is allowed for). A single weaker report never publishes above "low"; it takes two recent ones to reach "medium".
 */
export const STRONG_PROOF = 0.65;

/** Upper bounds of each bucket (share of capacity), exclusive: below 0.2 is Empty … 0.9 and above is Full. Printed on the Why screen. */
export const LEVEL_BOUNDS = [0.2, 0.45, 0.7, 0.9] as const;
/**
 * Mid-point a reported level stands for when fused with other sources. The relay aggregates the same
 * mid-points into the learned baseline, so a learned hour sits on the same 0..1 scale as a fused share.
 */
export const LEVEL_MID: Record<Level, number> = { 0: 0.1, 1: 0.325, 2: 0.575, 3: 0.8, 4: 0.95 };

/** The published level for a 0..1 share of capacity (fused or predicted), cut at LEVEL_BOUNDS. */
export function bucket(pct: number): Level {
  if (pct < LEVEL_BOUNDS[0]) return 0;
  if (pct < LEVEL_BOUNDS[1]) return 1;
  if (pct < LEVEL_BOUNDS[2]) return 2;
  if (pct < LEVEL_BOUNDS[3]) return 3;
  return 4;
}

/** Type guard for untrusted input: relay JSON read by the phone (crowdClient) and stored rows read by the server (crowdStore). */
export function isLevel(v: unknown): v is Level {
  return v === 0 || v === 1 || v === 2 || v === 3 || v === 4;
}

/** Fusion parameters in one table, so a re-fit against ground truth changes numbers here, not the fusion logic. The Why screen prints them. */
export const FUSION = {
  /** Base weight of one student report (spec: 0.45 of a fully-instrumented venue). */
  reportBase: 0.45,
  /** Base weight of the typical-pattern prior (spec: 0.03). */
  priorBase: 0.03,
  /** Recency half-life in minutes. Weekends change slower. */
  halfLifeWeekdayMin: 25,
  halfLifeWeekendMin: 40,
  /** Reports older than this are ignored entirely. */
  maxAgeMin: 180,
  /**
   * Confidence windows (minutes). freshMin: "high" needs two agreeing reports this new. recentMin: "medium" needs
   * one strong or two reports this new. staleMin: zone rows and the "reported" details ignore anything older.
   */
  freshMin: 20,
  recentMin: 45,
  staleMin: 90,
} as const;

/**
 * Proof strength from distance to the venue: at the door = 1.0, far away or unknown = 0.4.
 * The GPS accuracy radius is subtracted first (benefit of the doubt), then 75 / 150 / 300 m give 1.0 / 0.85 / 0.65.
 * It becomes a live report's weight (toReport); the check-in screen labels 0.85 and up "verified".
 */
export function proofStrength(distanceM: number | null, gpsAccuracyM: number | null): number {
  if (distanceM === null) return 0.4;
  const slack = Math.max(0, gpsAccuracyM ?? 0);
  const d = Math.max(0, distanceM - slack);
  if (d <= 75) return 1.0;
  if (d <= 150) return 0.85;
  if (d <= 300) return 0.65;
  return 0.4;
}

/** Weights of reports without presence proof (remote = now but not at the spot, past = an earlier visit); the relay forces the same values. */
export const KIND_WEIGHT = { remote: 0.25, past: 0.5 } as const;

/**
 * The anonymous part of a check-in, with the weight the relay will store: proof strength for a live report,
 * KIND_WEIGHT otherwise. The note and the GPS distance stay on the phone. Used to post the report
 * (crowdClient.postReport) and to fuse the student's own check-ins (store/derived.ts).
 */
export function toReport(c: CheckIn): CrowdReport {
  return { venueId: c.venueId, kind: c.kind, zoneId: c.zoneId, level: c.level, at: c.at, weight: c.kind === 'live' ? proofStrength(c.proof.distanceM, c.proof.gpsAccuracyM) : KIND_WEIGHT[c.kind], noise: c.noise, amenities: c.amenities };
}

/** How much a report of this age still counts: ½^(age ÷ half-life), 25 min on weekdays and 40 on weekends. A future-stamped report counts fully. */
export function recencyDecay(ageMin: number, weekend: boolean): number {
  const hl = weekend ? FUSION.halfLifeWeekendMin : FUSION.halfLifeWeekdayMin;
  return Math.pow(0.5, Math.max(0, ageMin) / hl);
}

/** Input to fuse() and fuseZones() for one venue. */
export interface FusionInput {
  venue: Venue;
  /** Every report that may count for this venue, already de-duplicated; past reports are skipped inside. */
  reports: readonly CrowdReport[];
  /** The clock report ages and the typical hour are read against: the app clock (device time + demo offset), or device time in the background watch poll. */
  now: number;
  /** Term phase; it scales the estimate, never a learned hour. */
  phase?: TermPhase;
  /** The learned student pattern for this venue, when the phone has one. */
  pattern?: VenuePattern | null;
}

/**
 * Fuse live reports with the typical-pattern prior into one publishable level.
 *
 *  pct        = (0.03 × prior + Σ w_r × LEVEL_MID[level_r]) / (0.03 + Σ w_r),
 *               w_r = 0.45 × weight_r × ½^(age_r ÷ half-life), weight_r = proof strength (0.25 when remote),
 *               over reports at most 3 h old and at most 5 min ahead (the relay's own window)
 *  confidence = how many fresh, agreeing, independent reports exist
 *  range      = widened when confidence is low or reports disagree
 *
 * Past reports never enter. Remote ones count only while nobody at the spot has reported, and never lift
 * confidence above "low". `prior` names what filled the gaps (learned hour, venue curve or estimate; null
 * when closed). A closed venue still gets a level, but `open: false` tells the screens to show it as closed.
 */
export function fuse({ venue, reports, now, phase = 'regular', pattern = null }: FusionInput): LiveLevel {
  const open = isOpenAt(venue, now);
  const weekend = isWeekend(now);
  const prior = typicalPct(venue, now, phase, pattern);

  // One usable report: level, age in minutes, fusion weight, proof strength, and whether it was made away from the spot.
  type R = { level: Level; ageMin: number; w: number; proof: number; remote: boolean };
  const all: R[] = [];
  for (const r of reports) {
    if (r.kind === 'past') continue;
    const t = toEpoch(r.at);
    if (!Number.isFinite(t) || t > now + 5 * 60_000) continue;
    const ageMin = (now - t) / 60_000;
    if (ageMin > FUSION.maxAgeMin) continue;
    all.push({ level: r.level, ageMin, w: FUSION.reportBase * r.weight * recencyDecay(ageMin, weekend), proof: r.weight, remote: r.kind === 'remote' });
  }
  // Newest first, so live[0] dates the honesty line ("newest 3 min ago").
  all.sort((a, b) => a.ageMin - b.ageMin);
  // Reports from students who are not at the spot count only while nobody at the spot has reported.
  const live = all.some((r) => !r.remote) ? all.filter((r) => !r.remote) : all;
  const remote = live.filter((r) => r.remote).length;

  let num = FUSION.priorBase * prior;
  let den = FUSION.priorBase;
  for (const r of live) {
    num += r.w * LEVEL_MID[r.level];
    den += r.w;
  }
  const pct = den > 0 ? num / den : prior;
  const level = bucket(pct);

  // Confidence rests on presence: remote reports never make a level "high" or "medium".
  const fresh = live.filter((r) => !r.remote && r.ageMin <= FUSION.freshMin);
  const recent = live.filter((r) => !r.remote && r.ageMin <= FUSION.recentMin);
  const strongRecent = recent.filter((r) => r.proof >= STRONG_PROOF);
  // The reported levels of a group, for the agreement test and the range below.
  const levelsOf = (rs: R[]) => rs.map((r) => r.level);
  // How many levels apart a group's reports are: 0 = identical, ≤ 1 counts as agreeing.
  const spread = (rs: R[]) => (rs.length ? Math.max(...levelsOf(rs)) - Math.min(...levelsOf(rs)) : 0);

  // high: two fresh reports that agree (within one level) · medium: one recent report with real presence proof, or two of any strength
  // low: anything else still inside the 3-hour window, remote-only evidence included (shown as "unverified" or "not at the spot")
  // none: no usable report at all, so the prior alone sets the level
  let confidence: Confidence;
  if (fresh.length >= 2 && spread(fresh) <= 1) confidence = 'high';
  else if (strongRecent.length >= 1 || recent.length >= 2) confidence = 'medium';
  else if (live.length >= 1) confidence = 'low';
  else confidence = 'none';

  // Range: one level when confident; up to the highest recent report when recent reports disagree;
  // the prior's natural uncertainty (+20% and 5 points, upward only) when confidence is low or none.
  let levelHigh: Level = level;
  if (confidence === 'medium' && recent.length >= 2 && spread(recent) > 1) {
    const hi = Math.max(...levelsOf(recent)) as Level;
    levelHigh = hi > level ? hi : level;
  } else if (confidence === 'low' || confidence === 'none') {
    const hi = bucket(Math.min(1, pct * 1.2 + 0.05));
    levelHigh = hi > level ? hi : level;
  }

  const newest = live[0] ? new Date(now - live[0].ageMin * 60_000).toISOString() : null;
  return {
    venueId: venue.venueId,
    level,
    levelHigh,
    pct,
    confidence,
    reports: live.length,
    fresh: fresh.length,
    newestAt: newest,
    prior: open ? (learnedBucket(pattern, now) ? 'reports' : venue.curveSource) : null,
    remote,
    open,
  };
}

/** "Filling" or "Filling to Packed", for a fused level or a predictAt() result. Never a bare percentage. */
export function levelText(l: Pick<LiveLevel, 'level' | 'levelHigh'>): string {
  return l.levelHigh > l.level ? t('level.range', { low: levelLabel(l.level), high: levelLabel(l.levelHigh) }) : levelLabel(l.level);
}

/**
 * The honesty line under a level: where it came from and how old it is. "2 reports agree · newest 3 min ago" (high),
 * "1 report, 5 min ago" (medium), "… · unverified" or "… · not at the spot" (low); with no report it names what the
 * typical value came from (student reports, the venue's curve, or the estimate); "Closed now" when closed.
 * `now` should be the clock the level was fused with.
 */
export function confidenceText(l: LiveLevel, now: number): string {
  if (!l.open) return t('level.closedNow');
  const age = l.newestAt ? Math.max(0, Math.round((now - toEpoch(l.newestAt)) / 60_000)) : null;
  const ago = age === null ? '' : age < 1 ? t('time.justNow') : age < 60 ? t('time.minAgo', { n: age }) : tn(Math.floor(age / 60), 'time.hoursAgo');
  switch (l.confidence) {
    case 'high':
      // Only the fresh reports were tested for agreement, so that is the number to print.
      return t('level.high', { n: l.fresh, ago });
    case 'medium':
      return tn(l.reports, 'level.medium', { ago });
    case 'low':
      return tn(l.reports, l.remote > 0 ? 'level.lowRemote' : 'level.low', { ago });
    default:
      return l.prior === 'reports' ? t('level.noneLearned') : l.prior === 'venue' ? t('level.noneVenue') : t('level.noneTypical');
  }
}

/**
 * Merge own reports with relay reports, dropping relay rows that are the phone's own check-in coming back
 * (same spot, zone and level within 90 s — the relay floors times to the minute). Without this one student
 * could read as "2 reports agree". The store passes demo reports on the relay side too.
 */
export function dedupeReports(own: readonly CrowdReport[], relay: readonly CrowdReport[]): CrowdReport[] {
  const out: CrowdReport[] = [...own];
  for (const r of relay) {
    const t = toEpoch(r.at);
    const dup = own.some((o) => o.venueId === r.venueId && (o.zoneId ?? null) === (r.zoneId ?? null) && o.level === r.level && Math.abs(toEpoch(o.at) - t) < 90_000);
    if (!dup) out.push(r);
  }
  return out;
}

/** Minutes from an ISO time to `now`: negative for a future stamp, NaN for an unparseable one. */
const ageMinutes = (at: string, now: number) => (now - toEpoch(at)) / 60_000;

/**
 * Per-zone levels for the zones that have at least one report in the last 90 minutes ("4F silent is full, 2F is chill").
 * Each zone is fused from its own reports with the venue's prior; zones without a recent report are left out and
 * past reports never make a zone row. Shown on the spot page.
 */
export function fuseZones({ venue, reports, now, phase = 'regular', pattern = null }: FusionInput): Record<string, LiveLevel> {
  const out: Record<string, LiveLevel> = {};
  for (const z of venue.zones) {
    const zr = reports.filter((r) => r.kind !== 'past' && r.zoneId === z.zoneId && ageMinutes(r.at, now) <= FUSION.staleMin);
    if (zr.length === 0) continue;
    out[z.zoneId] = fuse({ venue, reports: zr, now, phase, pattern });
  }
  return out;
}

/** What the spot page's "reported" line shows: the newest report's noise and amenities, its time, and its kind (remote adds "not at the spot"). */
export interface ReportDetails {
  noise: NoiseReport | null;
  amenities: Amenity[];
  at: string;
  kind: ReportKind;
}

/** The newest recent report (at most 90 min old, not future-stamped, not an earlier visit) that said anything about noise or what was available; null when none did. */
export function latestReportDetails(reports: readonly CrowdReport[], now: number): ReportDetails | null {
  let best: CrowdReport | null = null;
  for (const r of reports) {
    if (r.kind === 'past') continue;
    const age = ageMinutes(r.at, now);
    if (age < 0 || age > FUSION.staleMin) continue;
    if (r.noise === null || r.noise === undefined) {
      if (!r.amenities || r.amenities.length === 0) continue;
    }
    if (!best || toEpoch(r.at) > toEpoch(best.at)) best = r;
  }
  return best ? { noise: best.noise ?? null, amenities: best.amenities ?? [], at: best.at, kind: best.kind ?? 'live' } : null;
}

/**
 * Predicted level at a future instant: live level drifts back to the typical curve as the arrival time moves away.
 * pct = typical(at) + (live.pct − typical(now)) × ½^(minutes ahead ÷ 45); with no live report it is simply the
 * typical value at arrival. The range always gets a little headroom (×1.15 + 3 points). Closed at `at` →
 * open: false, with the typical bucket as level and range. Used by ranking for "level when you arrive".
 */
export function predictAt(venue: Venue, live: LiveLevel, at: number, now: number, phase: TermPhase = 'regular', pattern: VenuePattern | null = null): { level: Level; levelHigh: Level; open: boolean } {
  const open = isOpenAt(venue, at);
  const target = typicalPct(venue, at, phase, pattern);
  if (!open) return { level: bucket(target), levelHigh: bucket(target), open: false };
  const horizonMin = Math.max(0, (at - now) / 60_000);
  // Weight of "now" fades with a 45-minute half-life; with no live reports it is 0.
  const liveWeight = live.confidence === 'none' ? 0 : Math.pow(0.5, horizonMin / 45);
  const base = typicalPct(venue, now, phase, pattern);
  const delta = live.pct - base; // how far today differs from a typical day right now
  const pct = Math.min(1, Math.max(0, target + delta * liveWeight));
  const level = bucket(pct);
  const hi = bucket(Math.min(1, pct * 1.15 + 0.03));
  return { level, levelHigh: hi > level ? hi : level, open: true };
}
