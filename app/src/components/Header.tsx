import { colors } from '../theme';

/** Общие настройки шапки внутри разделов. */
export const stackHeader = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.brand },
  headerTintColor: colors.black,
  headerTitleStyle: { fontWeight: '700' as const, fontSize: 20 },
  headerShadowVisible: false,
  headerBackTitle: 'Назад',
  contentStyle: { backgroundColor: colors.bg },
};
