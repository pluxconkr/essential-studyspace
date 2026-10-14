/**
 * Bundled vector map data per area (OpenStreetMap derivative, ODbL). Simplified offline:
 * water lines, main rail, light rail, a whitelist of named roads, and station nodes.
 *
 * The four JSON files ship inside the app bundle, so the Map tab never touches the network; `src/ui/AreaMap.tsx`
 * projects these lines onto an SVG. The lines stay under ODbL (attribution in each file and on the Map tab).
 */
import hoboken from '@/assets/data/maps/hoboken.json';
import newBrunswick from '@/assets/data/maps/new-brunswick.json';
import newark from '@/assets/data/maps/newark.json';
import princeton from '@/assets/data/maps/princeton.json';
import type { BBox } from '@/domain/areas';
import type { Area } from '@/domain/types';

/** A polyline as [lng, lat] pairs: longitude first, as in GeoJSON. */
export type Line = [number, number][];

/**
 * One area's bundled map file. `bbox` equals the area's AREA_BBOX; each road has a weight class (major roads are
 * drawn thicker) and a flag for printing its name. `stations` are the OSM station nodes (`kind` rail, light_rail
 * or subway); the map draws its station pins from the station list (stationRepo) instead.
 */
export interface AreaMapData {
  attribution: string;
  area: string;
  bbox: BBox;
  water: Line[];
  rail: Line[];
  lightRail: Line[];
  roads: { name: string; class: 'major' | 'minor'; label: boolean; pts: Line }[];
  stations: { name: string; lat: number; lng: number; kind: string }[];
}

/** Map data for each area. The JSON is cast, not validated at runtime; the bundled-data test checks every file. */
export const MAPS: Record<Area, AreaMapData> = {
  'new-brunswick': newBrunswick as unknown as AreaMapData,
  newark: newark as unknown as AreaMapData,
  hoboken: hoboken as unknown as AreaMapData,
  princeton: princeton as unknown as AreaMapData,
};

/** Size of all bundled map data as JSON characters (about bytes), for the Maps row of the Offline data screen. */
export function mapBytes(): number {
  return Object.values(MAPS).reduce((n, m) => n + JSON.stringify(m).length, 0);
}
