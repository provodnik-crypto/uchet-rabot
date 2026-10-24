import { StyleSheet, View } from 'react-native';
import { requestExtras } from '../lib/requests';
import { useFocusQuery } from '../lib/useQuery';
import type { RemotePhoto } from '../lib/workPhotos';
import { colors, font, space } from '../theme';
import { PhotoStrip } from './PhotoStrip';
import { Text } from './Text';

/**
 * Под описанием заявки: рабочий телефон инициатора (031xxx) и фото из файла ITSM.
 * Нажатие на фото — на весь экран, листать влево-вправо. Ничего нет — блока нет.
 */
export function RequestExtras({ requestId }: { requestId: number }) {
  const { data } = useFocusQuery(() => requestExtras(requestId).catch(() => null), { key: `extras:${requestId}` });
  if (!data || (!data.contact_phone && !data.photos.length)) return null;
  return (
    <View style={styles.wrap}>
      {data.contact_phone ? (
        <Text style={styles.phone} selectable>
          Тел. инициатора: <Text style={styles.bold}>{data.contact_phone}</Text>
        </Text>
      ) : null}
      {data.photos.length ? (
        <>
          <Text style={styles.meta}>Фото от инициатора — нажмите, чтобы открыть</Text>
          <PhotoStrip photos={data.photos as unknown as RemotePhoto[]} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.s6 },
  phone: { fontSize: font.body },
  bold: { fontWeight: '700' },
  meta: { fontSize: font.small, color: colors.secondary },
});
