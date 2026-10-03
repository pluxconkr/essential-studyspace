/**
 * S-06 Your week · focus hours, streak, when you actually focus, where you focus. Student-owned data,
 * derived on the phone, never shared with venues or schools. Settings live below it.
 */
import { useRouter } from 'expo-router';
import { Text, View, useWindowDimensions } from 'react-native';

import { formatHourBand, goalRate } from '@/domain/focus';
import { formatDuration } from '@/domain/time';
import { useAppState } from '@/store/appStore';
import { useFocusStats } from '@/store/derived';
import { HourBars } from '@/ui/level-widgets';
import { Cell, Group, KeyValue, SectionFooter, SectionHeader } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';
import { CELL_PAD, GUTTER, colors, type } from '@/ui/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const stats = useFocusStats();
  const checkIns = useAppState((s) => s.myCheckIns);
  const rate = goalRate(stats.week);
  const chartWidth = Math.min(width - GUTTER * 2 - CELL_PAD * 2, 600);

  return (
    <Screen title="Your week" largeTitle="Your week" subtitle={`${stats.streak}-day streak · ${formatDuration(stats.week.focusSeconds)} focused in the last 7 days`} fallback="/">
      <Group style={{ marginTop: 8 }}>
        <View style={{ paddingLeft: CELL_PAD }}>
          <KeyValue k="Focused time" v={formatDuration(stats.week.focusSeconds)} />
          <KeyValue k="Sessions" v={String(stats.week.sessions)} />
          <KeyValue k="Goals completed" v={rate === null ? 'no goals set' : `${rate}% (${stats.week.goalsDone} of ${stats.week.goalsTotal})`} />
          <KeyValue k="Crowd check-ins" v={`${checkIns.length} in the last 30 days`} />
          <KeyValue k="Streak" v={`${stats.streak} day${stats.streak === 1 ? '' : 's'} with 25+ min`} last />
        </View>
      </Group>

      <SectionHeader>When you actually focus</SectionHeader>
      <Group padded>
        {stats.log.length === 0 ? (
          <Text style={type.subheadline}>No sessions yet. The chart fills in as you study.</Text>
        ) : (
          <>
            <HourBars values={stats.byHour} width={chartWidth} highlightStart={stats.best?.startHour ?? null} />
            <Text style={[type.footnote, { marginTop: 6 }]}>{stats.best ? `Best window: ${formatHourBand(stats.best.startHour)} — ${formatDuration(stats.best.seconds)} of focus logged there.` : ''} StudySpace uses this to suggest when to study, not just where.</Text>
          </>
        )}
      </Group>

      <SectionHeader>Where you focus</SectionHeader>
      <Group>
        {stats.byVenue.length === 0 ? (
          <Cell icon="pin" iconColor={colors.ink2} title="Nowhere yet" subtitle="Pick a spot when you start a session." last />
        ) : (
          stats.byVenue.slice(0, 6).map((v, i) => <Cell key={v.venueId ?? 'none'} icon={v.venueId ? 'library' : 'solo'} title={v.name} subtitle={`${v.sessions} session${v.sessions === 1 ? '' : 's'}`} value={formatDuration(v.seconds)} last={i === Math.min(6, stats.byVenue.length) - 1} />)
        )}
      </Group>
      <SectionFooter>Your focus log is yours — exportable from Offline data, deletable, and never sold to venues or shared with schools. There is no leaderboard; a precise score turns into a status game.</SectionFooter>

      <SectionHeader>Settings</SectionHeader>
      <Group>
        <Cell icon="settings" title="Preferences" subtitle="Area, station, noise, outlets, step-free" accessory="chevron" onPress={() => router.push('/prefs')} />
        <Cell icon="calendar" title="Free blocks" subtitle="Your gaps between classes" accessory="chevron" onPress={() => router.push('/blocks')} />
        <Cell icon="download" title="Offline data & demo" subtitle="What is saved, sharing, notifications, scenarios, reset" accessory="chevron" onPress={() => router.push('/data')} last />
      </Group>
    </Screen>
  );
}
