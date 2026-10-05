import { getLocales } from 'expo-localization';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState, Platform, useWindowDimensions } from 'react-native';

// Importing this module also defines the background poll task at module scope (required by expo-task-manager).
import { ensureBackgroundPollRegistered } from '@/services/backgroundPoll';
import { restoreDemoScenario } from '@/services/demo';
import { startNetworkWatch } from '@/services/network';
import { configureNotifications } from '@/services/notifications';
import { refreshIfStale } from '@/services/refresh';
import { setLocale } from '@/i18n';
import { hydrate, useAppState } from '@/store/appStore';
import { colors } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Device language first (iOS per-app language setting respected), then synchronous hydration. No network, no waiting.
try {
  setLocale(getLocales()[0]?.languageTag);
} catch {
  /* stays English */
}
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
  // Text that is already mounted keeps its old measurements when the user changes text size; remounting fixes it.
  const { fontScale } = useWindowDimensions();
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
    void ensureBackgroundPollRegistered();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void refreshIfStale();
    });
    // Levels go stale in minutes: while the app stays open, re-check every five.
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refreshIfStale();
    }, 5 * 60_000);
    return () => {
      stopNet();
      sub.remove();
      clearInterval(timer);
    };
  }, []);

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={Platform.OS === 'ios' ? 'dark' : 'auto'} />
      <Stack key={`fs-${fontScale}`} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
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
          <Stack.Screen name="privacy" />
          <Stack.Screen name="why/[id]" options={{ presentation: 'modal' }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
