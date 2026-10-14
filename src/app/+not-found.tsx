/**
 * expo-router's fallback for any URL that matches no route, such as a mistyped or outdated deep link
 * (`studyspace://nowhere`). A sub-screen with a Back bar, one explanation and a way home; no data, no side effects.
 */
import { useRouter } from 'expo-router';

import { t } from '@/i18n';
import { Button, Callout, Subhead } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';

/** The dead-end page: "That screen does not exist" and a "Back to Now" button that replaces this route with the Now tab (`/`). */
export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <Screen title={t('common.notFound.nav')}>
      <Callout icon="info" title={t('common.notFound.title')}>
        <Subhead>{t('common.notFound.body')}</Subhead>
      </Callout>
      <Button title={t('common.notFound.button')} style={{ marginTop: 12 }} onPress={() => router.replace('/')} />
    </Screen>
  );
}
