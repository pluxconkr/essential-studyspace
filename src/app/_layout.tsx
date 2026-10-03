import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { restoreDemoScenario } from '@/services/demo';
import { startNetworkWatch } from '@/services/network';
import { configureNotifications } from '@/services/notifications';
import { refreshIfStale } from '@/services/refresh';
import { hydrate, useAppState } from '@/store/appStore';
import { colors } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Synchronous hydration from local storage before the first render. No network, no waiting.
hydrate();

export const unstable_settings = {
  anchor: '(tabs)',
};

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg, card: colors.surface, primary: colors.navy, text: colors.ink, border: colors.line },
};

export default function RootLayout() {
  const onboarded = useAppState((s) => s.onboarded);
  const booted = useRef(false);

  useEffect(() => {
    SplashScreen.hide();
    if (booted.current) return;
    booted.current = true;
    // Re-materialise the demo scenario (its clock offset is relative to today) before any refresh runs.
    restoreDemoScenario();
    const stopNet = startNetworkWatch((info) => {
      if (info.online) void refreshIfStale();
    });
    void configureNotifications();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void refreshIfStale();
    });
    return () => {
      stopNet();
      sub.remove();
    };
  }, []);

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={Platform.OS === 'ios' ? 'dark' : 'auto'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Protected guard={!onboarded}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={onboarded}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="spot/[id]" />
          <Stack.Screen name="checkin/[id]" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="prefs" />
          <Stack.Screen name="blocks" />
          <Stack.Screen name="data" />
          <Stack.Screen name="why/[id]" options={{ presentation: 'modal' }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
