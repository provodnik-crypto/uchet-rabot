import type { ImageSourcePropType } from 'react-native';

/**
 * Фото сотрудников встроены в приложение и не скачиваются с сервера.
 * Раньше они приходили одним ответом ~23 КБ; на части российских сетей такие ответы
 * от серверов за Cloudflare «замирают» и тормозят остальные запросы (рейтинг, суммы).
 * Новое фото: положить файл в assets/employees/<id сотрудника>.jpg и добавить строку ниже.
 */
const PHOTOS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/employees/1.jpg'),
  2: require('../../assets/employees/2.jpg'),
  3: require('../../assets/employees/3.jpg'),
  4: require('../../assets/employees/4.jpg'),
};

/** id сотрудника → фото. Без фото — инициалы. */
export function usePhotoUrls(): Record<number, ImageSourcePropType> {
  return PHOTOS;
}
