/**
 * Crowd-level widgets: bars (count, never colour alone), the level hero, the honesty line,
 * and the typical-day curve. Reference points: Apple Weather hourly strip, Reminders rows.
 *
 * Also the focus-by-hour chart of Your week and the zone and level pickers shared by the check-in and
 * earlier-visit report forms. Pure views: levels arrive already fused (domain/levels.ts), typical values come from
 * domain/curve.ts, and the clock comes in as `now`; nothing here reads the store or has side effects.
 */
import { StyleSheet, Text, View } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { learnedBucket, type TermPhase, typicalPct } from '@/domain/curve';
import { hoursOn } from '@/domain/hours';
import { ALL_LEVELS, LEVELS, confidenceText, levelBlurb, levelLabel, levelText } from '@/domain/levels';
import { hhmmToMinutes, zonedParts } from '@/domain/time';
import type { Level, LiveLevel, Venue, VenuePattern } from '@/domain/types';
import { t } from '@/i18n';

import { noiseIcon } from './icons';
import { Cell, Group, SectionHeader } from './primitives';
import { colors, fonts, tabular, toneColor, type } from './theme';

/** Tone of a level from the LEVELS table (Empty and Chill green, Filling amber, Packed and Full red); also colours the map pins. */
export function levelTone(level: Level): 'green' | 'amber' | 'red' {
  return LEVELS[level].tone;
}

/**
 * Five rising bars; filled = level + 1, in the level's tone. A range (`levelHigh` above `level`) lights the extra
 * bars at low opacity. `muted` greys the bars for a closed spot. Screen readers hear "Filling, 3 of 5 bars".
 */
export function LevelBars({ level, levelHigh = level, size = 'md', muted = false, faint = false }: { level: Level; levelHigh?: Level; size?: 'sm' | 'md' | 'lg'; muted?: boolean; /** Half strength: a level from the typical pattern with no live report. */ faint?: boolean }) {
  const w = size === 'lg' ? 10 : size === 'md' ? 7 : 5;
  const gap = size === 'lg' ? 4 : 3;
  const base = size === 'lg' ? 10 : size === 'md' ? 7 : 5;
  const step = size === 'lg' ? 5 : size === 'md' ? 3.5 : 2.5;
  const color = muted ? colors.ink4 : toneColor[levelTone(level)];
  return (
    <View style={[styles.bars, { gap }]} accessibilityLabel={t('level.bars', { level: levelText({ level, levelHigh }), n: level + 1 })} accessibilityRole="image">
      {[0, 1, 2, 3, 4].map((i) => {
        const on = i <= level;
        const range = !on && i <= levelHigh;
        return <View key={i} style={{ width: w, height: base + i * step, borderRadius: 2, backgroundColor: on ? color : range ? color : colors.fill, opacity: range ? (faint ? 0.2 : 0.35) : on && faint ? 0.45 : 1 }} />;
      })}
    </View>
  );
}

/**
 * Inline "Filling · 1 report, 6 min ago" with bars: the level and its honesty line (confidenceText), or "Closed now".
 * Used for the zone rows of a spot page and the spot rows of the Map tab.
 */
export function LevelLine({ live, now, compact }: { live: LiveLevel; now: number; /** List rows: shorten the no-report case to "typical pattern". */ compact?: boolean }) {
  const text = !live.open ? t('level.closedNow') : compact && live.confidence === 'none' ? t('level.typicalShort', { level: levelText(live) }) : `${levelText(live)} · ${confidenceText(live, now)}`;
  return (
    <View style={styles.line}>
      <LevelBars level={live.level} levelHigh={live.levelHigh} size="sm" muted={!live.open} faint={live.open && live.confidence === 'none'} />
      <Text style={[type.footnote, { flex: 1 }]}>{text}</Text>
    </View>
  );
}

/**
 * The big level block on a spot detail: label, bars, blurb, honesty line. `isDemo` (a demo scenario is running)
 * appends " · demo" to the honesty line. A closed spot shows "Closed" in grey. A polite live region, so Android
 * TalkBack reads changes.
 */
export function LevelHero({ live, now, isDemo }: { live: LiveLevel; now: number; isDemo?: boolean }) {
  const tone = levelTone(live.level);
  return (
    <View accessibilityLiveRegion="polite">
      <Text style={type.subheadline}>{t('spot.rightNow')}</Text>
      <View style={styles.heroRow}>
        <Text maxFontSizeMultiplier={1.2} style={[styles.heroLabel, { color: live.open ? toneColor[tone] : colors.ink2 }]}>
          {live.open ? levelText(live) : t('hours.closed')}
        </Text>
        <LevelBars level={live.level} levelHigh={live.levelHigh} size="lg" muted={!live.open} faint={live.open && live.confidence === 'none'} />
      </View>
      <Text style={type.subheadline}>{live.open ? levelBlurb(live.level) : t('spot.closedBlurb')}</Text>
      <Text style={[type.footnote, { marginTop: 6 }]}>
        {confidenceText(live, now)}
        {isDemo && live.open ? ` · ${t('common.demo')}` : ''}
      </Text>
    </View>
  );
}

/**
 * Typical day as 24 bars with the current hour and an optional arrival marker. Closed hours are empty.
 * Each bar is typicalPct at the half hour (the students' value where that hour is learned, else the estimate),
 * coloured by the level it falls in: the 0.45 / 0.7 cuts are written here to match LEVEL_BOUNDS. Learned hours get
 * a 2 pt underline and the legend gains "▁ student reports". Solid line = now; dashed tint line = arrival.
 *
 * It draws today's clock hours 0–23 from today's hours entry only, so the small hours still open from yesterday's
 * past-midnight close (e.g. "26:00") draw as closed, and an arrival after midnight is marked near the left edge.
 * Bar h samples local midnight + h:30, with midnight taken as `now` minus the minutes since midnight, so on a
 * DST-change day the bars on the far side of the change sample the neighbouring hour.
 */
export function HourlyCurve({ venue, now, arrivalAt, phase, pattern = null, width, height = 96 }: { venue: Venue; now: number; arrivalAt?: number | null; phase: TermPhase; pattern?: VenuePattern | null; width: number; height?: number }) {
  const p = zonedParts(now);
  const day = hoursOn(venue, p.dateKey).hours;
  const open = day ? hhmmToMinutes(day.open) : null;
  const close = day ? hhmmToMinutes(day.close) : null;
  const padL = 4;
  const padB = 16;
  const innerW = width - padL * 2;
  const bw = innerW / 24;
  const barH = height - padB - 4;
  const dayStart = now - p.minutesOfDay * 60_000;
  const bars = Array.from({ length: 24 }, (_, h) => {
    const at = dayStart + h * 3600_000 + 30 * 60_000;
    const isOpen = open !== null && close !== null && h * 60 + 30 >= open && h * 60 + 30 < close;
    return { h, pct: isOpen ? typicalPct(venue, at, phase, pattern) : 0, isOpen, learned: isOpen && learnedBucket(pattern, at) !== null };
  });
  const arrivalHour = arrivalAt ? zonedParts(arrivalAt).hour + zonedParts(arrivalAt).minute / 60 : null;
  const nowX = padL + (p.minutesOfDay / 60) * bw;
  return (
    <View accessibilityLabel={t('widgets.typicalDayA11y', { spot: venue.shortName })} accessibilityRole="image">
      <Svg width={width} height={height}>
        {bars.map((b) => {
          const hgt = Math.max(b.isOpen ? 2 : 0, b.pct * barH);
          const tone = b.pct < 0.45 ? 'green' : b.pct < 0.7 ? 'amber' : 'red';
          return (
            <G key={b.h}>
              <Rect x={padL + b.h * bw + 1} y={4 + barH - hgt} width={bw - 2} height={hgt} rx={1.5} fill={b.isOpen ? toneColor[tone] : colors.fill} opacity={b.h === p.hour ? 1 : 0.55} />
              {b.learned ? <Rect x={padL + b.h * bw + 1} y={barH + 6} width={bw - 2} height={2} fill={colors.ink} /> : null}
            </G>
          );
        })}
        <Line x1={nowX} x2={nowX} y1={2} y2={barH + 6} stroke={colors.ink} strokeWidth={1.5} />
        {arrivalHour !== null && arrivalHour >= 0 && arrivalHour < 24 ? <Line x1={padL + arrivalHour * bw} x2={padL + arrivalHour * bw} y1={2} y2={barH + 6} stroke={colors.tint} strokeWidth={1.5} strokeDasharray="3 3" /> : null}
        {[0, 6, 12, 18].map((h) => (
          <SvgText key={h} x={padL + h * bw + 1} y={height - 3} fontSize={type.chartAxis.fontSize} fill={colors.ink2} fontFamily={fonts.sans}>
            {h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}
          </SvgText>
        ))}
      </Svg>
      <View style={styles.legend}>
        <Text style={type.caption}>{t('widgets.legendNow')}</Text>
        {arrivalHour !== null ? <Text style={[type.caption, { color: colors.tint }]}>{t('widgets.legendArrival')}</Text> : null}
        {bars.some((b) => b.learned) ? <Text style={type.caption}>{t('widgets.legendLearned')}</Text> : null}
        <Text style={type.caption}>{t('widgets.legendClosed')}</Text>
      </View>
    </View>
  );
}

/**
 * Row of focus seconds by hour (profile): "When you actually focus" on Your week, over the whole focus log, scaled to
 * the busiest hour. `highlightStart` turns that hour and the next green (the best two-hour window, wrapping past midnight).
 */
export function HourBars({ values, width, height = 72, highlightStart }: { values: readonly number[]; width: number; height?: number; highlightStart?: number | null }) {
  const max = Math.max(1, ...values);
  const padB = 14;
  const bw = width / 24;
  const barH = height - padB - 2;
  return (
    <Svg width={width} height={height} accessibilityLabel={t('profile.hourChartA11y')}>
      {values.map((v, h) => {
        const hgt = Math.max(v > 0 ? 2 : 0, (v / max) * barH);
        const hi = highlightStart !== null && highlightStart !== undefined && (h === highlightStart || h === (highlightStart + 1) % 24);
        return <Rect key={h} x={h * bw + 1} y={2 + barH - hgt} width={bw - 2} height={hgt} rx={1.5} fill={hi ? colors.green : colors.tint} opacity={v > 0 ? (hi ? 1 : 0.6) : 1} />;
      })}
      {[0, 6, 12, 18].map((h) => (
        <SvgText key={h} x={h * bw + 1} y={height - 2} fontSize={type.chartAxis.fontSize} fill={colors.ink2} fontFamily={fonts.sans}>
          {h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}
        </SvgText>
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 2, marginBottom: 4 },
  heroLabel: { ...type.display, ...tabular },
  legend: { flexDirection: 'row', gap: 12, marginTop: 2 },
});

/**
 * "Where in the building" check list, shared by check-in and earlier-visit reports. Nothing for single-zone venues.
 * `null` is the whole building; each zone row shows its noise glyph and floor.
 */
export function ZonePicker({ venue, zoneId, onChange }: { venue: Venue; zoneId: string | null; onChange: (z: string | null) => void }) {
  if (venue.zones.length <= 1) return null;
  return (
    <>
      <SectionHeader>{t('checkin.whereInBuilding')}</SectionHeader>
      <Group>
        <Cell icon="pin" title={t('checkin.wholeBuilding')} accessory={zoneId === null ? 'check' : 'none'} onPress={() => onChange(null)} accessibilityRole="button" accessibilityState={{ selected: zoneId === null }} />
        {venue.zones.map((z, i) => (
          <Cell key={z.zoneId} icon={noiseIcon(z.noise)} title={z.name} subtitle={z.floor} accessory={zoneId === z.zoneId ? 'check' : 'none'} onPress={() => onChange(z.zoneId)} accessibilityRole="button" accessibilityState={{ selected: zoneId === z.zoneId }} last={i === venue.zones.length - 1} />
        ))}
      </Group>
    </>
  );
}

/**
 * The five level rows of a report form (Empty … Full, each with bars and blurb); the chosen one is checked.
 * Returns bare Cells for the caller's Group; each row's testID is `testIDPrefix` + the level number.
 */
export function LevelRows({ level, onChange, testIDPrefix }: { level: Level | null; onChange: (l: Level) => void; testIDPrefix: string }) {
  return ALL_LEVELS.map((l, i) => (
    <Cell key={l} leading={<LevelBars level={l} size="md" />} title={levelLabel(l)} subtitle={levelBlurb(l)} accessory={level === l ? 'check' : 'none'} onPress={() => onChange(l)} accessibilityRole="button" accessibilityState={{ selected: level === l }} last={i === ALL_LEVELS.length - 1} testID={`${testIDPrefix}${l}`} />
  ));
}
