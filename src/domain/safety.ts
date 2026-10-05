/**
 * Late-night campus safety numbers (spec §13): shown on spots that stay open late. Numbers come from each
 * university's public-safety pages (see docs/venue-sources.md) and are bundled, so they work with no signal.
 */
import { t } from '@/i18n';

import type { Venue } from './types';

export interface SafetyContact {
  label: string;
  display: string;
  /** E.164 for tel: links. */
  e164: string;
  note: string;
}

const RUTGERS = (): SafetyContact[] => [
  { label: t('safety.rupd'), display: '732-932-7211', e164: '+17329327211', note: t('safety.rupd.note') },
  { label: t('safety.knightMover'), display: '732-932-7433', e164: '+17329327433', note: t('safety.knightMover.note') },
];
const NJIT = (): SafetyContact[] => [{ label: t('safety.njit'), display: '(973) 596-3120', e164: '+19735963120', note: t('safety.njit.note') }];
const STEVENS = (): SafetyContact[] => [{ label: t('safety.stevens'), display: '201-216-5105', e164: '+12012165105', note: t('safety.stevens.note') }];

/** Keyed by the venue `campus` label. Public libraries and cafés have no campus escort. */
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

/** University spaces only: a café next to campus does not get a campus escort line. */
export function safetyFor(venue: Pick<Venue, 'campus' | 'kind'>): SafetyContact[] {
  if (venue.kind !== 'library' && venue.kind !== 'student-center') return [];
  const make = venue.campus ? CAMPUS_SAFETY[venue.campus] : undefined;
  return make ? make() : [];
}
