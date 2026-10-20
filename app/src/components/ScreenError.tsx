import type { ErrorBoundaryProps } from 'expo-router';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme';
import { BigButton } from './BigButton';
import { reportError } from '../lib/errorLog';
import { useEffect } from 'react';

/** Ошибка на экране: вместо закрытия приложения — понятное сообщение и «Повторить». */
export function ScreenError({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => reportError(error, 'crash'), [error]);
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Что-то пошло не так</Text>
      <Text style={styles.text}>Экран не открылся. Нажмите «Повторить». Если не помогает — вернитесь на главную и сообщите руководителю.</Text>
      <Text style={styles.detail}>{String(error?.message ?? error).slice(0, 200)}</Text>
      <BigButton title="Повторить" onPress={retry} />
      <BigButton
        title="На главную"
        variant="secondary"
        onPress={() => {
          if (router.canDismiss()) router.dismissAll();
          retry();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: 24, gap: 14, justifyContent: 'center', backgroundColor: colors.bg },
  title: { fontSize: font.title, fontWeight: '800' },
  text: { fontSize: font.body },
  detail: { fontSize: font.small - 1, color: colors.muted },
});
