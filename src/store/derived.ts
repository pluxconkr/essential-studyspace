/**
 * Derived state hooks: live levels, ranking, session block, focus stats. Pure derivations over
 * the store plus a slow clock tick so time-based values advance without user interaction.
 *
 * This is where the domain functions (fuse, rankVenues, blockAt, the focus stats) meet the store.
 * Nothing here writes storage or calls the network. Two clocks: useNow is the app clock (device time
 * plus the demo offset) for hours, levels and sessions; useRealNow is the device clock for facts stamped
 * in device time. Demo-scenario effects (the finals exception and term phase) are applied here, never stored.
 */
import { useEffect, useMemo, useState } from 'react';

import { AREA_BBOX, AREA_DEFAULT_STATION, AREA_NAME } from '@/domain/areas';
import { currentOrNextGap, type ActiveGap } from '@/domain/blocks';
import type { TermPhase } from '@/domain/curve';
import { inBBox } from '@/domain/geo';
import { dedupeReports, fuse, toReport } from '@/domain/levels';
import { rankVenues, type RankContext, type RankResult } from '@/domain/ranking';
import { nowMs } from '@/domain/time';
import { blockAt, type BlockState } from '@/domain/timer';
import { bestWindow, focusByHour, focusByVenue, streakDays, weekSummary } from '@/domain/focus';
import { stationById } from '@/domain/transit';
import type { CheckIn, CrowdReport, CrowdSnapshot, LiveLevel, Session, Venue, VenuePattern } from '@/domain/types';
import { t } from '@/i18n';

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

/**
 * Term phase for the typical curves: 'finals' (the venue-declared or per-kind curve scaled ×1.35; hours with
 * enough learned data unaffected) while the finals demo scenario runs, else 'regular'. Nothing else sets the phase, so 'break' never occurs here.
 */
export function useTermPhase(): TermPhase {
  return useAppState((s) => (s.settings.demoScenario === 'finals' ? 'finals' : 'regular'));
}

/**
 * Venues with demo-scenario exceptions applied (labelled; never persisted). Only the finals scenario
 * changes anything: Alexander Library gets an all-dates "open 24 hours" exception marked isDemo.
 */
export function useVenues(): Venue[] {
  const venues = useAppState((s) => s.venues);
  const scenario = useAppState((s) => s.settings.demoScenario);
  return useMemo(() => {
    if (scenario !== 'finals') return venues;
    return venues.map((v) =>
      v.venueId === 'alexander-library'
        ? { ...v, exceptions: [...v.exceptions, { from: '1970-01-01', to: '2999-12-31', label: t('demo.finalsException'), hours: '24h' as const, source: 'Demo scenario', isDemo: true }] }
        : v,
    );
  }, [venues, scenario]);
}

/** One venue by id from useVenues (demo exceptions included); null for an unknown or missing id. */
export function useVenue(id: string | undefined): Venue | null {
  const venues = useVenues();
  return useMemo(() => venues.find((v) => v.venueId === id) ?? null, [venues, id]);
}

/**
 * Own check-ins expressed as anonymous reports, with the weight the relay would assign, grouped by venue id.
 * Earlier-visit ('past') reports are left out: they shape only the relay's learned baseline and must never
 * count as "right now" here, nor hide a relay report as a supposed echo.
 */
function ownReports(checkIns: readonly CheckIn[]): Record<string, CrowdReport[]> {
  const out: Record<string, CrowdReport[]> = {};
  for (const c of checkIns) {
    if (c.kind !== 'past') (out[c.venueId] ??= []).push(toReport(c));
  }
  return out;
}

/** One venue's reports: own first, then relay and demo rows, dropping rows that match one of our own (our check-in echoed back by the relay; see dedupeReports). */
function reportsFor(venueId: string, mine: Record<string, CrowdReport[]>, crowd: CrowdSnapshot | null, demo: Record<string, CrowdReport[]>): CrowdReport[] {
  return dedupeReports(mine[venueId] ?? [], [...(crowd?.reports[venueId] ?? []), ...(demo[venueId] ?? [])]);
}

/**
 * Every report that counts for one venue: own check-ins, the relay (minus echoes of our own), and demo reports.
 * Not filtered by age: the spot page's consumers (fuseZones, latestReportDetails) apply their own windows.
 */
export function useVenueReports(venueId: string): CrowdReport[] {
  const my = useAppState((s) => s.myCheckIns);
  const crowd = useAppState((s) => s.crowd);
  const demo = useAppState((s) => s.demoReports);
  return useMemo(() => reportsFor(venueId, ownReports(my.filter((c) => c.venueId === venueId)), crowd, demo), [my, crowd, demo, venueId]);
}

/**
 * Fused level for every venue: own check-ins + relay snapshot + demo reports + the typical-pattern prior.
 * Keyed by venue id, for the whole directory. Recomputed on the 30-second app clock as well as on new data,
 * so report decay and freshness advance on their own.
 */
export function useLiveLevels(): Record<string, LiveLevel> {
  const venues = useVenues();
  const my = useAppState((s) => s.myCheckIns);
  const crowd = useAppState((s) => s.crowd);
  const demo = useAppState((s) => s.demoReports);
  const patterns = usePatterns();
  const phase = useTermPhase();
  const now = useNow();
  return useMemo(() => {
    const mine = ownReports(my);
    const out: Record<string, LiveLevel> = {};
    for (const v of venues) {
      const reports = reportsFor(v.venueId, mine, crowd, demo);
      out[v.venueId] = fuse({ venue: v, reports, now, phase, pattern: patterns?.[v.venueId] ?? null });
    }
    return out;
  }, [venues, my, crowd, demo, patterns, phase, now]);
}

/** Learned baselines by venue id, when the phone has downloaded them. Undefined when none is cached; hours then use the per-kind estimate or the venue's own curve. */
export function usePatterns(): Record<string, VenuePattern> | undefined {
  return useAppState((s) => s.pattern?.patterns);
}

/** The ranking plus what it was computed from, so screens can show the origin, the free block and the "Why this ranking?" numbers. */
export interface RankingView extends RankResult {
  /** The inputs given to rankVenues: origin and its label, prefs, app-clock now, free-block end, term phase, learned patterns. */
  ctx: RankContext;
  /** Today's free block in progress, or the next one today; null when none is left. */
  gap: ActiveGap | null;
  /** Where walking times are measured from: GPS (a fix inside the area), a station (the home station or the area's default one), or the area's centre. */
  originKind: 'gps' | 'station' | 'area';
}

/**
 * The ranking behind the Now tab (also used by Focus, the spot page and "Why this ranking?"): spots in
 * the student's area that are open on arrival, by score; the rest by next opening. Walks start at the
 * GPS fix when it lies inside the area's box padded by 0.05° (about 5 km), else the home station, else
 * the area's default station, else the area's centre. The free block's end feeds the "stays open" term
 * only while that block is in progress.
 */
export function useRanking(): RankingView {
  const venues = useVenues();
  const levels = useLiveLevels();
  const prefs = useAppState((s) => s.prefs);
  const stations = useAppState((s) => s.stations);
  const location = useAppState((s) => s.location);
  const patterns = usePatterns();
  const phase = useTermPhase();
  const now = useNow();
  return useMemo(() => {
    const gap = currentOrNextGap(prefs.blocks, now);
    const home = stationById(stations, prefs.homeStationId) ?? stationById(stations, AREA_DEFAULT_STATION[prefs.area]);
    const gpsInArea = location && inBBox(location, AREA_BBOX[prefs.area], 0.05);
    const origin = gpsInArea && location ? location : home ? { lat: home.lat, lng: home.lng } : { lat: (AREA_BBOX[prefs.area].minLat + AREA_BBOX[prefs.area].maxLat) / 2, lng: (AREA_BBOX[prefs.area].minLng + AREA_BBOX[prefs.area].maxLng) / 2 };
    const originKind: RankingView['originKind'] = gpsInArea ? 'gps' : home ? 'station' : 'area';
    const originLabel = originKind === 'gps' ? t('origin.you') : home ? home.name : AREA_NAME[prefs.area];
    const ctx: RankContext = { origin, originLabel, prefs, now, gapEndsAt: gap?.now ? gap.endsAt : null, phase, patterns };
    return { ...rankVenues(venues, levels, ctx), ctx, gap, originKind };
  }, [venues, levels, prefs, stations, location, patterns, phase, now]);
}

/**
 * The live session with its current block, ticking once a second while running (every 30 s when paused or idle).
 * The block is computed from absolute timestamps, so it is right again as soon as the app wakes; `now` is the
 * app-clock instant it was computed for.
 */
export function useSessionState(): { session: Session | null; block: BlockState | null; now: number } {
  const session = useAppState((s) => s.session);
  const now = useNow(session && !session.pausedAt ? 1000 : 30_000);
  const block = useMemo(() => (session ? blockAt(session, now) : null), [session, now]);
  return { session, block, now };
}

/**
 * "Your week" numbers from the local focus log: the log itself, the last-7-days summary, the streak, focus by
 * hour of day with the best 2-hour window, and focus per spot. Re-evaluated every minute so days roll over.
 * Computed on the phone and never shared.
 */
export function useFocusStats() {
  const log = useAppState((s) => s.focusLog);
  const venues = useVenues();
  const now = useNow(60_000);
  return useMemo(() => {
    const byHour = focusByHour(log);
    return { log, week: weekSummary(log, now), streak: streakDays(log, now), byHour, best: bestWindow(byHour), byVenue: focusByVenue(log, venues) };
  }, [log, venues, now]);
}
