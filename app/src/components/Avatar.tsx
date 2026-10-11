import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import { ICON_STROKE, toolIcon, type IconShape } from '../lib/toolIcons';
import { colors } from '../theme';

function Shape({ s }: { s: IconShape }) {
  switch (s.t) {
    case 'path':
      return <Path d={s.d} />;
    case 'line':
      return <Line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />;
    case 'rect':
      return <Rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r ?? 0} />;
    case 'circle':
      return <Circle cx={s.cx} cy={s.cy} r={s.r} />;
  }
}

/** Значок инструмента на жёлтом круге (фото людей не храним). Без значка — первые буквы имени. */
export function Avatar({ name, icon, size = 40 }: { name: string; icon?: number | null; size?: number }) {
  const tool = toolIcon(icon);
  if (tool) {
    return (
      <View accessibilityLabel={name}>
        <Svg width={size} height={size} viewBox="0 0 48 48">
          <Circle cx={24} cy={24} r={24} fill={colors.brand} />
          <G
            transform="translate(9 9) scale(1.25)"
            fill="none"
            stroke={colors.black}
            strokeWidth={ICON_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <G transform={`rotate(${tool.rotate ?? 0} 12 12)`}>
              {tool.shapes.map((s, i) => (
                <Shape key={i} s={s} />
              ))}
            </G>
          </G>
        </Svg>
      </View>
    );
  }
  const box = { width: size, height: size, borderRadius: size / 2 };
  const initials = name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <View style={[styles.fallback, box]} accessibilityLabel={name}>
      <Text style={[styles.text, { fontSize: size * 0.38 }]}>{initials || '?'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '800', color: colors.black },
});
