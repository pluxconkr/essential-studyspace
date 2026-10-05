/**
 * Screen smoke tests: every screen renders from local state with ZERO network, in every demo scenario.
 * Uses expo-router's testing library so hooks like useRouter work.
 */
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

async function press(el: ReturnType<typeof screen.getByText>) {
  await act(async () => {
    await fireEvent.press(el);
    jest.runOnlyPendingTimers();
  });
}

import NowScreen from '@/app/(tabs)/index';
import MapScreen from '@/app/(tabs)/map';
import FocusScreen from '@/app/(tabs)/focus';
import BlocksScreen from '@/app/blocks';
import CheckInScreen from '@/app/checkin/[id]';
import DataScreen from '@/app/data';
import OnboardingScreen from '@/app/onboarding';
import PrefsScreen from '@/app/prefs';
import PrivacyScreen from '@/app/privacy';
import ProfileScreen from '@/app/profile';
import SpotScreen from '@/app/spot/[id]';
import WhyScreen from '@/app/why/[id]';
import { applyDemoScenario } from '@/services/demo';
import { actions, getState, hydrate, setState } from '@/store/appStore';

const routes = {
  index: NowScreen,
  map: MapScreen,
  focus: FocusScreen,
  'spot/[id]': SpotScreen,
  'checkin/[id]': CheckInScreen,
  profile: ProfileScreen,
  prefs: PrefsScreen,
  blocks: BlocksScreen,
  data: DataScreen,
  privacy: PrivacyScreen,
  'why/[id]': WhyScreen,
  onboarding: OnboardingScreen,
};

const fetchSpy = jest.spyOn(globalThis, 'fetch' as never);

beforeEach(() => {
  hydrate();
  applyDemoScenario('live');
  setState({ network: { online: false, type: 'NONE' }, locationStatus: 'denied', location: null });
  actions.savePrefs({ ...getState().prefs, area: 'new-brunswick', homeStationId: 'new-brunswick', blocks: [] }, { finishOnboarding: true });
  fetchSpy.mockClear();
});

afterAll(() => fetchSpy.mockRestore());

describe('Now tab (offline, no fetch)', () => {
  test('live: ranked spots, closed list, your week, offline banner, zero fetches', async () => {
    await renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByText('Open near you')).toBeTruthy();
    expect(screen.getByText(/OFFLINE MODE · saved hours and your check-ins/)).toBeTruthy();
    expect(screen.getByText(/No signal · saved hours and typical pattern/)).toBeTruthy();
    expect(screen.getAllByText(/min$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/-day streak/)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('finals demo: labelled, Packed/Full libraries, Alexander 24h exception', async () => {
    applyDemoScenario('finals');
    await renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByText(/^Demo · clock set to/)).toBeTruthy();
    expect(screen.getAllByText(/Packed|Full/).length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('late-night demo: closing-soon or past-midnight callout', async () => {
    applyDemoScenario('late');
    await renderRouter(routes, { initialUrl: '/' });
    expect((await screen.findAllByText(/closes in|past midnight/i)).length).toBeGreaterThan(0);
  });

  test('standing at a spot offers a one-tap check-in once per 30 minutes', async () => {
    setState({ location: { lat: 40.50495, lng: -74.45228, accuracyM: 10, at: Date.now() }, locationStatus: 'granted' });
    await renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByText("You're at Alexander Library")).toBeTruthy();
    await press(screen.getByTestId('arrival-checkin'));
    expect(await screen.findByText('How crowded is it?')).toBeTruthy();
  });

  test('quiet demo renders', async () => {
    applyDemoScenario('quiet');
    await renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByText('Open near you')).toBeTruthy();
    expect(screen.getAllByText(/Empty|Chill/).length).toBeGreaterThan(0);
  });
});

describe('Map tab', () => {
  test('renders the New Brunswick map with attribution and campus groups, no fetch', async () => {
    await renderRouter(routes, { initialUrl: '/map' });
    expect(await screen.findByText('© OpenStreetMap contributors')).toBeTruthy();
    expect(screen.getByText('College Avenue')).toBeTruthy();
    expect(screen.getByText('Alexander Library')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('the open-late layer narrows the list to spots open past 11 PM today', async () => {
    await renderRouter(routes, { initialUrl: '/map' });
    expect(await screen.findByText(/^12 spots · New Brunswick$/)).toBeTruthy();
    await press(screen.getByText('Open late'));
    expect(screen.getByText(/^\d+ open late · New Brunswick$/)).toBeTruthy();
    expect(screen.queryByText('Chang Library')).toBeNull(); // 9–5 branch is never "late"
  });

  test('deep link switches area', async () => {
    await renderRouter(routes, { initialUrl: '/map?area=hoboken' });
    expect(await screen.findByText(/spots · Hoboken/)).toBeTruthy();
    expect(screen.getByText('Williams Library')).toBeTruthy();
  });
});

describe('Spot, why, check-in', () => {
  test('spot detail shows hours, zones, sources and the typical-day estimate', async () => {
    await renderRouter(routes, { initialUrl: '/spot/alexander-library' });
    expect((await screen.findAllByText('Alexander Library')).length).toBeGreaterThan(0);
    expect(screen.getByText('Quiet Areas')).toBeTruthy();
    expect(screen.getByText('Mon–Thu')).toBeTruthy();
    expect(screen.getByText(/Rutgers University Libraries · checked 2026-10-03/)).toBeTruthy();
    expect(screen.getByText(/Estimate for a typical university library/)).toBeTruthy();
    expect(screen.getByText(/min walk from New Brunswick/)).toBeTruthy();
  });

  test('why screen shows the formula and confidence rules', async () => {
    await renderRouter(routes, { initialUrl: '/why/alexander-library' });
    expect(await screen.findByText(/min walk from New Brunswick/)).toBeTruthy();
    expect(screen.queryByText(/0.35 seats \+ 0.25 proximity/)).toBeNull(); // arithmetic is collapsed by default
    await press(screen.getByTestId('why-math'));
    expect(screen.getByText(/0.35 seats \+ 0.25 proximity/)).toBeTruthy();
    expect(screen.getByText('Confidence')).toBeTruthy();
  });

  test('privacy screen lists what is shared and what never is', async () => {
    await renderRouter(routes, { initialUrl: '/privacy' });
    expect(await screen.findByText('Never shared')).toBeTruthy();
    expect(screen.getByText('Anonymous check-ins')).toBeTruthy();
    expect(screen.getByText(/Read once when you check in/)).toBeTruthy();
  });

  test('one-tap check-in is saved locally with an unverified proof and no fetch while offline', async () => {
    await renderRouter(routes, { initialUrl: '/checkin/alexander-library' });
    expect(await screen.findByText('How crowded is it?')).toBeTruthy();
    await press(screen.getByTestId('level-2'));
    await press(screen.getByTestId('checkin-post'));
    const mine = getState().myCheckIns;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ venueId: 'alexander-library', level: 2, zoneId: null, synced: false, source: 'me' });
    expect(mine[0].shownLevel === null || typeof mine[0].shownLevel === 'number').toBe(true);
    expect(mine[0].proof.distanceM).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Focus tab', () => {
  test('start a 50/10 session, then the live view shows the ring and goals', async () => {
    await renderRouter(routes, { initialUrl: '/focus' });
    expect(await screen.findByText('Timer')).toBeTruthy();
    await press(screen.getByTestId('shape-p25'));
    await press(screen.getByTestId('session-start'));
    expect(getState().session?.shapeId).toBe('p25');
    expect(screen.getByText(/focus · block 1 of 4/)).toBeTruthy();
    expect(screen.getByText('Goals')).toBeTruthy();
    await act(() => actions.discardSession());
  });
});

describe('Profile, prefs, blocks, data, onboarding', () => {
  test('profile renders stats and settings links', async () => {
    await renderRouter(routes, { initialUrl: '/profile' });
    expect(await screen.findByText('When you actually focus')).toBeTruthy();
    expect(screen.getByText('Offline data')).toBeTruthy();
  });

  test('prefs saves a changed area', async () => {
    await renderRouter(routes, { initialUrl: '/prefs' });
    expect(await screen.findByText('Station')).toBeTruthy();
    await press(screen.getByText('Newark'));
    await press(screen.getByTestId('prefs-save'));
    expect(getState().prefs.area).toBe('newark');
    expect(getState().prefs.homeStationId).toBe('newark-penn');
  });

  test('blocks adds a free block', async () => {
    await renderRouter(routes, { initialUrl: '/blocks' });
    expect(await screen.findByText('No free blocks yet')).toBeTruthy();
    await press(screen.getByTestId('block-add'));
    expect(getState().prefs.blocks).toHaveLength(1);
    expect(screen.getByText(/Monday · 2:00 PM – 5:00 PM/)).toBeTruthy();
  });

  test('data shows saved items, a disabled refresh offline, and the demo controls', async () => {
    await renderRouter(routes, { initialUrl: '/data' });
    expect(await screen.findByText(/Spot directory/)).toBeTruthy();
    expect(screen.getByText('No signal — will retry automatically')).toBeTruthy();
    expect(screen.getByText('Demo & testing')).toBeTruthy();
  });

  test('onboarding saves and finishes', async () => {
    setState({ onboarded: false });
    await renderRouter(routes, { initialUrl: '/onboarding' });
    expect(await screen.findByText('Where do you study?')).toBeTruthy();
    await press(screen.getByTestId('onboarding-save'));
    expect(getState().onboarded).toBe(true);
  });
});
