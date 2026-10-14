/**
 * Root layout: the app shell every screen renders inside.
 *
 * At import time, before the first render, it holds the native splash, sets the language from the
 * device and hydrates the store synchronously from local storage, so the first frame already shows
 * real data. On mount it hides the splash and boots the services: demo-scenario restore, the network
 * watch, local notifications, the background watch poll, and the foreground refresh policy: refresh
 * whenever the network reports online (so at every launch with a signal), on return to the foreground
 * and every five minutes while open, each skipped while the last attempt is under five minutes old.
 * It also declares the root stack: onboarding until the student finishes it, then the tabs and every
 * pushed screen.
 */
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

// Keep the native splash up until RootLayout's first effect hides it. Best effort: if this fails the splash hides on its own.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Device language first (iOS per-app language setting respected), then synchronous hydration. No network, no waiting.
// Both run at module scope: once per launch, before the first render.
try {
  setLocale(getLocales()[0]?.languageTag);
} catch {
  /* stays English */
}
hydrate();

/**
 * expo-router settings: `(tabs)` anchors the root stack, so a deep link straight to a pushed screen
 * (e.g. `studyspace://spot/alexander-library`) opens with the tabs beneath it and Back has somewhere to go.
 */
export const unstable_settings = {
  anchor: '(tabs)',
};

/** React Navigation theme mapped onto the app's light-only design tokens, so navigator backgrounds, cards and borders match the grouped-list surfaces. */
const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg, card: colors.surface, primary: colors.navy, text: colors.ink, border: colors.line },
};

/**
 * Root component: boots the services once and renders the root stack. Before onboarding only
 * `onboarding` is reachable; when `onboarded` flips (Save or Skip there) its guard closes and the tabs
 * plus every pushed screen (spot, check-in, report, profile, prefs, blocks, data, privacy) open up,
 * with `why/[id]` as a modal. Navigator headers are off: every screen draws its own through `Screen`.
 */
export default function RootLayout() {
  const onboarded = useAppState((s) => s.onboarded);
  // Text that is already mounted keeps its old measurements when the user changes text size (verified on the simulator: Fabric does not re-measure it); remounting fixes it.
  // Hence the fontScale `key` on the Stack below: a text-size change remounts every screen (see docs/perf.md).
  const { fontScale } = useWindowDimensions();
  const booted = useRef(false);

  useEffect(() => {
    // Hydration ran at import, so the first frame already shows real data: the splash can go now.
    SplashScreen.hide();
    // Boot work below runs once (`booted`); the cleanup stops the watchers it started.
    if (booted.current) return;
    booted.current = true;
    // Re-materialise the demo scenario (its clock offset is relative to today) before any refresh runs.
    restoreDemoScenario();
    // Mirror connectivity into the store. The first reading and every later change that says online call
    // refreshIfStale; its last-attempt stamp lives in memory only, so every launch with a signal refreshes.
    const stopNet = startNetworkWatch((info) => {
      if (info.online) void refreshIfStale();
    });
    // Notification handler and Android channel only; the permission prompt waits until a notification is first scheduled.
    void configureNotifications();
    // Register the OS background check of watched spots: dev and production builds only (not Expo Go, never web).
    void ensureBackgroundPollRegistered();
    // Back in the foreground → refresh if stale.
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
          <Stack.Screen name="report/[id]" />
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
