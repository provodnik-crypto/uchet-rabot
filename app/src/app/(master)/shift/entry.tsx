import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../../components/Avatar';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { PhotoPicker } from '../../../components/PhotoPicker';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { useAuth } from '../../../lib/auth';
import { useDraft, type DraftEntry } from '../../../lib/draft';
import { humanError } from '../../../lib/errors';
import { usePhotoUrls } from '../../../lib/photos';
import { listUnits, type Unit } from '../../../lib/price';
import {
  listActiveDepartments,
  listMasters,
  parseQuantity,
  suggestCustomNames,
  type DepartmentOption,
  type Person,
  type Suggestion,
} from '../../../lib/shift';
import { goToShiftList } from '../../../lib/shiftNav';
import { uuid } from '../../../lib/today';
import type { DraftPhoto } from '../../../lib/workPhotos';
import { colors, font } from '../../../theme';

type Params = {
  key?: string;
  custom?: string;
  itemId?: string;
  name?: string;
  category?: string;
  unitId?: string;
  unitCode?: string;
  integerOnly?: string;
};

type PriceChoice = { id: number; name: string; category: string; unitId: number; unitCode: string; integerOnly: boolean };

export default function EntryScreen() {
  const params = useLocalSearchParams<Params>();
  const { me } = useAuth();
  const { draft, upsertEntry } = useDraft();
  const photos = usePhotoUrls();
  const editing = params.key ? draft?.entries.find((e) => e.key === params.key) : undefined;
  const last = draft?.entries[draft.entries.length - 1];

  const [refs, setRefs] = useState<{ masters: Person[]; departments: DepartmentOption[]; units: Unit[] } | null>(null);
  const [refsError, setRefsError] = useState<string | null>(null);
  const loadRefs = () => {
    setRefsError(null);
    Promise.all([listMasters(), listActiveDepartments(), listUnits()])
      .then(([masters, departments, units]) => setRefs({ masters, departments, units }))
      .catch((e) => setRefsError(humanError(e)));
  };
  useEffect(loadRefs, []);

  // Работа из прайса или своя (вне прайса).
  const [priceChoice, setPriceChoice] = useState<PriceChoice | null>(() => {
    if (editing) {
      return editing.priceItemId
        ? { id: editing.priceItemId, name: editing.name, category: editing.category ?? '', unitId: editing.unitId, unitCode: editing.unitCode, integerOnly: editing.integerOnly }
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
  const [customName, setCustomName] = useState(editing?.customName ?? (params.custom ? (params.name ?? '') : ''));
  const [unitId, setUnitId] = useState<number | null>(editing && !editing.priceItemId ? editing.unitId : null);
  const [quantity, setQuantity] = useState(editing?.quantity ?? '');
  const [departmentId, setDepartmentId] = useState<number | null>(editing?.departmentId ?? last?.departmentId ?? null);
  const [performerIds, setPerformerIds] = useState<number[]>(editing?.performerIds ?? last?.performerIds ?? (me ? [me.id] : []));
  const [note, setNote] = useState(editing?.note ?? '');
  const [workPhotos, setWorkPhotos] = useState<DraftPhoto[]>(editing?.photos ?? []);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const isCustom = !priceChoice;
  const units = refs?.units ?? [];
  const unit = isCustom ? units.find((u) => u.id === unitId) : undefined;
  const unitCode = priceChoice?.unitCode ?? unit?.code ?? '';
  const integerOnly = priceChoice?.integerOnly ?? unit?.integer_only ?? false;

  // Отдел по умолчанию — из справочника, если в смене ещё ничего не выбирали.
  useEffect(() => {
    if (refs && departmentId == null) setDepartmentId(refs.departments.find((d) => d.is_default)?.id ?? refs.departments[0]?.id ?? null);
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

  if (!draft) {
    return (
      <Screen>
        <Text style={styles.err}>Смена не начата.</Text>
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

  function togglePerformer(id: number) {
    setPerformerIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function save() {
    const qty = parseQuantity(quantity, integerOnly);
    const e: Record<string, string | null> = {
      name: isCustom && customName.trim().length < 3 ? 'Введите название работы (не короче 3 букв)' : null,
      unit: isCustom && !unit ? 'Выберите единицу' : null,
      quantity: unitCode ? qty.error : null,
      department: departmentId ? null : 'Выберите отдел',
      performers: performerIds.length ? null : 'Выберите хотя бы одного исполнителя',
    };
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    const dep = refs!.departments.find((d) => d.id === departmentId)!;
    const names = performerIds.map((id) => masters.find((m) => m.id === id)?.display_name ?? '?');
    const entry: DraftEntry = {
      key: editing?.key ?? uuid(),
      requestNumber: editing ? editing.requestNumber : (draft!.currentRequest ?? null),
      departmentId: dep.id,
      departmentName: dep.name,
      priceItemId: priceChoice?.id ?? null,
      customName: isCustom ? customName.trim().replace(/\s+/g, ' ') : null,
      name: priceChoice?.name ?? customName.trim().replace(/\s+/g, ' '),
      category: priceChoice?.category || null,
      unitId: priceChoice?.unitId ?? unit!.id,
      unitCode,
      integerOnly,
      quantity: quantity.trim(),
      note: note.trim(),
      performerIds,
      performerNames: names,
      photos: workPhotos,
    };
    upsertEntry(entry);
    goToShiftList();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: isCustom ? 'Работа вне прайса' : 'Работа' }} />

      {isCustom ? (
        <Card style={styles.card}>
          <Field
            label="Название работы"
            value={customName}
            onChangeText={setCustomName}
            placeholder="Например, распил МДФ"
            error={errors.name}
            autoFocus={!editing}
            multiline
          />
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
          <Text style={styles.label}>Единица измерения</Text>
          <View style={styles.chips}>
            {units.map((u) => (
              <Chip key={u.id} label={u.code} selected={u.id === unitId} onPress={() => setUnitId(u.id)} />
            ))}
          </View>
          {errors.unit ? <Text style={styles.err}>{errors.unit}</Text> : null}
          <Text style={styles.meta}>Цену назначит руководитель. До этого работа будет со статусом «На оценке».</Text>
        </Card>
      ) : (
        <Card style={styles.card}>
          <Text style={styles.cat}>{priceChoice.category}</Text>
          <Text style={styles.workName}>{priceChoice.name}</Text>
        </Card>
      )}

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

      <Card style={styles.card}>
        <Text style={styles.label}>Отдел</Text>
        <View style={styles.chips}>
          {refs.departments.map((d) => (
            <Chip key={d.id} label={d.name} selected={d.id === departmentId} onPress={() => setDepartmentId(d.id)} />
          ))}
        </View>
        {errors.department ? <Text style={styles.err}>{errors.department}</Text> : null}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.label}>Исполнители (сумма делится поровну)</Text>
        <View style={styles.chips}>
          {masters.map((m) => (
            <Chip
              key={m.id}
              label={m.id === me?.id ? `${m.display_name} (я)` : m.display_name}
              selected={performerIds.includes(m.id)}
              onPress={() => togglePerformer(m.id)}
              left={<Avatar name={m.display_name} photo={photos[m.id]} size={36} />}
            />
          ))}
        </View>
        {errors.performers ? <Text style={styles.err}>{errors.performers}</Text> : null}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.label}>Фото работы</Text>
        <PhotoPicker photos={workPhotos} onChange={setWorkPhotos} hint={isCustom} />
      </Card>

      <Card style={styles.card}>
        <Field label="Примечание (необязательно)" value={note} onChangeText={setNote} multiline maxLength={500} />
      </Card>

      <BigButton title={editing ? 'Сохранить' : 'Добавить в смену'} size="big" onPress={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  cat: { fontSize: font.small, color: colors.muted },
  workName: { fontSize: font.title, fontWeight: '800' },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  meta: { fontSize: font.small, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  err: { color: colors.danger, fontSize: font.small },
  sug: { gap: 8 },
  sugTitle: { fontSize: font.small, fontWeight: '700' },
  sugItem: { backgroundColor: colors.bg, padding: 12, gap: 2 },
  sugName: { fontSize: font.body, fontWeight: '600' },
  sugMeta: { fontSize: font.small, color: colors.muted },
});
