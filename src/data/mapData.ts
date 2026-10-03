/**
 * Bundled vector map data per area (OpenStreetMap derivative, ODbL). Simplified offline:
 * water lines, main rail, light rail, a whitelist of named roads, and station nodes.
 */
import hoboken from '@/assets/data/maps/hoboken.json';
import newBrunswick from '@/assets/data/maps/new-brunswick.json';
import newark from '@/assets/data/maps/newark.json';
import princeton from '@/assets/data/maps/princeton.json';
import type { BBox } from '@/domain/areas';
import type { Area } from '@/domain/types';

export type Line = [number, number][];

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

export const MAPS: Record<Area, AreaMapData> = {
  'new-brunswick': newBrunswick as unknown as AreaMapData,
  newark: newark as unknown as AreaMapData,
  hoboken: hoboken as unknown as AreaMapData,
  princeton: princeton as unknown as AreaMapData,
};

export function mapBytes(): number {
  return Object.values(MAPS).reduce((n, m) => n + JSON.stringify(m).length, 0);
}
