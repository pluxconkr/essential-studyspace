/**
 * Tab bar for the three main screens: Now (`index`), Map and Focus. This group is the root stack's
 * anchor, so every pushed screen sits on top of it.
 * Uses expo-router's JavaScript tabs (React Navigation bottom tabs) styled like a UIKit tab bar.
 * Each tab mounts on its first visit, not at launch (docs/perf.md). While a focus session is running,
 * the Focus icon turns green with a dot and its accessibility label says so.
 */
import { Tabs } from 'expo-router/js-tabs';
import { Platform, StyleSheet, View } from 'react-native';

import { t } from '@/i18n';
import { useAppState } from '@/store/appStore';
import { Icon, type IconName } from '@/ui/icons';
import { colors, type } from '@/ui/theme';

/** One tab-bar glyph at the standard 24 pt; callers pass the filled variant for the focused tab and the outline one otherwise. */
function TabIcon({ name, color }: { name: IconName; color: string }) {
  return <Icon name={name} size={24} color={color} weight="medium" />;
}

/**
 * The bottom tab navigator. Its only store read is whether a focus session is running (one exists and is
 * not paused), which recolours the Focus icon, adds the dot and switches its accessibility label.
 */
export default function TabLayout() {
  const running = useAppState((s) => !!s.session && !s.session.pausedAt);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.ink2,
        tabBarStyle: styles.bar,
        tabBarLabelStyle: styles.label,
        // Like UIKit tab bars: labels stay put at large text sizes; everything above the bar scales.
        tabBarAllowFontScaling: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: t('tab.now'), tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'now' : 'nowOutline'} color={String(color)} /> }} />
      <Tabs.Screen name="map" options={{ title: t('tab.map'), tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'map' : 'mapOutline'} color={String(color)} /> }} />
      <Tabs.Screen
        name="focus"
        options={{
          title: t('tab.focus'),
          tabBarAccessibilityLabel: running ? t('tab.focusRunning') : t('tab.focusLabel'),
          tabBarIcon: ({ color, focused }) => (
            <View>
              <TabIcon name={focused ? 'focus' : 'focusOutline'} color={running ? colors.green : String(color)} />
              {running ? <View style={styles.dot} /> : null}
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: 'rgba(249,249,249,0.94)', borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, height: Platform.OS === 'ios' ? 84 : 64, paddingTop: 6 },
  label: { ...type.tabLabel, marginTop: 1 },
  dot: { position: 'absolute', top: -1, right: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green, borderWidth: 1.5, borderColor: '#F9F9F9' },
});
