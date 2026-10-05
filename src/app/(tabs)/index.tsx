/**
 * S-01 Now (tab 1, home). Answers only: where is there a seat right now, and will there be one when I arrive.
 * Layout follows Apple Weather: large title, status line, grouped content. Never a bare percentage.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';

import { arrivalCandidate } from '@/domain/arrival';
import { formatBlock } from '@/domain/blocks';
import { haversineM } from '@/domain/geo';
import { isClosingSoon, minutesToClose, untilLabel } from '@/domain/hours';
import { levelText } from '@/domain/levels';
import { formatClock, formatDuration, formatIn, formatShort, zonedParts, zonedToEpoch } from '@/domain/time';
import { formatHourBand } from '@/domain/focus';
import { t, tn } from '@/i18n';
import { applyDemoScenario } from '@/services/demo';
import { acquireLocation } from '@/services/location';
import { refreshAll } from '@/services/refresh';
import { useAppState } from '@/store/appStore';
import { useFocusStats, useRanking, useRealNow, useVenues } from '@/store/derived';
import { kindIcon } from '@/ui/icons';
import { LevelBars } from '@/ui/level-widgets';
import { Button, Callout, Cell, Group, SectionHeader, Subhead } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';
import { colors } from '@/ui/theme';

export default function NowScreen() {
  const router = useRouter();
  const ranking = useRanking();
  const stats = useFocusStats();
  const refreshing = useAppState((s) => s.refreshing);
  const scenario = useAppState((s) => s.settings.demoScenario);
  const locStatus = useAppState((s) => s.locationStatus);
  const location = useAppState((s) => s.location);
  const session = useAppState((s) => s.session);
  const myCheckIns = useAppState((s) => s.myCheckIns);
  const venues = useVenues();
  const realNow = useRealNow(10_000);
  const now = ranking.ctx.now;
  const area = ranking.ctx.prefs.area;

  // Deep-link scenario switch for demos and testing: studyspace://?demo=finals|quiet|late|live
  const { demo } = useLocalSearchParams<{ demo?: string }>();
  useEffect(() => {
    if (!__DEV__) return; // a link or QR code must never be able to shift a production build's clock
    if (demo === 'finals' || demo === 'quiet' || demo === 'late' || demo === 'live') applyDemoScenario(demo);
  }, [demo]);

  // Standing at a spot with no report there in the last 30 minutes → offer a one-tap check-in.
  const arrival = useMemo(() => arrivalCandidate(venues.filter((v) => v.area === area), location, myCheckIns, now, realNow), [venues, area, location, myCheckIns, now, realNow]);

  useEffect(() => {
    if (locStatus === 'idle') void acquireLocation();
  }, [locStatus]);

  const note = scenario !== 'live' ? t('demo.clock', { time: formatShort(now) }) : undefined;
  const top = ranking.open.slice(0, 6);
  const closed = ranking.closed.slice(0, 4);

  const closingSoon = useMemo(() => ranking.open.filter((r) => isClosingSoon(r.state, now)).sort((a, b) => (minutesToClose(a.state, now) ?? 0) - (minutesToClose(b.state, now) ?? 0)), [ranking.open, now]);
  const p = zonedParts(now);
  const midnight = zonedToEpoch(p.dateKey, 1440);
  const lateOpen = useMemo(() => (p.minutesOfDay >= 18 * 60 ? ranking.open.filter((r) => (r.state.closesAt ?? 0) > midnight) : []), [ranking.open, midnight, p.minutesOfDay]);

  const gap = ranking.gap;
  const gapTitle = gap ? (gap.now ? t('now.freeUntil', { time: formatClock(gap.endsAt), left: formatDuration((gap.endsAt - now) / 1000) }) : t('now.nextGap', { block: formatBlock(gap.block) })) : t('now.noBlock');
  const from = ranking.originKind === 'gps' ? t('now.yourPosition') : ranking.ctx.originLabel;
  const gapSub = gap ? t('now.rankingUntil', { from }) : t('now.addGaps');

  const nearestForCheckIn = () => {
    const inArea = ranking.open.concat(ranking.closed);
    if (location) {
      const sorted = [...inArea].sort((a, b) => haversineM(location, a.venue) - haversineM(location, b.venue));
      if (sorted[0]) return sorted[0].venue.venueId;
    }
    return top[0]?.venue.venueId ?? inArea[0]?.venue.venueId ?? null;
  };

  const rowSub = (r: (typeof top)[number]) => {
    const parts = [t('now.rowLevels', { now: levelText(r.live), arrival: levelText(r.arrival) })];
    const until = untilLabel(r.state);
    if (until) parts.push(until);
    if (r.venue.access !== 'public') parts.push(t('now.rowId'));
    return parts.join(' · ');
  };

  return (
    <Screen largeTitle={t('tab.now')} status note={note} testID="now" onRefresh={() => void refreshAll()} refreshing={refreshing}>
      <Group style={{ marginTop: 8 }}>
        <Cell icon="gap" title={gapTitle} subtitle={gapSub} accessory="chevron" onPress={() => router.push('/blocks')} last testID="gap-cell" />
      </Group>

      {arrival ? (
        <Callout icon="checkin" tone="navy" title={t('now.arrival', { spot: arrival.shortName })}>
          <Subhead>{t('checkin.title')}</Subhead>
          <Button title={t('checkin.nav')} size="sm" variant="tonal" style={{ marginTop: 10, alignSelf: 'flex-start' }} onPress={() => router.push({ pathname: '/checkin/[id]', params: { id: arrival.venueId } })} testID="arrival-checkin" />
        </Callout>
      ) : null}

      {closingSoon.length > 0 ? (
        <Callout icon="closing" tone="amber" title={t('now.closesIn', { spot: closingSoon[0].venue.shortName, when: formatIn((closingSoon[0].state.closesAt ?? now) - now) })}>
          {closingSoon.length > 1 || lateOpen.length > 0 ? (
            <Subhead>
              {closingSoon.length > 1 ? t('now.alsoClose', { spots: closingSoon.slice(1, 3).map((r) => r.venue.shortName).join(t('now.and')) }) : ''}
              {lateOpen.length > 0 ? tn(lateOpen.length, 'now.staysOpen', { spots: lateOpen.map((r) => r.venue.shortName).join(', ') }) : ''}
            </Subhead>
          ) : null}
        </Callout>
      ) : lateOpen.length > 0 && lateOpen.length <= 3 ? (
        <Callout icon="moon" tone="navy" title={t('now.openPastMidnight', { spots: lateOpen.map((r) => r.venue.shortName).join(', ') })}>
          <Subhead>{t('now.openPastMidnightBody')}</Subhead>
        </Callout>
      ) : null}

      <SectionHeader right={ranking.originKind === 'gps' ? t('now.fromYourPosition') : t('now.from', { from: ranking.ctx.originLabel })}>{t('now.openNearYou')}</SectionHeader>
      <Group>
        {top.length === 0 ? (
          <Cell icon="moon" iconColor={colors.ink2} title={t('now.nothingOpen')} subtitle={closed[0]?.state.opensAt ? t('now.firstToOpen', { spot: closed[0].venue.shortName, when: formatShort(closed[0].state.opensAt) }) : undefined} last />
        ) : (
          top.map((r, i) => (
            <Cell
              key={r.venue.venueId}
              leading={<LevelBars level={r.arrival.level} levelHigh={r.arrival.levelHigh} size="md" faint={r.live.confidence === 'none'} />}
              title={r.venue.shortName}
              subtitle={rowSub(r)}
              value={t('common.min', { n: r.walkMin })}
              accessory="chevron"
              onPress={() => router.push({ pathname: '/spot/[id]', params: { id: r.venue.venueId } })}
              accessibilityLabel={t('now.rowA11y', { spot: r.venue.shortName, now: levelText(r.live), arrival: levelText(r.arrival), walk: r.walkMin })}
              last={i === top.length - 1}
            />
          ))
        )}
      </Group>

      {closed.length > 0 ? (
        <>
          <SectionHeader>{t('level.closedNow')}</SectionHeader>
          <Group>
            {closed.map((r, i) => (
              <Cell key={r.venue.venueId} icon={kindIcon(r.venue.kind)} iconColor={colors.ink2} title={r.venue.shortName} subtitle={r.state.open && r.state.closesAt ? t('now.closesBeforeArrival', { closes: zonedParts(r.state.closesAt).minutesOfDay === 0 ? t('now.closesAtMidnight') : t('now.closesAt', { time: formatClock(r.state.closesAt) }) }) : r.state.opensAt ? t('now.opens', { when: formatShort(r.state.opensAt) }) : t('hours.closed')} value={t('common.min', { n: r.walkMin })} accessory="chevron" onPress={() => router.push({ pathname: '/spot/[id]', params: { id: r.venue.venueId } })} last={i === closed.length - 1} />
            ))}
          </Group>
        </>
      ) : null}

      <SectionHeader>{t('profile.nav')}</SectionHeader>
      <Group>
        <Cell
          icon="flame"
          iconColor={stats.streak > 0 ? colors.amber : colors.ink2}
          title={t('now.streak', { n: stats.streak, time: formatDuration(stats.week.focusSeconds) })}
          subtitle={session ? t('now.sessionRunning') : stats.best ? t('now.bestWindow', { band: formatHourBand(stats.best.startHour) }) : t('now.startSession')}
          accessory="chevron"
          onPress={() => router.push('/profile')}
          last
        />
      </Group>

      <Button
        title={t('now.checkInWhereIAm')}
        icon="checkin"
        style={{ marginTop: 10 }}
        onPress={() => {
          const id = nearestForCheckIn();
          if (id) router.push({ pathname: '/checkin/[id]', params: { id } });
        }}
        disabled={ranking.open.length + ranking.closed.length === 0}
      />
    </Screen>
  );
}
