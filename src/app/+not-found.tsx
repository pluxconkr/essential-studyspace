import { useRouter } from 'expo-router';

import { t } from '@/i18n';
import { Button, Callout, Subhead } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';

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
