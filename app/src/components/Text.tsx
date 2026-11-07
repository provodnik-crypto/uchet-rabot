import { createContext, forwardRef, useContext } from 'react';
import {
  Platform,
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { fontFiles } from '../theme';

/**
 * Текст приложения: шрифт LM Main нужного начертания подбирается по жирности сам
 * (до 500 — обычный, 600 — полужирный, 700+ — жирный). Пока шрифт не загрузился или не загрузится — системный.
 */
let ready = false;
export function setFontsReady(ok: boolean) {
  ready = ok;
}

const web = Platform.OS === 'web';
const withFallback = (name: string) => (web ? `${name}, Arial, sans-serif` : name);

/** Жирность родительского текста: вложенный текст без своей жирности её наследует. */
const ParentWeight = createContext(400);

function weightOf(style: StyleProp<TextStyle>, inherited: number): number {
  const w = StyleSheet.flatten(style)?.fontWeight;
  if (w == null) return inherited;
  return w === 'bold' ? 700 : w === 'normal' ? 400 : Number(w) || 400;
}

function family(n: number): TextStyle | null {
  if (!ready) return null;
  const name = n >= 700 ? fontFiles.bold : n >= 600 ? fontFiles.demi : fontFiles.regular;
  // жирность уже в файле шрифта — без искусственного утолщения
  return { fontFamily: withFallback(name), fontWeight: 'normal' };
}

export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...props }, ref) {
  const n = weightOf(style, useContext(ParentWeight));
  return (
    <ParentWeight.Provider value={n}>
      <RNText ref={ref} {...props} style={[style, family(n)]} />
    </ParentWeight.Provider>
  );
});

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...props }, ref) {
  return <RNTextInput ref={ref} {...props} style={[style, family(weightOf(style, 400))]} />;
});

/** Тип для ссылок на поле (useRef<TextInput>). */
export type TextInput = RNTextInput;
export type Text = RNText;
