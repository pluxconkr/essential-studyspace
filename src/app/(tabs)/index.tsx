/**
 * S-01 Now (tab 1, home). Answers only: where is there a seat right now, and will there be one when I arrive.
 * Layout follows Apple Weather: large title, status line, grouped content. Never a bare percentage.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatBlock } from '@/domain/blocks';
import { haversineM } from '@/domain/geo';
import { minutesToClose } from '@/domain/hours';
import { levelText } from '@/domain/levels';
import { formatClock, formatDuration, formatIn, formatShort, zonedParts, zonedToEpoch } from '@/domain/time';
import { formatHourBand } from '@/domain/focus';
import { applyDemoScenario } from '@/services/demo';
import { acquireLocation } from '@/services/location';
import { refreshAll } from '@/services/refresh';
import { isOfflineNow, useAppState } from '@/store/appStore';
import { useFocusStats, useRanking } from '@/store/derived';
import { kindIcon } from '@/ui/icons';
import { LevelBars } from '@/ui/level-widgets';
import { Button, Callout, Cell, Group, SectionFooter, SectionHeader, Subhead } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';
import { colors, tabular, type } from '@/ui/theme';

export default function NowScreen() {
  const router = useRouter();
  const ranking = useRanking();
  const stats = useFocusStats();
  const offline = useAppState((s) => isOfflineNow(s));
  const refreshing = useAppState((s) => s.refreshing);
  const scenario = useAppState((s) => s.settings.demoScenario);
  const locStatus = useAppState((s) => s.locationStatus);
  const location = useAppState((s) => s.location);
  const session = useAppState((s) => s.session);
  const now = ranking.ctx.now;

  // Deep-link scenario switch for demos and testing: studyspace://?demo=finals|quiet|late|live
  const { demo } = useLocalSearchParams<{ demo?: string }>();
  useEffect(() => {
    if (demo === 'finals' || demo === 'quiet' || demo === 'late' || demo === 'live') applyDemoScenario(demo);
  }, [demo]);

  useEffect(() => {
    if (locStatus === 'idle') void acquireLocation();
  }, [locStatus]);

  const note = scenario !== 'live' ? `Demo scenario · simulated reports · clock set to ${formatShort(now)}` : undefined;
  const top = ranking.open.slice(0, 6);
  const closed = ranking.closed.slice(0, 4);

  // Closing soon: open spots with under an hour left, measured from now.
  const closingSoon = useMemo(() => ranking.open.filter((r) => (minutesToClose(r.state, now) ?? 999) <= 60).sort((a, b) => (minutesToClose(a.state, now) ?? 0) - (minutesToClose(b.state, now) ?? 0)), [ranking.open, now]);
  // After 6 PM: what is still open past midnight tonight.
  const p = zonedParts(now);
  const midnight = zonedToEpoch(p.dateKey, 1440);
  const lateOpen = useMemo(() => (p.minutesOfDay >= 18 * 60 ? ranking.open.filter((r) => (r.state.closesAt ?? 0) > midnight) : []), [ranking.open, midnight, p.minutesOfDay]);

  const gap = ranking.gap;
  const gapTitle = gap ? (gap.now ? `Your ${formatBlock(gap.block)} gap · ${formatDuration((gap.endsAt - now) / 1000)} left` : `Next gap ${formatBlock(gap.block)} · starts ${formatIn(gap.startsAt - now)}`) : 'No free block saved for today';
  const gapSub = gap ? (gap.now ? `Ranking spots that stay open until ${formatClock(gap.endsAt)}, measured from ${ranking.ctx.originLabel}` : `Walking minutes measured from ${ranking.ctx.originLabel}`) : 'Add your gaps between classes to rank by "open until my next class"';

  const nearestForCheckIn = () => {
    const inArea = ranking.open.concat(ranking.closed);
    if (location) {
      const sorted = [...inArea].sort((a, b) => haversineM(location, a.venue) - haversineM(location, b.venue));
      if (sorted[0]) return sorted[0].venue.venueId;
    }
    return top[0]?.venue.venueId ?? inArea[0]?.venue.venueId ?? null;
  };

  return (
    <Screen largeTitle="Now" status note={note} testID="now">
      <Group style={{ marginTop: 8 }}>
        <Cell icon="gap" title={gapTitle} subtitle={gapSub} accessory="chevron" onPress={() => router.push('/blocks')} last testID="gap-cell" />
      </Group>

      {closingSoon.length > 0 ? (
        <Callout icon="closing" tone="amber" title={`${closingSoon[0].venue.shortName} closes ${formatIn((closingSoon[0].state.closesAt ?? now) - now)}`}>
          <Subhead>
            {closingSoon.length > 1 ? `${closingSoon.slice(1, 3).map((r) => r.venue.shortName).join(' and ')} also close within the hour. ` : ''}
            {lateOpen.length > 0 ? `${lateOpen.map((r) => r.venue.shortName).join(', ')} ${lateOpen.length === 1 ? 'stays' : 'stay'} open past midnight.` : ''}
          </Subhead>
        </Callout>
      ) : lateOpen.length > 0 && lateOpen.length <= 3 ? (
        <Callout icon="moon" tone="navy" title={`Open past midnight tonight: ${lateOpen.map((r) => r.venue.shortName).join(', ')}`}>
          <Subhead>Everything else in {ranking.ctx.originLabel === 'you' ? 'your area' : 'the area'} closes by midnight. Check the access note before you go — some late hours need a student ID.</Subhead>
        </Callout>
      ) : null}

      <SectionHeader right={ranking.originKind === 'gps' ? 'From your position' : `From ${ranking.ctx.originLabel}`}>Open near you</SectionHeader>
      <Group>
        {top.length === 0 ? (
          <Cell icon="moon" iconColor={colors.ink2} title="Nothing is open right now" subtitle={closed[0]?.state.opensAt ? `First to open: ${closed[0].venue.shortName} ${formatShort(closed[0].state.opensAt)}` : 'Check the list below for opening times.'} last />
        ) : (
          top.map((r, i) => (
            <Cell
              key={r.venue.venueId}
              leading={<LevelBars level={r.arrival.level} levelHigh={r.arrival.levelHigh} size="md" />}
              title={r.venue.shortName}
              subtitle={
                <View>
                  <Text style={[type.footnote, { marginTop: 2 }]}>
                    {levelText(r.live)} now · {levelText(r.arrival)} when you arrive
                  </Text>
                  <Text style={[type.footnote, tabular, { marginTop: 2 }]}>
                    {r.state.closesAt ? `Closes ${formatClock(r.state.closesAt)}` : 'Open'}
                    {r.stayMin !== null && r.stayMin < 90 ? ` · only ${r.stayMin} min after you arrive` : ''}
                    {r.venue.access !== 'public' ? ' · student ID' : ''}
                  </Text>
                </View>
              }
              value={`${r.walkMin} min`}
              accessory="chevron"
              onPress={() => router.push({ pathname: '/spot/[id]', params: { id: r.venue.venueId } })}
              accessibilityLabel={`${r.venue.shortName}, ${levelText(r.live)} now, ${levelText(r.arrival)} at arrival, ${r.walkMin} minute walk`}
              last={i === top.length - 1}
            />
          ))
        )}
      </Group>
      <SectionFooter>Level when you arrive is a forecast: today&apos;s reports blended back toward the typical pattern over the walk. Tap a spot, then &quot;Why this ranking?&quot; for the arithmetic.</SectionFooter>

      {closed.length > 0 ? (
        <>
          <SectionHeader>Closed now</SectionHeader>
          <Group>
            {closed.map((r, i) => (
              <Cell key={r.venue.venueId} icon={kindIcon(r.venue.kind)} iconColor={colors.ink2} title={r.venue.shortName} subtitle={r.state.opensAt ? `Opens ${formatShort(r.state.opensAt)}` : 'No opening found in the next two weeks'} value={`${r.walkMin} min`} accessory="chevron" onPress={() => router.push({ pathname: '/spot/[id]', params: { id: r.venue.venueId } })} last={i === closed.length - 1} />
            ))}
          </Group>
        </>
      ) : null}

      <SectionHeader>Your week</SectionHeader>
      <Group>
        <Cell
          icon="flame"
          iconColor={stats.streak > 0 ? colors.amber : colors.ink2}
          title={`${stats.streak}-day streak · ${formatDuration(stats.week.focusSeconds)} focused`}
          subtitle={session ? 'A session is running — open the Focus tab' : stats.best ? `You focus best around ${formatHourBand(stats.best.startHour)}` : 'Start a focus session to begin a log that stays on this phone'}
          accessory="chevron"
          onPress={() => router.push('/profile')}
          last
        />
      </Group>

      <View style={styles.actions}>
        <Button
          title="Check in where I am"
          icon="checkin"
          onPress={() => {
            const id = nearestForCheckIn();
            if (id) router.push({ pathname: '/checkin/[id]', params: { id } });
          }}
          disabled={ranking.open.length + ranking.closed.length === 0}
        />
        <Button title={session ? 'Back to your session' : 'Start a focus session'} icon="focus" variant="tonal" onPress={() => router.push('/focus')} />
        <Button title={refreshing ? 'Checking live levels…' : offline ? 'No signal — will check automatically' : 'Check live levels now'} variant="secondary" disabled={offline || refreshing} onPress={() => void refreshAll()} />
      </View>
      <SectionFooter style={{ textAlign: 'center' }}>Hours from each library&apos;s published schedule · Levels from student check-ins and a labelled typical pattern · Map © OpenStreetMap contributors</SectionFooter>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8, marginTop: 10 },
});
