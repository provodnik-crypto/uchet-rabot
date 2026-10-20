import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { TourTarget } from '../lib/tour';
import { colors, font, radius, space, tabBar, touch } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Tab = { path: '/' | '/req' | '/history' | '/team'; label: string; icon: IconName; tour: string };
const TABS: Tab[] = [
  { path: '/', label: 'Главная', icon: 'home', tour: 'tab.home' },
  { path: '/req', label: 'Заявки', icon: 'requests', tour: 'home.requests' },
  { path: '/history', label: 'История', icon: 'history', tour: 'home.history' },
  { path: '/team', label: 'Команда', icon: 'team', tour: 'tab.team' },
];

/**
 * Нижнее меню мастера. Из главной вкладка открывается поверх (кнопка «Назад» телефона вернёт на главную),
 * между вкладками — замена, чтобы не копились экраны.
 */
export function BottomTabs() {
  const path = usePathname();
  const go = (t: Tab) => {
    if (t.path === path) return;
    if (t.path === '/') router.dismissTo('/');
    else if (path === '/') router.push(t.path);
    else router.replace(t.path);
  };
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {TABS.map((t) => {
        const on = t.path === path;
        return (
          <TourTarget key={t.path} id={t.tour} style={styles.flex}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t.label}
              onPress={() => go(t)}
              style={styles.tab}
            >
              <View style={[styles.pill, on && styles.pillOn]}>
                <Icon name={t.icon} color={on ? colors.black : colors.secondary} />
              </View>
              <Text style={[styles.label, on && styles.labelOn]}>{t.label}</Text>
            </Pressable>
          </TourTarget>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', paddingTop: space.s8, paddingHorizontal: space.s4, paddingBottom: space.s10 },
  flex: { flex: 1 },
  tab: { alignItems: 'center', gap: space.s2, minHeight: touch.big },
  pill: { width: tabBar.pillWidth, height: tabBar.pillHeight, borderRadius: radius.tab, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: colors.brand },
  label: { fontSize: font.caption, color: colors.secondary },
  labelOn: { fontWeight: '700', color: colors.black },
});
