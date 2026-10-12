import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../theme';

/** Простые контурные значки интерфейса (24×24). */
const shapes = {
  chevronRight: <Path d="M9 6l6 6-6 6" />,
  chevronDown: <Path d="M6 9l6 6 6-6" />,
  close: <Path d="M6 6l12 12M18 6L6 18" />,
  check: <Path d="M5 12l5 5 9-10" />,
  search: (
    <>
      <Circle cx={11} cy={11} r={7} />
      <Path d="M20 20l-4-4" />
    </>
  ),
  clock: (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 7v5l3 2" />
    </>
  ),
  list: (
    <>
      <Rect x={5} y={3} width={14} height={18} rx={2} />
      <Path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  chart: <Path d="M4 20V12h4v8zM10 20V7h4v13zM16 20V4h4v16z" />,
  download: (
    <>
      <Rect x={4} y={4} width={16} height={16} rx={2} />
      <Path d="M12 8v7M9 12l3 3 3-3" />
    </>
  ),
  doc: <Path d="M6 3h9l3 3v15H6zM9 11h6M9 15h6" />,
  users: <Path d="M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM3 20c.8-3.5 3.2-5 6-5s5.2 1.5 6 5M16 4.5a3.5 3.5 0 0 1 0 7M18 15c1.6.6 2.6 2.2 3 5" />,
  tag: (
    <>
      <Path d="M3 12V4h8l10 10-8 8z" />
      <Circle cx={7.5} cy={8.5} r={1.5} />
    </>
  ),
  grid: (
    <>
      <Rect x={3} y={4} width={7} height={7} rx={1} />
      <Rect x={14} y={4} width={7} height={7} rx={1} />
      <Rect x={3} y={14} width={7} height={7} rx={1} />
      <Rect x={14} y={14} width={7} height={7} rx={1} />
    </>
  ),
  logout: <Path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />,
};

export type IconName = keyof typeof shapes;

export function Icon({ name, size = 22, color = colors.black, fill = 'none', strokeWidth = 2 }: { name: IconName; size?: number; color?: string; fill?: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {shapes[name]}
    </Svg>
  );
}
