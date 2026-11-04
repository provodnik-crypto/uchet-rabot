import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../../../components/Text';
import { Avatar } from '../../../components/Avatar';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { PhotoPicker } from '../../../components/PhotoPicker';
import { Screen } from '../../../components/Screen';
import { SelectField } from '../../../components/SelectField';
import { StateView } from '../../../components/StateView';
import { useAuth } from '../../../lib/auth';
import { addRequestWork, type RequestWork } from '../../../lib/requests';
import { uuid } from '../../../lib/today';
import { humanError } from '../../../lib/errors';
import { useEmployeeIcons } from '../../../lib/employeeIcons';
import { listUnits, type Unit } from '../../../lib/price';
import {
  listActiveDepartments,
  formatQuantity,
  listMasters,
  parseQuantity,
  suggestCustomNames,
  type DepartmentOption,
  type Person,
  type Suggestion,
} from '../../../lib/shift';
import { fetchEntryPhotos, remoteToDraft, toPayload, uploadAll, type DraftPhoto } from '../../../lib/workPhotos';
import { TourTarget } from '../../../lib/tour';
import { colors, font, size, space } from '../../../theme';

type Params = {
  /** Заявка, в которую вносится работа (обязательно: работы — только внутри заявки). */
  requestId?: string;
  /** Исправление своей работы: id и данные работы из карточки (JSON). */
  entryId?: string;
  work?: string;
  custom?: string;
  itemId?: string;
  name?: string;
  category?: string;
  unitId?: string;
  unitCode?: string;
  integerOnly?: string;
};

type PriceChoice = { id: number; name: string; category: string; unitId: number; unitCode: string; integerOnly: boolean };

/**
 * Отдел последней работы — подставляется в следующую (пока приложение открыто), свой у каждого мастера.
 * Помощники по умолчанию не подставляются (05.11.2026): без помощников вся позиция — основному исполнителю.
 */
const lastDepartment: Record<number, number> = {};

export default function EntryScreen() {
  const params = useLocalSearchParams<Params>();
  const { me } = useAuth();
  const icons = useEmployeeIcons();
  const requestId = Number(params.requestId);
  const editing: RequestWork | undefined = params.work ? (JSON.parse(params.work) as RequestWork) : undefined;
  const editId = params.entryId ? Number(params.entryId) : null;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [refs, setRefs] = useState<{ masters: Person[]; departments: DepartmentOption[]; units: Unit[] } | null>(null);
  const [refsError, setRefsError] = useState<string | null>(null);
  const loadRefs = () => {
    setRefsError(null);
    Promise.all([listMasters(), listActiveDepartments(), listUnits()])
      .then(([masters, departments, units]) => {
        setRefs({ masters, departments, units });
      })
      .catch((e) => setRefsError(humanError(e)));
  };
  useEffect(loadRefs, []);

  // Работа из прайса или своя (вне прайса).
  const [priceChoice, setPriceChoice] = useState<PriceChoice | null>(() => {
    if (editing) {
      return editing.price_item_id
        ? { id: editing.price_item_id, name: editing.name, category: editing.category ?? '', unitId: editing.unit_id ?? 0, unitCode: editing.unit, integerOnly: !!editing.integer_only }
        : null;
    }
    if (params.itemId) {
      return {
        id: Number(params.itemId),
        name: params.name ?? '',
        category: params.category ?? '',
        unitId: Number(params.unitId),
        unitCode: params.unitCode ?? '',
        integerOnly: params.integerOnly === '1',
      };
    }
    return null;
  });
  const [customName, setCustomName] = useState(editing?.custom ? editing.name : params.custom ? (params.name ?? '') : '');
  const [unitId, setUnitId] = useState<number | null>(editing && !editing.price_item_id ? (editing.unit_id ?? null) : null);
  const [quantity, setQuantity] = useState(editing ? formatQuantity(editing.quantity) : '');
  const [departmentId, setDepartmentId] = useState<number | null>(editing?.department_id ?? (me ? lastDepartment[me.id] : undefined) ?? null);
  // основной исполнитель — вы; помощники — остальные исполнители позиции (по умолчанию нет)
  const mainId = editing?.main_id ?? me?.id;
  const [helperIds, setHelperIds] = useState<number[]>((editing?.performer_ids ?? []).filter((id) => id !== mainId));
  // одно нажатие «Добавить работу» — один ключ: повтор после обрыва связи не создаёт дубль
  const clientKey = useRef(uuid());
  const saving = useRef(false);
  const [note, setNote] = useState(editing?.note ?? '');
  const [workPhotos, setWorkPhotos] = useState<DraftPhoto[]>([]);
  // при исправлении — уже приложенные фото работы
  useEffect(() => {
    if (!editId) return;
    fetchEntryPhotos([editId])
      .then((m) => setWorkPhotos(remoteToDraft(m[editId])))
      .catch(() => {});
  }, [editId]);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const isCustom = !priceChoice;
  const units = refs?.units ?? [];
  const unit = isCustom ? units.find((u) => u.id === unitId) : undefined;
  const unitCode = priceChoice?.unitCode ?? unit?.code ?? '';
  const integerOnly = priceChoice?.integerOnly ?? unit?.integer_only ?? false;

  // Отдел по умолчанию — из справочника, если в смене ещё ничего не выбирали
  // или выбранный раньше отдел выключили (например, «Магазин»).
  useEffect(() => {
    if (refs && (departmentId == null || !refs.departments.some((d) => d.id === departmentId))) setDepartmentId(refs.departments.find((d) => d.is_default)?.id ?? refs.departments[0]?.id ?? null);
  }, [refs, departmentId]);

  // Подсказки, пока мастер печатает название своей работы: чтобы не плодить дубли.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const sugReq = useRef(0);
  useEffect(() => {
    if (!isCustom || customName.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const my = ++sugReq.current;
    setSuggesting(true);
    const t = setTimeout(() => {
      suggestCustomNames(customName)
        .then((s) => my === sugReq.current && setSuggestions(s))
        .catch(() => my === sugReq.current && setSuggestions([]))
        .finally(() => my === sugReq.current && setSuggesting(false));
    }, 350);
    return () => clearTimeout(t);
  }, [customName, isCustom]);

  const masters = useMemo(() => {
    // Сам мастер — первым в списке исполнителей.
    const list = refs?.masters ?? [];
    return [...list.filter((m) => m.id === me?.id), ...list.filter((m) => m.id !== me?.id)];
  }, [refs, me]);

  if (!requestId) {
    return (
      <Screen>
        <Text style={styles.err}>Работу вносят из карточки заявки: «Заявки» → заявка → «+ Добавить работу».</Text>
        <BigButton title="На главную" onPress={() => router.dismissAll()} />
      </Screen>
    );
  }
  if (!refs) {
    return (
      <Screen>
        <StateView loading={!refsError} error={refsError} onRetry={loadRefs} />
      </Screen>
    );
  }

  function toggleHelper(id: number) {
    setHelperIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function save() {
    const qty = parseQuantity(quantity, integerOnly);
    const e: Record<string, string | null> = {
      name: isCustom && customName.trim().length < 3 ? 'Введите название работы (не короче 3 букв)' : null,
      unit: isCustom && !unit ? 'Выберите единицу' : null,
      quantity: unitCode ? qty.error : null,
      department: departmentId ? null : 'Выберите отдел',
      performers: mainId ? null : 'Войдите в приложение заново',
    };
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    // второе быстрое нажатие, пока первое сохраняется, — пропускаем
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setSaveError(null);
    try {
      // фото загружаются в хранилище до сохранения работы; уже загруженные не грузятся повторно
      const photos = await uploadAll(workPhotos, setProgress);
      setWorkPhotos(photos);
      await addRequestWork(
        requestId,
        {
          department_id: departmentId!,
          ...(priceChoice ? { price_item_id: priceChoice.id } : { custom_name: customName.trim().replace(/\s+/g, ' '), unit_id: unit!.id }),
          quantity: qty.value ?? Number(quantity.replace(',', '.')),
          note: note.trim() || null,
          performer_ids: [mainId!, ...helperIds.filter((id) => id !== mainId)],
          photos: toPayload(photos),
          client_key: clientKey.current,
        },
        editId,
      );
      if (me) lastDepartment[me.id] = departmentId!;
      // назад в карточку заявки (из выбора работы — через два экрана)
      if (editId) router.back();
      else router.dismissTo({ pathname: '/req/[id]', params: { id: String(requestId) } });
    } catch (x) {
      // всё введённое остаётся на экране — можно нажать ещё раз
      setSaveError(humanError(x));
    } finally {
      saving.current = false;
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: isCustom ? 'Работа вне прайса' : 'Работа' }} />

      {isCustom ? (
        <Card style={styles.card}>
          <TourTarget id="entry.customName">
          <Field
            label="Название работы"
            value={customName}
            onChangeText={setCustomName}
            placeholder="Например, распил МДФ"
            error={errors.name}
            autoFocus={!editing}
            multiline
          />
          </TourTarget>
          {suggesting ? <ActivityIndicator color={colors.black} /> : null}
          {suggestions.length ? (
            <View style={styles.sug}>
              <Text style={styles.sugTitle}>Может быть, это одна из этих работ?</Text>
              {suggestions.map((s, i) => (
                <Card
                  key={`${s.kind}${s.price_item_id ?? s.name}${i}`}
                  style={styles.sugItem}
                  onPress={() => {
                    if (s.kind === 'price' && s.price_item_id) {
                      setPriceChoice({
                        id: s.price_item_id,
                        name: s.name,
                        category: s.category ?? '',
                        unitId: s.unit_id,
                        unitCode: s.unit_code,
                        integerOnly: units.find((u) => u.id === s.unit_id)?.integer_only ?? false,
                      });
                    } else {
                      setCustomName(s.name);
                      setUnitId(s.unit_id);
                    }
                  }}
                >
                  <Text style={styles.sugName}>{s.name}</Text>
                  <Text style={styles.sugMeta}>
                    {s.kind === 'price' ? 'Из прайса' : 'Уже вносили'} · {s.unit_code}
                  </Text>
                </Card>
              ))}
            </View>
          ) : null}
          <TourTarget id="entry.unit" style={styles.card}>
            <Text style={styles.label}>Единица измерения</Text>
            <View style={styles.chips}>
              {units.map((u) => (
                <Chip key={u.id} label={u.code} selected={u.id === unitId} onPress={() => setUnitId(u.id)} />
              ))}
            </View>
          </TourTarget>
          {errors.unit ? <Text style={styles.err}>{errors.unit}</Text> : null}
          <Text style={styles.meta}>Работу вне прайса проверит руководитель. До этого она со статусом «На оценке».</Text>
        </Card>
      ) : (
        <Card style={styles.card}>
          <Text style={styles.cat}>{priceChoice.category}</Text>
          <Text style={styles.workName}>{priceChoice.name}</Text>
        </Card>
      )}

      <TourTarget id="entry.qty">
      <Card style={styles.card}>
        <Field
          label={unitCode ? `Объём, ${unitCode}` : 'Объём'}
          value={quantity}
          onChangeText={setQuantity}
          keyboardType={integerOnly ? 'number-pad' : 'decimal-pad'}
          placeholder={integerOnly ? 'например 2' : 'например 1,5'}
          error={errors.quantity}
          autoFocus={!isCustom && !editing}
          editable={!!unitCode}
          hint={unitCode ? undefined : 'Сначала выберите единицу'}
        />
      </Card>
      </TourTarget>

      <Card style={styles.card}>
        <TourTarget id="entry.dept">
        <SelectField
          label="Отдел"
          value={departmentId}
          onChange={setDepartmentId}
          options={refs.departments.map((d) => ({ value: d.id, label: d.name }))}
          error={errors.department}
        />
        </TourTarget>
        <TourTarget id="entry.perf" style={styles.card}>
        <Text style={styles.label}>Помощники (необязательно)</Text>
        <View style={styles.chips}>
          {masters
            .filter((m) => m.id !== mainId)
            .map((m) => (
              <Chip
                key={m.id}
                label={m.display_name}
                selected={helperIds.includes(m.id)}
                onPress={() => toggleHelper(m.id)}
                left={<Avatar name={m.display_name} icon={icons[m.id]} size={size.check} />}
              />
            ))}
        </View>
        <Text style={styles.meta}>
          {helperIds.length
            ? `Позиция засчитается вам и помощникам поровну (на ${helperIds.length + 1}).`
            : 'Без помощников вся позиция — ваша. Помогали только на часть — внесите эту часть отдельной строкой.'}
        </Text>
        </TourTarget>
        {errors.performers ? <Text style={styles.err}>{errors.performers}</Text> : null}
      </Card>

      <TourTarget id="entry.photo">
      <Card style={styles.card}>
        <Text style={styles.label}>Фото работы</Text>
        <PhotoPicker photos={workPhotos} onChange={setWorkPhotos} hint={isCustom} />
      </Card>
      </TourTarget>

      <Card style={styles.card}>
        <Field label="Примечание (необязательно)" value={note} onChangeText={setNote} multiline maxLength={500} />
      </Card>

      <TourTarget id="entry.add">
        {progress ? <Text style={styles.meta}>{progress}</Text> : null}
        {saveError ? <Text style={styles.err}>Не сохранено: {saveError}</Text> : null}
        <BigButton title={saveError ? 'Повторить' : editing ? 'Сохранить' : 'Добавить работу'} size="big" loading={busy} onPress={save} />
      </TourTarget>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s10 },
  cat: { fontSize: font.small, color: colors.muted },
  workName: { fontSize: font.title, fontWeight: '700' },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  meta: { fontSize: font.small, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s8 },
  err: { color: colors.danger, fontSize: font.small },
  sug: { gap: space.s8 },
  sugTitle: { fontSize: font.small, fontWeight: '700' },
  sugItem: { backgroundColor: colors.bg, padding: space.s10, gap: space.s2 },
  sugName: { fontSize: font.body, fontWeight: '600' },
  sugMeta: { fontSize: font.small, color: colors.muted },
});
