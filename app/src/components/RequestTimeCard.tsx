import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DraftRequest } from '../lib/draft';
import { formatDate } from '../lib/dates';
import { formatMinutes, formatPlan, QUICK_TIMES, TIME_STEP } from '../lib/requestTime';
import type { RequestTime } from '../lib/shift';
import { colors, font, radius, touch } from '../theme';
import { Chip } from './Chip';
import { TourTarget } from '../lib/tour';
import type { ReactNode } from 'react';

/** Метка для обучения только у первой заявки списка. */
const Mark = ({ on, id, children }: { on?: boolean; id: string; children: ReactNode }) =>
  on ? (
    <TourTarget id={id} style={styles.part}>
      {children}
    </TourTarget>
  ) : (
    <>{children}</>
  );

type Props = {
  time: DraftRequest;
  /** План и время прошлых смен с сервера (может не прийти без связи). */
  info?: RequestTime;
  /** Подсветка частей карточки в обучении. */
  tour?: boolean;
  onChange: (patch: Partial<Pick<DraftRequest, 'minutes' | 'status'>>) => void;
  label?: string;
};

/** Сколько времени ушло на заявку за смену. Крупные кнопки — под палец. */
export function RequestTimeCard({ time, info, onChange, tour, label }: Props) {
  const minutes = time.minutes ?? 0;
  const before = info?.spent_minutes ?? time.carried?.spent ?? 0;
  const plan = info?.plan_minutes ?? time.carried?.plan ?? null;
  const total = before + minutes;
  const over = plan != null && total > plan;
  const step = (d: number) => onChange({ minutes: Math.max(0, Math.min(24 * 60, minutes + d)) });

  return (
    <View style={styles.box}>
      {time.carried ? (
        <Mark on={tour} id="list.carried">
          <Text style={styles.carried}>
            В работе с {formatDate(time.carried.since).slice(0, 5)} · уже потрачено {formatMinutes(time.carried.spent)} · работ:{' '}
            {time.carried.entries}
          </Text>
        </Mark>
      ) : null}
      {plan != null || before > 0 ? (
        <Text style={[styles.plan, over && styles.over]}>
          {plan != null ? `План ${formatPlan(plan)} · ` : ''}всего потрачено {formatMinutes(total)}
          {over ? ' — больше плана' : ''}
        </Text>
      ) : null}

      <Mark on={tour} id="list.time">
        <Text style={styles.label}>{label ?? 'Время за смену'}</Text>
        <View style={styles.chips}>
          {QUICK_TIMES.map((q) => (
            <Chip key={q.label} label={q.label} selected={time.minutes === q.minutes} onPress={() => onChange({ minutes: q.minutes })} />
          ))}
        </View>
        <View style={styles.stepper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Меньше на 15 минут"
            onPress={() => step(-TIME_STEP)}
            style={styles.stepBtn}
          >
            <Text style={styles.stepText}>−15</Text>
          </Pressable>
          <Text style={[styles.value, time.minutes == null && styles.empty]}>
            {time.minutes == null ? 'не указано' : formatMinutes(minutes)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Больше на 15 минут"
            onPress={() => step(TIME_STEP)}
            style={styles.stepBtn}
          >
            <Text style={styles.stepText}>+15</Text>
          </Pressable>
        </View>
      </Mark>

    </View>
  );
}

const styles = StyleSheet.create({
  part: { gap: 8 },
  box: {
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 14,
  },
  carried: {
    fontSize: font.small,
    fontWeight: '700',
    color: colors.black,
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  plan: { fontSize: font.small, color: colors.muted },
  over: { color: colors.danger, fontWeight: '700' },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: touch.min + 8,
    height: touch.min,
    borderRadius: radius.control,
    borderWidth: 2,
    borderColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: font.body, fontWeight: '800' },
  value: {
    flex: 1,
    textAlign: 'center',
    fontSize: font.title,
    fontWeight: '800',
  },
  empty: { color: colors.muted, fontSize: font.body, fontWeight: '600' },
});
