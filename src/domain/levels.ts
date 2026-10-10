/**
 * Crowd level, fusion and confidence — the ONLY place a level number comes from. No AI.
 *
 * Five published levels, one confidence badge, and a hard rule against false precision:
 * one weak report never prints a percentage, and when the band is wider than one level the
 * app shows a range ("Filling to Packed"). Weights are config, not code, and re-fit later
 * against ground truth (door counters) once a venue has them.
 */
import { t, tn } from '@/i18n';

import type { TermPhase } from './curve';
import { learnedBucket, typicalPct } from './curve';
import { isOpenAt } from './hours';
import { isWeekend, toEpoch } from './time';
import type { Amenity, CheckIn, Confidence, CrowdReport, Level, LiveLevel, NoiseReport, ReportKind, Venue, VenuePattern } from './types';

export interface LevelMeta {
  level: Level;
  tone: 'green' | 'amber' | 'red';
}

export const LEVELS: readonly LevelMeta[] = [
  { level: 0, tone: 'green' },
  { level: 1, tone: 'green' },
  { level: 2, tone: 'amber' },
  { level: 3, tone: 'red' },
  { level: 4, tone: 'red' },
] as const;

export const ALL_LEVELS: readonly Level[] = [0, 1, 2, 3, 4];

/** "Packed" — in the current language. */
export const levelLabel = (l: Level) => t(`level.${l}` as const);
/** "you'll be hunting" */
export const levelBlurb = (l: Level) => t(`level.blurb.${l}` as const);
/** "low murmur" */
export const noiseLabel = (n: NoiseReport) => t(`noise.${n}` as const);

/** A report whose phone was close enough to be sure it was there. Weaker ones never publish above "low" on their own. */
export const STRONG_PROOF = 0.65;

/** Upper bounds of each bucket (share of capacity). */
export const LEVEL_BOUNDS = [0.2, 0.45, 0.7, 0.9] as const;
/** Mid-point a reported level stands for when fused with other sources. */
export const LEVEL_MID: Record<Level, number> = { 0: 0.1, 1: 0.325, 2: 0.575, 3: 0.8, 4: 0.95 };

export function bucket(pct: number): Level {
  if (pct < LEVEL_BOUNDS[0]) return 0;
  if (pct < LEVEL_BOUNDS[1]) return 1;
  if (pct < LEVEL_BOUNDS[2]) return 2;
  if (pct < LEVEL_BOUNDS[3]) return 3;
  return 4;
}

export function isLevel(v: unknown): v is Level {
  return v === 0 || v === 1 || v === 2 || v === 3 || v === 4;
}

/** Fusion configuration — shipped as config so a venue can be re-fit without a code change. */
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
  /** Confidence windows (minutes). */
  freshMin: 20,
  recentMin: 45,
  staleMin: 90,
} as const;

/** Proof strength from distance to the venue: at the door = 1.0, far away or unknown = 0.4. */
export function proofStrength(distanceM: number | null, gpsAccuracyM: number | null): number {
  if (distanceM === null) return 0.4;
  const slack = Math.max(0, gpsAccuracyM ?? 0);
  const d = Math.max(0, distanceM - slack);
  if (d <= 75) return 1.0;
  if (d <= 150) return 0.85;
  if (d <= 300) return 0.65;
  return 0.4;
}

/** Weights of reports without presence proof; the relay forces the same values. */
export const KIND_WEIGHT = { remote: 0.25, past: 0.5 } as const;

/** The anonymous part of a check-in, with the weight the relay will store. */
export function toReport(c: CheckIn): CrowdReport {
  return { venueId: c.venueId, kind: c.kind, zoneId: c.zoneId, level: c.level, at: c.at, weight: c.kind === 'live' ? proofStrength(c.proof.distanceM, c.proof.gpsAccuracyM) : KIND_WEIGHT[c.kind], noise: c.noise, amenities: c.amenities };
}

export function recencyDecay(ageMin: number, weekend: boolean): number {
  const hl = weekend ? FUSION.halfLifeWeekendMin : FUSION.halfLifeWeekdayMin;
  return Math.pow(0.5, Math.max(0, ageMin) / hl);
}

export interface FusionInput {
  venue: Venue;
  reports: readonly CrowdReport[];
  now: number;
  phase?: TermPhase;
  /** The learned student pattern for this venue, when the phone has one. */
  pattern?: VenuePattern | null;
}

/**
 * Fuse live reports with the typical-pattern prior into one publishable level.
 *
 *  pct        = Σ(w_s × est_s) / Σ(w_s) over live sources (reports decay with age) + the prior
 *  confidence = how many fresh, agreeing, independent reports exist
 *  range      = widened when confidence is low or reports disagree
 */
export function fuse({ venue, reports, now, phase = 'regular', pattern = null }: FusionInput): LiveLevel {
  const open = isOpenAt(venue, now);
  const weekend = isWeekend(now);
  const prior = typicalPct(venue, now, phase, pattern);

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
  const levelsOf = (rs: R[]) => rs.map((r) => r.level);
  const spread = (rs: R[]) => (rs.length ? Math.max(...levelsOf(rs)) - Math.min(...levelsOf(rs)) : 0);

  // high: two fresh reports that agree · medium: one recent report with real presence proof, or two of any strength
  // low: anything else still inside the 3-hour window (shown as "unverified") · none: no live report at all
  let confidence: Confidence;
  if (fresh.length >= 2 && spread(fresh) <= 1) confidence = 'high';
  else if (strongRecent.length >= 1 || recent.length >= 2) confidence = 'medium';
  else if (live.length >= 1) confidence = 'low';
  else confidence = 'none';

  // Range: one level when confident; the spread of recent reports when they disagree;
  // the prior's natural uncertainty (±20%) when nothing live exists.
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

/** "Filling" or "Filling to Packed". Never a bare percentage. */
export function levelText(l: Pick<LiveLevel, 'level' | 'levelHigh'>): string {
  return l.levelHigh > l.level ? t('level.range', { low: levelLabel(l.level), high: levelLabel(l.levelHigh) }) : levelLabel(l.level);
}

/** The honesty line under a level: where it came from and how old it is. */
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
 * (same spot, zone and level within a minute). Without this one student could read as "2 reports agree".
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

const ageMinutes = (at: string, now: number) => (now - toEpoch(at)) / 60_000;

/** Per-zone levels for the zones that have at least one report in the last 90 minutes ("4F silent is full, 2F is chill"). */
export function fuseZones({ venue, reports, now, phase = 'regular', pattern = null }: FusionInput): Record<string, LiveLevel> {
  const out: Record<string, LiveLevel> = {};
  for (const z of venue.zones) {
    const zr = reports.filter((r) => r.kind !== 'past' && r.zoneId === z.zoneId && ageMinutes(r.at, now) <= FUSION.staleMin);
    if (zr.length === 0) continue;
    out[z.zoneId] = fuse({ venue, reports: zr, now, phase, pattern });
  }
  return out;
}

export interface ReportDetails {
  noise: NoiseReport | null;
  amenities: Amenity[];
  at: string;
  kind: ReportKind;
}

/** The newest recent report that said anything about noise or what was available. */
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

/** Predicted level at a future instant: live level drifts back to the typical curve as the arrival time moves away. */
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
