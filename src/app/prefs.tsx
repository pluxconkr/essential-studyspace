/**
 * S-07 Preferences editor. Draft → save → back. Cancel discards everything.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { AREAS, AREA_BLURB, AREA_DEFAULT_STATION, AREA_NAME } from '@/domain/areas';
import { formatModes } from '@/domain/transit';
import { t } from '@/i18n';
import type { NoisePolicy, Prefs } from '@/domain/types';
import { actions, useAppState } from '@/store/appStore';
import { Button, Cell, Group, SectionHeader, Segmented, Toggle } from '@/ui/primitives';
import { Screen, goBackOr } from '@/ui/Screen';

export default function PrefsScreen() {
  const router = useRouter();
  const current = useAppState((s) => s.prefs);
  const stations = useAppState((s) => s.stations);
  const [draft, setDraft] = useState<Prefs>({ ...current });
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const areaStations = stations.filter((s) => s.area === draft.area);

  return (
    <Screen title={t('prefs.nav')} largeTitle={t('prefs.nav')} fallback="/">
      <SectionHeader>{t('prefs.area')}</SectionHeader>
      <Group>
        {AREAS.map((a, i) => (
          <Cell key={a} icon="map" title={AREA_NAME[a]} subtitle={AREA_BLURB[a]} accessory={draft.area === a ? 'check' : 'none'} onPress={() => setDraft((d) => ({ ...d, area: a, homeStationId: AREA_DEFAULT_STATION[a] }))} accessibilityRole="button" accessibilityState={{ selected: draft.area === a }} last={i === AREAS.length - 1} />
        ))}
      </Group>

      <SectionHeader>{t('prefs.station')}</SectionHeader>
      <Group>
        {areaStations.map((s, i) => (
          <Cell key={s.stationId} icon="train" title={s.name} subtitle={formatModes(s)} accessory={draft.homeStationId === s.stationId ? 'check' : 'none'} onPress={() => set('homeStationId', s.stationId)} accessibilityRole="button" accessibilityState={{ selected: draft.homeStationId === s.stationId }} last={i === areaStations.length - 1} />
        ))}
      </Group>

      <SectionHeader>{t('prefs.preferences')}</SectionHeader>
      <Group>
        <Cell
          icon="quiet"
          title={t('prefs.noise')}
          trailing={
            <Segmented<NoisePolicy>
              label={t('prefs.noisePref')}
              options={[
                { value: 'silent', label: t('prefs.silent') },
                { value: 'low', label: t('prefs.low') },
                { value: 'chatty', label: t('prefs.chatty') },
              ]}
              value={draft.noisePref}
              onChange={(v) => set('noisePref', v)}
            />
          }
        />
        <Toggle icon="outlet" label={t('prefs.outlet')} value={draft.needOutlets} onChange={(v) => set('needOutlets', v)} />
        <Toggle icon="accessible" label={t('prefs.stepFree')} value={draft.stepFree} onChange={(v) => set('stepFree', v)} hint={t('prefs.stepFreeHint')} last />
      </Group>

      <Button title={t('prefs.save')} onPress={() => {
        actions.savePrefs(draft);
        goBackOr(router, '/');
      }} style={{ marginTop: 8 }} testID="prefs-save" />
      <Button title={t('common.cancel')} variant="ghost" style={{ marginTop: 6 }} onPress={() => goBackOr(router, '/')} />
    </Screen>
  );
}
