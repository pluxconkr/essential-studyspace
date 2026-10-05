/**
 * Geometry helpers: great-circle distance and an equirectangular projection used by
 * the offline SVG area maps. Pure functions.
 */
import type { BBox } from './areas';

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "850 m" / "1.2 km" */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function inBBox(p: LatLng, b: BBox, padDeg = 0): boolean {
  return p.lat >= b.minLat - padDeg && p.lat <= b.maxLat + padDeg && p.lng >= b.minLng - padDeg && p.lng <= b.maxLng + padDeg;
}

export interface Projection {
  width: number;
  height: number;
  toXY: (p: LatLng) => { x: number; y: number };
}

/**
 * Equirectangular projection that fits `bbox` into width×height, preserving aspect ratio
 * (longitude scaled by cos(mid-latitude)), centred with padding.
 */
export function makeProjection(bbox: BBox, width: number, height: number, padding = 8): Projection {
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const kx = Math.cos(toRad(midLat));
  const spanX = (bbox.maxLng - bbox.minLng) * kx;
  const spanY = bbox.maxLat - bbox.minLat;
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  const scale = Math.min(innerW / spanX, innerH / spanY);
  const offX = padding + (innerW - spanX * scale) / 2;
  const offY = padding + (innerH - spanY * scale) / 2;
  return {
    width,
    height,
    toXY: (p) => ({ x: offX + (p.lng - bbox.minLng) * kx * scale, y: offY + (bbox.maxLat - p.lat) * scale }),
  };
}

/** Build an SVG path "M x y L x y …" for a polyline of [lng, lat] positions (no close). */
export function lineToPath(line: readonly (readonly [number, number])[], proj: Projection, precision = 1): string {
  if (line.length === 0) return '';
  const f = (n: number) => n.toFixed(precision);
  let d = '';
  for (let i = 0; i < line.length; i++) {
    const { x, y } = proj.toXY({ lng: line[i][0], lat: line[i][1] });
    d += `${i === 0 ? 'M' : 'L'}${f(x)} ${f(y)}`;
  }
  return d;
}
