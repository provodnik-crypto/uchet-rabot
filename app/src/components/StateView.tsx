import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors, font, space } from '../theme';
import { BigButton } from './BigButton';

/** Индикатор загрузки или ошибка с кнопкой «Повторить». */
export function StateView({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <View style={styles.box}>
        <Text style={styles.error}>{error}</Text>
        <BigButton title="Повторить" onPress={onRetry} />
      </View>
    );
  }
  if (loading) return <ActivityIndicator size="large" color={colors.black} style={{ marginTop: space.s32 }} />;
  return null;
}

const styles = StyleSheet.create({
  box: { gap: space.s12 },
  error: { color: colors.danger, fontSize: font.body },
});
