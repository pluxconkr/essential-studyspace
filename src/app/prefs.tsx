/**
 * S-07 Preferences editor. Draft → save → back. Cancel discards everything.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { AREAS, AREA_BLURB, AREA_DEFAULT_STATION, AREA_NAME } from '@/domain/areas';
import { formatModes } from '@/domain/transit';
import type { Area, NoisePolicy, Prefs } from '@/domain/types';
import { actions, useAppState } from '@/store/appStore';
import { Button, Cell, Group, SectionFooter, SectionHeader, Segmented, Toggle } from '@/ui/primitives';
import { Screen, goBackOr } from '@/ui/Screen';

export default function PrefsScreen() {
  const router = useRouter();
  const current = useAppState((s) => s.prefs);
  const stations = useAppState((s) => s.stations);
  const [draft, setDraft] = useState<Prefs>({ ...current });
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const areaStations = stations.filter((s) => s.area === draft.area);

  return (
    <Screen title="Preferences" largeTitle="Preferences" fallback="/">
      <SectionHeader>Area</SectionHeader>
      <Group padded>
        <Segmented<Area> label="Area" options={AREAS.map((a) => ({ value: a, label: AREA_NAME[a] }))} value={draft.area} onChange={(a) => setDraft((d) => ({ ...d, area: a, homeStationId: AREA_DEFAULT_STATION[a] }))} />
      </Group>
      <SectionFooter>{AREA_BLURB[draft.area]}</SectionFooter>

      <SectionHeader>Your station</SectionHeader>
      <Group>
        {areaStations.map((s, i) => (
          <Cell key={s.stationId} icon="train" title={s.name} subtitle={formatModes(s)} accessory={draft.homeStationId === s.stationId ? 'check' : 'none'} onPress={() => set('homeStationId', s.stationId)} accessibilityRole="button" accessibilityState={{ selected: draft.homeStationId === s.stationId }} last={i === areaStations.length - 1} />
        ))}
      </Group>

      <SectionHeader>How you like it</SectionHeader>
      <Group>
        <Cell
          icon="quiet"
          title="Noise"
          trailing={
            <Segmented<NoisePolicy>
              label="Noise preference"
              options={[
                { value: 'silent', label: 'Silent' },
                { value: 'low', label: 'Low' },
                { value: 'chatty', label: 'Chatty' },
              ]}
              value={draft.noisePref}
              onChange={(v) => set('noisePref', v)}
            />
          }
        />
        <Toggle icon="outlet" label="I need an outlet" value={draft.needOutlets} onChange={(v) => set('needOutlets', v)} />
        <Toggle icon="accessible" label="Step-free access" value={draft.stepFree} onChange={(v) => set('stepFree', v)} hint="Only confirmed step-free spots score; unknown ones do not" last />
      </Group>

      <Button title="Save changes" onPress={() => {
        actions.savePrefs(draft);
        goBackOr(router, '/');
      }} style={{ marginTop: 8 }} testID="prefs-save" />
      <Button title="Cancel" variant="ghost" style={{ marginTop: 6 }} onPress={() => goBackOr(router, '/')} />
      <SectionFooter style={{ textAlign: 'center' }}>Saved on this phone first. No signal needed.</SectionFooter>
    </Screen>
  );
}
