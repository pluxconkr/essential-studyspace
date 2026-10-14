/**
 * Late-night campus safety numbers (spec §13): shown on spots that stay open late. Numbers come from each
 * university's public-safety pages (see docs/venue-sources.md) and are bundled, so they work with no signal.
 *
 * How it fits: the spot page calls safetyFor and lists the contacts as tap-to-call rows when today's hours
 * run to 11 PM or later (hours.opensLate). Pure; no network.
 */
import { t } from '@/i18n';

import type { Venue } from './types';

/** One tap-to-call row on the spot page: `label` and `note` (e.g. "Call about ten minutes ahead") in the current language, `display` the number as printed. */
export interface SafetyContact {
  label: string;
  display: string;
  /** E.164 for tel: links. */
  e164: string;
  note: string;
}

/**
 * Rutgers police walking escort and the Knight Mover shuttle. The lists are functions, not constants, so t() runs
 * when a spot page asks, after the root layout has set the device language, not whenever this module is imported.
 */
const RUTGERS = (): SafetyContact[] => [
  { label: t('safety.rupd'), display: '732-932-7211', e164: '+17329327211', note: t('safety.rupd.note') },
  { label: t('safety.knightMover'), display: '732-932-7433', e164: '+17329327433', note: t('safety.knightMover.note') },
];
/** NJIT Public Safety escort. */
const NJIT = (): SafetyContact[] => [{ label: t('safety.njit'), display: '(973) 596-3120', e164: '+19735963120', note: t('safety.njit.note') }];
/** Stevens Campus Police escort. */
const STEVENS = (): SafetyContact[] => [{ label: t('safety.stevens'), display: '201-216-5105', e164: '+12012165105', note: t('safety.stevens.note') }];

/** Keyed by the venue `campus` label. Public libraries and cafés have no campus escort. Every Rutgers campus, Newark included, shares one list. */
const CAMPUS_SAFETY: Record<string, () => SafetyContact[]> = {
  'College Avenue': RUTGERS,
  Busch: RUTGERS,
  Livingston: RUTGERS,
  Douglass: RUTGERS,
  Cook: RUTGERS,
  'Rutgers–Newark': RUTGERS,
  NJIT,
  Stevens: STEVENS,
};

/**
 * The campus safety contacts for a venue, in the current language; [] when there are none.
 * University spaces only: a café next to campus does not get a campus escort line.
 */
export function safetyFor(venue: Pick<Venue, 'campus' | 'kind'>): SafetyContact[] {
  if (venue.kind !== 'library' && venue.kind !== 'student-center') return [];
  const make = venue.campus ? CAMPUS_SAFETY[venue.campus] : undefined;
  return make ? make() : [];
}
