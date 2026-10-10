/**
 * Home ranking — "where should I go right now" in one explainable score. No AI.
 *
 *   score = 0.35 × seats at arrival + 0.25 × proximity + 0.15 × open long enough
 *         + 0.15 × noise match + 0.10 × amenities
 *
 * Every component is shown on the "Why this ranking?" screen. Closed venues are listed
 * separately with their next opening, never hidden.
 */
import { t } from '@/i18n';

import type { TermPhase } from './curve';
import type { LatLng } from './geo';
import { openState, type OpenState } from './hours';
import { predictAt } from './levels';
import { walkMinutes } from './transit';
import type { Level, LiveLevel, Prefs, Venue, VenuePattern } from './types';

export const RANK_WEIGHTS = { seats: 0.35, proximity: 0.25, openFit: 0.15, noise: 0.15, amenities: 0.1 } as const;
/** Beyond this many minutes on foot a spot scores zero for proximity. */
export const MAX_WALK_MIN = 30;
/** A spot must stay open at least this long after arrival to score full marks. */
export const MIN_STAY_MIN = 90;

export interface RankedVenue {
  venue: Venue;
  live: LiveLevel;
  state: OpenState;
  walkMin: number;
  arrivalAt: number;
  arrival: { level: Level; levelHigh: Level; open: boolean };
  /** Minutes the spot stays open after arrival (null if closed at arrival). */
  stayMin: number | null;
  score: number;
  parts: { seats: number; proximity: number; openFit: number; noise: number; amenities: number };
  reasons: string[];
}

export interface RankContext {
  origin: LatLng;
  originLabel: string;
  prefs: Prefs;
  now: number;
  /** End of the student's current free block, if one is active. Spots open past it rank higher. */
  gapEndsAt: number | null;
  phase?: TermPhase;
  /** Learned student patterns by venue id, when the phone has them. */
  patterns?: Record<string, VenuePattern>;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function noiseFit(venue: Venue, pref: Prefs['noisePref']): number {
  const zones = venue.zones.map((z) => z.noise);
  if (zones.length === 0) return 0.5;
  if (zones.includes(pref)) return 1;
  if (pref === 'silent') return zones.includes('low') ? 0.6 : 0.2;
  if (pref === 'low') return zones.includes('silent') ? 0.8 : 0.5;
  return zones.includes('low') ? 0.6 : 0.3;
}

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

export interface RankResult {
  open: RankedVenue[];
  closed: RankedVenue[];
}

/** Rank every venue in the area: open ones by score, closed ones by next opening. */
export function rankVenues(venues: readonly Venue[], levels: Record<string, LiveLevel>, ctx: RankContext): RankResult {
  const rows = venues.filter((v) => v.area === ctx.prefs.area).map((v) => rankVenue(v, levels[v.venueId], ctx));
  const open = rows.filter((r) => r.arrival.open).sort((a, b) => b.score - a.score || a.walkMin - b.walkMin);
  const closed = rows.filter((r) => !r.arrival.open).sort((a, b) => (a.state.opensAt ?? Infinity) - (b.state.opensAt ?? Infinity));
  return { open, closed };
}

/** Human-readable breakdown rows for the "Why this ranking?" screen. */
export function explainRank(r: RankedVenue): { k: string; v: string }[] {
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
