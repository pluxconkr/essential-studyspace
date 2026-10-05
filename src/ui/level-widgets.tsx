/**
 * Crowd-level widgets: bars (count, never colour alone), the level hero, the honesty line,
 * and the typical-day curve. Reference points: Apple Weather hourly strip, Reminders rows.
 */
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { typicalPct, type TermPhase } from '@/domain/curve';
import { hoursOn } from '@/domain/hours';
import { LEVELS, confidenceText, levelBlurb, levelText } from '@/domain/levels';
import { hhmmToMinutes, zonedParts } from '@/domain/time';
import type { Level, LiveLevel, Venue } from '@/domain/types';
import { t } from '@/i18n';

import { colors, fonts, tabular, toneColor, type } from './theme';

export function levelTone(level: Level): 'green' | 'amber' | 'red' {
  return LEVELS[level].tone;
}

/** Five bars; filled = level + 1. A range lights the extra bars at half strength. */
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

/** Inline "Filling · 2 reports, 6 min ago" with bars. */
export function LevelLine({ live, now, muted, compact }: { live: LiveLevel; now: number; muted?: boolean; /** List rows: shorten the no-report case to "typical pattern". */ compact?: boolean }) {
  const text = !live.open ? t('level.closedNow') : compact && live.confidence === 'none' ? t('level.typicalShort', { level: levelText(live) }) : `${levelText(live)} · ${confidenceText(live, now)}`;
  return (
    <View style={styles.line}>
      <LevelBars level={live.level} levelHigh={live.levelHigh} size="sm" muted={muted || !live.open} faint={live.open && live.confidence === 'none'} />
      <Text style={[type.footnote, { flex: 1 }]}>{text}</Text>
    </View>
  );
}

/** The big level block on a spot detail: label, bars, blurb, honesty line. */
export function LevelHero({ live, now, isDemo }: { live: LiveLevel; now: number; isDemo?: boolean }) {
  const tone = levelTone(live.level);
  return (
    <View accessibilityLiveRegion="polite">
      <Text style={type.subheadline}>{t('spot.rightNow')}</Text>
      <View style={styles.heroRow}>
        <Text maxFontSizeMultiplier={1.2} style={[styles.heroLabel, { color: live.open ? toneColor[tone] : colors.ink2 }]}>
          {live.open ? levelText(live) : t('spot.closed')}
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

/** Typical day as 24 bars with the current hour and an optional arrival marker. Closed hours are empty. */
export function HourlyCurve({ venue, now, arrivalAt, phase, width, height = 96 }: { venue: Venue; now: number; arrivalAt?: number | null; phase: TermPhase; width: number; height?: number }) {
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
    return { h, pct: isOpen ? typicalPct(venue, at, phase) : 0, isOpen };
  });
  const arrivalHour = arrivalAt ? zonedParts(arrivalAt).hour + zonedParts(arrivalAt).minute / 60 : null;
  const nowX = padL + (p.minutesOfDay / 60) * bw;
  return (
    <View accessibilityLabel={t('widgets.typicalDayA11y', { spot: venue.shortName })} accessibilityRole="image">
      <Svg width={width} height={height}>
        {bars.map((b) => {
          const hgt = Math.max(b.isOpen ? 2 : 0, b.pct * barH);
          const tone = b.pct < 0.45 ? 'green' : b.pct < 0.7 ? 'amber' : 'red';
          return <Rect key={b.h} x={padL + b.h * bw + 1} y={4 + barH - hgt} width={bw - 2} height={hgt} rx={1.5} fill={b.isOpen ? toneColor[tone] : colors.fill} opacity={b.h === p.hour ? 1 : 0.55} />;
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
        <Text style={type.caption}>{t('widgets.legendClosed')}</Text>
      </View>
    </View>
  );
}

/** Row of focus seconds by hour (profile). */
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
