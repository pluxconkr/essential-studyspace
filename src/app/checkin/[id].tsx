/**
 * S-05 Check-in · ONE tap is a complete check-in. Everything else is optional.
 * Presence proof is a distance, not a trail: GPS is read once and discarded.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { haversineM, formatDistance } from '@/domain/geo';
import { newId } from '@/domain/ids';
import { LEVELS, proofStrength } from '@/domain/levels';
import { nowIso, nowMs } from '@/domain/time';
import type { Amenity, CheckIn, Level, NoiseReport, Session } from '@/domain/types';
import { acquireLocation } from '@/services/location';
import { postReport } from '@/services/crowdClient';
import { scheduleSessionNotifications } from '@/services/notifications';
import { actions, isOfflineNow, useAppState } from '@/store/appStore';
import { useRealNow, useVenue } from '@/store/derived';
import { Screen, goBackOr } from '@/ui/Screen';
import { LevelBars } from '@/ui/level-widgets';
import { Button, Callout, Cell, Field, Group, SectionFooter, SectionHeader, Segmented, Toggle } from '@/ui/primitives';
import { colors, type } from '@/ui/theme';

const NOISE: { value: NoiseReport; label: string }[] = [
  { value: 0, label: 'Silent' },
  { value: 1, label: 'Murmur' },
  { value: 2, label: 'Chatty' },
  { value: 3, label: 'Loud' },
];
const AVAILABLE: { a: Amenity; label: string }[] = [
  { a: 'outlets', label: 'Outlets free' },
  { a: 'solo-desks', label: 'Solo desks' },
  { a: 'big-tables', label: 'Big tables' },
  { a: 'group-rooms', label: 'Group rooms' },
  { a: 'wifi-eduroam', label: 'Wifi fine' },
  { a: 'food-nearby', label: 'Food nearby' },
];

export default function CheckInScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const venue = useVenue(id);
  const location = useAppState((s) => s.location);
  const locStatus = useAppState((s) => s.locationStatus);
  const share = useAppState((s) => s.settings.shareCheckIns);
  const offline = useAppState((s) => isOfflineNow(s));
  const session = useAppState((s) => s.session);
  const realNow = useRealNow(5_000);
  const [level, setLevel] = useState<Level | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [noise, setNoise] = useState<NoiseReport | null>(null);
  const [avail, setAvail] = useState<Amenity[]>([]);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (locStatus === 'idle' || locStatus === 'granted') void acquireLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!venue) {
    return (
      <Screen title="Check in">
        <Callout icon="pin" title="Not in the saved directory" />
      </Screen>
    );
  }

  // location.at is device time; compare with the real clock, not the demo-shifted app clock.
  const fresh = location && realNow - location.at < 10 * 60_000 ? location : null;
  const distanceM = fresh ? haversineM(fresh, venue) : null;
  const strength = proofStrength(distanceM, fresh?.accuracyM ?? null);
  const presence =
    locStatus === 'denied'
      ? 'Location is off — this check-in counts as unverified (weight 0.4).'
      : distanceM === null
        ? 'Getting a GPS fix… without one the check-in counts as unverified.'
        : `You are ${formatDistance(distanceM)} from ${venue.shortName}${fresh?.accuracyM ? ` (GPS ±${Math.round(fresh.accuracyM)} m)` : ''} · weight ${strength.toFixed(2)}`;

  const build = (): CheckIn => ({
    checkInId: newId('ci'),
    venueId: venue.venueId,
    zoneId,
    level: level as Level,
    noise,
    amenities: avail,
    note: note.trim() ? note.trim().slice(0, 240) : null,
    at: nowIso(),
    proof: { distanceM: distanceM === null ? null : Math.round(distanceM), gpsAccuracyM: fresh?.accuracyM ?? null },
    source: 'me',
    synced: !share,
  });

  const post = async (ci: CheckIn) => {
    actions.addCheckIn(ci);
    if (share && !offline) {
      const ok = await postReport(ci);
      if (ok) actions.markCheckInsSynced([ci.checkInId]);
    }
  };

  const submit = async () => {
    if (level === null) return;
    await post(build());
    goBackOr(router, '/');
  };

  const submitAndStart = async () => {
    if (level === null) return;
    const ci = build();
    await post(ci);
    if (!session) {
      const now = nowMs();
      const s: Session = { sessionId: newId('s', now), venueId: venue.venueId, zoneId, shapeId: 'p50', startedAt: new Date(now).toISOString(), pausedAt: null, pausedMs: 0, endedAt: null, goals: [], checkInId: ci.checkInId };
      actions.startSession(s);
      void scheduleSessionNotifications(s, now);
    }
    router.replace('/focus');
  };

  return (
    <Screen title="Check in" largeTitle="How is it right now?" subtitle={venue.name} fallback="/" testID="checkin">
      {venue.zones.length > 1 ? (
        <>
          <SectionHeader>Where in the building</SectionHeader>
          <Group>
            <Cell icon="pin" title="Whole building" accessory={zoneId === null ? 'check' : 'none'} onPress={() => setZoneId(null)} accessibilityRole="button" accessibilityState={{ selected: zoneId === null }} />
            {venue.zones.map((z, i) => (
              <Cell key={z.zoneId} icon={z.noise === 'silent' ? 'quiet' : 'noise'} title={z.name} subtitle={z.floor} accessory={zoneId === z.zoneId ? 'check' : 'none'} onPress={() => setZoneId(z.zoneId)} accessibilityRole="button" accessibilityState={{ selected: zoneId === z.zoneId }} last={i === venue.zones.length - 1} />
            ))}
          </Group>
        </>
      ) : null}

      <SectionHeader>How crowded is it?</SectionHeader>
      <Group>
        {LEVELS.map((l, i) => (
          <Cell key={l.level} leading={<LevelBars level={l.level} size="md" />} title={l.label} subtitle={l.blurb} accessory={level === l.level ? 'check' : 'none'} onPress={() => setLevel(l.level)} accessibilityRole="button" accessibilityState={{ selected: level === l.level }} last={i === LEVELS.length - 1} testID={`level-${l.level}`} />
        ))}
      </Group>
      <SectionFooter>One tap is a complete check-in. The rest is optional.</SectionFooter>

      <SectionHeader>Noise (optional)</SectionHeader>
      <Group padded>
        <Segmented<NoiseReport | -1> label="Noise level" options={[{ value: -1, label: 'Skip' }, ...NOISE]} value={noise ?? -1} onChange={(v) => setNoise(v === -1 ? null : v)} />
      </Group>

      <SectionHeader>What&apos;s actually available? (optional)</SectionHeader>
      <Group>
        {AVAILABLE.map((x, i) => (
          <Toggle key={x.a} label={x.label} value={avail.includes(x.a)} onChange={(v) => setAvail((cur) => (v ? [...cur, x.a] : cur.filter((a) => a !== x.a)))} last={i === AVAILABLE.length - 1} />
        ))}
      </Group>

      <SectionHeader>Note for yourself (optional)</SectionHeader>
      <Group>
        <Field value={note} onChangeText={setNote} placeholder="e.g. 2A is dead quiet, avoid the atrium side" maxLength={240} last />
      </Group>
      <SectionFooter>Notes stay on this phone. Only the level, zone and a minute-rounded time are shared, and only if sharing is on.</SectionFooter>

      <SectionHeader>Presence</SectionHeader>
      <Group>
        <Cell icon={distanceM === null ? 'locationOff' : 'location'} iconColor={distanceM !== null && strength >= 0.85 ? colors.green : colors.ink2} title={presence} subtitle="Precise GPS confirms you are here, then is discarded. Other students never see a location, only the venue." />
        <Toggle icon="share" label="Share anonymously" value={share} onChange={(v) => actions.patchSettings({ shareCheckIns: v })} hint={offline ? 'No signal — will upload when back online' : 'Venue-level only · no account, no name'} last />
      </Group>

      <View style={styles.actions}>
        <Button title="Post check-in" icon="checkin" disabled={level === null} onPress={() => void submit()} testID="checkin-post" />
        <Button title={session ? 'Post & back to session' : 'Post & start a 50/10 session here'} icon="focus" variant="tonal" disabled={level === null} onPress={() => void submitAndStart()} />
      </View>
      <Text style={[type.footnote, { textAlign: 'center', marginTop: 10 }]}>Corrections are what keep the forecast honest. Report what you see, not what you hope.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8, marginTop: 10 },
});
