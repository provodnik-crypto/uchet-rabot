import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AppHeader } from '../../../components/AppHeader';
import { BigButton } from '../../../components/BigButton';
import { Chip } from '../../../components/Chip';
import { DateField, todayText } from '../../../components/DateField';
import { Field } from '../../../components/Field';
import { PhotoPicker } from '../../../components/PhotoPicker';
import { Screen } from '../../../components/Screen';
import { Segmented } from '../../../components/Segmented';
import { SelectField } from '../../../components/SelectField';
import { StatusPill } from '../../../components/StatusPill';
import { Text } from '../../../components/Text';
import { humanError } from '../../../lib/errors';
import { addDepartmentByName, createInitiatorRequest, WORK_CATEGORIES } from '../../../lib/initiators';
import { cleanDepartmentName, listDepartments, type Department } from '../../../lib/departments';
import { parseDate } from '../../../lib/dates';
import { useFocusQuery } from '../../../lib/useQuery';
import { uploadPhotos, forgetLocalPhotos, toPayload, type DraftPhoto } from '../../../lib/workPhotos';
import { colors, font, space } from '../../../theme';

type DueMode = 'plan' | 'date' | 'urgent';

/** Экран «Новая заявка»: тот же состав сведений, что в бумажном шаблоне, но коротко и с фото. */
export default function NewInitiatorRequestScreen() {
  const deptQ = useFocusQuery(listDepartments, { key: 'init:departments' });
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [deptId, setDeptId] = useState<number | null>(null);
  const [place, setPlace] = useState('');
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [dueMode, setDueMode] = useState<DueMode>('plan');
  const [dueText, setDueText] = useState(todayText());
  const [urgentReason, setUrgentReason] = useState('');
  const [materials, setMaterials] = useState('');
  const [newDept, setNewDept] = useState('');
  const [addingDept, setAddingDept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  const departments = deptQ.data ?? [];
  const deptOptions = useMemo(
    () => departments.filter((d) => d.is_active).map((d) => ({ value: d.id, label: d.name })),
    [departments],
  );
  const deptName = departments.find((d) => d.id === deptId)?.name;

  async function addDepartment() {
    const name = cleanDepartmentName(newDept);
    if (!name) return setError('Напишите название отдела');
    setError(null);
    setAddingDept(true);
    try {
      const id = await addDepartmentByName(name);
      await deptQ.reload();
      setDeptId(id);
      setNewDept('');
      setAddingDept(false);
    } catch (e) {
      setError(humanError(e));
      setAddingDept(false);
    }
  }

  async function submit() {
    if (!category) return setError('Выберите, что нужно сделать');
    if (description.trim().length < 3) return setError('Опишите задачу');
    if (description.trim().length > 200) return setError('Описание: до 200 знаков');
    if (!deptId) return setError('Выберите отдел');
    if (!place.trim()) return setError('Укажите, где именно: аллея, подиум, бокс');
    if (photos.filter((p) => p.path || p.localUri).length < 1) return setError('Добавьте фото — без него заявку не принять');
    if (dueMode === 'urgent' && !urgentReason.trim()) return setError('Укажите, почему это срочно');
    if (dueMode === 'date' && !parseDate(dueText)) return setError('Дата: ДД.ММ.ГГГГ');
    setError(null);
    setBusy(true);
    try {
      if (photos.some((p) => !p.path)) setProgress('Загружаю фото…');
      await uploadPhotos(photos, (p) => setPhotos((prev) => prev.map((x) => (x.key === p.key ? p : x))), (done, total) =>
        setProgress(`Загружаю фото… ${done} из ${total}`),
      );
      setProgress('Отправляю заявку…');
      const due = dueMode === 'date' ? parseDate(dueText) : null;
      const res = await createInitiatorRequest({
        category,
        description: description.trim(),
        departmentId: deptId,
        place: place.trim(),
        due,
        urgent: dueMode === 'urgent',
        urgentReason: dueMode === 'urgent' ? urgentReason.trim() : null,
        materials: materials.trim() || null,
        photos: toPayload(photos),
      });
      forgetLocalPhotos(photos);
      setBusy(false);
      setProgress('');
      Alert.alert('Готово', `Заявка № ${res.number} отправлена руководителю.`, [
        { text: 'Отлично', onPress: () => router.replace('/') },
      ]);
    } catch (e) {
      setError(humanError(e));
      setBusy(false);
      setProgress('');
    }
  }

  return (
    <Screen
      header={<AppHeader title="Новая заявка" back />}
      footer={<BigButton title={progress || 'Отправить'} onPress={submit} loading={busy} disabled={busy} />}
    >
      <Text style={styles.hint}>Поля со звёздочкой — обязательные. Фото помогает мастеру понять задачу.</Text>

      <Text style={styles.label}>Что сделать *</Text>
      <View style={styles.chips}>
        {WORK_CATEGORIES.map((c) => (
          <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(c)} />
        ))}
      </View>

      <Field
        label="Опишите задачу *"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={200}
        placeholder="Например: собрать шкаф распашной, зеркало 240×238, 6 дверей, ЛДСП дуб комано, ЛМ 89433656"
        hint="Артикул, количество и цвет пишите прямо сюда — до 200 знаков"
      />

      <SelectField
        label="Отдел *"
        value={deptId}
        options={deptOptions}
        onChange={setDeptId}
        placeholder="Выберите отдел"
        error={deptQ.error ? 'Не удалось загрузить отделы' : null}
      />
      {addingDept || deptOptions.length === 0 ? (
        <View style={styles.newDept}>
          <Field label="Новый отдел" value={newDept} onChangeText={setNewDept} placeholder="Например, Аллея 3 — освещение" />
          <BigButton title="Добавить отдел" size="small" variant="secondary" onPress={addDepartment} loading={addingDept} />
        </View>
      ) : (
        <Text style={styles.link} onPress={() => setAddingDept(true)}>
          Нет отдела в списке? Добавить
        </Text>
      )}

      <Field
        label="Где именно *"
        value={place}
        onChangeText={setPlace}
        maxLength={200}
        placeholder="Центральный подиум, третий бокс справа"
      />

      <View>
        <Text style={styles.label}>Фото *</Text>
        <PhotoPicker photos={photos} onChange={setPhotos} required />
      </View>

      <View style={styles.due}>
        <Text style={styles.label}>Срок</Text>
        <Segmented<DueMode>
          options={[
            { value: 'plan', label: 'Планово' },
            { value: 'date', label: 'К дате' },
            { value: 'urgent', label: 'Срочно' },
          ]}
          value={dueMode}
          onChange={setDueMode}
        />
        {dueMode === 'date' ? <DateField label="Желаемая дата" value={dueText} onChange={setDueText} quick={false} hint="" /> : null}
        {dueMode === 'urgent' ? (
          <View style={styles.urgent}>
            <StatusPill tone="urgent" label="Если горит — звоните 031 833" />
            <Field
              label="Почему срочно *"
              value={urgentReason}
              onChangeText={setUrgentReason}
              maxLength={200}
              placeholder="Безопасность / монетизация / другое"
            />
          </View>
        ) : null}
      </View>

      <Field
        label="Материалы"
        value={materials}
        onChangeText={setMaterials}
        maxLength={300}
        placeholder="Что нужно и где лежит: RAL 9003, аллея 65 (в конце)"
      />

      {deptName ? <Text style={styles.deptLine}>Отдел: {deptName}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: font.small, color: colors.muted },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s8 },
  newDept: { gap: space.s8 },
  link: { fontSize: font.small, color: colors.secondary, fontWeight: '600' },
  due: { gap: space.s8 },
  urgent: { gap: space.s8 },
  deptLine: { fontSize: font.small, color: colors.muted, textAlign: 'center' },
  error: { color: colors.danger, fontSize: font.body },
});
