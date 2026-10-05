/**
 * Focus-session widgets: the timer ring with big numerals, the block strip, and goal rows.
 * Reference points: Clock timer numerals, Reminders list rows.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatMMSS } from '@/domain/time';
import { scheduleOf, shapeById, type BlockState } from '@/domain/timer';
import type { Goal, Session } from '@/domain/types';
import { t } from '@/i18n';

import { Icon } from './icons';
import { Checkbox, ProgressRing } from './primitives';
import { MIN_TAP, colors, tabular, type } from './theme';

export function TimerRing({ block, size = 220 }: { block: BlockState; size?: number }) {
  const pct = block.totalMs && block.remainingMs !== null ? ((block.totalMs - block.remainingMs) / block.totalMs) * 100 : 0;
  const color = block.kind === 'break' ? colors.green : colors.tint;
  const label = block.kind === 'done' ? t('common.done') : block.remainingMs === null ? t('timer.freeLabel') : formatMMSS(block.remainingMs);
  const sub = block.kind === 'done' ? t('timer.allDone') : block.kind === 'break' ? t('timer.breakBlock', { n: block.blockNo, total: block.blocks }) : block.remainingMs === null ? t('timer.openEnded') : t('timer.focusBlock', { n: block.blockNo, total: block.blocks });
  return (
    <View style={{ alignItems: 'center' }} accessibilityLiveRegion="polite">
      <ProgressRing pct={block.remainingMs === null ? 100 : pct} size={size} stroke={10} color={block.paused ? colors.ink4 : color}>
        <View style={{ alignItems: 'center' }}>
          <Text maxFontSizeMultiplier={1.1} adjustsFontSizeToFit numberOfLines={1} style={[styles.numerals, tabular, block.paused && { color: colors.ink2 }]} accessibilityLabel={`${label} ${block.paused ? t('timer.paused') : t('timer.remaining')}`}>
            {label}
          </Text>
          <Text style={type.footnote}>{block.paused ? t('timer.paused') : sub}</Text>
        </View>
      </ProgressRing>
    </View>
  );
}

/** One segment per focus/break block: done = tint, current = outlined, upcoming = fill. */
export function BlockStrip({ session, block }: { session: Session; block: BlockState }) {
  const shape = shapeById(session.shapeId);
  if (shape.id === 'free') return null;
  const plan = scheduleOf(shape);
  const currentIdx = plan.findIndex((b) => b.kind === block.kind && b.index + 1 === block.blockNo);
  return (
    <View style={styles.strip} accessibilityLabel={t('timer.blockOf', { n: block.blockNo, total: block.blocks })} accessibilityRole="progressbar" accessibilityValue={{ now: block.blockNo, min: 1, max: block.blocks }}>
      {plan.map((b, i) => {
        const done = block.kind === 'done' || i < currentIdx;
        const cur = i === currentIdx && block.kind !== 'done';
        return <View key={`${b.kind}-${b.index}`} style={[styles.seg, { flex: b.kind === 'focus' ? shape.focusMin : shape.breakMin }, done && { backgroundColor: b.kind === 'focus' ? colors.tint : colors.green }, cur && { borderWidth: 2, borderColor: b.kind === 'focus' ? colors.tint : colors.green, backgroundColor: colors.surface }]} />;
      })}
    </View>
  );
}

export function GoalRow({ goal, onToggle, onRemove, last }: { goal: Goal; onToggle: (v: boolean) => void; onRemove?: () => void; last?: boolean }) {
  return (
    <View style={styles.goal}>
      <Checkbox checked={goal.done} onChange={onToggle} label={goal.text} />
      <View style={[styles.goalBody, !last && styles.goalSeparator]}>
        <Text style={[type.body, { flex: 1 }, goal.done && styles.goalDone]}>{goal.text}</Text>
        {onRemove ? (
          <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={t('timer.removeGoal', { goal: goal.text })} hitSlop={8} style={({ pressed }) => [{ minHeight: MIN_TAP, justifyContent: 'center', paddingLeft: 8 }, pressed && { opacity: 0.5 }]}>
            <Icon name="close" size={16} color={colors.ink4} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  numerals: { ...type.numerals },
  strip: { flexDirection: 'row', gap: 4, marginTop: 14, height: 8 },
  seg: { height: 8, borderRadius: 4, backgroundColor: colors.fill },
  goal: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, gap: 12 },
  goalBody: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingRight: 16, minHeight: MIN_TAP },
  goalSeparator: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  goalDone: { color: colors.ink2, textDecorationLine: 'line-through' },
});
