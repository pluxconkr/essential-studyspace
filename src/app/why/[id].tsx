/**
 * "Why this ranking?" — three plain reasons first; the arithmetic behind them on request.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { explainTypical } from '@/domain/curve';
import { FUSION, LEVEL_BOUNDS, confidenceText, levelLabel, levelText } from '@/domain/levels';
import { RANK_WEIGHTS, explainRank } from '@/domain/ranking';
import { untilLabel } from '@/domain/hours';
import { primaryStation, walkFormula } from '@/domain/transit';
import { t } from '@/i18n';
import { useAppState } from '@/store/appStore';
import { useLiveLevels, useNow, useRanking, useTermPhase, useVenue } from '@/store/derived';
import { Button, Callout, Cell, Group, KeyValue, SectionFooter, SectionHeader } from '@/ui/primitives';
import { Screen, goBackOr } from '@/ui/Screen';
import { CELL_PAD, colors, fonts, tabular, type } from '@/ui/theme';

export default function WhyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const venue = useVenue(id);
  const levels = useLiveLevels();
  const ranking = useRanking();
  const phase = useTermPhase();
  const now = useNow();
  const stations = useAppState((s) => s.stations);
  const [showMath, setShowMath] = useState(false);
  const row = [...ranking.open, ...ranking.closed].find((r) => r.venue.venueId === id) ?? null;

  if (!venue || !row) {
    return (
      <Screen title={t('why.nav')}>
        <Callout icon="question" title={t('why.notRanked')} />
        <Button title={t('common.close')} style={{ marginTop: 12 }} onPress={() => goBackOr(router)} />
      </Screen>
    );
  }
  const live = levels[venue.venueId];
  const rank = ranking.open.findIndex((r) => r.venue.venueId === venue.venueId);
  const station = primaryStation(venue, stations);
  const rows = explainRank(row);
  const lvl = levelText(row.arrival);
  const seatsLine = !row.arrival.open ? t('why.closedWhenArrive') : row.parts.seats >= 0.6 ? t('why.seatsLikely', { level: lvl }) : row.parts.seats >= 0.35 ? t('why.someSeats', { level: lvl }) : t('why.fewSeats', { level: lvl });
  const until = untilLabel(row.state);
  const stayLine = row.stayMin === null ? t('why.closedOnArrival') : until === t('hours.open24lower') ? t('hours.open24') : until ? `${t('why.openUntil', { until })}${row.stayMin < 90 ? t('why.onlyMin', { n: row.stayMin }) : ''}` : t('why.open');

  return (
    <Screen title={t('why.nav')} largeTitle={rank >= 0 ? t('why.rank', { n: rank + 1, total: ranking.open.length }) : t('why.closedOnArrival')} subtitle={venue.shortName}>
      <Group style={{ marginTop: 8 }}>
        <Cell icon="seat" iconColor={row.parts.seats >= 0.6 ? colors.green : row.parts.seats >= 0.35 ? colors.amber : colors.red} title={seatsLine} subtitle={confidenceText(live, now)} />
        <Cell icon="walk" title={t('why.walkFrom', { n: row.walkMin, from: ranking.ctx.originLabel })} subtitle={station && ranking.originKind === 'gps' ? t('why.fromStation', { formula: walkFormula(station, venue).split(' = ')[1], station: station.name }) : undefined} />
        <Cell icon="clock" title={stayLine} />
        <Cell icon={row.parts.noise === 1 ? 'quiet' : 'noise'} iconColor={row.parts.noise === 1 ? colors.green : colors.ink2} title={row.parts.noise === 1 ? t('why.hasZone', { noise: t(`noisePref.${ranking.ctx.prefs.noisePref}` as const) }) : t('why.noZone')} last />
      </Group>

      <Group>
        <Cell icon="chart" title={showMath ? t('why.hide') : t('why.show')} accessory={showMath ? 'none' : 'chevron'} onPress={() => setShowMath((v) => !v)} accessibilityState={{ expanded: showMath }} last testID="why-math" />
      </Group>

      {showMath ? (
        <>
          <SectionHeader>{t('rank.score')}</SectionHeader>
          <Group padded>
            <Text style={[styles.formula, tabular]} accessibilityLabel={t('why.formulaA11y')}>
              {t('why.formula', { seats: RANK_WEIGHTS.seats, prox: RANK_WEIGHTS.proximity, open: RANK_WEIGHTS.openFit, noise: RANK_WEIGHTS.noise, amen: RANK_WEIGHTS.amenities })}
            </Text>
          </Group>
          <Group>
            <View style={{ paddingLeft: CELL_PAD }}>
              {rows.map((r, i) => (
                <KeyValue key={r.k} k={r.k} v={r.v} last={i === rows.length - 1} />
              ))}
            </View>
          </Group>

          <SectionHeader>{t('why.level')}</SectionHeader>
          <Group>
            <View style={{ paddingLeft: CELL_PAD }}>
              <KeyValue k={t('why.published')} v={live.open ? levelText(live) : t('hours.closed')} />
              <KeyValue k={t('why.fusedShare')} v={t('why.busyDay', { pct: Math.round(live.pct * 100) })} />
              <KeyValue k={t('why.buckets')} v={t('why.bucketsValue', { b0: LEVEL_BOUNDS[0] * 100, l0: levelLabel(0), b1: LEVEL_BOUNDS[1] * 100, l1: levelLabel(1), b2: LEVEL_BOUNDS[2] * 100, l2: levelLabel(2), b3: LEVEL_BOUNDS[3] * 100, l3: levelLabel(3), l4: levelLabel(4) })} />
              <KeyValue k={t('why.reportWeight')} v={t('why.reportWeightValue', { base: FUSION.reportBase, hl: FUSION.halfLifeWeekdayMin })} />
              <KeyValue k={t('why.priorWeight')} v={t('why.priorWeightValue', { base: FUSION.priorBase })} />
              <KeyValue k={t('why.onArrival')} v={t('why.onArrivalValue', { level: levelText(row.arrival) })} last />
            </View>
          </Group>
          <SectionFooter>{explainTypical(venue, now, phase)}</SectionFooter>

          <SectionHeader>{t('why.confidence')}</SectionHeader>
          <Group>
            <View style={{ paddingLeft: CELL_PAD }}>
              <KeyValue k={t('why.high')} v={t('why.highValue', { n: FUSION.freshMin })} />
              <KeyValue k={t('why.medium')} v={t('why.mediumValue', { n: FUSION.recentMin })} />
              <KeyValue k={t('why.low')} v={t('why.lowValue', { a: FUSION.recentMin, b: FUSION.staleMin })} />
              <KeyValue k={t('why.none')} v={t('why.noneValue')} last />
            </View>
          </Group>

          <SectionHeader>{t('why.walk')}</SectionHeader>
          <Group padded>
            <Text style={[type.body, tabular]}>{walkFormula(ranking.ctx.origin, venue)}</Text>
            {station ? <Text style={[type.footnote, { marginTop: 6 }]}>{t('why.fromStation', { formula: walkFormula(station, venue), station: station.name })}</Text> : null}
          </Group>
        </>
      ) : null}
      <Button title={t('common.done')} onPress={() => goBackOr(router)} style={{ marginTop: 8 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  formula: { ...type.headline, fontFamily: fonts.rounded },
});
