/**
 * Home ranking — "where should I go right now" in one explainable score. No AI.
 *
 *   score = 0.35 × seats at arrival + 0.25 × proximity + 0.15 × open long enough
 *         + 0.15 × noise match + 0.10 × amenities
 *
 * Every component is shown on the "Why this ranking?" screen. Closed venues are listed
 * separately with their next opening, never hidden.
 *
 * Each term is a 0..1 share. The level at arrival comes from levels.predictAt (the live level fading
 * toward the typical pattern over the walk), the walk from transit.walkMinutes and the hours from
 * hours.openState. useRanking (store/derived.ts) calls rankVenues with the fused levels on every clock
 * tick; the Now tab, the spot page, the Why screen and the Focus tab's spot choices read the result.
 * "Closed" means closed when you would arrive. Pure functions; no storage or network.
 */
import { t } from '@/i18n';

import type { TermPhase } from './curve';
import type { LatLng } from './geo';
import { openState, type OpenState } from './hours';
import { predictAt } from './levels';
import { walkMinutes } from './transit';
import type { Level, LiveLevel, Prefs, Venue, VenuePattern } from './types';

/** Weights of the five score terms (they sum to 1); the Why screen prints the formula from them. */
export const RANK_WEIGHTS = { seats: 0.35, proximity: 0.25, openFit: 0.15, noise: 0.15, amenities: 0.1 } as const;
/** Beyond this many minutes on foot a spot scores zero for proximity. */
export const MAX_WALK_MIN = 30;
/** A spot must stay open at least this long after arrival to score full marks (when no free block is active); a shorter stay adds a "closes soon" reason. */
export const MIN_STAY_MIN = 90;

/** One ranked spot: its inputs, the predicted level at arrival, the score with its five 0..1 parts, and short reasons. */
export interface RankedVenue {
  venue: Venue;
  live: LiveLevel;
  /** Open state at `now`, not at arrival; closed rows sort by its next opening. */
  state: OpenState;
  walkMin: number;
  /** Epoch ms on the app clock: now + the walk. */
  arrivalAt: number;
  arrival: { level: Level; levelHigh: Level; open: boolean };
  /** Minutes the spot stays open after arrival (null if closed at arrival). */
  stayMin: number | null;
  score: number;
  parts: { seats: number; proximity: number; openFit: number; noise: number; amenities: number };
  /** Localized one-liners such as "seats likely when you arrive" or "closes 40 min after you arrive". */
  reasons: string[];
}

/** What ranking needs besides the venues and levels; built by useRanking (store/derived.ts). */
export interface RankContext {
  /** Where walks start: the GPS fix when it is inside the area, else the home station, else the area's centre. */
  origin: LatLng;
  /** The origin's name for reasons ("8 min from New Brunswick"). */
  originLabel: string;
  prefs: Prefs;
  /** App clock (device time + demo offset). */
  now: number;
  /** End of the student's current free block, if one is active. Spots open past it rank higher. */
  gapEndsAt: number | null;
  /** Term phase for the typical pattern behind arrival predictions. */
  phase?: TermPhase;
  /** Learned student patterns by venue id, when the phone has them. */
  patterns?: Record<string, VenuePattern>;
}

/** Keep a score part inside 0..1. */
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * How well the venue's zone noise policies suit the student's preference, 0..1: 1 when a zone has exactly the
 * preferred policy, partial credit by how close the nearest policy is (silent ↔ low ↔ chatty), 0.5 when no zones are listed.
 */
export function noiseFit(venue: Venue, pref: Prefs['noisePref']): number {
  const zones = venue.zones.map((z) => z.noise);
  if (zones.length === 0) return 0.5;
  if (zones.includes(pref)) return 1;
  if (pref === 'silent') return zones.includes('low') ? 0.6 : 0.2;
  if (pref === 'low') return zones.includes('silent') ? 0.8 : 0.5;
  return zones.includes('low') ? 0.6 : 0.3;
}

/** Share of the student's must-haves (outlets, step-free access) the venue meets; a neutral 0.7 when none are asked for. Unknown step-free access counts as not met. */
export function amenityFit(venue: Venue, prefs: Prefs): number {
  let want = 0;
  let have = 0;
  if (prefs.needOutlets) {
    want++;
    if (venue.amenities.includes('outlets')) have++;
  }
  if (prefs.stepFree) {
    want++;
    if (venue.accessibility.stepFree === true) have++;
  }
  return want === 0 ? 0.7 : have / want;
}

/**
 * Score one venue for the student's context: walk from the origin → arrival time → predicted level at arrival →
 * the five parts. seats = 1 − mean(level, levelHigh) ÷ 4 at arrival; proximity = 1 − walk ÷ 30 min; openFit = minutes
 * open after arrival ÷ the minutes needed (the rest of the active free block, at least 30, else 90); noise and
 * amenities from the fits above. A spot closed at arrival scores 0 and gets no reasons.
 */
export function rankVenue(venue: Venue, live: LiveLevel, ctx: RankContext): RankedVenue {
  const walkMin = walkMinutes(ctx.origin, venue);
  const arrivalAt = ctx.now + walkMin * 60_000;
  const arrival = predictAt(venue, live, arrivalAt, ctx.now, ctx.phase, ctx.patterns?.[venue.venueId] ?? null);
  const state = openState(venue, ctx.now);
  const arrivalState = arrival.open ? openState(venue, arrivalAt) : null;
  const stayMin = arrivalState?.open && arrivalState.closesAt !== null ? Math.round((arrivalState.closesAt - arrivalAt) / 60_000) : null;

  const seats = arrival.open ? clamp01(1 - (arrival.level + arrival.levelHigh) / 2 / 4) : 0;
  const proximity = clamp01(1 - walkMin / MAX_WALK_MIN);
  let openFit = 0;
  if (arrival.open && stayMin !== null) {
    const need = ctx.gapEndsAt ? Math.max(30, Math.round((ctx.gapEndsAt - arrivalAt) / 60_000)) : MIN_STAY_MIN;
    openFit = clamp01(stayMin / need);
  }
  const noise = noiseFit(venue, ctx.prefs.noisePref);
  const amenities = amenityFit(venue, ctx.prefs);
  const parts = { seats, proximity, openFit, noise, amenities };
  const score = arrival.open
    ? RANK_WEIGHTS.seats * seats + RANK_WEIGHTS.proximity * proximity + RANK_WEIGHTS.openFit * openFit + RANK_WEIGHTS.noise * noise + RANK_WEIGHTS.amenities * amenities
    : 0;

  const reasons: string[] = [];
  if (arrival.open) {
    if (seats >= 0.6) reasons.push(t('rank.reason.seats'));
    if (walkMin <= 10) reasons.push(t('rank.reason.near', { n: walkMin, from: ctx.originLabel }));
    if (stayMin !== null && stayMin >= 180) reasons.push(t('rank.reason.late'));
    if (stayMin !== null && stayMin < MIN_STAY_MIN) reasons.push(t('rank.reason.closesSoon', { n: stayMin }));
    if (noise === 1) reasons.push(t('rank.reason.noise', { noise: t(`noisePref.${ctx.prefs.noisePref}` as const) }));
  }
  return { venue, live, state, walkMin, arrivalAt, arrival, stayMin, score, parts, reasons };
}

/** Ranking output: spots open when you would arrive, best first, and the rest by next opening. */
export interface RankResult {
  open: RankedVenue[];
  closed: RankedVenue[];
}

/**
 * Rank every venue in the area: open ones by score, closed ones by next opening.
 * Only `prefs.area` is ranked; "open" means open at arrival, and score ties go to the shorter walk. A spot that is
 * open now but closes before you get there has no next opening yet, so it sorts last among the closed.
 */
export function rankVenues(venues: readonly Venue[], levels: Record<string, LiveLevel>, ctx: RankContext): RankResult {
  const rows = venues.filter((v) => v.area === ctx.prefs.area).map((v) => rankVenue(v, levels[v.venueId], ctx));
  const open = rows.filter((r) => r.arrival.open).sort((a, b) => b.score - a.score || a.walkMin - b.walkMin);
  const closed = rows.filter((r) => !r.arrival.open).sort((a, b) => (a.state.opensAt ?? Infinity) - (b.state.opensAt ?? Infinity));
  return { open, closed };
}

/** Human-readable breakdown rows for the "Why this ranking?" screen: each term with its weight and this spot's share, then the score to two decimals. */
export function explainRank(r: RankedVenue): { k: string; v: string }[] {
  // A 0..1 share as "64%".
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return [
    { k: t('rank.seats', { w: RANK_WEIGHTS.seats }), v: pct(r.parts.seats) },
    { k: t('rank.proximity', { w: RANK_WEIGHTS.proximity }), v: t('rank.walk', { pct: pct(r.parts.proximity), n: r.walkMin }) },
    { k: t('rank.open', { w: RANK_WEIGHTS.openFit }), v: r.stayMin === null ? t('rank.closedAtArrival') : t('rank.stay', { pct: pct(r.parts.openFit), n: r.stayMin }) },
    { k: t('rank.noise', { w: RANK_WEIGHTS.noise }), v: pct(r.parts.noise) },
    { k: t('rank.amenities', { w: RANK_WEIGHTS.amenities }), v: pct(r.parts.amenities) },
    { k: t('rank.score'), v: r.score.toFixed(2) },
  ];
}
