import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { formatUpdatedAt } from '../lib/useQuery';
import { colors, font, radius, space, stroke } from '../theme';
import { BigButton } from './BigButton';

/** То, что экран знает о своих загрузках: данные, ошибка, идёт ли загрузка, когда обновлено. */
export type StatusLike = {
  data?: unknown;
  error: string | null;
  loading: boolean;
  updatedAt?: Date | null;
  reload: () => unknown;
};

export function toList(s: StatusLike | StatusLike[] | undefined): StatusLike[] {
  return !s ? [] : Array.isArray(s) ? s : [s];
}

/**
 * Над содержимым экрана: при ошибке — плашка с текстом и «Повторить», а прежние данные остаются;
 * иначе — мелкая строка «Обновлено в 19:20». Если данных ещё нет, ошибку показывает сам экран
 * (StateView), кроме экранов-«каркасов» вроде главной (frame) — там плашка видна всегда.
 */
export function LoadStatus({ status, frame }: { status?: StatusLike | StatusLike[]; frame?: boolean }) {
  const list = toList(status);
  if (!list.length) return null;
  const failed = list.find((s) => s.error && (frame || s.data != null));
  const dated = list.filter((s) => s.data != null && s.updatedAt).map((s) => s.updatedAt as Date);
  const oldest = dated.length ? new Date(Math.min(...dated.map((d) => d.getTime()))) : null;
  const loading = list.some((s) => s.loading);

  if (failed) {
    return (
      <View style={styles.banner} accessibilityRole="alert">
        <Text style={styles.bannerText}>{failed.error}</Text>
        {oldest ? <Text style={styles.bannerMeta}>Показаны данные, обновлённые в {formatUpdatedAt(oldest)}</Text> : null}
        <BigButton
          title="Повторить"
          size="small"
          variant="secondary"
          onPress={() => list.filter((s) => s.error).forEach((s) => s.reload())}
        />
      </View>
    );
  }
  if (!oldest) return null;
  return (
    <Text style={styles.line}>
      {loading ? 'Обновляется… · ' : ''}Обновлено в {formatUpdatedAt(oldest)}
    </Text>
  );
}

const styles = StyleSheet.create({
  banner: { gap: space.s6, padding: space.s12, borderRadius: radius.card, backgroundColor: colors.dangerBg, borderWidth: stroke.hair, borderColor: colors.danger },
  bannerText: { fontSize: font.body, color: colors.danger, fontWeight: '600' },
  bannerMeta: { fontSize: font.small, color: colors.secondary },
  line: { fontSize: font.caption, color: colors.muted, textAlign: 'right', marginBottom: -space.s6 },
});
