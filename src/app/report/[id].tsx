/**
 * Earlier visit · how crowded a spot was at some hour in the last 7 days. It shapes the learned
 * typical pattern only — never "right now" — and sends one hour, a level and an optional zone, no location.
 *
 * Route `/report/[id]`, pushed from the spot page (under the typical-day chart) and from the check-in
 * screen. The report is a `CheckIn` of kind `past` and goes through the same `submitCheckIn` path, so it
 * is saved on the phone first and, with sharing on, uploaded now or queued while offline. The relay adds
 * it to the hourly aggregates only, and the phone leaves its own past reports out of live fusion.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { hoursOn } from '@/domain/hours';
import { newId } from '@/domain/ids';
import { dayLong, formatMinutesShort, hhmmToMinutes, shiftDateKey, weekdayOf, zonedParts, zonedToEpoch } from '@/domain/time';
import type { CheckIn, Level } from '@/domain/types';
import { t } from '@/i18n';
import { submitCheckIn } from '@/services/refresh';
import { useAppState } from '@/store/appStore';
import { useNow, useVenue } from '@/store/derived';
import { Screen, goBackOr } from '@/ui/Screen';
import { LevelRows, ZonePicker } from '@/ui/level-widgets';
import { Button, Callout, Cell, Group, SectionFooter, SectionHeader } from '@/ui/primitives';

/** The relay accepts earlier visits up to seven days back; the day list is today plus the six days before it. */
const DAYS = 7;

/**
 * Earlier-visit form for the `id` route param (a "Not in the saved directory" callout for an unknown id):
 * a day (Today, Yesterday, then weekday names), an hour the venue was open that day, the level and an
 * optional zone. Picking another day clears the chosen hour.
 * Days and hours follow the app clock; in a demo scenario the report is saved as demo and never uploaded.
 */
export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const venue = useVenue(id);
  const now = useNow();
  const share = useAppState((s) => s.settings.shareCheckIns);
  const demo = useAppState((s) => s.settings.demoScenario !== 'live');
  const [dayOffset, setDayOffset] = useState(0);
  const [hour, setHour] = useState<number | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);

  if (!venue) {
    return (
      <Screen title={t('report.nav')}>
        <Callout icon="pin" title={t('common.notInDirectory')} />
      </Screen>
    );
  }

  const p = zonedParts(now);
  const days = Array.from({ length: DAYS }, (_, i) => {
    const dateKey = shiftDateKey(p.dateKey, -i);
    return { i, dateKey, label: i === 0 ? t('report.today') : i === 1 ? t('report.yesterday') : dayLong(weekdayOf(dateKey)) };
  });
  const day = days[dayOffset];
  const open = hoursOn(venue, day.dateKey).hours;
  // Every hour the venue was open that day (exceptions applied), cut at midnight: the part of a
  // closing time past midnight (e.g. "26:00") is not offered for that day.
  const first = open ? Math.floor(hhmmToMinutes(open.open) / 60) : 0;
  const last = open ? Math.min(24, Math.ceil(hhmmToMinutes(open.close) / 60)) : 0;
  // Today: only hours that have already started (the current one included); an earlier visit cannot lie in the future.
  const hours = Array.from({ length: Math.max(0, last - first) }, (_, k) => first + k).filter((h) => dayOffset > 0 || h <= p.hour);

  /**
   * Saves a `past` report stamped at the start of the chosen hour in library time (no noise, amenities,
   * note or GPS proof), uploads it like a check-in when sharing is on, then goes back.
   */
  const submit = async () => {
    if (level === null || hour === null) return;
    const ci: CheckIn = {
      checkInId: newId('ci'),
      kind: 'past',
      venueId: venue.venueId,
      zoneId,
      level,
      noise: null,
      amenities: [],
      note: null,
      at: new Date(zonedToEpoch(day.dateKey, hour * 60)).toISOString(),
      proof: { distanceM: null, gpsAccuracyM: null },
      source: demo ? 'demo' : 'me',
      synced: !share || demo,
      shownLevel: null,
    };
    await submitCheckIn(ci);
    goBackOr(router);
  };

  return (
    <Screen title={t('report.nav')} largeTitle={t('report.title')} subtitle={venue.name} testID="report">
      <SectionHeader>{t('report.when')}</SectionHeader>
      <Group>
        {days.map((d, i) => (
          <Cell
            key={d.dateKey}
            icon="calendar"
            title={d.label}
            accessory={dayOffset === d.i ? 'check' : 'none'}
            onPress={() => {
              setDayOffset(d.i);
              setHour(null);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: dayOffset === d.i }}
            last={i === days.length - 1}
            testID={`report-day-${d.i}`}
          />
        ))}
      </Group>

      <SectionHeader>{t('report.hour')}</SectionHeader>
      <Group>
        {!open ? (
          <Cell icon="clock" title={t('report.closedThatDay')} last />
        ) : hours.length === 0 ? (
          <Cell icon="clock" title={t('report.noHoursYet')} last />
        ) : (
          hours.map((h, i) => <Cell key={h} icon="clock" title={formatMinutesShort(h * 60)} accessory={hour === h ? 'check' : 'none'} onPress={() => setHour(h)} accessibilityRole="button" accessibilityState={{ selected: hour === h }} last={i === hours.length - 1} testID={`report-hour-${h}`} />)
        )}
      </Group>

      <ZonePicker venue={venue} zoneId={zoneId} onChange={setZoneId} />

      <SectionHeader>{t('report.level')}</SectionHeader>
      <Group>
        <LevelRows level={level} onChange={setLevel} testIDPrefix="report-level-" />
      </Group>
      <SectionFooter>{t('report.footer')}</SectionFooter>

      <View style={styles.actions}>
        <Button title={t('report.post')} icon="history" disabled={level === null || hour === null} onPress={() => void submit()} testID="report-post" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: 10 },
});
