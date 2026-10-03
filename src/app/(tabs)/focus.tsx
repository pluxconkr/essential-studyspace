/**
 * S-03 Focus (tab 3). A one-person study table: declared goals, one timer, no feed.
 * The schedule is absolute timestamps, so the ring is right after a locked screen or a reboot.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { newId } from '@/domain/ids';
import { formatDuration, formatShort, nowIso, nowMs } from '@/domain/time';
import { TIMER_SHAPES, focusSeconds, shapeById } from '@/domain/timer';
import type { Goal, Session, TimerShapeId, Venue } from '@/domain/types';
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
  if (session && block) return <LiveSession session={session} block={block} now={now} />;
  return <StartSession />;
}

function LiveSession({ session, block, now }: { session: Session; block: NonNullable<ReturnType<typeof useSessionState>['block']>; now: number }) {
  const router = useRouter();
  const venues = useVenues();
  const venue = venues.find((v) => v.venueId === session.venueId) ?? null;
  const [goalText, setGoalText] = useState('');
  const shape = shapeById(session.shapeId);

  const pause = () => {
    actions.updateSession((s) => ({ ...s, pausedAt: nowIso(now) }));
    void cancelSessionNotifications();
  };
  const resume = () => {
    actions.updateSession((s) => ({ ...s, pausedAt: null, pausedMs: s.pausedMs + (s.pausedAt ? Math.max(0, now - Date.parse(s.pausedAt)) : 0) }));
    const s = { ...session, pausedAt: null, pausedMs: session.pausedMs + (session.pausedAt ? Math.max(0, now - Date.parse(session.pausedAt)) : 0) };
    void scheduleSessionNotifications(s, now);
  };
  const skip = () => {
    if (block.remainingMs === null) return;
    const rem = block.remainingMs;
    // Shift the whole schedule so the current block ends now. Absolute timestamps make this one subtraction.
    actions.updateSession((s) => ({ ...s, startedAt: new Date(Date.parse(s.startedAt) - rem).toISOString() }));
    void scheduleSessionNotifications({ ...session, startedAt: new Date(Date.parse(session.startedAt) - rem).toISOString() }, now);
  };
  const end = () => {
    const doEnd = () => {
      const entry = actions.endSession(now);
      void cancelSessionNotifications();
      if (entry) Alert.alert('Session logged', `${formatDuration(entry.focusSeconds)} of focus · ${entry.goalsDone} of ${entry.goalsTotal} goals`);
    };
    if (Platform.OS === 'web') {
      doEnd();
      return;
    }
    Alert.alert('End session?', `${formatDuration(focusSeconds(session, now))} of focus so far will be logged.`, [
      { text: 'Keep going', style: 'cancel' },
      { text: 'End and log', style: 'destructive', onPress: doEnd },
    ]);
  };
  const addGoal = () => {
    const t = goalText.trim();
    if (!t) return;
    actions.updateSession((s) => ({ ...s, goals: [...s.goals, { goalId: newId('g'), text: t, done: false }] }));
    setGoalText('');
  };

  return (
    <Screen largeTitle={block.kind === 'break' ? 'Break' : block.kind === 'done' ? 'Done' : 'Focus'} subtitle={venue ? `${venue.shortName} · ${shape.label}` : `Elsewhere · ${shape.label}`} note={session.isDemo ? 'Demo session' : undefined} testID="focus-live">
      <Group padded style={{ marginTop: 8, alignItems: 'center' }}>
        <TimerRing block={block} />
        <BlockStrip session={session} block={block} />
        <Text style={[type.footnote, { marginTop: 10 }]}>Started {formatShort(session.startedAt)} · {formatDuration(focusSeconds(session, now))} focused so far</Text>
      </Group>

      <View style={styles.controls}>
        {block.kind !== 'done' ? <Button title={block.paused ? 'Resume' : 'Pause'} icon={block.paused ? 'play' : 'pause'} variant="tonal" onPress={block.paused ? resume : pause} style={{ flex: 1 }} /> : null}
        {block.kind !== 'done' && block.remainingMs !== null ? <Button title={block.kind === 'focus' ? 'Skip to break' : 'Skip break'} icon="forward" variant="secondary" onPress={skip} style={{ flex: 1 }} /> : null}
      </View>
      <Button title={block.kind === 'done' ? 'Log session' : 'End session'} icon="stop" variant={block.kind === 'done' ? 'green' : 'red'} onPress={end} style={{ marginTop: 8 }} testID="session-end" />

      <SectionHeader>Your goals for this session</SectionHeader>
      <Group>
        {session.goals.map((g, i) => (
          <GoalRow key={g.goalId} goal={g} onToggle={(v) => actions.updateSession((s) => ({ ...s, goals: s.goals.map((x) => (x.goalId === g.goalId ? { ...x, done: v } : x)) }))} onRemove={() => actions.updateSession((s) => ({ ...s, goals: s.goals.filter((x) => x.goalId !== g.goalId) }))} last={false && i === session.goals.length - 1} />
        ))}
        <Field icon="plus" value={goalText} onChangeText={setGoalText} placeholder="Add a goal" onSubmitEditing={addGoal} returnKeyType="done" maxLength={120} last />
      </Group>
      <SectionFooter>Goals are text on this phone only. Nobody sees your screen, and there is no camera.</SectionFooter>

      {block.kind === 'break' ? (
        <Callout icon="noise" tone="green" title="Break — chat would open now">
          <Subhead>In a shared table, chat is locked during focus blocks and opens for the break. A study app whose chat is always open becomes a social app and stops being useful for studying.</Subhead>
        </Callout>
      ) : null}
      {venue ? (
        <Group>
          <Cell icon={kindIcon(venue.kind)} title={venue.shortName} subtitle="Open the spot" accessory="chevron" onPress={() => router.push({ pathname: '/spot/[id]', params: { id: venue.venueId } })} last />
        </Group>
      ) : null}
    </Screen>
  );
}

function StartSession() {
  const router = useRouter();
  const ranking = useRanking();
  const focusLog = useAppState((s) => s.focusLog);
  const venues = useVenues();
  const location = useAppState((s) => s.location);
  const [shapeId, setShapeId] = useState<TimerShapeId>('p50');
  const [venueId, setVenueId] = useState<string | null>(ranking.open[0]?.venue.venueId ?? null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalText, setGoalText] = useState('');
  const [lastLogged, setLastLogged] = useState<string | null>(null);

  const choices: (Venue | null)[] = [...ranking.open.slice(0, 3).map((r) => r.venue), null];
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
  void location;

  return (
    <Screen largeTitle="Focus" subtitle="A one-person study table: your goals, one timer, no feed." testID="focus-start">
      {lastLogged ? (
        <Callout icon="checkCircle" tone="green" title="Session logged">
          <Subhead>{lastLogged}</Subhead>
        </Callout>
      ) : null}
      <SectionHeader>Timer</SectionHeader>
      <Group>
        {TIMER_SHAPES.map((s, i) => (
          <Cell key={s.id} icon="clock" title={s.label} subtitle={s.blurb} accessory={shapeId === s.id ? 'check' : 'none'} onPress={() => setShapeId(s.id)} accessibilityRole="button" accessibilityState={{ selected: shapeId === s.id }} last={i === TIMER_SHAPES.length - 1} testID={`shape-${s.id}`} />
        ))}
      </Group>

      <SectionHeader>Where</SectionHeader>
      <Group>
        {choices.map((v, i) => (
          <Cell key={v?.venueId ?? 'none'} icon={v ? kindIcon(v.kind) : 'solo'} title={v ? v.shortName : 'Elsewhere / home'} subtitle={v ? `${ranking.open.find((r) => r.venue.venueId === v.venueId)?.walkMin ?? '–'} min from ${ranking.ctx.originLabel}` : 'Time still counts toward your week'} accessory={venueId === (v?.venueId ?? null) ? 'check' : 'none'} onPress={() => setVenueId(v?.venueId ?? null)} accessibilityRole="button" accessibilityState={{ selected: venueId === (v?.venueId ?? null) }} last={i === choices.length - 1} />
        ))}
      </Group>
      <SectionFooter>Pick where you are so the focus log can tell you where you actually get work done.</SectionFooter>

      <SectionHeader>Goals (optional)</SectionHeader>
      <Group>
        {goals.map((g) => (
          <GoalRow key={g.goalId} goal={g} onToggle={(v) => setGoals((gs) => gs.map((x) => (x.goalId === g.goalId ? { ...x, done: v } : x)))} onRemove={() => setGoals((gs) => gs.filter((x) => x.goalId !== g.goalId))} />
        ))}
        <Field icon="plus" value={goalText} onChangeText={setGoalText} placeholder="e.g. Orgo ch. 11 problems 1–18" onSubmitEditing={addGoal} returnKeyType="done" maxLength={120} last testID="goal-input" />
      </Group>

      <Button title="Start session" icon="play" onPress={start} style={{ marginTop: 8 }} testID="session-start" />
      <SectionFooter style={{ textAlign: 'center' }}>Timer runs on absolute timestamps, so it survives a locked screen. Block changes arrive as local notifications.</SectionFooter>

      {recent.length > 0 ? (
        <>
          <SectionHeader>Recent sessions</SectionHeader>
          <Group>
            {recent.map((e, i) => (
              <Cell key={e.sessionId} icon="history" title={`${formatDuration(e.focusSeconds)} focused · ${shapeById(e.shapeId).label}`} subtitle={`${formatShort(e.startedAt)} · ${e.venueId ? (venues.find((v) => v.venueId === e.venueId)?.shortName ?? 'Removed spot') : 'Elsewhere'} · ${e.goalsDone}/${e.goalsTotal} goals${e.isDemo ? ' · demo' : ''}`} last={i === recent.length - 1} />
            ))}
          </Group>
          <Group>
            <Cell icon="chart" title="Your week" subtitle="Streak, hours by time of day, where you focus" accessory="chevron" onPress={() => router.push('/profile')} last />
          </Group>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', gap: 8, marginTop: 4 },
});

