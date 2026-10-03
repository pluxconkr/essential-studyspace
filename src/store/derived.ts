/**
 * Derived state hooks: live levels, ranking, session block, focus stats. Pure derivations over
 * the store plus a slow clock tick so time-based values advance without user interaction.
 */
import { useEffect, useMemo, useState } from 'react';

import { AREA_BBOX, AREA_DEFAULT_STATION, AREA_NAME } from '@/domain/areas';
import { currentOrNextGap, type ActiveGap } from '@/domain/blocks';
import type { TermPhase } from '@/domain/curve';
import { inBBox } from '@/domain/geo';
import { fuse, proofStrength } from '@/domain/levels';
import { rankVenues, type RankContext, type RankResult } from '@/domain/ranking';
import { nowMs } from '@/domain/time';
import { blockAt, type BlockState } from '@/domain/timer';
import { bestWindow, focusByHour, focusByVenue, streakDays, weekSummary } from '@/domain/focus';
import { stationById } from '@/domain/transit';
import type { CrowdReport, LiveLevel, Session, Venue } from '@/domain/types';

import { useAppState } from './appStore';

/** Re-renders every `ms` (default 30 s) and returns the app clock (device time + demo offset). */
export function useNow(ms = 30_000): number {
  const [tick, setTick] = useState(0);
  const offset = useAppState((s) => s.settings.demoClockOffsetMs);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  // Read the clock at render time so a demo offset change is reflected on the very next render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => nowMs(), [tick, offset]);
}

/** The real device clock, ticking every `ms`. For facts stamped in device time (GPS fixes, cache ages) that a demo clock must not distort. */
export function useRealNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function useTermPhase(): TermPhase {
  return useAppState((s) => (s.settings.demoScenario === 'finals' ? 'finals' : 'regular'));
}

/** Venues with demo-scenario exceptions applied (labelled; never persisted). */
export function useVenues(): Venue[] {
  const venues = useAppState((s) => s.venues);
  const scenario = useAppState((s) => s.settings.demoScenario);
  return useMemo(() => {
    if (scenario !== 'finals') return venues;
    return venues.map((v) =>
      v.venueId === 'alexander-library'
        ? { ...v, exceptions: [...v.exceptions, { from: '1970-01-01', to: '2999-12-31', label: 'Finals: open 24 hours', hours: '24h' as const, source: 'Demo scenario', isDemo: true }] }
        : v,
    );
  }, [venues, scenario]);
}

export function useVenue(id: string | undefined): Venue | null {
  const venues = useVenues();
  return useMemo(() => venues.find((v) => v.venueId === id) ?? null, [venues, id]);
}

/** Own check-ins expressed as anonymous reports, with the weight the relay would assign. */
function ownReports(checkIns: { venueId: string; zoneId: string | null; level: LiveLevel['level']; at: string; proof: { distanceM: number | null; gpsAccuracyM: number | null } }[]): Record<string, CrowdReport[]> {
  const out: Record<string, CrowdReport[]> = {};
  for (const c of checkIns) {
    (out[c.venueId] ??= []).push({ venueId: c.venueId, zoneId: c.zoneId, level: c.level, at: c.at, weight: proofStrength(c.proof.distanceM, c.proof.gpsAccuracyM) });
  }
  return out;
}

/** Fused level for every venue: own check-ins + relay snapshot + demo reports + the typical-pattern prior. */
export function useLiveLevels(): Record<string, LiveLevel> {
  const venues = useVenues();
  const my = useAppState((s) => s.myCheckIns);
  const crowd = useAppState((s) => s.crowd);
  const demo = useAppState((s) => s.demoReports);
  const phase = useTermPhase();
  const now = useNow();
  return useMemo(() => {
    const mine = ownReports(my);
    const out: Record<string, LiveLevel> = {};
    for (const v of venues) {
      const reports = [...(mine[v.venueId] ?? []), ...(crowd?.reports[v.venueId] ?? []), ...(demo[v.venueId] ?? [])];
      out[v.venueId] = fuse({ venue: v, reports, now, phase });
    }
    return out;
  }, [venues, my, crowd, demo, phase, now]);
}

export interface RankingView extends RankResult {
  ctx: RankContext;
  gap: ActiveGap | null;
  /** Where walking times are measured from: GPS, the home station, or the area default. */
  originKind: 'gps' | 'station' | 'area';
}

export function useRanking(): RankingView {
  const venues = useVenues();
  const levels = useLiveLevels();
  const prefs = useAppState((s) => s.prefs);
  const stations = useAppState((s) => s.stations);
  const location = useAppState((s) => s.location);
  const phase = useTermPhase();
  const now = useNow();
  return useMemo(() => {
    const gap = currentOrNextGap(prefs.blocks, now);
    const home = stationById(stations, prefs.homeStationId) ?? stationById(stations, AREA_DEFAULT_STATION[prefs.area]);
    const gpsInArea = location && inBBox(location, AREA_BBOX[prefs.area], 0.05);
    const origin = gpsInArea && location ? location : home ? { lat: home.lat, lng: home.lng } : { lat: (AREA_BBOX[prefs.area].minLat + AREA_BBOX[prefs.area].maxLat) / 2, lng: (AREA_BBOX[prefs.area].minLng + AREA_BBOX[prefs.area].maxLng) / 2 };
    const originKind: RankingView['originKind'] = gpsInArea ? 'gps' : home ? 'station' : 'area';
    const originLabel = originKind === 'gps' ? 'you' : home ? home.name : AREA_NAME[prefs.area];
    const ctx: RankContext = { origin, originLabel, prefs, now, gapEndsAt: gap?.now ? gap.endsAt : null, phase };
    return { ...rankVenues(venues, levels, ctx), ctx, gap, originKind };
  }, [venues, levels, prefs, stations, location, phase, now]);
}

/** The live session with its current block, ticking once a second while running. */
export function useSessionState(): { session: Session | null; block: BlockState | null; now: number } {
  const session = useAppState((s) => s.session);
  const now = useNow(session && !session.pausedAt ? 1000 : 30_000);
  const block = useMemo(() => (session ? blockAt(session, now) : null), [session, now]);
  return { session, block, now };
}

export function useFocusStats() {
  const log = useAppState((s) => s.focusLog);
  const venues = useVenues();
  const now = useNow(60_000);
  return useMemo(() => {
    const byHour = focusByHour(log);
    return { log, week: weekSummary(log, now), streak: streakDays(log, now), byHour, best: bestWindow(byHour), byVenue: focusByVenue(log, venues) };
  }, [log, venues, now]);
}
