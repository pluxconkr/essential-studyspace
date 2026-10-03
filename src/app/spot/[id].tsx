/**
 * S-04 Spot detail · level + honesty line, hours with exceptions, typical day, zones, getting there,
 * accessibility, watch, your own check-ins, and the sources every number came from.
 */
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { describeWeek, formatDayHours, minutesToClose, openState } from '@/domain/hours';
import { LEVEL_LABEL, levelText } from '@/domain/levels';
import { formatClock, formatDate, formatIn, formatShort, relativeAgo } from '@/domain/time';
import { primaryStation, walkFormula, walkMinutes } from '@/domain/transit';
import type { Venue } from '@/domain/types';
import { actions, useAppState } from '@/store/appStore';
import { useLiveLevels, useNow, useRanking, useTermPhase, useVenue } from '@/store/derived';
import { AMENITY_LABEL } from '@/ui/icons';
import { HourlyCurve, LevelBars, LevelHero } from '@/ui/level-widgets';
import { Button, Callout, Cell, Group, KeyValue, SectionFooter, SectionHeader, Subhead, Toggle } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';
import { CELL_PAD, GUTTER, colors, type } from '@/ui/theme';

const ACCESS_LABEL: Record<Venue['access'], string> = { public: 'Open to everyone', students: 'Students / ID required', 'students-late': 'Public by day · student ID late' };

export default function SpotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
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

  if (!venue) {
    return (
      <Screen title="Spot">
        <Callout icon="pin" title="Not in the saved directory">
          <Subhead>This spot is not in the copy stored on this phone.</Subhead>
        </Callout>
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

  const openMaps = () => {
    const q = encodeURIComponent(venue.address);
    const url = Platform.select({ ios: `maps:0,0?q=${q}`, android: `geo:0,0?q=${q}`, default: `https://www.openstreetmap.org/?mlat=${venue.lat}&mlon=${venue.lng}#map=17/${venue.lat}/${venue.lng}` });
    Linking.openURL(url ?? '').catch(() => {});
  };

  return (
    <Screen title="Spot" largeTitle={venue.shortName} subtitle={`${venue.campus ? `${venue.campus} · ` : ''}${venue.town}${row ? ` · ${row.walkMin} min from ${ranking.ctx.originLabel}` : ''}`} note={isDemo ? 'Demo scenario · simulated reports' : undefined} fallback="/" testID="spot">
      <Group padded style={{ marginTop: 8 }}>
        <LevelHero live={live} now={now} isDemo={isDemo} />
        {row && row.arrival.open ? (
          <View style={styles.arrival}>
            <LevelBars level={row.arrival.level} levelHigh={row.arrival.levelHigh} size="sm" />
            <Text style={[type.footnote, { flex: 1 }]}>
              {levelText(row.arrival)} when you arrive ({row.walkMin} min walk)
              {row.stayMin !== null ? ` · then open ${row.stayMin >= 60 ? `${Math.floor(row.stayMin / 60)} h ${row.stayMin % 60} min` : `${row.stayMin} min`}` : ''}
            </Text>
          </View>
        ) : null}
      </Group>
      <View style={styles.actions}>
        <Button title="Check in here" icon="checkin" onPress={() => router.push({ pathname: '/checkin/[id]', params: { id: venue.venueId } })} style={{ flex: 1 }} testID="spot-checkin" />
        <Button title="Why this ranking?" icon="question" variant="tonal" onPress={() => router.push({ pathname: '/why/[id]', params: { id: venue.venueId } })} style={{ flex: 1 }} />
      </View>

      {state.exception ? (
        <Callout icon={state.exception.hours === 'closed' ? 'alert' : 'info'} tone={state.exception.hours === 'closed' ? 'red' : 'amber'} title={`${state.exception.label}${state.exception.isDemo ? ' · demo' : ''}`}>
          <Subhead>
            {state.exception.isDemo ? 'Demo scenario — not a real announcement. Finals dates are published each term.' : `${formatDate(Date.parse(`${state.exception.from}T12:00:00`))} – ${formatDate(Date.parse(`${state.exception.to}T12:00:00`))} · Source: ${state.exception.source}`}
          </Subhead>
        </Callout>
      ) : null}

      <SectionHeader right={state.open ? (toClose !== null && toClose <= 60 ? `Closes ${formatIn(toClose * 60_000)}` : state.closesAt ? `Until ${formatClock(state.closesAt)}` : undefined) : state.opensAt ? `Opens ${formatShort(state.opensAt)}` : undefined}>Hours</SectionHeader>
      <Group>
        <Cell icon="clock" iconColor={state.open ? colors.green : colors.ink2} title={state.open ? 'Open now' : 'Closed now'} subtitle={`Today: ${formatDayHours(state.today)}`} />
        <Cell icon="shield" title={ACCESS_LABEL[venue.access]} subtitle={venue.accessNote ?? venue.hoursNote ?? 'No ID needed.'} last={week.length === 0} />
        <View style={{ paddingLeft: CELL_PAD }}>
          {week.map((w, i) => (
            <KeyValue key={w.days} k={w.days} v={w.hours} last={i === week.length - 1} />
          ))}
        </View>
      </Group>
      <SectionFooter>
        Hours: {venue.hoursSource} · checked {venue.hoursVerified}. Wrong hours destroy trust faster than wrong levels — if these are off, tell us in a check-in note.
      </SectionFooter>

      <SectionHeader>Typical day</SectionHeader>
      <Group padded>
        <HourlyCurve venue={venue} now={now} arrivalAt={row?.arrivalAt ?? null} phase={phase} width={curveWidth} />
      </Group>
      <SectionFooter>
        {venue.curveSource === 'venue' ? 'Curve declared by the venue.' : `Estimate for a typical ${venue.kind.replace('-', ' ')} — not a measurement.`} Live reports always outweigh it; with none, the level above is labelled &quot;typical pattern&quot;.
      </SectionFooter>

      <SectionHeader>Zones</SectionHeader>
      <Group>
        {venue.zones.map((z, i) => (
          <Cell key={z.zoneId} icon={z.noise === 'silent' ? 'quiet' : z.noise === 'low' ? 'solo' : 'noise'} iconColor={z.noise === 'silent' ? colors.green : colors.tint} title={z.name} subtitle={`${z.floor} · ${z.noise === 'silent' ? 'silent' : z.noise === 'low' ? 'low murmur' : 'conversation ok'}${z.seats ? ` · ${z.seats} seats` : ' · seats not published'}${z.computers ? ` · ${z.computers} computers` : ''}${z.outlets ? ` · ${z.outlets} outlets` : ''}${z.note ? `\n${z.note}` : ''}`} last={i === venue.zones.length - 1} />
        ))}
      </Group>
      <SectionFooter>Noise policies come from the venue&apos;s own directory pages. Silent zones are the default and the point of the app.</SectionFooter>

      {venue.amenities.length > 0 ? (
        <>
          <SectionHeader>What&apos;s here</SectionHeader>
          <Group padded>
            <View style={styles.chips}>
              {venue.amenities.map((a) => (
                <View key={a} style={styles.chip}>
                  <Text style={type.footnote}>{AMENITY_LABEL[a]}</Text>
                </View>
              ))}
            </View>
          </Group>
        </>
      ) : null}

      <SectionHeader>Getting there</SectionHeader>
      <Group>
        {station ? <Cell icon="train" title={`${walkMinutes(station, venue)} min walk from ${station.name}`} subtitle={walkFormula(station, venue)} /> : null}
        <Cell icon="pin" title={venue.address} subtitle={venue.coordConfidence === 'high' ? 'Pin geocoded to the building' : `Pin is approximate (${venue.coordConfidence} confidence)`} />
        <Cell icon="link" title="Open in Maps" subtitle="Needs a signal — the map tab works without one" accessory="chevron" onPress={openMaps} accessibilityRole="link" last />
      </Group>

      <SectionHeader>Accessibility</SectionHeader>
      <Group>
        <View style={{ paddingLeft: CELL_PAD }}>
          <KeyValue k="Step-free entrance" v={yesNo(venue.accessibility.stepFree)} />
          <KeyValue k="Accessible restroom" v={yesNo(venue.accessibility.accessibleRestroom)} />
          <KeyValue k="Adjustable desks" v={yesNo(venue.accessibility.adjustableDesks)} last />
        </View>
      </Group>
      {venue.accessibility.note ? <SectionFooter>{venue.accessibility.note}</SectionFooter> : null}

      <SectionHeader>Watch</SectionHeader>
      <Group>
        <Toggle icon="bellOutline" label={`Tell me when it's ${LEVEL_LABEL[1]} or emptier`} value={watched} onChange={() => actions.toggleWatch(venue.venueId, 1)} hint="Checked whenever the app refreshes live levels. Local notification, no account." last />
      </Group>

      <SectionHeader>Your check-ins here</SectionHeader>
      <Group>
        {mine.length === 0 ? (
          <Cell icon="checkin" iconColor={colors.ink2} title="None yet" subtitle="Your reports stay on this phone; an anonymous venue-level copy is shared only if sharing is on." last />
        ) : (
          mine.map((c, i) => <Cell key={c.checkInId} icon="checkin" title={`${LEVEL_LABEL[c.level]}${c.zoneId ? ` · ${venue.zones.find((z) => z.zoneId === c.zoneId)?.name ?? c.zoneId}` : ''}`} subtitle={`${relativeAgo(c.at, now)}${c.note ? ` · “${c.note}”` : ''}${c.synced ? '' : ' · not shared yet'}`} last={i === mine.length - 1} />)
        )}
      </Group>

      <SectionHeader>Where this came from</SectionHeader>
      <Group>
        <View style={{ paddingLeft: CELL_PAD }}>
          <KeyValue k="Kind" v={venue.kind.replace('-', ' ')} />
          <KeyValue k="Verified by" v={venue.verifiedBy} />
          <KeyValue k="Last verified" v={venue.lastVerified} />
          {venue.phone ? <KeyValue k="Phone" v={venue.phone} /> : null}
          <KeyValue k="Website" v={venue.website ?? '—'} last />
        </View>
      </Group>
      {venue.notes ? <SectionFooter>{venue.notes}</SectionFooter> : null}
      <SectionFooter>Venue names are real institutions used because students study there. No partnership or endorsement is implied; capacity is not shown unless the venue publishes it.</SectionFooter>
    </Screen>
  );
}

const yesNo = (v: boolean | null) => (v === true ? 'Yes' : v === false ? 'No' : 'Not confirmed');

const styles = StyleSheet.create({
  arrival: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  actions: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.fill },
});
