/**
 * Все цвета, размеры текста, скругления и отступы приложения — только здесь (макеты 2026-10, LM Design).
 * На экранах — ссылки на эти значения, без своих чисел и цветов.
 */
export const colors = {
  brand: '#FDC300',
  /** Тёмно-жёлтый: значки и точки на светлом фоне (не для текста). */
  brandDark: '#BE9200',
  black: '#000000',
  white: '#FFFFFF',
  bg: '#F2F2F2',
  card: '#FFFFFF',
  /** Тихая заливка внутри карточки. */
  subtle: '#F7F7F7',
  text: '#000000',
  secondary: '#595959',
  muted: '#6B6B6B',
  border: '#E7E6E6',
  /** Рамка поля ввода. */
  field: '#A6A6A6',
  danger: '#C00000',
  dangerBg: '#F7DCD5',
  success: '#1E6B4F',
  successBg: '#E0EDE9',
  info: '#0B4A8B',
  infoBg: '#DCE8F5',
  violet: '#4A2A85',
  violetBg: '#ECE4F7',
  /** Светло-жёлтая подложка: своё сообщение, «на оценке», приостановлена. */
  note: '#FFF3C4',
  /** Тёмный оттенок жёлтого для текста на светлом. */
  noteText: '#6B4E00',
  /** Текст на чёрном. */
  onDark: '#FFFFFF',
  onDarkMuted: '#CFCFCF',
  /** Полупрозрачные: затемнение под окном, кнопка на жёлтом, кнопка на фото. */
  overlay: 'rgba(0,0,0,0.45)',
  overlayStrong: 'rgba(0,0,0,0.62)',
  onBrandGlass: 'rgba(0,0,0,0.08)',
  onPhotoGlass: 'rgba(255,255,255,0.18)',
  onPhotoText: 'rgba(255,255,255,0.75)',
  errorOnDark: '#FF8A80',
  handle: '#D0D0D0',
  darkPanel: '#1F1F1F',
};

/** Статусы заявки: всегда цвет + слово (макет «Статусы»). */
export const statusColors = {
  waiting: { bg: '#E7E6E6', fg: '#000000' },
  in_work: { bg: '#FDC300', fg: '#000000' },
  busy: { bg: '#000000', fg: '#FFFFFF' },
  review: { bg: '#DCE8F5', fg: '#0B4A8B' },
  returned: { bg: '#F7DCD5', fg: '#C00000' },
  accepted: { bg: '#E0EDE9', fg: '#1E6B4F' },
  contractor: { bg: '#ECE4F7', fg: '#4A2A85' },
  urgent: { bg: '#F7DCD5', fg: '#C00000' },
  paused: { bg: '#FFF3C4', fg: '#6B4E00' },
  high: { bg: '#FFF3C4', fg: '#6B4E00' },
} as const;
export type StatusTone = keyof typeof statusColors;

/** Размер текста: не мельче 13. */
export const font = {
  caption: 13,
  small: 14,
  /** Текст в списках, ленте, фильтрах. */
  list: 15,
  body: 16,
  text: 17,
  /** Номер заявки в списке. */
  lead: 18,
  title: 19,
  number: 20,
  header: 22,
  h1: 24,
  sum: 30,
  /** «⋯» и крестики. */
  symbol: 24,
};

/** Межстрочный интервал для длинного текста (17 × 1.45). */
export const lineHeight = { text: 25, body: 22, list: 20, small: 19 };

/** Шрифт LM Main трёх начертаний (файлы в assets/fonts). Если не загрузился — системный. */
export const fontFiles = {
  regular: 'LMMain-Regular',
  demi: 'LMMain-DemiBold',
  bold: 'LMMain-Bold',
};

export const radius = { card: 16, control: 12, pill: 12, tab: 15, chip: 20, small: 10, tiny: 4, round: 999 };

/** Высота кнопок и полей. Мелкие кнопки (40) добирают зону нажатия до 48 через hitSlop. */
export const touch = { min: 48, mid: 52, big: 56, small: 40, icon: 44, tiny: 32 };

/** Нижнее меню: жёлтая плашка под значком активной вкладки. */
export const tabBar = { pillWidth: 56, pillHeight: 30 };

/** Поле комментария (несколько строк). */
export const textArea = { minHeight: 84 };

/** Полоска-ручка у шторки снизу. */
export const sheetHandle = { width: 36, height: 4 };

/** Отступы — сетка по 2. */
export const space = { s2: 2, s4: 4, s6: 6, s8: 8, s10: 10, s12: 12, s14: 14, s16: 16, s18: 18, s20: 20, s24: 24, s32: 32 };

/** Размеры значков. */
export const iconSize = { small: 16, medium: 20, normal: 22, big: 26 };

/** Толщина линий: значки, обводка своей заявки, рамка поля. */
export const stroke = { icon: 2, outline: 2, hair: 1 };

/** Прозрачность: занятые чужие заявки, нажатие, недоступная кнопка. */
export const opacity = { dim: 0.75, pressed: 0.7, disabled: 0.45, soft: 0.8 };

/** Разрядка заголовков заглавными. */
export const letterSpacing = { caps: 0.3 };

/** Прочие размеры элементов (миниатюры, значки сотрудников, полоски, метки). */
export const size = {
  /** Точка в ленте и шкала рейтинга. */
  dot: 10,
  dotSmall: 6,
  barThin: 6,
  /** Счётчик-кружок. */
  badge: 24,
  /** Высота мелкой метки статуса работы. */
  tag: 22,
  /** Галочка и место в рейтинге. */
  check: 28,
  avatar: 44,
  avatarSmall: 32,
  avatarBig: 96,
  logo: 88,
  thumb: 96,
  thumbSmall: 64,
  /** Плитка на главной руководителя. */
  tile: 92,
  /** Жёлтый уголок на плитке руководителя. */
  cornerWidth: 80,
  cornerHeight: 30,
  /** Поле выбора в шапке фильтров. */
  filterMax: 220,
  /** Большое поле текста (загрузка заявок). */
  bigText: 100,
};

/** Тень только у подсказок обучения (карточки — без теней). */
export const tourShadow = { elevation: 6, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } };
