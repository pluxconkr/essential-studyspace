/**
 * Integrity of the data that ships inside the app — the offline directory and maps.
 */
import { MAPS } from '@/data/mapData';
import { AREAS, AREA_BBOX } from '@/domain/areas';
import { inBBox } from '@/domain/geo';
import { hoursValid } from '@/domain/hours';
import type { Station, Venue } from '@/domain/types';
import stations from '@/assets/data/stations.json';
import venues from '@/assets/data/venues.json';

const list = venues.venues as unknown as Venue[];
const sts = stations.stations as Station[];

describe('bundled venue directory', () => {
  test('17 venues across four areas with unique ids and every provenance field', () => {
    expect(list.length).toBeGreaterThanOrEqual(17);
    expect(new Set(list.map((v) => v.venueId)).size).toBe(list.length);
    for (const a of AREAS) expect(list.some((v) => v.area === a)).toBe(true);
    for (const v of list) {
      expect(v.name.length).toBeGreaterThan(3);
      expect(v.shortName.length).toBeGreaterThan(2);
      expect(v.address).toMatch(/NJ/);
      expect(/^\d{4}-\d{2}-\d{2}$/.test(v.hoursVerified)).toBe(true);
      expect(/^\d{4}-\d{2}-\d{2}$/.test(v.lastVerified)).toBe(true);
      expect(v.hoursSource.length).toBeGreaterThan(10);
      expect(v.verifiedBy.length).toBeGreaterThan(10);
      expect(['high', 'medium', 'low']).toContain(v.coordConfidence);
      expect(v.zones.length).toBeGreaterThan(0);
      expect(v.capacity).toBeNull(); // nobody publishes one; the app must not invent it
      expect(['estimate', 'venue']).toContain(v.curveSource);
    }
  });

  test('hours tables are valid and every venue is open at least one day', () => {
    for (const v of list) {
      expect(hoursValid(v)).toEqual([]);
      expect(v.hours.some((h) => h !== null)).toBe(true);
    }
  });

  test('every pin falls inside its area box and every station reference resolves', () => {
    for (const v of list) {
      expect(inBBox(v, AREA_BBOX[v.area], 0.003)).toBe(true);
      expect(v.stationIds.length).toBeGreaterThan(0);
      for (const id of v.stationIds) expect(sts.some((s) => s.stationId === id && s.area === v.area)).toBe(true);
    }
  });

  test('the Rutgers libraries carry the LibCal source and the renamed Carr Library is present', () => {
    const ru = list.filter((v) => v.hoursSource.includes('libcal.rutgers.edu'));
    expect(ru.map((v) => v.venueId)).toEqual(expect.arrayContaining(['alexander-library', 'carr-library', 'lsm', 'douglass-library', 'art-library', 'dana-library']));
    expect(list.find((v) => v.venueId === 'carr-library')!.notes).toMatch(/Kilmer/);
  });

  test('Hoboken main library carries the 2026 renovation closure as an exception', () => {
    const h = list.find((v) => v.venueId === 'hoboken-public-library')!;
    expect(h.exceptions.some((e) => e.hours === 'closed' && e.to === '2026-10-04')).toBe(true);
  });

  test('no venue claims a partnership or a deal', () => {
    for (const v of list) expect(JSON.stringify(v).toLowerCase()).not.toMatch(/partner venue|deal|discount|sponsored/);
  });
});

describe('bundled stations and maps', () => {
  test('stations are unique, in their area box, with modes', () => {
    expect(new Set(sts.map((s) => s.stationId)).size).toBe(sts.length);
    for (const s of sts) {
      expect(s.modes.length).toBeGreaterThan(0);
      expect(inBBox(s, AREA_BBOX[s.area], 0.03)).toBe(true);
    }
  });

  test('each area has a map with matching bbox, OSM attribution, and some lines', () => {
    for (const a of AREAS) {
      const m = MAPS[a];
      expect(m.bbox).toEqual(AREA_BBOX[a]);
      expect(m.attribution).toMatch(/OpenStreetMap/);
      expect(m.roads.length).toBeGreaterThan(20);
      expect(m.rail.length + m.lightRail.length).toBeGreaterThan(0);
      for (const r of m.roads) for (const [lng, lat] of r.pts) expect(inBBox({ lat, lng }, m.bbox, 0.01)).toBe(true);
    }
    const total = Object.values(MAPS).reduce((n, m) => n + JSON.stringify(m).length, 0);
    expect(total).toBeLessThan(220_000);
  });
});
