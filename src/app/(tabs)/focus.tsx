/**
 * S-03 Focus (tab 3). A one-person study table: declared goals, one timer, no feed.
 * The schedule is absolute timestamps, so the ring is right after a locked screen or a reboot.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { newId } from '@/domain/ids';
import { formatDuration, formatShort, nowIso, nowMs } from '@/domain/time';
import { TIMER_SHAPES, focusSeconds, shapeBlurb, shapeById, shapeLabel } from '@/domain/timer';
import { t } from '@/i18n';
import type { Goal, Session, TimerShapeId } from '@/domain/types';
import { cancelSessionNotifications, scheduleSessionNotifications } from '@/services/notifications';
import { actions, useAppState } from '@/store/appStore';
import { useRanking, useSessionState, useVenues } from '@/store/derived';
import { kindIcon } from '@/ui/icons';
import { Button, Callout, Cell, Field, Group, SectionFooter, SectionHeader, Subhead } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';
import { BlockStrip, GoalRow, TimerRing } from '@/ui/session-widgets';
import { type } from '@/ui/theme';

export default function FocusScreen() {
  const { session, block, now } = useSessionState();
  const [lastLogged, setLastLogged] = useState<string | null>(null);
  if (session && block) return <LiveSession session={session} block={block} now={now} onLogged={setLastLogged} />;
  return <StartSession lastLogged={lastLogged} setLastLogged={setLastLogged} />;
}

function LiveSession({ session, block, now, onLogged }: { session: Session; block: NonNullable<ReturnType<typeof useSessionState>['block']>; now: number; onLogged: (body: string) => void }) {
  const router = useRouter();
  const venues = useVenues();
  const venue = venues.find((v) => v.venueId === session.venueId) ?? null;
  const [goalText, setGoalText] = useState('');
  const { fontScale } = useWindowDimensions();
  const shape = shapeById(session.shapeId);

  const pause = () => {
    actions.updateSession((s) => ({ ...s, pausedAt: nowIso(now) }));
    void cancelSessionNotifications();
  };
  const resume = () => {
    const next = { ...session, pausedAt: null, pausedMs: session.pausedMs + (session.pausedAt ? Math.max(0, now - Date.parse(session.pausedAt)) : 0) };
    actions.updateSession(() => next);
    void scheduleSessionNotifications(next, now);
  };
  const skip = () => {
    if (block.remainingMs === null) return;
    // Shift the whole schedule so the current block ends now. Absolute timestamps make this one subtraction.
    const next = { ...session, startedAt: new Date(Date.parse(session.startedAt) - block.remainingMs).toISOString() };
    actions.updateSession(() => next);
    void scheduleSessionNotifications(next, now);
  };
  const end = () => {
    const doEnd = () => {
      const entry = actions.endSession(now);
      void cancelSessionNotifications();
      if (entry) {
        const body = t('focus.loggedBody', { time: formatDuration(entry.focusSeconds), done: entry.goalsDone, total: entry.goalsTotal });
        Alert.alert(t('focus.logged'), body);
        onLogged(body);
      }
    };
    if (Platform.OS === 'web') {
      doEnd();
      return;
    }
    Alert.alert(t('focus.endTitle'), t('focus.endBody', { time: formatDuration(focusSeconds(session, now)) }), [
      { text: t('focus.keepGoing'), style: 'cancel' },
      { text: t('focus.endAndLog'), style: 'destructive', onPress: doEnd },
    ]);
  };
  const addGoal = () => {
    const t = goalText.trim();
    if (!t) return;
    actions.updateSession((s) => ({ ...s, goals: [...s.goals, { goalId: newId('g'), text: t, done: false }] }));
    setGoalText('');
  };

  return (
    <Screen largeTitle={t('tab.focus')} subtitle={`${venue ? venue.shortName : t('focus.elsewhere')} · ${shapeLabel(shape)}`} note={session.isDemo ? t('demo.session') : undefined} testID="focus-live">
      <Group padded style={{ marginTop: 8, alignItems: 'center' }}>
        <TimerRing block={block} />
        <BlockStrip session={session} block={block} />
        <Text style={[type.footnote, { marginTop: 10 }]}>{t('focus.startedAgo', { when: formatShort(session.startedAt), time: formatDuration(focusSeconds(session, now)) })}</Text>
      </Group>

      <View style={[styles.controls, fontScale > 1.3 && { flexDirection: 'column' }]}>
        {block.kind !== 'done' ? <Button title={block.paused ? t('focus.resume') : t('focus.pause')} icon={block.paused ? 'play' : 'pause'} variant="tonal" onPress={block.paused ? resume : pause} style={{ flex: 1 }} /> : null}
        {block.kind !== 'done' && block.remainingMs !== null ? <Button title={block.kind === 'focus' ? t('focus.skipToBreak') : t('focus.skipBreak')} icon="forward" variant="secondary" onPress={skip} style={{ flex: 1 }} /> : null}
      </View>
      <Button title={block.kind === 'done' ? t('focus.logSession') : t('focus.endSession')} icon="stop" variant={block.kind === 'done' ? 'green' : 'red'} onPress={end} style={{ marginTop: 8 }} testID="session-end" />

      <SectionHeader>{t('focus.goals')}</SectionHeader>
      <Group>
        {session.goals.map((g) => (
          <GoalRow key={g.goalId} goal={g} onToggle={(v) => actions.updateSession((s) => ({ ...s, goals: s.goals.map((x) => (x.goalId === g.goalId ? { ...x, done: v } : x)) }))} onRemove={() => actions.updateSession((s) => ({ ...s, goals: s.goals.filter((x) => x.goalId !== g.goalId) }))} />
        ))}
        <Field icon="plus" value={goalText} onChangeText={setGoalText} placeholder={t('focus.addGoal')} onSubmitEditing={addGoal} returnKeyType="done" maxLength={120} last />
      </Group>
      {venue ? (
        <Group>
          <Cell icon={kindIcon(venue.kind)} title={venue.shortName} subtitle={t('focus.openSpot')} accessory="chevron" onPress={() => router.push({ pathname: '/spot/[id]', params: { id: venue.venueId } })} last />
        </Group>
      ) : null}
    </Screen>
  );
}

function StartSession({ lastLogged, setLastLogged }: { lastLogged: string | null; setLastLogged: (v: string | null) => void }) {
  const router = useRouter();
  const ranking = useRanking();
  const focusLog = useAppState((s) => s.focusLog);
  const venues = useVenues();
  const [shapeId, setShapeId] = useState<TimerShapeId>('p50');
  const [venueId, setVenueId] = useState<string | null>(ranking.open[0]?.venue.venueId ?? null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalText, setGoalText] = useState('');

  const choices = [...ranking.open.slice(0, 3), null];
  const addGoal = () => {
    const t = goalText.trim();
    if (!t) return;
    setGoals((g) => [...g, { goalId: newId('g'), text: t, done: false }]);
    setGoalText('');
  };
  const start = () => {
    const now = nowMs();
    const s: Session = { sessionId: newId('s', now), venueId, zoneId: null, shapeId, startedAt: new Date(now).toISOString(), pausedAt: null, pausedMs: 0, endedAt: null, goals, checkInId: null };
    actions.startSession(s);
    void scheduleSessionNotifications(s, now);
    setLastLogged(null);
  };
  const recent = focusLog.slice(0, 5);

  return (
    <Screen largeTitle={t('tab.focus')} subtitle={t('focus.subtitle')} testID="focus-start">
      {lastLogged ? (
        <Callout icon="checkCircle" tone="green" title={t('focus.logged')}>
          <Subhead>{lastLogged}</Subhead>
        </Callout>
      ) : null}
      <SectionHeader>{t('focus.timer')}</SectionHeader>
      <Group>
        {TIMER_SHAPES.map((s, i) => (
          <Cell key={s.id} icon="clock" title={shapeLabel(s)} subtitle={shapeBlurb(s.id)} accessory={shapeId === s.id ? 'check' : 'none'} onPress={() => setShapeId(s.id)} accessibilityRole="button" accessibilityState={{ selected: shapeId === s.id }} last={i === TIMER_SHAPES.length - 1} testID={`shape-${s.id}`} />
        ))}
      </Group>

      <SectionHeader>{t('focus.where')}</SectionHeader>
      <Group>
        {choices.map((r, i) => (
          <Cell key={r?.venue.venueId ?? 'none'} icon={r ? kindIcon(r.venue.kind) : 'solo'} title={r ? r.venue.shortName : t('focus.elsewhere')} subtitle={r ? t('map.minFrom', { n: r.walkMin, station: ranking.ctx.originLabel }) : t('focus.stillCounts')} accessory={venueId === (r?.venue.venueId ?? null) ? 'check' : 'none'} onPress={() => setVenueId(r?.venue.venueId ?? null)} accessibilityRole="button" accessibilityState={{ selected: venueId === (r?.venue.venueId ?? null) }} last={i === choices.length - 1} />
        ))}
      </Group>
      <SectionHeader>{t('focus.goalsOptional')}</SectionHeader>
      <Group>
        {goals.map((g) => (
          <GoalRow key={g.goalId} goal={g} onToggle={(v) => setGoals((gs) => gs.map((x) => (x.goalId === g.goalId ? { ...x, done: v } : x)))} onRemove={() => setGoals((gs) => gs.filter((x) => x.goalId !== g.goalId))} />
        ))}
        <Field icon="plus" value={goalText} onChangeText={setGoalText} placeholder={t('focus.goalPlaceholder')} onSubmitEditing={addGoal} returnKeyType="done" maxLength={120} last testID="goal-input" />
      </Group>

      <Button title={t('focus.start')} icon="play" onPress={start} style={{ marginTop: 8 }} testID="session-start" />
      <SectionFooter style={{ textAlign: 'center' }}>{t('focus.notifFooter')}</SectionFooter>

      {recent.length > 0 ? (
        <>
          <SectionHeader>{t('focus.recent')}</SectionHeader>
          <Group>
            {recent.map((e, i) => (
              <Cell key={e.sessionId} icon="history" title={t('focus.recentRow', { time: formatDuration(e.focusSeconds), shape: shapeLabel(shapeById(e.shapeId)) })} subtitle={`${t('focus.recentSub', { when: formatShort(e.startedAt), where: e.venueId ? (venues.find((v) => v.venueId === e.venueId)?.shortName ?? t('focus.removedSpot')) : t('focus.elsewhere'), done: e.goalsDone, total: e.goalsTotal })}${e.isDemo ? ` · ${t('common.demo')}` : ''}`} last={i === recent.length - 1} />
            ))}
          </Group>
          <Group>
            <Cell icon="chart" title={t('profile.nav')} accessory="chevron" onPress={() => router.push('/profile')} last />
          </Group>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', gap: 8, marginTop: 4 },
});

