/**
 * S-08 Free blocks · the gaps between classes, by hand. The home screen ranks spots that stay open
 * until the gap ends. Phase 2 reads them from a calendar; v1 keeps the schedule on the phone.
 *
 * Route `/blocks`, pushed from the Now tab's free-block row and from Your week's settings. Blocks live in
 * Prefs (a weekday plus start and end as New Jersey minutes since midnight). Adding or removing one saves
 * the prefs at once through `actions.savePrefs` (local storage only; there is no Save button), and
 * useRanking picks the change up: while a block is in progress its end is the ranking's stay-open target,
 * and the Now tab shows "Free until …".
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { blockValid, formatBlock, sortBlocks } from '@/domain/blocks';
import { newId } from '@/domain/ids';
import { dayLong, dayName, formatMinutes } from '@/domain/time';
import { t } from '@/i18n';
import { actions, useAppState } from '@/store/appStore';
import { Icon } from '@/ui/icons';
import { Button, Cell, Group, SectionFooter, SectionHeader, Segmented } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';
import { CELL_PAD, MIN_TAP, colors, tabular, type } from '@/ui/theme';

/**
 * Minutes per − / + press. Moving one end also pushes the other along to keep them at least this far
 * apart where the day allows, which is blockValid's 30-minute minimum.
 */
const STEP = 30;

/**
 * One time row of the add form: the label, then − / + buttons around the time that move it by STEP
 * minutes, clamped to 0–1440 (midnight to the next midnight). Screen readers announce the buttons as
 * "Earlier <label>" / "Later <label>".
 */
function TimeRow({ label, value, onChange, last }: { label: string; value: number; onChange: (v: number) => void; last?: boolean }) {
  return (
    <Cell
      icon="clock"
      title={label}
      last={last}
      trailing={
        <View style={styles.stepper} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: formatMinutes(value) }}>
          <Pressable onPress={() => onChange(Math.max(0, value - STEP))} accessibilityLabel={t('blocks.earlier', { label })} accessibilityRole="button" style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.6 }]}>
            <Icon name="minus" size={16} color={colors.ink} weight="semibold" />
          </Pressable>
          <Text maxFontSizeMultiplier={1.3} style={[type.headline, tabular, styles.stepValue]}>
            {formatMinutes(value)}
          </Text>
          <Pressable onPress={() => onChange(Math.min(1440, value + STEP))} accessibilityLabel={t('blocks.later', { label })} accessibilityRole="button" style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.6 }]}>
            <Icon name="plus" size={16} color={colors.ink} weight="semibold" />
          </Pressable>
        </View>
      }
    />
  );
}

/**
 * The saved blocks (Monday first, then by start time), each with a delete button, then the add form:
 * weekday (preset Monday), From and Until (preset 2–5 PM) and an add button that is enabled only while
 * blockValid accepts the block (at least 30 minutes, within one day).
 */
export default function BlocksScreen() {
  const router = useRouter();
  const prefs = useAppState((s) => s.prefs);
  const [weekday, setWeekday] = useState(1);
  const [startMin, setStartMin] = useState(14 * 60);
  const [endMin, setEndMin] = useState(17 * 60);
  const blocks = sortBlocks(prefs.blocks);
  const valid = blockValid({ weekday, startMin, endMin });

  /** Appends the form's block, with a new id, to the saved prefs and saves them; ignored while the block is invalid. */
  const add = () => {
    if (!valid) return;
    actions.savePrefs({ ...prefs, blocks: [...prefs.blocks, { blockId: newId('b'), weekday, startMin, endMin }] });
  };
  /** Deletes one block from the saved prefs at once, without asking. */
  const remove = (id: string) => actions.savePrefs({ ...prefs, blocks: prefs.blocks.filter((b) => b.blockId !== id) });

  return (
    <Screen title={t('blocks.nav')} largeTitle={t('blocks.nav')} subtitle={t('blocks.subtitle')}>
      <SectionHeader>{t('profile.nav')}</SectionHeader>
      <Group>
        {blocks.length === 0 ? (
          <Cell icon="gap" iconColor={colors.ink2} title={t('blocks.none')} subtitle={t('blocks.addBelow')} last />
        ) : (
          blocks.map((b, i) => (
            <Cell key={b.blockId} icon="gap" title={t('blocks.row', { day: dayLong(b.weekday), range: formatBlock(b) })} subtitle={t('blocks.hoursFree', { n: Math.round((b.endMin - b.startMin) / 60 * 10) / 10 })} trailing={
              <Pressable onPress={() => remove(b.blockId)} accessibilityRole="button" accessibilityLabel={t('blocks.remove', { day: dayLong(b.weekday), range: formatBlock(b) })} hitSlop={8} style={({ pressed }) => [{ minHeight: MIN_TAP, justifyContent: 'center' }, pressed && { opacity: 0.5 }]}>
                <Icon name="trash" size={18} color={colors.red} />
              </Pressable>
            } last={i === blocks.length - 1} />
          ))
        )}
      </Group>

      <SectionHeader>{t('blocks.add')}</SectionHeader>
      <Group padded>
        <Segmented<number> label={t('blocks.weekday')} options={[1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: d, label: dayName(d) }))} value={weekday} onChange={setWeekday} />
      </Group>
      <Group>
        <TimeRow label={t('blocks.from')} value={startMin} onChange={(v) => { setStartMin(v); if (endMin < v + STEP) setEndMin(Math.min(1440, v + STEP)); }} />
        <TimeRow label={t('blocks.until')} value={endMin} onChange={(v) => { setEndMin(v); if (startMin > v - STEP) setStartMin(Math.max(0, v - STEP)); }} last />
      </Group>
      <Button title={t('blocks.addButton', { day: dayName(weekday), from: formatMinutes(startMin), to: formatMinutes(endMin) })} onPress={add} disabled={!valid} style={{ marginTop: 4 }} testID="block-add" />
      <SectionFooter>{t('blocks.minFooter')}</SectionFooter>
      <Button title={t('common.done')} variant="ghost" onPress={() => router.back()} style={{ marginTop: 6 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.fill, borderRadius: 8, padding: 2 },
  stepBtn: { width: 36, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 76, textAlign: 'center', paddingHorizontal: CELL_PAD / 4 },
});
