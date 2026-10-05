/**
 * Demo scenarios for judging and the submission video. They inject simulated reports (always
 * labelled "demo") and shift the app clock so hours logic can be shown at any time of day.
 * 'live' = real data only.
 */
import { AREA_BBOX } from '@/domain/areas';
import { inBBox } from '@/domain/geo';
import { isOpenAt } from '@/domain/hours';
import { setClockOffset, zonedParts, zonedToEpoch } from '@/domain/time';
import { t } from '@/i18n';
import type { CrowdReport, DemoScenario, Level, Venue } from '@/domain/types';
import { actions, getState } from '@/store/appStore';

/** Local time of day each scenario is shown at (minutes from midnight). */
export const SCENARIO_CLOCK: Record<Exclude<DemoScenario, 'live'>, number> = {
  finals: 15 * 60, // 3:00 PM — the afternoon crunch
  quiet: 9 * 60 + 30, // 9:30 AM — libraries just opened
  late: 23 * 60 + 35, // 11:35 PM — most places close at midnight
};

export const scenarioLabel = (s: DemoScenario) => t(`demo.${s}` as const);

/** Clock offset that makes "now" read as the scenario time on the current local date (weekday scenarios move to the next weekday). */
export function clockOffsetFor(scenario: DemoScenario, realNow: number = Date.now()): number {
  if (scenario === 'live') return 0;
  const p = zonedParts(realNow);
  let key = p.dateKey;
  // Finals and late-night are weekday stories; shift Saturday/Sunday to Monday.
  if (p.weekday === 6) key = shift(key, 2);
  else if (p.weekday === 0) key = shift(key, 1);
  return zonedToEpoch(key, SCENARIO_CLOCK[scenario]) - realNow;
}

function shift(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Deterministic pseudo-random in [0,1) from a string, so the same scenario looks the same every time. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

const clampLevel = (n: number): Level => Math.max(0, Math.min(4, Math.round(n))) as Level;

/** Simulated recent reports per open venue in the area, relative to the (shifted) app clock. */
export function buildDemoReports(scenario: DemoScenario, venues: readonly Venue[], now: number): Record<string, CrowdReport[]> {
  if (scenario === 'live') return {};
  const out: Record<string, CrowdReport[]> = {};
  for (const v of venues) {
    if (!isOpenAt(v, now)) continue;
    const r = hash01(v.venueId);
    let base: number;
    if (scenario === 'finals') base = v.kind === 'library' ? 3.4 + r * 0.8 : v.kind === 'student-center' ? 2 + r : 1.5 + r;
    else if (scenario === 'quiet') base = v.kind === 'cafe' ? 1.5 + r : 0.2 + r * 0.9;
    else base = v.kind === 'library' ? 1 + r : 0.5 + r; // late night: calm
    const count = scenario === 'finals' ? 3 : 2;
    const list: CrowdReport[] = [];
    for (let i = 0; i < count; i++) {
      const ageMin = 4 + Math.floor(hash01(`${v.venueId}:${i}`) * 14) + i * 6; // 4–40 min old
      list.push({ venueId: v.venueId, zoneId: null, level: clampLevel(base + (hash01(`${v.venueId}:${i}:l`) - 0.5)), at: new Date(now - ageMin * 60_000).toISOString(), weight: 0.85 + hash01(`${v.venueId}:${i}:w`) * 0.15 });
    }
    out[v.venueId] = list;
  }
  return out;
}

/** Apply a scenario: shift the clock, inject labelled reports, remember the choice. */
export function applyDemoScenario(scenario: DemoScenario, realNow: number = Date.now()): void {
  const offset = clockOffsetFor(scenario, realNow);
  setClockOffset(offset);
  actions.patchSettings({ demoScenario: scenario, demoClockOffsetMs: offset });
  const now = realNow + offset;
  const { venues, prefs } = getState();
  const inArea = venues.filter((v) => v.area === prefs.area || inBBox(v, AREA_BBOX[prefs.area]));
  actions.setDemoReports(buildDemoReports(scenario, inArea, now));
}

/** Re-materialise the persisted scenario at boot (offsets are relative to today). */
export function restoreDemoScenario(): void {
  const s = getState().settings.demoScenario;
  if (s !== 'live') applyDemoScenario(s);
}

export function isDemoActive(): boolean {
  return getState().settings.demoScenario !== 'live';
}

