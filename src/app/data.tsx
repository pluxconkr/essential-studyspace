/**
 * S-09 Offline data · makes "this app works offline" a claim you can verify: what is saved, how big,
 * and when. Also hosts sharing, notifications, the demo controls (clearly labelled), and reset.
 */
import { useState } from 'react';
import { Alert, Platform, Share, Text } from 'react-native';

import { mapBytes } from '@/data/mapData';
import { files } from '@/data/files';
import { resetAllData, venueRepo } from '@/data/repos';
import { formatShort, formatStamp, isStale, relativeAgo } from '@/domain/time';
import type { DemoScenario } from '@/domain/types';
import { SCENARIO_LABEL, applyDemoScenario } from '@/services/demo';
import { refreshAll, type RefreshResult } from '@/services/refresh';
import { actions, isOfflineNow, useAppState } from '@/store/appStore';
import { useNow, useRealNow } from '@/store/derived';
import type { IconName } from '@/ui/icons';
import { Button, Callout, Cell, Group, ProgressBar, ProgressRing, SectionFooter, SectionHeader, Segmented, Subhead, Toggle } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';
import { colors, tabular, type } from '@/ui/theme';

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const DROPPED_LABEL = { 'crowd-cache': 'the cached live levels', 'old-checkins': 'older check-ins (the newest 50 are kept)' } as const;

export default function DataScreen() {
  const cacheMeta = useAppState((s) => s.cacheMeta);
  const venues = useAppState((s) => s.venues);
  const venueSource = useAppState((s) => s.venueSource);
  const venueVersion = useAppState((s) => s.venueVersion);
  const crowd = useAppState((s) => s.crowd);
  const myCheckIns = useAppState((s) => s.myCheckIns);
  const focusLog = useAppState((s) => s.focusLog);
  const settings = useAppState((s) => s.settings);
  const offline = useAppState((s) => isOfflineNow(s));
  const refreshing = useAppState((s) => s.refreshing);
  const progress = useAppState((s) => s.refreshProgress);
  const storageNotice = useAppState((s) => s.storageNotice);
  const now = useNow();
  // Cache time stamps are device time; a demo scenario shifts `now`, so ages use the real clock.
  const realNow = useRealNow();
  const free = files.availableBytes();
  const freeText = Number.isFinite(free) ? `${kb(free)} free on this phone` : null;
  const [last, setLast] = useState<RefreshResult | null>(null);

  const venueBytes = venueSource === 'network' ? venueRepo.bytes() : JSON.stringify(venues).length;
  const rows: { key: string; icon: IconName; name: string; size: string; saved: boolean; when: string; stale: boolean }[] = [
    { key: 'venues', icon: 'library', name: `Spot directory · ${venues.length} spots`, size: kb(venueBytes), saved: true, when: venueSource === 'network' && cacheMeta.venues?.fetchedAt ? `saved ${relativeAgo(cacheMeta.venues.fetchedAt, realNow)} · v${venueVersion}` : `bundled · v${venueVersion}`, stale: venueSource === 'network' && cacheMeta.venues?.fetchedAt ? isStale(cacheMeta.venues.fetchedAt, realNow) : false },
    { key: 'maps', icon: 'map', name: 'Maps · New Brunswick, Newark, Hoboken, Princeton', size: kb(mapBytes()), saved: true, when: 'bundled · OpenStreetMap vector lines', stale: false },
    { key: 'crowd', icon: 'share', name: 'Live levels', size: crowd ? kb(JSON.stringify(crowd).length) : '—', saved: !!crowd, when: cacheMeta.crowd?.fetchedAt ? `checked ${relativeAgo(cacheMeta.crowd.fetchedAt, realNow)}${crowd && !crowd.configured ? ' · dev relay (memory)' : ''}` : 'not checked yet · typical pattern shown', stale: cacheMeta.crowd?.fetchedAt ? realNow - Date.parse(cacheMeta.crowd.fetchedAt) > 60 * 60_000 : false },
    { key: 'checkins', icon: 'checkin', name: `Your check-ins · ${myCheckIns.length}`, size: kb(JSON.stringify(myCheckIns).length), saved: true, when: myCheckIns.some((c) => !c.synced) ? `${myCheckIns.filter((c) => !c.synced).length} not shared yet` : 'all shared or sharing off', stale: false },
    { key: 'focus', icon: 'focus', name: `Focus log · ${focusLog.length} sessions`, size: kb(JSON.stringify(focusLog).length), saved: true, when: 'student-owned · never leaves the phone', stale: false },
  ];
  const savedCount = rows.filter((r) => r.saved).length;

  const run = async () => setLast(await refreshAll());

  const exportLog = async () => {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), focusLog, checkIns: myCheckIns }, null, 2);
    try {
      await Share.share({ message: payload, title: 'StudySpace export' });
    } catch {
      /* cancelled */
    }
  };

  const confirmReset = () => {
    const doReset = () => {
      resetAllData();
      applyDemoScenario('live');
      actions.rehydrate();
    };
    if (Platform.OS === 'web') {
      if (typeof globalThis.confirm === 'function' ? globalThis.confirm('Erase all saved data on this device?') : true) doReset();
      return;
    }
    Alert.alert('Reset app data', 'Erase preferences, check-ins, focus log, watches and cached levels on this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Erase', style: 'destructive', onPress: doReset },
    ]);
  };

  return (
    <Screen title="Offline data" largeTitle="Offline data" subtitle="What is saved on this phone, how big, and when" fallback="/" testID="data">
      <Group style={{ marginTop: 8 }}>
        <Cell
          leading={
            <ProgressRing pct={(savedCount / rows.length) * 100} size={44} stroke={4} color={savedCount === rows.length ? colors.green : colors.amber}>
              <Text maxFontSizeMultiplier={1.15} style={[styles.ringText, tabular, { color: savedCount === rows.length ? colors.green : colors.amber }]}>
                {savedCount}/{rows.length}
              </Text>
            </ProgressRing>
          }
          title={savedCount === rows.length ? 'Everything the app needs is on this phone' : 'Live levels not fetched yet'}
          subtitle="Hours, the directory, the maps and your own data never need a signal. Live levels are the only thing that does."
          last
        />
      </Group>
      <Button title={refreshing ? 'Refreshing…' : offline ? 'No signal — will retry automatically' : 'Refresh live levels now'} disabled={offline || refreshing} onPress={() => void run()} accessibilityHint="Uploads unsent check-ins and downloads recent reports for your area" />
      {refreshing && progress ? (
        <Group padded style={{ marginTop: 10 }}>
          <ProgressBar pct={(progress.done / progress.total) * 100} color={colors.tint} label={`${progress.done} of ${progress.total} steps finished`} />
          <Text style={[type.footnote, tabular, { marginTop: 8 }]}>{`${progress.done} of ${progress.total} finished${freeText ? ` · ${freeText}` : ''}`}</Text>
        </Group>
      ) : null}
      {last ? <SectionFooter style={{ textAlign: 'center' }}>{`Live levels: ${last.crowd} · Directory: ${last.venues === 'no-source' ? 'bundled (no feed configured)' : last.venues} · Shared ${last.synced} check-in${last.synced === 1 ? '' : 's'}${last.watchHits ? ` · ${last.watchHits} watch alert${last.watchHits === 1 ? '' : 's'}` : ''}`}</SectionFooter> : null}

      {storageNotice ? (
        <Callout icon="alert" tone="amber" title={storageNotice.recovered ? 'Storage is almost full' : 'Storage is full — the last change could not be saved'}>
          <Subhead>
            {storageNotice.dropped.length > 0 ? `To make room the app gave up ${storageNotice.dropped.map((d) => DROPPED_LABEL[d]).join(' and ')}. ` : ''}
            Your preferences, focus log and the directory are kept. Free some space, then refresh.
          </Subhead>
          <Button title="OK" variant="tonal" size="sm" style={{ marginTop: 10, alignSelf: 'flex-start' }} onPress={() => actions.dismissStorageNotice()} />
        </Callout>
      ) : null}

      <SectionHeader>Saved items</SectionHeader>
      <Group>
        {rows.map((r, i) => (
          <Cell key={r.key} icon={r.icon} iconColor={r.saved ? (r.stale ? colors.amber : colors.green) : colors.ink2} title={r.name} subtitle={`${r.size} · ${r.when}${r.stale ? ' · older than expected' : ''}`} value={r.saved ? (r.stale ? 'Old' : 'Saved') : 'Missing'} valueColor={r.saved ? (r.stale ? colors.amber : colors.green) : colors.ink2} last={i === rows.length - 1} />
        ))}
      </Group>
      <SectionFooter>If storage runs out, cached live levels and old check-ins are dropped first. Preferences, the focus log, the directory and the maps are kept to the end. Total footprint is under 1 MB.{freeText ? ` ${freeText[0].toUpperCase()}${freeText.slice(1)}.` : ''}</SectionFooter>

      <SectionHeader>Sharing & notifications</SectionHeader>
      <Group>
        <Toggle icon="share" label="Share my check-ins anonymously" value={settings.shareCheckIns} onChange={(v) => actions.patchSettings({ shareCheckIns: v })} hint="Venue, zone, level and a minute-rounded time. No name, no account, no notes, no location." />
        <Toggle icon="bell" label="Notifications" value={settings.notificationsEnabled} onChange={(v) => actions.patchSettings({ notificationsEnabled: v })} hint="Watched spots clearing up, and focus-block changes. Local only." last />
      </Group>

      <SectionHeader>Demo & testing</SectionHeader>
      <Group>
        <Cell
          icon="flask"
          title="Scenario"
          subtitle={settings.demoScenario === 'live' ? 'Real data only' : `Simulated reports · clock set to ${formatShort(now)}`}
          trailing={<Segmented<DemoScenario> label="Demo scenario" options={(['live', 'finals', 'quiet', 'late'] as const).map((v) => ({ value: v, label: SCENARIO_LABEL[v] }))} value={settings.demoScenario} onChange={(v) => applyDemoScenario(v)} />}
        />
        <Toggle icon="offline" label="Simulate no signal" value={settings.simulateOffline} onChange={(v) => actions.patchSettings({ simulateOffline: v })} hint="Shows the OFFLINE banner and blocks network calls" last />
      </Group>
      <SectionFooter>Demo reports are labelled everywhere they appear and never uploaded. For the real test use airplane mode: quit the app, turn airplane mode on, relaunch. Every tab must still open with hours and the typical pattern.</SectionFooter>

      <SectionHeader>Your data</SectionHeader>
      <Group>
        <Cell icon="document" title="Export focus log & check-ins" subtitle="JSON via the share sheet. It is yours." accessory="chevron" onPress={() => void exportLog()} last />
      </Group>

      <SectionHeader>About the data</SectionHeader>
      <Group padded>
        <Text style={type.footnote}>
          Hours: published schedules of Rutgers University Libraries (LibCal), NJIT Library, Stevens Library, New Brunswick Free Public Library, Newark Public Library, Hoboken Public Library and Princeton Public Library, read 3 Oct 2026 — see docs/venue-sources.md. Café hours from a public listing. Coordinates and map lines: © OpenStreetMap contributors, ODbL 1.0 — openstreetmap.org/copyright. Transit modes: NJ Transit, PATH and Amtrak public maps. Typical-day curves are estimates and say so. No venue is a partner; no endorsement is implied.
        </Text>
        <Text style={[type.footnote, tabular, { marginTop: 8 }]}>Last live-level check: {cacheMeta.crowd?.fetchedAt ? formatStamp(cacheMeta.crowd.fetchedAt) : 'never'}</Text>
      </Group>

      <Button title="Reset app data" variant="secondary" onPress={confirmReset} style={{ marginTop: 8 }} />
    </Screen>
  );
}

const styles = {
  ringText: { fontSize: 11, fontWeight: '600' as const },
};
