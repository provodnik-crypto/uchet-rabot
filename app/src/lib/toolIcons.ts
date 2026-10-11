/**
 * Значки сотрудников — инструменты. Нарисованы вручную для этого приложения (без сторонних наборов):
 * сетка 24×24, только контур, одна толщина линии, скруглённые концы и углы.
 * Каждый значок — список простых фигур SVG; при необходимости вся группа поворачивается вокруг центра.
 */
export type IconShape =
  | { t: 'path'; d: string }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; r?: number }
  | { t: 'circle'; cx: number; cy: number; r: number };

export type ToolIcon = { id: number; name: string; rotate?: number; shapes: IconShape[] };

export const ICON_STROKE = 1.75;

export const TOOL_ICONS: ToolIcon[] = [
  {
    id: 1,
    name: 'Молоток',
    shapes: [
      { t: 'path', d: 'M12.2 4.7 L19.3 11.8 L16.8 14.3 L9.7 7.2 Z' },
      { t: 'line', x1: 4.5, y1: 19.5, x2: 13.3, y2: 10.7 },
    ],
  },
  {
    id: 2,
    name: 'Пила',
    shapes: [
      { t: 'path', d: 'M15 7.5 L3 10.5 V14 H15' },
      { t: 'path', d: 'M3 14 l1.5 1.5 l1.5 -1.5 l1.5 1.5 l1.5 -1.5 l1.5 1.5 l1.5 -1.5 l1.5 1.5 l1.5 -1.5' },
      { t: 'path', d: 'M15 7.5 H18.5 a2 2 0 0 1 2 2 V15 a2 2 0 0 1 -2 2 H15 Z' },
      { t: 'rect', x: 16.6, y: 10.3, w: 2.2, h: 3.4, r: 0.8 },
    ],
  },
  {
    id: 3,
    name: 'Отвёртка',
    rotate: 45,
    shapes: [
      { t: 'rect', x: 9.5, y: 2.5, w: 5, h: 8, r: 2 },
      { t: 'line', x1: 11, y1: 5, x2: 11, y2: 8 },
      { t: 'line', x1: 13, y1: 5, x2: 13, y2: 8 },
      { t: 'line', x1: 12, y1: 10.5, x2: 12, y2: 18.5 },
      { t: 'path', d: 'M10.8 18.5 H13.2 L12.6 21.5 H11.4 Z' },
    ],
  },
  {
    id: 4,
    name: 'Гаечный ключ',
    rotate: 45,
    shapes: [{ t: 'path', d: 'M9 2.8 C7.2 4.2 7.4 7.4 10.5 8.6 V20 a1.5 1.5 0 0 0 3 0 V8.6 C16.6 7.4 16.8 4.2 15 2.8 V5.5 H9 Z' }],
  },
  {
    id: 5,
    name: 'Дрель',
    shapes: [
      { t: 'path', d: 'M8 6 H17 a3 3 0 0 1 0 6 H8 Z' },
      { t: 'path', d: 'M8 7 H5 V11 H8' },
      { t: 'line', x1: 5, y1: 9, x2: 2.5, y2: 9 },
      { t: 'path', d: 'M13.5 12 L12.5 19 H17 L18 12' },
      { t: 'line', x1: 11.5, y1: 20.5, x2: 18, y2: 20.5 },
    ],
  },
  {
    id: 6,
    name: 'Рулетка',
    shapes: [
      { t: 'rect', x: 3, y: 6, w: 12, h: 12, r: 3 },
      { t: 'circle', cx: 9, cy: 12, r: 3 },
      { t: 'path', d: 'M15 15 H21 V17.5' },
      { t: 'line', x1: 17, y1: 15, x2: 17, y2: 16.3 },
      { t: 'line', x1: 19, y1: 15, x2: 19, y2: 16.3 },
    ],
  },
  {
    id: 7,
    name: 'Уровень',
    shapes: [
      { t: 'rect', x: 2, y: 8.5, w: 20, h: 7, r: 1.5 },
      { t: 'rect', x: 9, y: 10.25, w: 6, h: 3.5, r: 1.75 },
      { t: 'circle', cx: 12, cy: 12, r: 0.6 },
      { t: 'line', x1: 5, y1: 10.5, x2: 5, y2: 13.5 },
      { t: 'line', x1: 19, y1: 10.5, x2: 19, y2: 13.5 },
    ],
  },
  {
    id: 8,
    name: 'Плоскогубцы',
    shapes: [
      { t: 'path', d: 'M10.5 3 L11.4 9 L7.5 21' },
      { t: 'path', d: 'M13.5 3 L12.6 9 L16.5 21' },
      { t: 'line', x1: 10.5, y1: 3, x2: 13.5, y2: 3 },
      { t: 'circle', cx: 12, cy: 10.5, r: 1.4 },
      { t: 'line', x1: 8.6, y1: 16, x2: 10, y2: 16.4 },
      { t: 'line', x1: 15.4, y1: 16, x2: 14, y2: 16.4 },
    ],
  },
  {
    id: 9,
    name: 'Шпатель',
    shapes: [
      { t: 'path', d: 'M5.5 3 H18.5 L16 10.5 H8 Z' },
      { t: 'rect', x: 9.5, y: 10.5, w: 5, h: 2.5, r: 0.5 },
      { t: 'path', d: 'M10.5 13 H13.5 V19.5 a1.5 1.5 0 0 1 -3 0 Z' },
    ],
  },
  {
    id: 10,
    name: 'Кисть',
    rotate: 30,
    shapes: [
      { t: 'rect', x: 8.5, y: 2.5, w: 7, h: 6, r: 1 },
      { t: 'line', x1: 11, y1: 2.5, x2: 11, y2: 5.5 },
      { t: 'line', x1: 13, y1: 2.5, x2: 13, y2: 5.5 },
      { t: 'path', d: 'M9 8.5 H15 V11 L14 12.5 H10 L9 11 Z' },
      { t: 'path', d: 'M11 12.5 H13 V20.5 a1 1 0 0 1 -2 0 Z' },
    ],
  },
  {
    id: 11,
    name: 'Валик',
    shapes: [
      { t: 'rect', x: 3, y: 3, w: 14, h: 6, r: 2 },
      { t: 'path', d: 'M17 6 H20 V11.5 H12 V14' },
      { t: 'rect', x: 10.5, y: 14, w: 3, h: 7, r: 1.5 },
    ],
  },
  {
    id: 12,
    name: 'Стремянка',
    shapes: [
      { t: 'line', x1: 9.5, y1: 3, x2: 5, y2: 21 },
      { t: 'line', x1: 14.5, y1: 3, x2: 19, y2: 21 },
      { t: 'line', x1: 9.5, y1: 3, x2: 14.5, y2: 3 },
      { t: 'line', x1: 8.25, y1: 8, x2: 15.75, y2: 8 },
      { t: 'line', x1: 7, y1: 13, x2: 17, y2: 13 },
      { t: 'line', x1: 5.75, y1: 18, x2: 18.25, y2: 18 },
    ],
  },
];

export function toolIcon(id: number | null | undefined): ToolIcon | undefined {
  return TOOL_ICONS.find((i) => i.id === id);
}
