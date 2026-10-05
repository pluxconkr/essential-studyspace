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
import { t, tn } from '@/i18n';
import { applyDemoScenario, scenarioLabel } from '@/services/demo';
import { refreshAll, type RefreshResult } from '@/services/refresh';
import { actions, hydrate, isOfflineNow, useAppState } from '@/store/appStore';
import { useNow, useRealNow } from '@/store/derived';
import type { IconName } from '@/ui/icons';
import { Button, Callout, Cell, Group, ProgressBar, ProgressRing, SectionFooter, SectionHeader, Segmented, Subhead, Toggle } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';
import { colors, tabular, type } from '@/ui/theme';

const kb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const droppedLabel = (d: 'crowd-cache' | 'old-checkins') => (d === 'crowd-cache' ? t('data.dropped.crowd') : t('data.dropped.checkins'));

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
  const freeText = Number.isFinite(free) ? t('data.freeOnPhone', { size: kb(free) }) : null;
  const [last, setLast] = useState<RefreshResult | null>(null);

  const venueBytes = venueSource === 'network' ? venueRepo.bytes() : JSON.stringify(venues).length;
  const rows: { key: string; icon: IconName; name: string; size: string; saved: boolean; when: string; stale: boolean }[] = [
    { key: 'venues', icon: 'library', name: t('data.directory', { n: venues.length }), size: kb(venueBytes), saved: true, when: venueSource === 'network' && cacheMeta.venues?.fetchedAt ? t('data.savedAgo', { ago: relativeAgo(cacheMeta.venues.fetchedAt, realNow), v: venueVersion }) : t('data.bundled', { v: venueVersion }), stale: venueSource === 'network' && cacheMeta.venues?.fetchedAt ? isStale(cacheMeta.venues.fetchedAt, realNow) : false },
    { key: 'maps', icon: 'map', name: t('data.maps'), size: kb(mapBytes()), saved: true, when: t('data.mapsWhen'), stale: false },
    { key: 'crowd', icon: 'share', name: t('data.liveLevels'), size: crowd ? kb(JSON.stringify(crowd).length) : '—', saved: !!crowd, when: cacheMeta.crowd?.fetchedAt ? `${t('data.checkedAgo', { ago: relativeAgo(cacheMeta.crowd.fetchedAt, realNow) })}${crowd && !crowd.configured ? t('data.devRelay') : ''}` : t('data.notChecked'), stale: cacheMeta.crowd?.fetchedAt ? isStale(cacheMeta.crowd.fetchedAt, realNow, 1 / 24) : false },
    { key: 'checkins', icon: 'checkin', name: t('data.yourCheckIns', { n: myCheckIns.length }), size: kb(JSON.stringify(myCheckIns).length), saved: true, when: myCheckIns.some((c) => !c.synced) ? t('data.notSharedYet', { n: myCheckIns.filter((c) => !c.synced).length }) : t('data.allShared'), stale: false },
    { key: 'focus', icon: 'focus', name: t('data.focusLog', { n: focusLog.length }), size: kb(JSON.stringify(focusLog).length), saved: true, when: t('data.focusLogWhen'), stale: false },
  ];
  const savedCount = rows.filter((r) => r.saved).length;

  const run = async () => setLast(await refreshAll());

  const exportLog = async () => {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), focusLog, checkIns: myCheckIns }, null, 2);
    try {
      await Share.share({ message: payload, title: t('data.exportTitle') });
    } catch {
      /* cancelled */
    }
  };

  const confirmReset = () => {
    const doReset = () => {
      resetAllData();
      applyDemoScenario('live');
      hydrate();
    };
    if (Platform.OS === 'web') {
      if (globalThis.confirm(t('data.resetWeb'))) doReset();
      return;
    }
    Alert.alert(t('data.reset'), t('data.resetBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('data.erase'), style: 'destructive', onPress: doReset },
    ]);
  };

  return (
    <Screen title={t('data.nav')} largeTitle={t('data.nav')} subtitle={t('data.subtitle')} testID="data">
      <Group style={{ marginTop: 8 }}>
        <Cell
          leading={
            <ProgressRing pct={(savedCount / rows.length) * 100} size={44} stroke={4} color={savedCount === rows.length ? colors.green : colors.amber}>
              <Text maxFontSizeMultiplier={1.15} style={[type.caption2, tabular, { color: savedCount === rows.length ? colors.green : colors.amber }]}>
                {savedCount}/{rows.length}
              </Text>
            </ProgressRing>
          }
          title={savedCount === rows.length ? t('data.allSaved') : t('data.notFetched')}
          subtitle={t('data.allSavedHint')}
          last
        />
      </Group>
      <Button title={refreshing ? t('data.refreshing') : offline ? t('data.noSignal') : t('data.refresh')} disabled={offline || refreshing} onPress={() => void run()} accessibilityHint={t('data.refreshHint')} />
      {refreshing && progress ? (
        <Group padded style={{ marginTop: 10 }}>
          <ProgressBar pct={(progress.done / progress.total) * 100} color={colors.tint} label={t('data.progress', { done: progress.done, total: progress.total })} />
          <Text style={[type.footnote, tabular, { marginTop: 8 }]}>{`${t('data.progressLine', { done: progress.done, total: progress.total })}${freeText ? ` · ${freeText}` : ''}`}</Text>
        </Group>
      ) : null}
      {last ? <SectionFooter style={{ textAlign: 'center' }}>{`${t('data.lastResult', { crowd: last.crowd, dir: last.venues === 'no-source' ? t('data.bundledNoFeed') : last.venues })}${tn(last.synced, 'data.synced')}${last.watchHits ? tn(last.watchHits, 'data.watchAlerts') : ''}`}</SectionFooter> : null}

      {storageNotice ? (
        <Callout icon="alert" tone="amber" title={storageNotice.recovered ? t('data.storageAlmostFull') : t('data.storageFull')}>
          <Subhead>
            {storageNotice.dropped.length > 0 ? t('data.gaveUp', { what: storageNotice.dropped.map(droppedLabel).join(t('now.and')) }) : ''}
            {t('data.kept')}
          </Subhead>
          <Button title={t('data.ok')} variant="tonal" size="sm" style={{ marginTop: 10, alignSelf: 'flex-start' }} onPress={() => actions.dismissStorageNotice()} />
        </Callout>
      ) : null}

      <SectionHeader>{t('data.savedItems')}</SectionHeader>
      <Group>
        {rows.map((r, i) => (
          <Cell key={r.key} icon={r.icon} iconColor={r.saved ? (r.stale ? colors.amber : colors.green) : colors.ink2} title={r.name} subtitle={`${r.size} · ${r.when}${r.stale ? t('data.olderThanExpected') : ''}`} value={r.saved ? (r.stale ? t('data.old') : t('data.saved')) : t('data.missing')} valueColor={r.saved ? (r.stale ? colors.amber : colors.green) : colors.ink2} last={i === rows.length - 1} />
        ))}
      </Group>
      <SectionFooter>{t('data.footprint')}{freeText ? ` ${freeText}.` : ''}</SectionFooter>

      <SectionHeader>{t('data.sharing')}</SectionHeader>
      <Group>
        <Toggle icon="share" label={t('data.shareLabel')} value={settings.shareCheckIns} onChange={(v) => actions.patchSettings({ shareCheckIns: v })} hint={t('privacy.anonymousHint')} />
        <Toggle icon="bell" label={t('data.notifications')} value={settings.notificationsEnabled} onChange={(v) => actions.patchSettings({ notificationsEnabled: v })} hint={t('data.notifHint')} last />
      </Group>

      <SectionHeader>{t('data.demo')}</SectionHeader>
      <Group>
        <Cell
          icon="flask"
          title={t('data.scenario')}
          subtitle={settings.demoScenario === 'live' ? t('data.realData') : t('data.clockSet', { time: formatShort(now) })}
          trailing={<Segmented<DemoScenario> label={t('data.demoScenario')} options={(['live', 'finals', 'quiet', 'late'] as const).map((v) => ({ value: v, label: scenarioLabel(v) }))} value={settings.demoScenario} onChange={(v) => applyDemoScenario(v)} />}
        />
        <Toggle icon="offline" label={t('data.simulate')} value={settings.simulateOffline} onChange={(v) => actions.patchSettings({ simulateOffline: v })} last />
      </Group>
      <SectionFooter>{t('data.demoFooter')}</SectionFooter>

      <SectionHeader>{t('data.yourData')}</SectionHeader>
      <Group>
        <Cell icon="document" title={t('data.export')} subtitle="JSON" accessory="chevron" onPress={() => void exportLog()} last />
      </Group>

      <SectionHeader>{t('data.about')}</SectionHeader>
      <Group padded>
        <Text style={type.footnote}>{t('data.aboutText')}</Text>
        <Text style={[type.footnote, tabular, { marginTop: 8 }]}>{t('data.lastCheck', { when: cacheMeta.crowd?.fetchedAt ? formatStamp(cacheMeta.crowd.fetchedAt) : t('time.never') })}</Text>
      </Group>

      <Button title={t('data.reset')} variant="secondary" onPress={confirmReset} style={{ marginTop: 8 }} />
    </Screen>
  );
}

