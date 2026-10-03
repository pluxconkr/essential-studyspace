/**
 * Walking time — the number commuters actually think in. Deterministic and explainable:
 * straight-line distance × a street factor ÷ walking speed, rounded up. Never stored, always derived.
 */
import { haversineM, type LatLng } from './geo';
import type { Station, Venue } from './types';

/** Streets are not straight lines. 1.3 is the usual detour factor for a grid-ish US town. */
export const STREET_FACTOR = 1.3;
/** Metres per minute — a brisk student pace with a backpack (≈ 4.8 km/h). */
export const WALK_M_PER_MIN = 80;

export function walkMinutes(from: LatLng, to: LatLng): number {
  const m = haversineM(from, to);
  return Math.max(1, Math.ceil((m * STREET_FACTOR) / WALK_M_PER_MIN));
}

/** "420 m straight line × 1.3 street factor ÷ 80 m/min = 7 min" */
export function walkFormula(from: LatLng, to: LatLng): string {
  const m = Math.round(haversineM(from, to));
  return `${m} m straight line × ${STREET_FACTOR} street factor ÷ ${WALK_M_PER_MIN} m/min = ${walkMinutes(from, to)} min`;
}

export function stationById(stations: readonly Station[], id: string | null | undefined): Station | null {
  if (!id) return null;
  return stations.find((s) => s.stationId === id) ?? null;
}

/** The venue's primary station (first in its list, else nearest in the same area). */
export function primaryStation(venue: Venue, stations: readonly Station[]): Station | null {
  const first = stationById(stations, venue.stationIds[0]);
  if (first) return first;
  let best: Station | null = null;
  let bestM = Infinity;
  for (const s of stations) {
    if (s.area !== venue.area) continue;
    const m = haversineM(venue, s);
    if (m < bestM) {
      bestM = m;
      best = s;
    }
  }
  return best;
}

export function formatModes(s: Station): string {
  return s.modes.join(' · ');
}
