/**
 * S-03 Focus (tab 3). A one-person study table: declared goals, one timer, no feed.
 * The schedule is absolute timestamps, so the ring is right after a locked screen or a reboot.
 *
 * One route, two views: StartSession until a session exists, then LiveSession. The session is kept in
 * the store and on disk (never uploaded) and stamped on the app clock (device time + demo offset); every
 * `now` handed to the timer math (domain/timer.ts) comes from that same clock. Block changes arrive as
 * local notifications (when switched on and allowed), scheduled on start, resume and skip and cancelled
 * on pause and end. The OS reads those notification dates as device time, so while a demo scenario shifts the
 * clock they fire off by that offset. Ending adds an entry to the focus log, which feeds Your week.
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

/**
 * The Focus tab: the live session while one exists (started here or from the check-in screen), else the start
 * form. `lastLogged` lives here, not in LiveSession, because ending a session unmounts LiveSession; the start
 * form then shows the summary in its "Session logged" callout, the only confirmation on web.
 */
export default function FocusScreen() {
  const { session, block, now } = useSessionState();
  const [lastLogged, setLastLogged] = useState<string | null>(null);
  if (session && block) return <LiveSession session={session} block={block} now={now} onLogged={setLastLogged} />;
  return <StartSession lastLogged={lastLogged} setLastLogged={setLastLogged} />;
}

/**
 * The running session: timer ring and block strip, pause/resume, skip, end (or "Log session" once every block
 * is done), goals, and a link to the spot. `now` is the app clock from useSessionState, ticking every second
 * while running. Edits go through `actions.updateSession` (written to storage, then a store update);
 * `onLogged` receives the summary line after an end.
 */
function LiveSession({ session, block, now, onLogged }: { session: Session; block: NonNullable<ReturnType<typeof useSessionState>['block']>; now: number; onLogged: (body: string) => void }) {
  const router = useRouter();
  const venues = useVenues();
  const venue = venues.find((v) => v.venueId === session.venueId) ?? null;
  const [goalText, setGoalText] = useState('');
  // At large text sizes the pause and skip buttons stack instead of sharing a row.
  const { fontScale } = useWindowDimensions();
  const shape = shapeById(session.shapeId);

  // Pause: stamp pausedAt (the schedule freezes there) and cancel the pending block-change notifications.
  const pause = () => {
    actions.updateSession((s) => ({ ...s, pausedAt: nowIso(now) }));
    void cancelSessionNotifications();
  };
  // Resume: add the paused stretch to pausedMs, clear pausedAt and reschedule the notifications from now.
  // `next` is built once so the store and the notification schedule see the same session.
  const resume = () => {
    const next = { ...session, pausedAt: null, pausedMs: session.pausedMs + (session.pausedAt ? Math.max(0, now - Date.parse(session.pausedAt)) : 0) };
    actions.updateSession(() => next);
    void scheduleSessionNotifications(next, now);
  };
  // Skip: end the current block now (the next one starts, or the session is done after the last) and reschedule
  // the notifications. A free session's open-ended block (remainingMs null) has nothing to skip to.
  const skip = () => {
    if (block.remainingMs === null) return;
    // Shift the whole schedule so the current block ends now. Absolute timestamps make this one subtraction.
    const next = { ...session, startedAt: new Date(Date.parse(session.startedAt) - block.remainingMs).toISOString() };
    actions.updateSession(() => next);
    void scheduleSessionNotifications(next, now);
  };
  // End: on web at once (react-native-web's Alert.alert does nothing, so a confirmation could never be answered),
  // elsewhere after an "End session?" dialog that shows the focus time so far.
  const end = () => {
    // Close the session into the focus log (storage), cancel its notifications, and show the summary as an alert
    // and, through onLogged, in the start form's callout.
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
  // Add the typed goal (trimmed; blank ignored) to the live session, saved with it, and clear the field.
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

/**
 * The start form: timer shape (50/10 × 3 preselected), where to study (the three best spots open on arrival, the
 * best one preselected, or "somewhere else"), optional goals, then Start. Nothing is saved before Start. Also shows
 * the last "Session logged" summary (`lastLogged`, cleared on the next start) and, once the focus log has entries,
 * the five latest sessions and a link to Your week.
 */
function StartSession({ lastLogged, setLastLogged }: { lastLogged: string | null; setLastLogged: (v: string | null) => void }) {
  const router = useRouter();
  const ranking = useRanking();
  const focusLog = useAppState((s) => s.focusLog);
  const venues = useVenues();
  const [shapeId, setShapeId] = useState<TimerShapeId>('p50');
  const [venueId, setVenueId] = useState<string | null>(ranking.open[0]?.venue.venueId ?? null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalText, setGoalText] = useState('');

  // The three best spots open on arrival, then null for "somewhere else" (still counts toward the week).
  const choices = [...ranking.open.slice(0, 3), null];
  // Add the typed goal (trimmed; blank ignored) to the draft list and clear the field.
  const addGoal = () => {
    const t = goalText.trim();
    if (!t) return;
    setGoals((g) => [...g, { goalId: newId('g'), text: t, done: false }]);
    setGoalText('');
  };
  // Start now on the app clock: save the session (storage, then a store update that swaps this tab to
  // LiveSession), schedule its block-change notifications and clear the last "Session logged" callout.
  const start = () => {
    const now = nowMs();
    const s: Session = { sessionId: newId('s', now), venueId, zoneId: null, shapeId, startedAt: new Date(now).toISOString(), pausedAt: null, pausedMs: 0, endedAt: null, goals, checkInId: null };
    actions.startSession(s);
    void scheduleSessionNotifications(s, now);
    setLastLogged(null);
  };
  // The five latest sessions (the focus log is stored newest first).
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

