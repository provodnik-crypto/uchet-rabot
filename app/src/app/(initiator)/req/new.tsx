import { useEffect, useState } from 'react';
import { Alert, Image, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AppHeader } from '../../../components/AppHeader';
import { BigButton } from '../../../components/BigButton';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { PhotoPicker } from '../../../components/PhotoPicker';
import { Screen } from '../../../components/Screen';
import { SelectField } from '../../../components/SelectField';
import { Text } from '../../../components/Text';
import { humanError } from '../../../lib/errors';
import {
  addDepartmentByName,
  createInitiatorRequest,
  initiatorProfile,
  WORK_CATEGORIES,
  type InitiatorProfileInfo,
} from '../../../lib/initiators';
import { cleanDepartmentName, listDepartments } from '../../../lib/departments';
import { useFocusQuery } from '../../../lib/useQuery';
import { uploadPhotos, forgetLocalPhotos, toPayload, type DraftPhoto } from '../../../lib/workPhotos';
import { colors, font, radius, space, stroke } from '../../../theme';

/** Экран «Новая заявка»: тот же состав сведений, что в бумажном шаблоне, но коротко и с фото. */
export default function NewInitiatorRequestScreen() {
  const deptQ = useFocusQuery(listDepartments, { key: 'init:departments' });
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [deptId, setDeptId] = useState<number | null>(null);
  const [place, setPlace] = useState('');
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [urgent, setUrgent] = useState(false);
  const [urgentReason, setUrgentReason] = useState('');
  const [materials, setMaterials] = useState('');
  const [newDept, setNewDept] = useState('');
  const [addingDept, setAddingDept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  // профиль подставляет отдел из учётки: в форме поле «Отдел» не показываем — не дублируем
  const [profile, setProfile] = useState<InitiatorProfileInfo | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  // шаг «Проверка»: инициатор смотрит оформленную заявку и подтверждает отправку
  const [step, setStep] = useState<'form' | 'review'>('form');

  // Отдел из учётки — подставляем сразу (руководитель задал при регистрации).
  useEffect(() => {
    let on = true;
    initiatorProfile()
      .then((p) => {
        if (!on) return;
        setProfile(p);
        if (p?.department_id) setDeptId((cur) => cur ?? p.department_id ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (on) setProfileReady(true);
      });
    return () => {
      on = false;
    };
  }, []);

  const departments = deptQ.data ?? [];
  // поле «Отдел» появляется, только если в профиле отдел не выбран
  const needDeptPick = profileReady && !deptId;
  const deptOptions = departments.filter((d) => d.is_active).map((d) => ({ value: d.id, label: d.name }));
  const deptName =
    departments.find((d) => d.id === deptId)?.name ??
    (profile?.department_id === deptId ? (profile?.department_name ?? null) : null);

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

  function validate(): string | null {
    if (!category) return 'Выберите, что нужно сделать';
    if (description.trim().length < 3) return 'Опишите задачу';
    if (description.trim().length > 200) return 'Описание: до 200 знаков';
    if (!deptId) return 'Отдел не задан в профиле — выберите свой отдел перед созданием заявки';
    if (!place.trim()) return 'Укажите место проведения работ: аллея, подиум, бокс';
    if (photos.filter((p) => p.path || p.localUri).length < 1) return 'Добавьте минимум одно фото — без него заявку не принять';
    if (urgent && !urgentReason.trim()) return 'Укажите, почему это срочно';
    return null;
  }

  /** «Отправить» — проверяем поля и показываем оформленную заявку на проверку. */
  function toReview() {
    const problem = validate();
    if (problem) return setError(problem);
    setError(null);
    setStep('review');
  }

  /** «Подтверждаю» — настоящая отправка: фото в хранилище, заявка в базу. */
  async function confirm() {
    setError(null);
    setBusy(true);
    try {
      // Результат загрузки собираем в свою карту: массив `photos` в замыкании устаревает после setPhotos.
      const uploaded = new Map<string, DraftPhoto>();
      if (photos.some((p) => !p.path)) {
        setProgress('Загружаю фото…');
        try {
          await uploadPhotos(
            photos,
            (p) => {
              uploaded.set(p.key, p);
              setPhotos((prev) => prev.map((x) => (x.key === p.key ? p : x)));
            },
            (done, total) => setProgress(`Загружаю фото… ${done} из ${total}`),
          );
        } catch {
          setBusy(false);
          setProgress('');
          setError('Не удалось загрузить фото — проверьте интернет и нажмите «Подтверждаю» ещё раз');
          return;
        }
      }
      setProgress('Отправляю заявку…');
      const res = await createInitiatorRequest({
        category: category!,
        description: description.trim(),
        departmentId: deptId!,
        place: place.trim(),
        due: null,
        urgent: urgent,
        urgentReason: urgent ? urgentReason.trim() : null,
        safety: urgent,
        materials: materials.trim() || null,
        photos: toPayload(photos.map((p) => uploaded.get(p.key) ?? p)),
      });
      forgetLocalPhotos(photos);
      setBusy(false);
      setProgress('');
      Alert.alert('Готово', `Заявка № ${res.number} отправлена МВСО.`, [
        { text: 'Отлично', onPress: () => router.replace('/') },
      ]);
    } catch (e) {
      setError(humanError(e));
      setBusy(false);
      setProgress('');
    }
  }

  if (step === 'review') {
    return (
      <Screen
        header={<AppHeader title="Проверьте заявку" back={() => setStep('form')} />}
        footer={
          <View style={styles.reviewButtons}>
            <BigButton title={progress || 'Подтверждаю'} onPress={confirm} loading={busy} disabled={busy} />
            <BigButton title="Изменить" variant="secondary" onPress={() => setStep('form')} disabled={busy} />
          </View>
        }
      >
        <Text style={styles.hint}>
          Проверьте всё, что написали. «Подтверждаю» — отправить заявку, «Изменить» — вернуться и поправить.
        </Text>

        <ReviewRow label="Что сделать" value={category ?? ''} />
        <ReviewRow label="Опишите задачу" value={description} />
        <ReviewRow label="Место проведения работ" value={place} />

        <View style={styles.reviewPhotos}>
          <Text style={styles.reviewLabel}>Фото</Text>
          <View style={styles.thumbs}>
            {photos.map((p) => {
              const uri = p.thumbUri ?? p.localUri;
              return uri ? <Image key={p.key} source={{ uri }} style={styles.thumb} /> : null;
            })}
          </View>
        </View>

        {urgent ? (
          <ReviewRow label="Срочно · безопасность" value={urgentReason.trim() || 'Связана с безопасностью'} />
        ) : (
          <ReviewRow label="Срок" value="Назначит МВСО" />
        )}
        {materials.trim() ? <ReviewRow label="Материалы" value={materials} /> : null}
        {deptName ? <ReviewRow label="Отдел" value={deptName} /> : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Screen>
    );
  }

  return (
    <Screen
      header={<AppHeader title="Новая заявка" back />}
      footer={<BigButton title="Отправить" onPress={toReview} />}
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
        style={styles.tallInput}
      />

      {needDeptPick ? (
        <View style={styles.newDept}>
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
        </View>
      ) : null}

      <Field
        label="Место проведения работ *"
        value={place}
        onChangeText={setPlace}
        multiline
        maxLength={200}
        placeholder="Центральный подиум, третий бокс справа"
        style={styles.wideInput}
      />

      <View>
        <Text style={styles.label}>Фото *</Text>
        <PhotoPicker photos={photos} onChange={setPhotos} required caption="Добавьте минимум одно фото" />
      </View>

      <View style={styles.due}>
        <Chip
          label="Срочно. Заявка связана с безопасностью"
          selected={urgent}
          onPress={() => setUrgent((u) => !u)}
        />
        {urgent ? (
          <Field
            label="Почему срочно *"
            value={urgentReason}
            onChangeText={setUrgentReason}
            maxLength={200}
            placeholder="Безопасность / монетизация / другое"
          />
        ) : (
          <Text style={styles.hint}>Срок назначит МВСО</Text>
        )}
      </View>

      <Field
        label="Материалы"
        value={materials}
        onChangeText={setMaterials}
        multiline
        maxLength={300}
        placeholder="Шкаф изъят, стоит в аллее №69"
        style={styles.wideInput}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

/** Строка проверки: слева — название поля, справа — что написал инициатор. */
function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: font.small, color: colors.muted },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s8 },
  newDept: { gap: space.s8 },
  link: { fontSize: font.small, color: colors.secondary, fontWeight: '600' },
  due: { gap: space.s8 },
  error: { color: colors.danger, fontSize: font.body },
  // поля ввода выше: текст виден целиком, поле не уходит под клавиатуру (Screen + useKeepAboveKeyboard)
  tallInput: { minHeight: 128, textAlignVertical: 'top' },
  wideInput: { minHeight: 96, textAlignVertical: 'top' },
  reviewButtons: { gap: space.s8 },
  reviewRow: { gap: space.s4, paddingBottom: space.s8, borderBottomWidth: stroke.hair, borderBottomColor: colors.border },
  reviewLabel: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  reviewValue: { fontSize: font.body, color: colors.text },
  reviewPhotos: { gap: space.s4 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s8 },
  thumb: { width: 96, height: 96, borderRadius: radius.small, backgroundColor: colors.border },
});
