/**
 * The honesty metric (spec §17, E12): did the level the app showed match what the student found?
 * Computed on the phone from the student's own check-ins. Never uploaded.
 *
 * How it fits: the check-in screen stores `shownLevel` on each check-in (the level on screen when it was
 * posted; null when the spot showed as closed), and the Your week screen (profile.tsx) prints
 * "N of M within one level" from wastedTrips. Pure function.
 */
import type { CheckIn } from './types';

/** Shown-vs-found counts over this phone's at-the-spot check-ins. */
export interface WastedTripStats {
  /** Check-ins that recorded what was shown at the time. */
  total: number;
  /** Found level within one step of what was shown. */
  withinOne: number;
  /**
   * Found level two or more steps away from what was shown, busier or quieter. The spec's wasted-trip rate counts
   * only "2+ worse than shown"; this counts both directions. No screen prints it; Your week shows withinOne of total.
   */
  wasted: number;
}

/** Compare each at-the-spot check-in's found level with the level shown when it was posted; check-ins without a shown level are skipped. */
export function wastedTrips(checkIns: readonly CheckIn[]): WastedTripStats {
  let total = 0;
  let withinOne = 0;
  let wasted = 0;
  for (const c of checkIns) {
    // Only a student who was there can say what they found.
    if (c.kind !== 'live' || c.shownLevel === null || c.shownLevel === undefined) continue;
    total += 1;
    const d = Math.abs(c.level - c.shownLevel);
    if (d <= 1) withinOne += 1;
    if (d >= 2) wasted += 1;
  }
  return { total, withinOne, wasted };
}
