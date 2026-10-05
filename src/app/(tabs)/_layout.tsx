import { Tabs } from 'expo-router/js-tabs';
import { Platform, StyleSheet, View } from 'react-native';

import { t } from '@/i18n';
import { useAppState } from '@/store/appStore';
import { Icon, type IconName } from '@/ui/icons';
import { colors, type } from '@/ui/theme';

function TabIcon({ name, color }: { name: IconName; color: string }) {
  return <Icon name={name} size={24} color={color} weight="medium" />;
}

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
