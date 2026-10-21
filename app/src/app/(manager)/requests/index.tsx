import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { humanError } from '../../../lib/errors';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../components/Text';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { Segmented } from '../../../components/Segmented';
import { StateView } from '../../../components/StateView';
import { formatDate } from '../../../lib/dates';
import { listRequests, type RequestStatusFilter } from '../../../lib/manager';
import { formatRegistered, holdText, lifecycleLabel, mastersNow, setStaleWorkDays, staleWorkDays, workDaysText, priorityLabel, type LifecycleStatus, type Priority, requestLabel } from '../../../lib/requests';
import { listMasters } from '../../../lib/shift';
import { useFocusQuery } from '../../../lib/useQuery';
import { FilterSelect } from '../../../components/FilterSelect';
import { RequestBadges } from '../../../components/RequestBadges';
import { TourTarget } from '../../../lib/tour';
import { colors, font, opacity, radius, space, stroke, touch } from '../../../theme';
import { DueLine } from '../../../components/DueLine';

export default function RequestsScreen() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<RequestStatusFilter>('open');
  const params = useLocalSearchParams<{ lifecycle?: LifecycleStatus | 'pause_request' | 'materials' }>();
  const [lifecycle, setLifecycle] = useState<LifecycleStatus | 'pause_request' | 'materials' | null>(params.lifecycle ?? null);
  // кто над какой заявкой работает сейчас
  const nowQ = useFocusQuery(mastersNow, { key: 'masters-now' });
  // порог подсветки «долго в работе» (рабочих дней), настройка магазина
  const limitQ = useFocusQuery(staleWorkDays, { key: 'stale-work-days' });
  const limit = limitQ.data ?? 3;
  const [limitErr, setLimitErr] = useState<string | null>(null);
  const changeLimit = async (d: number) => {
    const next = Math.max(1, Math.min(60, limit + d));
    if (next === limit) return;
    setLimitErr(null);
    try {
      await setStaleWorkDays(next);
      await Promise.all([limitQ.reload(), query.reload()]);
    } catch (e) {
      setLimitErr(humanError(e));
    }
  };
  const long = (days: number | null | undefined) => days != null && days > limit;
  const [priority, setPriority] = useState<Priority | null>(null);
  const [employee, setEmployee] = useState<number | null>(null);
  const { data: masters } = useFocusQuery(listMasters);
  const query = useFocusQuery(() => listRequests(q, status, { lifecycle, priority, employee }), {
    key: `requests:${status}:${lifecycle ?? ''}:${priority ?? ''}:${employee ?? ''}:${q}`,
    persist: !q,
    debounceMs: 300,
  });
  const { data: rows, error, loading, reload } = query;

  return (
    <Screen status={[query, nowQ]}>
      {nowQ.data?.length ? (
        <TourTarget id="requests.now">
          <Card style={styles.now}>
            <Text style={styles.nowTitle}>Сейчас в работе</Text>
            {nowQ.data.map((m) => {
              const over = long(m.work_days);
              return (
                <Pressable
                  key={m.employee_id}
                  accessibilityRole="button"
                  disabled={!m.request_id}
                  onPress={() => m.request_id && router.push({ pathname: '/requests/[id]', params: { id: String(m.request_id), number: m.number ?? '' } })}
                  style={({ pressed }) => [styles.nowRow, pressed && { opacity: opacity.pressed }]}
                >
                  <Text style={styles.nowName}>{m.display_name}</Text>
                  {m.request_id ? (
                    <>
                      <Text style={styles.nowReq}>
                        {m.priority === 1 ? '● ' : ''}
                        {requestLabel(m.number)}
                        {m.operation ? ` · ${m.operation}` : ''}
                      </Text>
                      <Text style={[styles.meta, over && styles.overText]}>
                        {m.taken_at ? `с ${formatDate(m.taken_at.slice(0, 10))} · ` : ''}
                        {workDaysText(m.work_days)}
                        {over ? ` — дольше ${limit} раб. дн.` : ''}
                      </Text>
                      {m.pause_request ? <Text style={styles.nowWarn}>Просит приостановить: {m.pause_request}</Text> : null}
                      {m.returned ? <Text style={styles.meta}>Вернули на доработку</Text> : null}
                    </>
                  ) : (
                    <Text style={styles.meta}>Свободен</Text>
                  )}
                  {m.paused ? <Text style={styles.meta}>Приостановлено: {m.paused}</Text> : null}
                </Pressable>
              );
            })}
          </Card>
        </TourTarget>
      ) : null}
      <Field label="Поиск" value={q} onChangeText={setQ} placeholder="номер, операция или текст" autoCorrect={false} />
      <Segmented<RequestStatusFilter>
        options={[
          { value: 'open', label: 'Открытые' },
          { value: 'closed', label: 'Закрытые' },
          { value: 'all', label: 'Все' },
        ]}
        value={status}
        onChange={setStatus}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} keyboardShouldPersistTaps="handled">
        <FilterSelect
          label="Статус"
          allLabel="Все статусы"
          value={lifecycle}
          onChange={setLifecycle}
          options={[
            ...(Object.keys(lifecycleLabel) as LifecycleStatus[]).map((v) => ({ value: v as LifecycleStatus | 'pause_request' | 'materials', label: lifecycleLabel[v] })),
            { value: 'pause_request' as const, label: 'Запросы на приостановку' },
            { value: 'materials' as const, label: 'Ждут материалы' },
          ]}
        />
        <FilterSelect
          label="Приоритет"
          allLabel="Любой приоритет"
          value={priority}
          onChange={setPriority}
          options={([1, 2, 3, 4] as Priority[]).map((v) => ({ value: v, label: priorityLabel[v] }))}
        />
        <FilterSelect
          label="Мастер"
          allLabel="Все мастера"
          value={employee}
          onChange={setEmployee}
          options={(masters ?? []).map((m) => ({ value: m.id, label: m.display_name }))}
        />
      </ScrollView>
      <BigButton title="+ Новая заявка" onPress={() => router.push('/requests/new')} />
      <BigButton title="Загрузить заявки из ITSM" variant="secondary" onPress={() => router.push('/import')} />
      <BigButton title="Закрыть старые заявки" variant="secondary" onPress={() => router.push('/requests/close-old')} />
      <Text style={styles.meta}>Нажмите на заявку, чтобы назначить её мастеру или подрядчику, закрыть или открыть снова. Оранжевая рамка — заявка в работе дольше порога.</Text>
      <Card style={styles.limit}>
        <Text style={styles.limitText}>Подсвечивать, если в работе дольше</Text>
        <View style={styles.limitRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Меньше на день" hitSlop={space.s8} style={styles.limitBtn} onPress={() => changeLimit(-1)}>
            <Text style={styles.limitBtnText}>−</Text>
          </Pressable>
          <Text style={styles.limitValue}>{limit} раб. дн.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Больше на день" hitSlop={space.s8} style={styles.limitBtn} onPress={() => changeLimit(1)}>
            <Text style={styles.limitBtnText}>+</Text>
          </Pressable>
        </View>
        {limitErr ? <Text style={styles.overText}>{limitErr}</Text> : null}
      </Card>
      {!rows ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {rows && !rows.length ? <Text style={styles.meta}>{status === 'closed' ? 'Закрытых заявок нет' : 'Заявок не найдено'}</Text> : null}
      {rows?.map((r, i) => (
        <TourTarget key={r.id} id={i === 0 ? 'requests.first' : `requests.${r.id}`}>
        <Card
          key={r.id}
          style={[styles.card, r.status === 'in_work' && long(r.work_days) && styles.stale]}
          onPress={() => router.push({ pathname: '/requests/[id]', params: { id: String(r.id), data: JSON.stringify(r) } })}
        >
          <RequestBadges status={r.status} priority={r.priority} responsibleName={r.responsible_name} unread={r.unread} />
          {r.status === 'in_work' && r.work_days != null ? (
            <Text style={[styles.meta, long(r.work_days) && styles.staleText]}>
              {workDaysText(r.work_days).replace(/^в/, 'В')}
              {long(r.work_days) ? ` — дольше ${limit}` : ''}
              {r.returned_comment ? ' · возвращена' : ''}
            </Text>
          ) : null}
          {r.pause_request ? <Text style={styles.nowWarn}>Мастер просит приостановить: {r.pause_request}</Text> : null}
          {r.status === 'paused' ? <Text style={styles.nowWarn}>{holdText(r.hold_reason, r.hold_number)}</Text> : null}
          <Text style={styles.number}>
            {requestLabel(r.number)}
            {r.source === 'itsm' && !r.is_open ? <Text style={styles.closed}>  закрыта</Text> : null}
          </Text>
          {r.operation ? <Text style={styles.meta}>{r.operation}</Text> : null}
          <DueLine dueAt={r.due_at} status={r.status} isOpen={r.is_open} />
          {r.description || r.subject ? (
            <Text style={styles.subject} numberOfLines={2}>
              {r.description ?? r.subject}
            </Text>
          ) : null}
          <Text style={styles.meta}>
            {[
              r.registered_at ? formatRegistered(r.registered_at) : r.source === 'manual' ? 'введена вручную' : null,
              r.to_contractor ? 'подрядчик' : r.assignee_name ? `назначена: ${r.assignee_name}` : null,
              `работ: ${r.entries}`,
              r.last_work_date ? `последняя ${formatDate(r.last_work_date)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </Card>
        </TourTarget>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  over: { borderWidth: stroke.outline, borderColor: colors.danger },
  overText: { color: colors.danger, fontWeight: '800' },
  state: { fontSize: font.small, fontWeight: '800', color: colors.success },
  open: { color: colors.noteText },
  card: { gap: space.s4 },
  number: { fontSize: font.body, fontWeight: '800' },
  subject: { fontSize: font.body },
  meta: { fontSize: font.small, color: colors.muted },
  filters: { gap: space.s8, paddingVertical: space.s2 },
  stale: { borderWidth: stroke.outline, borderColor: colors.noteText },
  staleText: { color: colors.noteText, fontWeight: '800' },
  limit: { gap: space.s6 },
  limitText: { fontSize: font.small, fontWeight: '700', color: colors.secondary },
  limitRow: { flexDirection: 'row', alignItems: 'center', gap: space.s12 },
  limitBtn: { width: touch.min, height: touch.small, borderRadius: radius.small, borderWidth: stroke.outline, borderColor: colors.black, alignItems: 'center', justifyContent: 'center' },
  limitBtnText: { fontSize: font.number, fontWeight: '800' },
  limitValue: { flex: 1, textAlign: 'center', fontSize: font.body, fontWeight: '800' },
  closed: { fontSize: font.small, color: colors.danger, fontWeight: '700' },
  now: { gap: space.s6 },
  nowTitle: { fontSize: font.body, fontWeight: '800' },
  nowRow: { paddingVertical: space.s6, borderTopWidth: stroke.hair, borderTopColor: colors.bg, gap: space.s2 },
  nowName: { fontSize: font.body, fontWeight: '700' },
  nowReq: { fontSize: font.small, fontWeight: '700' },
  nowWarn: { fontSize: font.small, fontWeight: '700', color: colors.noteText },
});
