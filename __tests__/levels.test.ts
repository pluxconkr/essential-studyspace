import { typicalPct } from '@/domain/curve';
import { FUSION, LEVEL_BOUNDS, bucket, confidenceText, fuse, levelText, predictAt, proofStrength, recencyDecay } from '@/domain/levels';
import type { CrowdReport, Venue } from '@/domain/types';
import venues from '@/assets/data/venues.json';

const alexander = (venues.venues as unknown as Venue[]).find((v) => v.venueId === 'alexander-library')!;
// Wednesday 7 Oct 2026, 2:00 PM EDT = 18:00Z — Alexander is open (8 AM – 2 AM).
const NOW = Date.parse('2026-10-07T18:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const rep = (level: CrowdReport['level'], min: number, weight = 1): CrowdReport => ({ venueId: alexander.venueId, zoneId: null, level, at: ago(min), weight });

describe('crowd level buckets', () => {
  test('five levels from share of capacity', () => {
    expect(bucket(0)).toBe(0);
    expect(bucket(LEVEL_BOUNDS[0] - 0.001)).toBe(0);
    expect(bucket(LEVEL_BOUNDS[0])).toBe(1);
    expect(bucket(0.5)).toBe(2);
    expect(bucket(0.8)).toBe(3);
    expect(bucket(0.95)).toBe(4);
    expect(bucket(1)).toBe(4);
  });

  test('proof strength: at the door 1.0, far away or unknown 0.4; GPS accuracy is forgiven', () => {
    expect(proofStrength(20, 10)).toBe(1);
    expect(proofStrength(null, null)).toBe(0.4);
    expect(proofStrength(500, null)).toBe(0.4);
    expect(proofStrength(120, 60)).toBe(1); // 120 m with ±60 m accuracy → treated as 60 m
    expect(proofStrength(200, 10)).toBe(0.65);
  });

  test('recency decay halves every 25 min on weekdays and 40 on weekends', () => {
    expect(recencyDecay(0, false)).toBe(1);
    expect(recencyDecay(25, false)).toBeCloseTo(0.5);
    expect(recencyDecay(40, true)).toBeCloseTo(0.5);
  });
});

describe('fusion', () => {
  test('no reports → typical pattern, confidence none, shown as a range', () => {
    const l = fuse({ venue: alexander, reports: [], now: NOW });
    expect(l.confidence).toBe('none');
    expect(l.reports).toBe(0);
    expect(l.pct).toBeCloseTo(typicalPct(alexander, NOW));
    expect(l.levelHigh).toBeGreaterThanOrEqual(l.level);
    expect(confidenceText(l, NOW)).toBe('Typical pattern · no live reports');
    expect(l.open).toBe(true);
  });

  test('one fresh report dominates the prior and is medium confidence', () => {
    const l = fuse({ venue: alexander, reports: [rep(4, 5)], now: NOW });
    expect(l.level).toBe(4);
    expect(l.confidence).toBe('medium');
    expect(confidenceText(l, NOW)).toBe('1 report, 5 min ago');
    expect(levelText(l)).toBe('Full');
  });

  test('two fresh agreeing reports → high confidence, single level', () => {
    const l = fuse({ venue: alexander, reports: [rep(3, 3), rep(3, 12)], now: NOW });
    expect(l.confidence).toBe('high');
    expect(l.level).toBe(3);
    expect(l.levelHigh).toBe(3);
    expect(confidenceText(l, NOW)).toBe('2 reports agree · newest 3 min ago');
  });

  test('two fresh disagreeing reports → medium and a range', () => {
    const l = fuse({ venue: alexander, reports: [rep(1, 4), rep(4, 8)], now: NOW });
    expect(l.confidence).toBe('medium');
    expect(l.levelHigh).toBeGreaterThan(l.level);
    expect(levelText(l)).toMatch(/ to /);
  });

  test('an old report is low confidence and labelled unverified; older than 3 h is ignored', () => {
    const low = fuse({ venue: alexander, reports: [rep(0, 70)], now: NOW });
    expect(low.confidence).toBe('low');
    expect(confidenceText(low, NOW)).toMatch(/unverified/);
    const gone = fuse({ venue: alexander, reports: [rep(0, FUSION.maxAgeMin + 1)], now: NOW });
    expect(gone.reports).toBe(0);
    expect(gone.confidence).toBe('none');
  });

  test('a stale report drifts back toward the typical pattern', () => {
    const fresh = fuse({ venue: alexander, reports: [rep(0, 2)], now: NOW });
    const stale = fuse({ venue: alexander, reports: [rep(0, 100)], now: NOW });
    const prior = typicalPct(alexander, NOW);
    expect(fresh.pct).toBeLessThan(stale.pct);
    expect(Math.abs(stale.pct - prior)).toBeLessThan(Math.abs(fresh.pct - prior));
  });

  test('closed venue reports closed', () => {
    const closedAt = Date.parse('2026-10-10T08:00:00Z'); // Saturday 4 AM EDT
    const l = fuse({ venue: alexander, reports: [], now: closedAt });
    expect(l.open).toBe(false);
    expect(confidenceText(l, closedAt)).toBe('Closed now');
  });

  test('predictAt: with no live data equals the typical curve; with live data fades toward it', () => {
    const none = fuse({ venue: alexander, reports: [], now: NOW });
    const at = NOW + 20 * 60_000;
    const p0 = predictAt(alexander, none, at, NOW);
    expect(p0.level).toBe(bucket(typicalPct(alexander, at)));
    const full = fuse({ venue: alexander, reports: [rep(4, 1), rep(4, 2)], now: NOW });
    const soon = predictAt(alexander, full, NOW + 5 * 60_000, NOW);
    const later = predictAt(alexander, full, NOW + 3 * 3600_000, NOW);
    expect(soon.level).toBeGreaterThanOrEqual(later.level);
    expect(predictAt(alexander, full, Date.parse('2026-10-10T08:00:00Z'), NOW).open).toBe(false);
  });
});
