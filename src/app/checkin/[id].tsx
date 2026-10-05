/**
 * S-05 Check-in · ONE tap is a complete check-in. Everything else is optional.
 * Presence proof is a distance, not a trail: GPS is read once and discarded.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { haversineM, formatDistance } from '@/domain/geo';
import { newId } from '@/domain/ids';
import { ALL_LEVELS, levelBlurb, levelLabel, proofStrength } from '@/domain/levels';
import { nowIso, nowMs } from '@/domain/time';
import type { Amenity, CheckIn, Level, NoiseReport, Session } from '@/domain/types';
import { t } from '@/i18n';
import { acquireLocation } from '@/services/location';
import { postReport } from '@/services/crowdClient';
import { scheduleSessionNotifications } from '@/services/notifications';
import { actions, getState, isOfflineNow, useAppState } from '@/store/appStore';
import { useLiveLevels, useRealNow, useVenue } from '@/store/derived';
import { Screen, goBackOr } from '@/ui/Screen';
import { noiseIcon } from '@/ui/icons';
import { LevelBars } from '@/ui/level-widgets';
import { Button, Callout, Cell, Field, Group, SectionFooter, SectionHeader, Segmented, Toggle } from '@/ui/primitives';
import { colors } from '@/ui/theme';

const NOISE: NoiseReport[] = [0, 1, 2, 3];
const AVAILABLE: { a: Amenity; key: 'outlets' | 'solo' | 'big' | 'group' | 'wifi' | 'food' }[] = [
  { a: 'outlets', key: 'outlets' },
  { a: 'solo-desks', key: 'solo' },
  { a: 'big-tables', key: 'big' },
  { a: 'group-rooms', key: 'group' },
  { a: 'wifi-eduroam', key: 'wifi' },
  { a: 'food-nearby', key: 'food' },
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
  const demo = useAppState((s) => s.settings.demoScenario !== 'live');
  const realNow = useRealNow(5_000);
  const levels = useLiveLevels();
  const [level, setLevel] = useState<Level | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [noise, setNoise] = useState<NoiseReport | null>(null);
  const [avail, setAvail] = useState<Amenity[]>([]);
  const [note, setNote] = useState('');

  useEffect(() => {
    // Read once at mount; a later status change must not request another fix.
    const st = getState().locationStatus;
    if (st === 'idle' || st === 'granted') void acquireLocation();
  }, []);

  if (!venue) {
    return (
      <Screen title={t('checkin.nav')}>
        <Callout icon="pin" title={t('common.notInDirectory')} />
      </Screen>
    );
  }

  // location.at is device time; compare with the real clock, not the demo-shifted app clock.
  const fresh = location && realNow - location.at < 10 * 60_000 ? location : null;
  const distanceM = fresh ? haversineM(fresh, venue) : null;
  const strength = proofStrength(distanceM, fresh?.accuracyM ?? null);
  const presence =
    locStatus === 'denied'
      ? t('checkin.locationOff')
      : distanceM === null
        ? t('checkin.gettingFix')
        : `${t('checkin.distance', { distance: formatDistance(distanceM), spot: venue.shortName })}${strength >= 0.85 ? t('checkin.verified') : t('checkin.unverified')}`;

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
    source: demo ? 'demo' : 'me',
    synced: !share || demo,
    shownLevel: levels[venue.venueId]?.open ? levels[venue.venueId].level : null,
  });

  const post = async (ci: CheckIn) => {
    actions.addCheckIn(ci);
    if (share && !offline && !demo) {
      const r = await postReport(ci);
      if (r !== 'failed') actions.markCheckInsSynced([ci.checkInId]);
    }
  };

  const submit = async () => {
    if (level === null) return;
    await post(build());
    goBackOr(router);
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
    <Screen title={t('checkin.nav')} largeTitle={t('checkin.title')} subtitle={venue.name} testID="checkin">
      {venue.zones.length > 1 ? (
        <>
          <SectionHeader>{t('checkin.whereInBuilding')}</SectionHeader>
          <Group>
            <Cell icon="pin" title={t('checkin.wholeBuilding')} accessory={zoneId === null ? 'check' : 'none'} onPress={() => setZoneId(null)} accessibilityRole="button" accessibilityState={{ selected: zoneId === null }} />
            {venue.zones.map((z, i) => (
              <Cell key={z.zoneId} icon={noiseIcon(z.noise)} title={z.name} subtitle={z.floor} accessory={zoneId === z.zoneId ? 'check' : 'none'} onPress={() => setZoneId(z.zoneId)} accessibilityRole="button" accessibilityState={{ selected: zoneId === z.zoneId }} last={i === venue.zones.length - 1} />
            ))}
          </Group>
        </>
      ) : null}

      <SectionHeader>{t('checkin.howCrowded')}</SectionHeader>
      <Group>
        {ALL_LEVELS.map((l, i) => (
          <Cell key={l} leading={<LevelBars level={l} size="md" />} title={levelLabel(l)} subtitle={levelBlurb(l)} accessory={level === l ? 'check' : 'none'} onPress={() => setLevel(l)} accessibilityRole="button" accessibilityState={{ selected: level === l }} last={i === ALL_LEVELS.length - 1} testID={`level-${l}`} />
        ))}
      </Group>
      <SectionFooter>{t('checkin.onlyLevel')}</SectionFooter>

      <SectionHeader>{t('checkin.noise')}</SectionHeader>
      <Group padded>
        <Segmented<NoiseReport | -1> label={t('checkin.noiseLabel')} options={[{ value: -1, label: t('checkin.skip') }, ...NOISE.map((n) => ({ value: n, label: t(`checkin.noise.${n}` as const) }))]} value={noise ?? -1} onChange={(v) => setNoise(v === -1 ? null : v)} />
      </Group>

      <SectionHeader>{t('checkin.available')}</SectionHeader>
      <Group>
        {AVAILABLE.map((x, i) => (
          <Toggle key={x.a} label={t(`checkin.avail.${x.key}` as const)} value={avail.includes(x.a)} onChange={(v) => setAvail((cur) => (v ? [...cur, x.a] : cur.filter((a) => a !== x.a)))} last={i === AVAILABLE.length - 1} />
        ))}
      </Group>

      <SectionHeader>{t('checkin.note')}</SectionHeader>
      <Group>
        <Field value={note} onChangeText={setNote} placeholder={t('checkin.notePlaceholder')} maxLength={240} last />
      </Group>
      <SectionFooter>{t('checkin.noteFooter')}</SectionFooter>

      <SectionHeader>{t('checkin.presence')}</SectionHeader>
      <Group>
        <Cell icon={distanceM === null ? 'locationOff' : 'location'} iconColor={distanceM !== null && strength >= 0.85 ? colors.green : colors.ink2} title={presence} subtitle={t('checkin.presenceHint')} />
        <Toggle icon="share" label={t('checkin.share')} value={share} onChange={(v) => actions.patchSettings({ shareCheckIns: v })} hint={offline ? t('checkin.shareOffline') : t('privacy.anonymousHint')} last />
      </Group>

      <Group>
        <Cell icon="map" title={t('checkin.notHere')} accessory="chevron" onPress={() => router.replace('/map')} last />
      </Group>

      <View style={styles.actions}>
        <Button title={t('checkin.post')} icon="checkin" disabled={level === null} onPress={() => void submit()} testID="checkin-post" />
        <Button title={session ? t('checkin.postReturn') : t('checkin.postStart')} icon="focus" variant="tonal" disabled={level === null} onPress={() => void submitAndStart()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8, marginTop: 10 },
});
