/**
 * The honesty metric (spec §17, E12): did the level the app showed match what the student found?
 * Computed on the phone from the student's own check-ins. Never uploaded.
 */
import type { CheckIn } from './types';

export interface WastedTripStats {
  /** Check-ins that recorded what was shown at the time. */
  total: number;
  /** Found level within one step of what was shown. */
  withinOne: number;
  /** Found level two or more steps worse or better than shown — a wasted trip by the spec's definition. */
  wasted: number;
}

export function wastedTrips(checkIns: readonly CheckIn[]): WastedTripStats {
  let total = 0;
  let withinOne = 0;
  let wasted = 0;
  for (const c of checkIns) {
    if (c.shownLevel === null || c.shownLevel === undefined) continue;
    total += 1;
    const d = Math.abs(c.level - c.shownLevel);
    if (d <= 1) withinOne += 1;
    if (d >= 2) wasted += 1;
  }
  return { total, withinOne, wasted };
}
