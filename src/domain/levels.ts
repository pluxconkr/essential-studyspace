/**
 * Crowd level, fusion and confidence — the ONLY place a level number comes from. No AI.
 *
 * Five published levels, one confidence badge, and a hard rule against false precision:
 * one weak report never prints a percentage, and when the band is wider than one level the
 * app shows a range ("Filling to Packed"). Weights are config, not code, and re-fit later
 * against ground truth (door counters) once a venue has them.
 */
import type { TermPhase } from './curve';
import { typicalPct } from './curve';
import { isOpenAt } from './hours';
import { isWeekend, toEpoch } from './time';
import type { Confidence, CrowdReport, Level, LiveLevel, Venue } from './types';

export interface LevelMeta {
  level: Level;
  label: string;
  blurb: string;
  tone: 'green' | 'amber' | 'red';
}

export const LEVELS: readonly LevelMeta[] = [
  { level: 0, label: 'Empty', blurb: 'plenty of seats', tone: 'green' },
  { level: 1, label: 'Chill', blurb: 'easy to find a seat', tone: 'green' },
  { level: 2, label: 'Filling', blurb: 'some seats, maybe not your favourite', tone: 'amber' },
  { level: 3, label: 'Packed', blurb: "you'll be hunting", tone: 'red' },
  { level: 4, label: 'Full', blurb: 'expect to wait or share', tone: 'red' },
] as const;

export const LEVEL_LABEL: Record<Level, string> = { 0: 'Empty', 1: 'Chill', 2: 'Filling', 3: 'Packed', 4: 'Full' };

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

export function recencyDecay(ageMin: number, weekend: boolean): number {
  const hl = weekend ? FUSION.halfLifeWeekendMin : FUSION.halfLifeWeekdayMin;
  return Math.pow(0.5, Math.max(0, ageMin) / hl);
}

export interface FusionInput {
  venue: Venue;
  reports: readonly CrowdReport[];
  now: number;
  phase?: TermPhase;
}

/**
 * Fuse live reports with the typical-pattern prior into one publishable level.
 *
 *  pct        = Σ(w_s × est_s) / Σ(w_s) over live sources (reports decay with age) + the prior
 *  confidence = how many fresh, agreeing, independent reports exist
 *  range      = widened when confidence is low or reports disagree
 */
export function fuse({ venue, reports, now, phase = 'regular' }: FusionInput): LiveLevel {
  const open = isOpenAt(venue, now);
  const weekend = isWeekend(now);
  const prior = typicalPct(venue, now, phase);

  type R = { level: Level; ageMin: number; w: number };
  const live: R[] = [];
  for (const r of reports) {
    const t = toEpoch(r.at);
    if (!Number.isFinite(t) || t > now + 5 * 60_000) continue;
    const ageMin = (now - t) / 60_000;
    if (ageMin > FUSION.maxAgeMin) continue;
    live.push({ level: r.level, ageMin, w: FUSION.reportBase * r.weight * recencyDecay(ageMin, weekend) });
  }
  live.sort((a, b) => a.ageMin - b.ageMin);

  let num = FUSION.priorBase * prior;
  let den = FUSION.priorBase;
  for (const r of live) {
    num += r.w * LEVEL_MID[r.level];
    den += r.w;
  }
  const pct = den > 0 ? num / den : prior;
  const level = bucket(pct);

  const fresh = live.filter((r) => r.ageMin <= FUSION.freshMin);
  const recent = live.filter((r) => r.ageMin <= FUSION.recentMin);
  const stale = live.filter((r) => r.ageMin <= FUSION.staleMin);
  const levelsOf = (rs: R[]) => rs.map((r) => r.level);
  const spread = (rs: R[]) => (rs.length ? Math.max(...levelsOf(rs)) - Math.min(...levelsOf(rs)) : 0);

  let confidence: Confidence;
  if (fresh.length >= 2 && spread(fresh) <= 1) confidence = 'high';
  else if (recent.length >= 1) confidence = 'medium';
  else if (stale.length >= 1) confidence = 'low';
  else confidence = 'none';

  // Range: one level when confident; the spread of recent reports when they disagree;
  // the prior's natural uncertainty (±20%) when nothing live exists.
  let levelHigh: Level = level;
  if (confidence === 'high') levelHigh = level;
  else if (confidence === 'medium' && recent.length >= 2 && spread(recent) > 1) {
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
    newestAt: newest,
    prior: open ? venue.curveSource : null,
    open,
  };
}

/** "Filling" or "Filling to Packed". Never a bare percentage. */
export function levelText(l: Pick<LiveLevel, 'level' | 'levelHigh'>): string {
  return l.levelHigh > l.level ? `${LEVEL_LABEL[l.level]} to ${LEVEL_LABEL[l.levelHigh]}` : LEVEL_LABEL[l.level];
}

/** The honesty line under a level: where it came from and how old it is. */
export function confidenceText(l: LiveLevel, now: number): string {
  if (!l.open) return 'Closed now';
  const age = l.newestAt ? Math.max(0, Math.round((now - toEpoch(l.newestAt)) / 60_000)) : null;
  const ageTxt = age === null ? '' : age < 1 ? 'just now' : `${age} min ago`;
  switch (l.confidence) {
    case 'high':
      return `${l.reports} reports agree · newest ${ageTxt}`;
    case 'medium':
      return l.reports === 1 ? `1 report, ${ageTxt}` : `${l.reports} reports · newest ${ageTxt}`;
    case 'low':
      return `${l.reports === 1 ? '1 report' : `${l.reports} reports`}, ${ageTxt} · unverified`;
    default:
      return l.prior === 'venue' ? 'Venue estimate · no live reports' : 'Typical pattern · no live reports';
  }
}

/** Predicted level at a future instant: live level drifts back to the typical curve as the arrival time moves away. */
export function predictAt(venue: Venue, live: LiveLevel, at: number, now: number, phase: TermPhase = 'regular'): { level: Level; levelHigh: Level; open: boolean } {
  const open = isOpenAt(venue, at);
  const target = typicalPct(venue, at, phase);
  if (!open) return { level: bucket(target), levelHigh: bucket(target), open: false };
  const horizonMin = Math.max(0, (at - now) / 60_000);
  // Weight of "now" fades with a 45-minute half-life; with no live reports it is 0.
  const liveWeight = live.confidence === 'none' ? 0 : Math.pow(0.5, horizonMin / 45);
  const base = typicalPct(venue, now, phase);
  const delta = live.pct - base; // how far today differs from a typical day right now
  const pct = Math.min(1, Math.max(0, target + delta * liveWeight));
  const level = bucket(pct);
  const hi = bucket(Math.min(1, pct * 1.15 + 0.03));
  return { level, levelHigh: hi > level ? hi : level, open: true };
}
