/**
 * Pilot areas (NJ rollout waves 1–3 plus Princeton for county coverage). Bounding boxes match
 * the bundled map files. Pure data.
 *
 * How it fits: the student picks one area (Prefs.area). The Now tab ranks that area's venues and live
 * levels are fetched for them only; the Map shows one area at a time. The tables below name each area,
 * frame its map and give the walking origin to fall back on.
 */
import type { Area } from './types';

/** A latitude/longitude rectangle in degrees. */
export interface BBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Every area in display order: the area picker, the Map's area switcher, and the check on a stored Prefs.area. */
export const AREAS: readonly Area[] = ['new-brunswick', 'newark', 'hoboken', 'princeton'] as const;

/** Display name of each area. Place names, shown as-is in both languages. */
export const AREA_NAME: Record<Area, string> = {
  'new-brunswick': 'New Brunswick',
  newark: 'Newark',
  hoboken: 'Hoboken',
  princeton: 'Princeton',
};

/** Fits a quarter-width segmented control (the Map's area switcher). */
export const AREA_SHORT: Record<Area, string> = {
  'new-brunswick': 'N. Brunswick',
  newark: 'Newark',
  hoboken: 'Hoboken',
  princeton: 'Princeton',
};

/** What each area covers, shown under its name in the area picker (onboarding and Preferences). */
export const AREA_BLURB: Record<Area, string> = {
  'new-brunswick': 'Rutgers · College Ave, Busch, Livingston, Douglass',
  newark: 'Rutgers–Newark, NJIT, Newark Public Library',
  hoboken: 'Stevens, Hoboken Public Library',
  princeton: 'Princeton Public Library · Dinky and Princeton Junction',
};

/**
 * Each area's bounding box; a test keeps it equal to the bbox of the area's bundled map file. It frames the
 * Map's projection, decides whether a GPS fix is in the area (and so may be the walking origin) and, as its
 * centre, is the last-resort walking origin.
 */
export const AREA_BBOX: Record<Area, BBox> = {
  'new-brunswick': { minLat: 40.478, maxLat: 40.532, minLng: -74.475, maxLng: -74.425 },
  newark: { minLat: 40.728, maxLat: 40.752, minLng: -74.185, maxLng: -74.16 },
  hoboken: { minLat: 40.733, maxLat: 40.752, minLng: -74.045, maxLng: -74.022 },
  princeton: { minLat: 40.335, maxLat: 40.36, minLng: -74.675, maxLng: -74.645 },
};

/**
 * Default origin for walking times when there is no GPS fix in the area and no home station.
 * Also preselected as the home station when the student picks an area.
 */
export const AREA_DEFAULT_STATION: Record<Area, string> = {
  'new-brunswick': 'new-brunswick',
  newark: 'newark-penn',
  hoboken: 'hoboken-terminal',
  princeton: 'princeton',
};

/** Type guard for an untrusted string, such as the Map's `?area=` deep-link parameter. */
export function isArea(v: unknown): v is Area {
  return typeof v === 'string' && (AREAS as readonly string[]).includes(v);
}
