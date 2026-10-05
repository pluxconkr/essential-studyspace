/**
 * S-06 Your week · focus hours, streak, when you actually focus, where you focus. Student-owned data,
 * derived on the phone, never shared with venues or schools. Settings live below it.
 */
import { useRouter } from 'expo-router';
import { Text, View, useWindowDimensions } from 'react-native';

import { formatHourBand, goalRate } from '@/domain/focus';
import { wastedTrips } from '@/domain/honesty';
import { formatDuration } from '@/domain/time';
import { t, tn } from '@/i18n';
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
  const honesty = wastedTrips(checkIns);
  const chartWidth = Math.min(width - GUTTER * 2 - CELL_PAD * 2, 600);

  return (
    <Screen title={t('profile.nav')} largeTitle={t('profile.nav')} subtitle={t('profile.subtitle', { n: stats.streak, time: formatDuration(stats.week.focusSeconds) })}>
      <Group style={{ marginTop: 8 }}>
        <View style={{ paddingLeft: CELL_PAD }}>
          <KeyValue k={t('profile.focusedTime')} v={formatDuration(stats.week.focusSeconds)} />
          <KeyValue k={t('profile.sessions')} v={String(stats.week.sessions)} />
          <KeyValue k={t('profile.goals')} v={rate === null ? t('profile.noGoals') : t('profile.goalsValue', { pct: rate, done: stats.week.goalsDone, total: stats.week.goalsTotal })} />
          <KeyValue k={t('profile.checkIns')} v={t('profile.checkInsValue', { n: checkIns.length })} />
          <KeyValue k={t('profile.streak')} v={tn(stats.streak, 'profile.streakValue')} />
          <KeyValue k={t('profile.honesty')} v={honesty.total === 0 ? t('profile.honestyNone') : t('profile.honestyValue', { a: honesty.withinOne, b: honesty.total })} last />
        </View>
      </Group>

      <SectionHeader>{t('profile.whenFocus')}</SectionHeader>
      <Group padded>
        {stats.log.length === 0 ? (
          <Text style={type.subheadline}>{t('profile.noSessions')}</Text>
        ) : (
          <>
            <HourBars values={stats.byHour} width={chartWidth} highlightStart={stats.best?.startHour ?? null} />
            <Text style={[type.footnote, { marginTop: 6 }]}>{stats.best ? t('profile.bestWindow', { band: formatHourBand(stats.best.startHour), time: formatDuration(stats.best.seconds) }) : ''}</Text>
          </>
        )}
      </Group>

      <SectionHeader>{t('profile.whereFocus')}</SectionHeader>
      <Group>
        {stats.byVenue.length === 0 ? (
          <Cell icon="pin" iconColor={colors.ink2} title={t('profile.nowhere')} subtitle={t('profile.pickSpot')} last />
        ) : (
          stats.byVenue.slice(0, 6).map((v, i) => <Cell key={v.venueId ?? 'none'} icon={v.venueId ? 'library' : 'solo'} title={v.name} subtitle={tn(v.sessions, 'profile.sessionsCount')} value={formatDuration(v.seconds)} last={i === Math.min(6, stats.byVenue.length) - 1} />)
        )}
      </Group>
      <SectionFooter>{t('profile.staysFooter')}</SectionFooter>

      <SectionHeader>{t('profile.settings')}</SectionHeader>
      <Group>
        <Cell icon="settings" title={t('prefs.nav')} accessory="chevron" onPress={() => router.push('/prefs')} />
        <Cell icon="calendar" title={t('blocks.nav')} accessory="chevron" onPress={() => router.push('/blocks')} />
        <Cell icon="download" title={t('data.nav')} accessory="chevron" onPress={() => router.push('/data')} />
        <Cell icon="shield" title={t('privacy.nav')} accessory="chevron" onPress={() => router.push('/privacy')} last />
      </Group>
    </Screen>
  );
}
