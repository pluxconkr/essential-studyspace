/**
 * Arrival prompt: when the phone is at a spot and has not reported it recently, the home screen offers a
 * one-tap check-in. Foreground only — no geofence, no background location.
 *
 * How it fits: the Now tab calls arrivalCandidate with the in-memory GPS fix (services/location, never stored)
 * and the spots of the ranking's area, and shows the prompt when a spot comes back. Pure function.
 */
import { haversineM } from './geo';
import { toEpoch } from './time';
import type { CheckIn, LocationFix, Venue } from './types';

/** How close the nearest spot must be, in metres, after crediting up to 50 m of GPS accuracy. */
export const ARRIVAL_RADIUS_M = 75;
/** A live check-in at the spot from this phone within this many minutes silences the prompt. */
export const ARRIVAL_DEBOUNCE_MIN = 30;
/** Fixes older than this (device clock) are ignored, so a stale position never prompts. */
export const ARRIVAL_FIX_MAX_AGE_MS = 10 * 60_000;

/**
 * The spot the phone is standing at, if any. `now` is the app clock (check-in times), `realNow` the device
 * clock (the GPS fix is stamped with it); they differ only while a demo scenario shifts the clock.
 * Only the nearest spot is considered. Remote and earlier-visit reports do not silence the prompt: they were
 * not made at the spot.
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
  const recent = checkIns.some((c) => c.kind === 'live' && c.venueId === id && now - toEpoch(c.at) < ARRIVAL_DEBOUNCE_MIN * 60_000);
  return recent ? null : best;
}
