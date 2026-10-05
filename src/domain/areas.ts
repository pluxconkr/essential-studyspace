/**
 * Pilot areas (NJ rollout waves 1–3 plus Princeton for county coverage). Bounding boxes match
 * the bundled map files. Pure data.
 */
import type { Area } from './types';

export interface BBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export const AREAS: readonly Area[] = ['new-brunswick', 'newark', 'hoboken', 'princeton'] as const;

export const AREA_NAME: Record<Area, string> = {
  'new-brunswick': 'New Brunswick',
  newark: 'Newark',
  hoboken: 'Hoboken',
  princeton: 'Princeton',
};

/** Fits a quarter-width segmented control. */
export const AREA_SHORT: Record<Area, string> = {
  'new-brunswick': 'N. Brunswick',
  newark: 'Newark',
  hoboken: 'Hoboken',
  princeton: 'Princeton',
};

export const AREA_BLURB: Record<Area, string> = {
  'new-brunswick': 'Rutgers · College Ave, Busch, Livingston, Douglass',
  newark: 'Rutgers–Newark, NJIT, Newark Public Library',
  hoboken: 'Stevens, Hoboken Public Library',
  princeton: 'Princeton Public Library · Dinky and Princeton Junction',
};

export const AREA_BBOX: Record<Area, BBox> = {
  'new-brunswick': { minLat: 40.478, maxLat: 40.532, minLng: -74.475, maxLng: -74.425 },
  newark: { minLat: 40.728, maxLat: 40.752, minLng: -74.185, maxLng: -74.16 },
  hoboken: { minLat: 40.733, maxLat: 40.752, minLng: -74.045, maxLng: -74.022 },
  princeton: { minLat: 40.335, maxLat: 40.36, minLng: -74.675, maxLng: -74.645 },
};

/** Default origin for walking times when there is no GPS fix and no home station. */
export const AREA_DEFAULT_STATION: Record<Area, string> = {
  'new-brunswick': 'new-brunswick',
  newark: 'newark-penn',
  hoboken: 'hoboken-terminal',
  princeton: 'princeton',
};

export function isArea(v: unknown): v is Area {
  return typeof v === 'string' && (AREAS as readonly string[]).includes(v);
}
