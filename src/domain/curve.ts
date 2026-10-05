/**
 * Typical-day occupancy curves — the cold-start prior. Per-kind estimates, clearly labelled
 * "estimate" everywhere they appear, until a venue declares its own curve or real reports exist.
 * Values are relative occupancy 0..1 by local hour; the term phase scales them.
 */
import { t } from '@/i18n';

import { formatMinutesShort, zonedParts } from './time';
import type { Venue, VenueKind } from './types';

export type TermPhase = 'regular' | 'finals' | 'break';

/** Weekday curves (index = hour 0..23). Weekend variants are flatter and later. */
const WEEKDAY: Record<VenueKind, number[]> = {
  //            0     1     2     3     4     5     6     7     8     9     10    11    12    13    14    15    16    17    18    19    20    21    22    23
  library: [0.25, 0.15, 0.1, 0.05, 0.05, 0.05, 0.05, 0.08, 0.15, 0.3, 0.45, 0.55, 0.6, 0.68, 0.75, 0.75, 0.7, 0.6, 0.58, 0.62, 0.6, 0.5, 0.4, 0.3],
  'public-library': [0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.15, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.6, 0.5, 0.4, 0.35, 0.3, 0.2, 0.1, 0],
  'student-center': [0.1, 0.05, 0.02, 0.02, 0.02, 0.02, 0.05, 0.15, 0.3, 0.4, 0.5, 0.7, 0.8, 0.75, 0.6, 0.55, 0.5, 0.6, 0.65, 0.55, 0.45, 0.35, 0.25, 0.15],
  cafe: [0, 0, 0, 0, 0, 0, 0.1, 0.4, 0.7, 0.75, 0.6, 0.5, 0.55, 0.5, 0.5, 0.45, 0.35, 0.25, 0.15, 0.1, 0.05, 0, 0, 0],
};

const WEEKEND: Record<VenueKind, number[]> = {
  library: [0.15, 0.1, 0.05, 0.02, 0.02, 0.02, 0.02, 0.02, 0.05, 0.1, 0.15, 0.25, 0.35, 0.45, 0.55, 0.6, 0.6, 0.55, 0.5, 0.5, 0.45, 0.35, 0.25, 0.2],
  'public-library': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.2, 0.35, 0.45, 0.5, 0.5, 0.45, 0.35, 0.2, 0.1, 0, 0, 0, 0, 0],
  'student-center': [0.05, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.05, 0.1, 0.15, 0.25, 0.35, 0.45, 0.45, 0.4, 0.4, 0.4, 0.45, 0.5, 0.45, 0.35, 0.25, 0.15, 0.1],
  cafe: [0, 0, 0, 0, 0, 0, 0.05, 0.2, 0.45, 0.7, 0.8, 0.75, 0.6, 0.5, 0.45, 0.4, 0.3, 0.2, 0.1, 0.05, 0, 0, 0, 0],
};

/** Finals push every library toward full; breaks empty the campus. Capped at 1. */
export const TERM_MULTIPLIER: Record<TermPhase, number> = { regular: 1, finals: 1.35, break: 0.4 };

/** "university library" — in the current language. */
export const kindLabel = (kind: VenueKind) => t(`kind.${kind}` as const);

/** The 24-value curve a venue uses: its own declared curve, else the per-kind estimate. */
export function curveFor(venue: Pick<Venue, 'kind' | 'typicalCurve'>, weekend: boolean): number[] {
  if (venue.typicalCurve && venue.typicalCurve.length === 24) return venue.typicalCurve;
  return (weekend ? WEEKEND : WEEKDAY)[venue.kind];
}

/** Linear interpolation on the curve at a local time (hour + minute fraction), scaled by term phase. */
export function typicalPct(venue: Pick<Venue, 'kind' | 'typicalCurve'>, at: number, phase: TermPhase = 'regular'): number {
  const p = zonedParts(at);
  const weekend = p.weekday === 0 || p.weekday === 6;
  const c = curveFor(venue, weekend);
  const a = c[p.hour];
  const b = c[(p.hour + 1) % 24];
  const frac = p.minute / 60;
  return Math.min(1, Math.max(0, (a + (b - a) * frac) * TERM_MULTIPLIER[phase]));
}

/** Plain-English explanation of the estimate for the "Why this estimate?" screen. */
export function explainTypical(venue: Pick<Venue, 'kind' | 'typicalCurve' | 'curveSource'>, at: number, phase: TermPhase): string {
  const p = zonedParts(at);
  const weekend = p.weekday === 0 || p.weekday === 6;
  const pct = Math.round(typicalPct(venue, at, phase) * 100);
  const who = venue.curveSource === 'venue' ? t('curve.whoVenue') : t('curve.whoKind', { kind: kindLabel(venue.kind) });
  const when = t('curve.at', { day: weekend ? t('curve.weekend') : t('curve.weekday'), time: formatMinutesShort(p.hour * 60) });
  const term = phase === 'finals' ? t('curve.finals', { x: TERM_MULTIPLIER.finals }) : phase === 'break' ? t('curve.break', { x: TERM_MULTIPLIER.break }) : '';
  return t('curve.explain', { pct, who, when, term });
}
