/**
 * Offline vector map of one pilot area: OSM water, rail, light rail, named roads (bundled, simplified),
 * station glyphs, venue pins coloured by crowd level, and the GPS dot. No tiles, no network,
 * no API keys. Attribution is always visible (ODbL requirement).
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { MAPS } from '@/data/mapData';
import { AREA_BBOX, AREA_NAME } from '@/domain/areas';
import { lineToPath, makeProjection } from '@/domain/geo';
import type { Area, LiveLevel, LocationFix, Station, Venue } from '@/domain/types';
import { t } from '@/i18n';

import { levelTone } from './level-widgets';
import { colors, fonts, toneColor, type } from './theme';

export function AreaMap({
  area,
  venues,
  levels,
  stations,
  location,
  selectedId,
  onSelect,
  width,
  height,
}: {
  area: Area;
  venues: Venue[];
  levels: Record<string, LiveLevel>;
  stations: Station[];
  location: LocationFix | null;
  selectedId?: string | null;
  onSelect?: (v: Venue) => void;
  width: number;
  height: number;
}) {
  const data = MAPS[area];
  const proj = useMemo(() => makeProjection(AREA_BBOX[area], width, height, 0), [area, width, height]);
  const water = useMemo(() => data.water.map((l) => lineToPath(l, proj)), [data, proj]);
  const rail = useMemo(() => data.rail.map((l) => lineToPath(l, proj)), [data, proj]);
  const light = useMemo(() => data.lightRail.map((l) => lineToPath(l, proj)), [data, proj]);
  const roads = useMemo(() => data.roads.map((r) => ({ ...r, d: lineToPath(r.pts, proj) })), [data, proj]);
  const pins = useMemo(() => venues.filter((v) => v.area === area).map((v) => ({ v, ...proj.toXY(v) })), [venues, area, proj]);
  const stationPins = useMemo(() => stations.filter((s) => s.area === area).map((s) => ({ s, ...proj.toXY(s) })), [stations, area, proj]);
  // Road labels: the longest segment of each labelled road, placed at its midpoint unless a pin sits there.
  const labels = useMemo(() => {
    const best = new Map<string, { pts: [number, number][]; len: number }>();
    for (const r of data.roads) {
      if (!r.label || r.pts.length < 2) continue;
      let len = 0;
      for (let i = 1; i < r.pts.length; i++) len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
      const cur = best.get(r.name);
      if (!cur || len > cur.len) best.set(r.name, { pts: r.pts, len });
    }
    const out: { name: string; x: number; y: number }[] = [];
    for (const [name, { pts }] of best) {
      const mid = pts[Math.floor(pts.length / 2)];
      const p = proj.toXY({ lng: mid[0], lat: mid[1] });
      if (p.x < 30 || p.x > width - 30 || p.y < 14 || p.y > height - 14) continue;
      if (pins.some((pin) => Math.hypot(pin.x - p.x, pin.y - p.y) < 26)) continue;
      out.push({ name: name.replace('State Route 18', 'Route 18'), x: p.x, y: p.y });
    }
    return out;
  }, [data, proj, pins, width, height]);
  const you = location ? proj.toXY(location) : null;
  const youInside = !!you && you.x >= 0 && you.x <= width && you.y >= 0 && you.y <= height;

  return (
    <View style={[styles.wrap, { width, height }]} accessibilityLabel={`${t('map.alt', { area: AREA_NAME[area], n: pins.length })}${youInside ? t('map.altYou') : ''}`} accessibilityRole="image">
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Rect x={0} y={0} width={width} height={height} fill="#F7F8FA" />
        <G>
          {water.map((d, i) => (
            <Path key={`w${i}`} d={d} stroke="#BBD3EE" strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </G>
        <G>
          {roads
            .filter((r) => r.class === 'minor')
            .map((r, i) => (
              <Path key={`rm${i}`} d={r.d} stroke="#E0E2E7" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
          {roads
            .filter((r) => r.class === 'major')
            .map((r, i) => (
              <Path key={`rM${i}`} d={r.d} stroke="#D3D6DD" strokeWidth={3.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
        </G>
        <G>
          {rail.map((d, i) => (
            <Path key={`r${i}`} d={d} stroke="#8B8F98" strokeWidth={1.6} fill="none" strokeDasharray="6 3" />
          ))}
          {light.map((d, i) => (
            <Path key={`l${i}`} d={d} stroke="#5E8ED6" strokeWidth={1.4} fill="none" strokeDasharray="3 3" />
          ))}
        </G>
        <G>
          {labels.map((l) => (
            <G key={l.name}>
              <SvgText x={l.x} y={l.y} fontSize={type.mapLabel.fontSize} fontWeight={type.mapLabel.fontWeight} fill="#F7F8FA" stroke="#F7F8FA" strokeWidth={3} fontFamily={fonts.sans} textAnchor="middle">
                {l.name}
              </SvgText>
              <SvgText x={l.x} y={l.y} fontSize={type.mapLabel.fontSize} fontWeight={type.mapLabel.fontWeight} fill={colors.ink2} fontFamily={fonts.sans} textAnchor="middle">
                {l.name}
              </SvgText>
            </G>
          ))}
        </G>
        <G>
          {stationPins.map(({ s, x, y }) => (
            <G key={s.stationId}>
              <Rect x={x - 7} y={y - 7} width={14} height={14} rx={3} fill={colors.ink} />
              <SvgText x={x} y={y + 3.5} fontSize={type.mapPin.fontSize} fontWeight={type.mapPin.fontWeight} fill={colors.white} textAnchor="middle" fontFamily={fonts.sans}>
                T
              </SvgText>
              <SvgText x={x + 10} y={y + 3.5} fontSize={type.mapLabel.fontSize} fontWeight={type.mapLabel.fontWeight} fill={colors.ink} fontFamily={fonts.sans}>
                {s.name}
              </SvgText>
            </G>
          ))}
        </G>
        <G>
          {pins.map(({ v, x, y }) => {
            const live = levels[v.venueId];
            const on = v.venueId === selectedId;
            const fill = live && live.open ? toneColor[levelTone(live.level)] : colors.ink4;
            return (
              <G key={v.venueId} onPress={onSelect ? () => onSelect(v) : undefined}>
                <Circle cx={x} cy={y} r={on ? 13 : 10} fill={fill} stroke={colors.white} strokeWidth={2} />
                <SvgText x={x} y={y + 4} fontSize={type.mapPin.fontSize} fontWeight={type.mapPin.fontWeight} fill={colors.white} textAnchor="middle" fontFamily={fonts.sans}>
                  {live && live.open ? String(live.level + 1) : '–'}
                </SvgText>
              </G>
            );
          })}
        </G>
        {youInside && you ? (
          <G>
            <Circle cx={you.x} cy={you.y} r={16} fill="rgba(31,85,166,0.18)" />
            <Circle cx={you.x} cy={you.y} r={7} fill={colors.tint} stroke={colors.white} strokeWidth={3} />
          </G>
        ) : null}
        <G transform={`translate(${width - 22} 26)`}>
          <Path d="M0 -10 L5 6 L0 3 L-5 6 Z" fill={colors.ink2} />
          <SvgText x={0} y={18} fontSize={type.mapPin.fontSize} fontWeight={type.mapPin.fontWeight} fill={colors.ink2} textAnchor="middle">
            N
          </SvgText>
        </G>
      </Svg>
      <View style={styles.tag} pointerEvents="none">
        <Text maxFontSizeMultiplier={1.3} style={styles.tagText}>{AREA_NAME[area]}</Text>
      </View>
      {location && !youInside ? (
        <View style={styles.offMap}>
          <Text maxFontSizeMultiplier={1.3} style={styles.offMapText}>{t('map.offMap')}</Text>
        </View>
      ) : null}
      <View style={styles.attrib} pointerEvents="none">
        <Text maxFontSizeMultiplier={1.3} style={styles.attribText}>© OpenStreetMap contributors</Text>
      </View>
    </View>
  );
}

/** Legend row rendered under the map. Numbers in pins are the bar count (1 = Empty … 5 = Full). */
export function MapLegend({ hasPosition }: { hasPosition: boolean }) {
  return (
    <View style={styles.legend}>
      {(
        [
          ['green', t('map.legend.low')],
          ['amber', t('map.legend.mid')],
          ['red', t('map.legend.high')],
        ] as const
      ).map(([tone, label]) => (
        <View key={tone} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: toneColor[tone] }]} />
          <Text style={styles.legendText}>{label}</Text>
        </View>
      ))}
      <View style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: colors.tint, opacity: hasPosition ? 1 : 0.35 }]} />
        <Text style={styles.legendText}>{hasPosition ? t('map.legend.you') : t('map.legend.noFix')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#F7F8FA', borderRadius: 12, overflow: 'hidden' },
  attrib: { position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(255,255,255,0.85)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5 },
  attribText: { ...type.mapAttribution },
  tag: { position: 'absolute', top: 8, left: 8 },
  tagText: { ...type.mapTag },
  offMap: { position: 'absolute', top: 30, left: 8, backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  offMapText: { ...type.caption2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.white },
  legendText: { ...type.legend },
});
