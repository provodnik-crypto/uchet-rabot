import { colors, font, fontFiles } from '../theme';

/** Общие настройки шапки внутри разделов. */
export const stackHeader = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.brand },
  headerTintColor: colors.black,
  headerTitleStyle: { fontFamily: fontFiles.bold, fontSize: font.title },
  headerShadowVisible: false,
  headerBackTitle: 'Назад',
  contentStyle: { backgroundColor: colors.bg },
};
