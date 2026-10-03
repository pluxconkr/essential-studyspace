import { useRouter } from 'expo-router';

import { Button, Callout, Subhead } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <Screen title="Not found">
      <Callout icon="info" title="That screen does not exist">
        <Subhead>Use the tabs to get back.</Subhead>
      </Callout>
      <Button title="Back to Now" style={{ marginTop: 12 }} onPress={() => router.replace('/')} />
    </Screen>
  );
}
