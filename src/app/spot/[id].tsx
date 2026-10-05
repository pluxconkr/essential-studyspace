/**
 * S-04 Spot detail · level with its honesty line, hours with exceptions, typical day, zones,
 * getting there, accessibility, watch, your own check-ins, and where the data came from.
 */
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { kindLabel } from '@/domain/curve';
import { describeWeek, formatDayHours, isAllDay, minutesToClose, openState, opensLate } from '@/domain/hours';
import { fuseZones, latestReportDetails, levelLabel, levelText, noiseLabel } from '@/domain/levels';
import { safetyFor } from '@/domain/safety';
import { formatDate, formatIn, formatMinutesShort, formatShort, relativeAgo, zonedParts, zonedToEpoch } from '@/domain/time';
import { formatModes, primaryStation, walkMinutes } from '@/domain/transit';
import type { Venue } from '@/domain/types';
import { t } from '@/i18n';
import { actions, useAppState } from '@/store/appStore';
import { useLiveLevels, useNow, useRanking, useTermPhase, useVenue, useVenueReports } from '@/store/derived';
import { amenityLabel, noiseIcon } from '@/ui/icons';
import { HourlyCurve, LevelBars, LevelHero, LevelLine } from '@/ui/level-widgets';
import { Button, Callout, Cell, Group, KeyValue, SectionFooter, SectionHeader, Subhead, Toggle } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';
import { CELL_PAD, GUTTER, colors, type } from '@/ui/theme';

const accessLabel = (a: Venue['access']) => t(`spot.access.${a}` as const);

/** "Rutgers University Libraries (LibCal hours, …); …" → "Rutgers University Libraries" */
const sourceLabel = (v: Venue) => v.verifiedBy.split(/[;(]/)[0].trim();

const hoursText = (min: number) => (min >= 60 ? (min % 60 ? t('common.hoursMinShort', { h: Math.floor(min / 60), m: min % 60 }) : t('common.hoursShort', { h: Math.floor(min / 60) })) : t('common.min', { n: min }));

const formatClockShort = (ms: number) => formatMinutesShort(zonedParts(ms).minutesOfDay);

const noiseText = (n: Venue['zones'][number]['noise']) => (n === 'silent' ? t('noise.0') : n === 'low' ? t('noise.1') : t('noise.chattyOk'));

export default function SpotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const venue = useVenue(id);
  const levels = useLiveLevels();
  const ranking = useRanking();
  const phase = useTermPhase();
  const now = useNow();
  const stations = useAppState((s) => s.stations);
  const watches = useAppState((s) => s.watches);
  const myCheckIns = useAppState((s) => s.myCheckIns);
  const scenario = useAppState((s) => s.settings.demoScenario);
  const row = useMemo(() => [...ranking.open, ...ranking.closed].find((r) => r.venue.venueId === id) ?? null, [ranking, id]);
  const reports = useVenueReports(id);
  const zoneLevels = useMemo(() => (venue ? fuseZones({ venue, reports, now, phase }) : {}), [venue, reports, now, phase]);
  const details = useMemo(() => latestReportDetails(reports, now), [reports, now]);

  if (!venue) {
    return (
      <Screen title={t('spot.nav')}>
        <Callout icon="pin" title={t('common.notInDirectory')} />
      </Screen>
    );
  }

  const live = levels[venue.venueId];
  const state = openState(venue, now);
  const station = primaryStation(venue, stations);
  const watched = watches.some((w) => w.venueId === venue.venueId);
  const mine = myCheckIns.filter((c) => c.venueId === venue.venueId).slice(0, 5);
  const week = describeWeek(venue);
  const toClose = minutesToClose(state, now);
  const isDemo = scenario !== 'live';
  const curveWidth = Math.min(width - GUTTER * 2 - CELL_PAD * 2, 600);
  const safety = safetyFor(venue);
  const late = opensLate(venue, now);

  const open = (url: string) => Linking.openURL(url).catch(() => {});
  const openMaps = () => {
    const q = encodeURIComponent(venue.address);
    open(Platform.select({ ios: `maps:0,0?q=${q}`, android: `geo:0,0?q=${q}`, default: `https://www.openstreetmap.org/?mlat=${venue.lat}&mlon=${venue.lng}#map=17/${venue.lat}/${venue.lng}` }));
  };

  return (
    <Screen title={t('spot.nav')} largeTitle={venue.shortName} subtitle={`${venue.campus ? `${venue.campus} · ` : ''}${venue.town}${row ? ` · ${t('rank.reason.near', { n: row.walkMin, from: ranking.ctx.originLabel })}` : ''}`} note={isDemo ? t('demo.reports') : undefined} testID="spot">
      <Group padded style={{ marginTop: 8 }}>
        <LevelHero live={live} now={now} isDemo={isDemo} />
        {details ? (
          <Text style={[type.footnote, { marginTop: 4 }]}>
            {t('spot.reported', { what: [details.noise !== null ? noiseLabel(details.noise) : null, ...details.amenities.map((a) => amenityLabel(a).toLowerCase())].filter(Boolean).join(', '), ago: relativeAgo(details.at, now) })}
          </Text>
        ) : null}
        {row && row.arrival.open ? (
          <View style={styles.arrival}>
            <LevelBars level={row.arrival.level} levelHigh={row.arrival.levelHigh} size="sm" />
            <Text style={[type.footnote, { flex: 1 }]}>
              {t('spot.arrival', { level: levelText(row.arrival), n: row.walkMin })}
              {row.stayMin !== null ? t('spot.openAfter', { time: hoursText(row.stayMin) }) : ''}
            </Text>
          </View>
        ) : null}
      </Group>
      <View style={[styles.actions, fontScale > 1.3 && { flexDirection: 'column' }]}>
        <Button title={t('spot.checkInHere')} icon="checkin" onPress={() => router.push({ pathname: '/checkin/[id]', params: { id: venue.venueId } })} style={{ flex: 1 }} testID="spot-checkin" />
        <Button title={t('why.nav')} icon="question" variant="tonal" onPress={() => router.push({ pathname: '/why/[id]', params: { id: venue.venueId } })} style={{ flex: 1 }} />
      </View>

      {state.exception ? (
        <Callout icon={state.exception.hours === 'closed' ? 'alert' : 'info'} tone={state.exception.hours === 'closed' ? 'red' : 'amber'} title={`${state.exception.label}${state.exception.isDemo ? ` · ${t('common.demo')}` : ''}`}>
          <Subhead>{state.exception.isDemo ? t('demo.notReal') : t('spot.exceptionDates', { from: formatDate(zonedToEpoch(state.exception.from, 720)), to: formatDate(zonedToEpoch(state.exception.to, 720)), source: state.exception.source.split(';')[0] })}</Subhead>
        </Callout>
      ) : null}

      <SectionHeader right={state.open ? (isAllDay(state.today) ? t('hours.open24') : toClose !== null && toClose <= 60 ? t('spot.closesIn', { when: formatIn(toClose * 60_000) }) : state.closesAt ? t('spot.until', { time: formatClockShort(state.closesAt) }) : undefined) : state.opensAt ? t('now.opens', { when: formatShort(state.opensAt) }) : undefined}>{t('spot.hours')}</SectionHeader>
      <Group>
        <Cell icon="clock" iconColor={state.open ? colors.green : colors.ink2} title={state.open ? t('spot.openNow') : t('level.closedNow')} subtitle={isAllDay(state.today) ? t('spot.open24Today') : state.today ? t('spot.today', { hours: formatDayHours(state.today) }) : t('spot.closedToday')} />
        <Cell icon="shield" title={accessLabel(venue.access)} subtitle={venue.accessNote} last={week.length === 0} />
        <View style={{ paddingLeft: CELL_PAD }}>
          {week.map((w, i) => (
            <KeyValue key={w.days} k={w.days} v={w.hours} last={i === week.length - 1} />
          ))}
        </View>
      </Group>
      <SectionFooter>{t('spot.checkedFooter', { source: sourceLabel(venue), date: venue.hoursVerified })}</SectionFooter>

      <SectionHeader>{t('spot.typicalDay')}</SectionHeader>
      <Group padded>
        <HourlyCurve venue={venue} now={now} arrivalAt={row?.arrivalAt ?? null} phase={phase} width={curveWidth} />
      </Group>
      <SectionFooter>{venue.curveSource === 'venue' ? t('spot.declaredByVenue') : t('spot.estimate', { kind: kindLabel(venue.kind) })}</SectionFooter>

      <SectionHeader>{t('spot.zones')}</SectionHeader>
      <Group>
        {venue.zones.map((z, i) => (
          <Cell
            key={z.zoneId}
            icon={noiseIcon(z.noise)}
            iconColor={z.noise === 'silent' ? colors.green : colors.tint}
            title={z.name}
            subtitle={
              <View>
                <Text style={[type.footnote, { marginTop: 2 }]}>{[z.floor, noiseText(z.noise), z.seats ? t('spot.seats', { n: z.seats }) : null, z.accessibleSeats ? t('spot.accessibleSeats', { n: z.accessibleSeats }) : null, z.computers ? t('spot.computers', { n: z.computers }) : null, z.outlets ? t(`outlets.${z.outlets}` as const) : null].filter(Boolean).join(' · ') + (z.note ? `\n${z.note}` : '')}</Text>
                {zoneLevels[z.zoneId] ? <LevelLine live={zoneLevels[z.zoneId]} now={now} /> : null}
              </View>
            }
            last={i === venue.zones.length - 1}
          />
        ))}
      </Group>

      {venue.amenities.length > 0 ? (
        <>
          <SectionHeader>{t('spot.amenities')}</SectionHeader>
          <Group padded>
            <View style={styles.chips}>
              {venue.amenities.map((a) => (
                <View key={a} style={styles.chip}>
                  <Text style={type.footnote}>{amenityLabel(a)}</Text>
                </View>
              ))}
            </View>
          </Group>
        </>
      ) : null}

      <SectionHeader>{t('spot.gettingThere')}</SectionHeader>
      <Group>
        {station ? <Cell icon="train" title={t('spot.walkFrom', { n: walkMinutes(station, venue), station: station.name })} subtitle={formatModes(station)} /> : null}
        <Cell icon="pin" title={venue.address} subtitle={venue.coordConfidence === 'high' ? undefined : t('spot.approx')} />
        <Cell icon="link" title={t('spot.openInMaps')} accessory="chevron" onPress={openMaps} accessibilityRole="link" last />
      </Group>

      {safety.length > 0 && late ? (
        <>
          <SectionHeader>{t('spot.gettingHome')}</SectionHeader>
          <Group>
            {safety.map((c, i) => (
              <Cell key={c.e164} icon="phone" title={c.label} subtitle={c.note} value={c.display} valueColor={colors.tint} onPress={() => open(`tel:${c.e164}`)} accessibilityRole="link" accessibilityLabel={t('spot.callA11y', { label: c.label, number: c.display })} last={i === safety.length - 1} />
            ))}
          </Group>
          <SectionFooter>{t('spot.safetyFooter')}</SectionFooter>
        </>
      ) : null}

      <SectionHeader>{t('spot.accessibility')}</SectionHeader>
      <Group>
        <View style={{ paddingLeft: CELL_PAD }}>
          <KeyValue k={t('spot.stepFree')} v={yesNo(venue.accessibility.stepFree)} />
          <KeyValue k={t('spot.restroom')} v={yesNo(venue.accessibility.accessibleRestroom)} />
          <KeyValue k={t('spot.desks')} v={yesNo(venue.accessibility.adjustableDesks)} last />
        </View>
      </Group>
      {venue.accessibility.note ? <SectionFooter>{venue.accessibility.note}</SectionFooter> : null}

      <SectionHeader>{t('spot.watch')}</SectionHeader>
      <Group>
        <Toggle icon="bellOutline" label={t('spot.watchLabel', { level: levelLabel(1) })} value={watched} onChange={() => actions.toggleWatch(venue.venueId, 1)} hint={t('spot.watchHint')} last />
      </Group>

      <SectionHeader>{t('spot.yourCheckIns')}</SectionHeader>
      <Group>
        {mine.length === 0 ? (
          <Cell icon="checkin" iconColor={colors.ink2} title={t('spot.noneYet')} subtitle={t('spot.stayOnPhone')} last />
        ) : (
          mine.map((c, i) => <Cell key={c.checkInId} icon="checkin" title={`${levelLabel(c.level)}${c.zoneId ? ` · ${venue.zones.find((z) => z.zoneId === c.zoneId)?.name ?? c.zoneId}` : ''}`} subtitle={`${relativeAgo(c.at, now)}${c.note ? ` · “${c.note}”` : ''}${c.synced ? '' : t('spot.notSharedYet')}`} last={i === mine.length - 1} />)
        )}
      </Group>

      <SectionHeader>{t('spot.about')}</SectionHeader>
      <Group>
        <View style={{ paddingLeft: CELL_PAD }}>
          <KeyValue k={t('spot.source')} v={sourceLabel(venue)} />
          <KeyValue k={t('spot.checked')} v={venue.lastVerified} last={!venue.phone && !venue.website} />
        </View>
        {venue.phone ? <Cell icon="phone" title={venue.phone} value={t('common.call')} valueColor={colors.tint} onPress={() => open(`tel:${venue.phone?.replace(/[^\d+]/g, '')}`)} accessibilityRole="link" last={!venue.website} /> : null}
        {venue.website ? <Cell icon="link" title={t('common.website')} accessory="chevron" onPress={() => open(venue.website!)} accessibilityRole="link" last /> : null}
      </Group>
      {venue.notes ? <SectionFooter>{venue.notes}</SectionFooter> : null}
    </Screen>
  );
}

const yesNo = (v: boolean | null) => (v === true ? t('common.yes') : v === false ? t('common.no') : t('common.notConfirmed'));

const styles = StyleSheet.create({
  arrival: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  actions: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.fill },
});
