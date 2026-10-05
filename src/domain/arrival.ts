/**
 * Arrival prompt: when the phone is at a spot and has not reported it recently, the home screen offers a
 * one-tap check-in. Foreground only — no geofence, no background location.
 */
import { haversineM } from './geo';
import { toEpoch } from './time';
import type { CheckIn, LocationFix, Venue } from './types';

export const ARRIVAL_RADIUS_M = 75;
export const ARRIVAL_DEBOUNCE_MIN = 30;
export const ARRIVAL_FIX_MAX_AGE_MS = 10 * 60_000;

/**
 * The spot the phone is standing at, if any. `now` is the app clock (check-in times), `realNow` the device
 * clock (the GPS fix is stamped with it); they differ only while a demo scenario shifts the clock.
 */
export function arrivalCandidate(venues: readonly Venue[], location: LocationFix | null, checkIns: readonly CheckIn[], now: number, realNow: number = now): Venue | null {
  if (!location || realNow - location.at > ARRIVAL_FIX_MAX_AGE_MS) return null;
  const slack = Math.min(location.accuracyM ?? 0, 50);
  let best: Venue | null = null;
  let bestM = Number.POSITIVE_INFINITY;
  for (const v of venues) {
    const m = haversineM(location, v);
    if (m < bestM) {
      bestM = m;
      best = v;
    }
  }
  if (!best || bestM - slack > ARRIVAL_RADIUS_M) return null;
  const id = best.venueId;
  const recent = checkIns.some((c) => c.venueId === id && now - toEpoch(c.at) < ARRIVAL_DEBOUNCE_MIN * 60_000);
  return recent ? null : best;
}
