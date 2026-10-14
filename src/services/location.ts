/**
 * GPS works without a signal (satellites, not cell towers). We ask once, use the last
 * known fix instantly, then refine. The spot list never waits on this.
 *
 * The fix and the permission status go to the store and nowhere else: memory only, never saved or sent
 * (a check-in keeps only its distance from the spot and the fix's accuracy, on the phone).
 * Callers: the Now and Map tabs (once per launch: walking times, the arrival prompt, the GPS dot) and the
 * check-in screen (a fresh reading at mount for the presence distance).
 */
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import type { LocationFix } from '@/domain/types';
import { actions } from '@/store/appStore';

/**
 * An expo-location reading as the app's LocationFix. `at` is the reading's own device timestamp, not the demo
 * clock, so callers judge its age against the real clock (the check-in's freshness test, the arrival prompt).
 */
function toFix(l: Location.LocationObject): LocationFix {
  return { lat: l.coords.latitude, lng: l.coords.longitude, accuracyM: l.coords.accuracy ?? null, at: l.timestamp };
}

/**
 * Ask for foreground location permission, then publish fixes to the store: the last known one first (native
 * only, at most 15 min old) so screens can use it at once, then a fresh high-accuracy one. The status goes
 * 'requesting' → 'granted', 'denied' or 'unavailable' (any error). Returns the fresh fix, or null when permission
 * is denied or no fix could be read; never throws. A failed attempt leaves any earlier fix in the store.
 */
export async function acquireLocation(): Promise<LocationFix | null> {
  actions.setLocation(null, 'requesting');
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      actions.setLocation(null, 'denied');
      return null;
    }
    if (Platform.OS !== 'web') {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 15 * 60_000 });
      if (last) actions.setLocation(toFix(last), 'granted');
    }
    const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const fix = toFix(cur);
    actions.setLocation(fix, 'granted');
    return fix;
  } catch {
    actions.setLocation(null, 'unavailable');
    return null;
  }
}
