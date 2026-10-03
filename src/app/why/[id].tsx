/**
 * "Why this ranking?" — the arithmetic behind a spot's position and level. Not AI; the formulas.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { explainTypical } from '@/domain/curve';
import { FUSION, LEVEL_BOUNDS, LEVEL_LABEL, confidenceText, levelText } from '@/domain/levels';
import { RANK_WEIGHTS, explainRank } from '@/domain/ranking';
import { primaryStation, walkFormula } from '@/domain/transit';
import { useAppState } from '@/store/appStore';
import { useLiveLevels, useNow, useRanking, useTermPhase, useVenue } from '@/store/derived';
import { Button, Callout, Group, KeyValue, SectionFooter, SectionHeader } from '@/ui/primitives';
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
  const row = [...ranking.open, ...ranking.closed].find((r) => r.venue.venueId === id) ?? null;

  if (!venue || !row) {
    return (
      <Screen title="Why this ranking?" fallback="/">
        <Callout icon="question" title="Not in the current ranking" />
        <Button title="Close" style={{ marginTop: 12 }} onPress={() => goBackOr(router, '/')} />
      </Screen>
    );
  }
  const live = levels[venue.venueId];
  const rank = ranking.open.findIndex((r) => r.venue.venueId === venue.venueId);
  const station = primaryStation(venue, stations);
  const rows = explainRank(row);

  return (
    <Screen title="Why this ranking?" fallback="/" largeTitle={rank >= 0 ? `#${rank + 1} of ${ranking.open.length} open` : 'Closed at arrival'} subtitle={venue.shortName}>
      <SectionHeader>The score</SectionHeader>
      <Group padded>
        <Text style={[styles.formula, tabular]} accessibilityLabel="Ranking formula">
          {`${RANK_WEIGHTS.seats} seats + ${RANK_WEIGHTS.proximity} proximity + ${RANK_WEIGHTS.openFit} stays open + ${RANK_WEIGHTS.noise} noise + ${RANK_WEIGHTS.amenities} amenities`}
        </Text>
      </Group>
      <Group>
        <View style={{ paddingLeft: CELL_PAD }}>
          {rows.map((r, i) => (
            <KeyValue key={r.k} k={r.k} v={r.v} last={i === rows.length - 1} />
          ))}
        </View>
      </Group>
      <SectionFooter>{row.reasons.length ? `In words: ${row.reasons.join('; ')}.` : 'Closed spots score zero and are listed by their next opening.'}</SectionFooter>

      <SectionHeader>The level</SectionHeader>
      <Group>
        <View style={{ paddingLeft: CELL_PAD }}>
          <KeyValue k="Published" v={live.open ? levelText(live) : 'Closed'} />
          <KeyValue k="Why" v={confidenceText(live, now)} />
          <KeyValue k="Fused share" v={`${Math.round(live.pct * 100)}% of a busy day (never shown as a number elsewhere)`} />
          <KeyValue k="Buckets" v={`<${LEVEL_BOUNDS[0] * 100}% ${LEVEL_LABEL[0]} · <${LEVEL_BOUNDS[1] * 100}% ${LEVEL_LABEL[1]} · <${LEVEL_BOUNDS[2] * 100}% ${LEVEL_LABEL[2]} · <${LEVEL_BOUNDS[3] * 100}% ${LEVEL_LABEL[3]} · else ${LEVEL_LABEL[4]}`} />
          <KeyValue k="Report weight" v={`${FUSION.reportBase} × proof (0.4–1.0) × ½^(age ÷ ${FUSION.halfLifeWeekdayMin} min)`} />
          <KeyValue k="Prior weight" v={`${FUSION.priorBase} × typical pattern`} />
          <KeyValue k="At arrival" v={`${levelText(row.arrival)} · today's difference from typical fades with a 45-min half-life over your ${row.walkMin}-min walk`} last />
        </View>
      </Group>
      <SectionFooter>{explainTypical(venue, now, phase)}</SectionFooter>

      <SectionHeader>Confidence rules</SectionHeader>
      <Group>
        <View style={{ paddingLeft: CELL_PAD }}>
          <KeyValue k="High" v={`≥2 reports within ${FUSION.freshMin} min that agree within one level`} />
          <KeyValue k="Medium" v={`1 report within ${FUSION.recentMin} min, or 2+ that disagree (shown as a range)`} />
          <KeyValue k="Low" v={`Only reports ${FUSION.recentMin}–${FUSION.staleMin} min old · labelled unverified`} />
          <KeyValue k="None" v="Typical pattern only · shown as a range, never a percentage" last />
        </View>
      </Group>

      {station ? (
        <>
          <SectionHeader>The walk</SectionHeader>
          <Group padded>
            <Text style={[type.body, tabular]}>{walkFormula(ranking.ctx.origin, venue)}</Text>
            <Text style={[type.footnote, { marginTop: 6 }]}>Measured from {ranking.ctx.originLabel}. From {station.name}: {walkFormula(station, venue)}.</Text>
          </Group>
        </>
      ) : null}
      <SectionFooter>Every number here comes from a formula you can read, not from a model. Same input, same output. In a crowd app, a level that cannot explain itself is not trusted.</SectionFooter>
      <Button title="Got it" onPress={() => goBackOr(router, '/')} style={{ marginTop: 8 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  formula: { fontFamily: fonts.rounded, fontSize: 17, lineHeight: 24, fontWeight: '600', color: colors.ink },
});
