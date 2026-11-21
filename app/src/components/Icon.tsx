import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors, iconSize, stroke } from '../theme';

/** Контурные значки интерфейса (24×24), одна толщина линии для всех — stroke.icon. */
const shapes = {
  home: <Path d="M3 11l9-7 9 7v9H3z" />,
  requests: (
    <>
      <Rect x={5} y={4} width={14} height={17} rx={2} />
      <Path d="M9 9h6M9 13h6M9 17h3" />
    </>
  ),
  history: (
    <>
      <Circle cx={12} cy={12} r={8} />
      <Path d="M12 8v4l3 2" />
    </>
  ),
  team: <Path d="M6 20V10M12 20V4M18 20v-7" />,
  user: (
    <>
      <Circle cx={12} cy={8} r={4} />
      <Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  tool: <Path d="M3 21l9-9M12.5 6.5l5 5M14 4l6 6-3 3-6-6z" />,
  back: <Path d="M15 5l-7 7 7 7" />,
  camera: (
    <>
      <Path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <Circle cx={12} cy={13} r={3.5} />
    </>
  ),
  plus: <Path d="M12 5v14M5 12h14" />,
  help: (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" />
    </>
  ),
  message: <Path d="M4 5h16v11H9l-5 4z" />,
  alert: <Path d="M12 4l9 16H3zM12 10v4M12 17h.01" />,
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
  upload: (
    <>
      <Rect x={4} y={4} width={16} height={16} rx={2} />
      <Path d="M12 16V9M9 12l3-3 3 3" />
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
  edit: <Path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  logout: <Path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />,
};

/** Три точки «⋯» — залитые кружки. */
const filled = {
  more: (
    <>
      <Circle cx={5} cy={12} r={2} />
      <Circle cx={12} cy={12} r={2} />
      <Circle cx={19} cy={12} r={2} />
    </>
  ),
};

export type IconName = keyof typeof shapes | keyof typeof filled;

export function Icon({ name, size = iconSize.normal, color = colors.black }: { name: IconName; size?: number; color?: string }) {
  if (name in filled) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        {filled[name as keyof typeof filled]}
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke.icon} strokeLinecap="round" strokeLinejoin="round">
      {shapes[name as keyof typeof shapes]}
    </Svg>
  );
}
