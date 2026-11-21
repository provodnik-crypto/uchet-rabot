import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatDate } from '../lib/dates';
import { humanError } from '../lib/errors';
import { setWorkHelpers, splitMyWork, workHelperIds, type RequestWork } from '../lib/requests';
import { formatQuantity, listMasters, parseQuantity } from '../lib/shift';
import { useFocusQuery } from '../lib/useQuery';
import { colors, font, space, stroke } from '../theme';
import { BigButton } from './BigButton';
import { Chip } from './Chip';
import { Field } from './Field';
import { Text } from './Text';

type Mode = 'master' | 'manager';

/**
 * Работы заявки по позициям с помощниками. Помощники — мастера магазина, кроме основного исполнителя;
 * по умолчанию их нет — вся позиция основному. С помощниками стоимость позиции делится поровну (считает сервер).
 * Мастер (у своей заявки «В работе») меняет помощников и делит строку («10 м² с помощником + 5 м² сам»);
 * руководитель — меняет помощников, пока заявка не принята. Сумм здесь нет.
 */
export function WorkHelpers({
  works,
  mainId,
  mode,
  editable,
  onChanged,
}: {
  works: RequestWork[];
  /** Основной исполнитель заявки — если у работы нет main_id (старая база). */
  mainId: number | null;
  mode: Mode;
  /** Руководитель: можно менять (заявка не принята). Мастер: по can_edit каждой работы. */
  editable: boolean;
  onChanged: () => void;
}) {
  const { data: masters } = useFocusQuery(listMasters);
  const names = new Map((masters ?? []).map((m) => [m.id, m.display_name]));
  if (!works.length) return null;
  return (
    <View>
      {works.map((w, i) => (
        <WorkRow
          key={w.id ?? i}
          w={w}
          first={i === 0}
          mainId={w.main_id ?? mainId}
          masters={masters ?? []}
          names={names}
          canEdit={!!w.id && (mode === 'manager' ? editable && w.status !== 'rejected' : !!w.can_edit)}
          canSplit={mode === 'master' && !!w.id && !!w.can_edit}
          onChanged={onChanged}
        />
      ))}
    </View>
  );
}

function WorkRow({
  w,
  first,
  mainId,
  masters,
  names,
  canEdit,
  canSplit,
  onChanged,
}: {
  w: RequestWork;
  first: boolean;
  mainId: number | null;
  masters: { id: number; display_name: string }[];
  names: Map<number, string>;
  canEdit: boolean;
  canSplit: boolean;
  onChanged: () => void;
}) {
  const helpers = workHelperIds(w, mainId);
  const [panel, setPanel] = useState<null | 'helpers' | 'split'>(null);
  const [picked, setPicked] = useState<number[]>(helpers);
  const [part, setPart] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const helperText = helpers.length ? helpers.map((id) => names.get(id) ?? '…').join(', ') : 'нет — вся позиция основному';
  const mainName = mainId != null ? names.get(mainId) : null;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      setPanel(null);
      onChanged();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  const q = parseQuantity(part, !!w.integer_only);
  const partError = part && !q.error && q.value! >= Number(w.quantity) ? `Меньше ${formatQuantity(w.quantity)}` : part ? q.error : null;
  const rest = q.value != null && !partError ? Number(w.quantity) - q.value : null;

  return (
    <View style={[styles.row, !first && styles.line]}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={styles.body}>{w.name}</Text>
          <Text style={styles.meta}>
            {formatDate(w.work_date)}
            {mainName ? ` · основной: ${mainName}` : ''}
          </Text>
        </View>
        <Text style={styles.qty}>
          {formatQuantity(w.quantity)} {w.unit}
        </Text>
      </View>
      <Text style={styles.helpers}>
        Помощники: <Text style={helpers.length ? styles.bold : styles.meta}>{helperText}</Text>
      </Text>

      {panel === 'helpers' ? (
        <View style={styles.panel}>
          <View style={styles.chips}>
            {masters
              .filter((m) => m.id !== mainId)
              .map((m) => (
                <Chip
                  key={m.id}
                  label={m.display_name}
                  selected={picked.includes(m.id)}
                  onPress={() => setPicked((x) => (x.includes(m.id) ? x.filter((y) => y !== m.id) : [...x, m.id]))}
                />
              ))}
          </View>
          <Text style={styles.meta}>
            {picked.length ? `Позиция делится поровну на ${picked.length + 1}.` : 'Без помощников вся позиция — основному исполнителю.'}
            {canSplit ? ' Помогали только на часть объёма — сначала «Разделить».' : ''}
          </Text>
          <View style={styles.buttons}>
            <View style={styles.flex}>
              <BigButton title="Сохранить" loading={busy} disabled={busy} onPress={() => run(() => setWorkHelpers(w.id!, picked))} />
            </View>
            <View style={styles.flex}>
              <BigButton title="Отмена" variant="secondary" disabled={busy} onPress={() => (setPanel(null), setErr(null))} />
            </View>
          </View>
        </View>
      ) : panel === 'split' ? (
        <View style={styles.panel}>
          <Field
            label={`Сколько отделить в новую строку, ${w.unit}`}
            value={part}
            onChangeText={setPart}
            keyboardType="decimal-pad"
            autoFocus
            error={partError}
            hint={rest != null ? `Здесь останется ${formatQuantity(rest)} ${w.unit} с прежними помощниками, новая строка — без помощников.` : 'Например: всего 15, помогали на 10 — отделите 5.'}
          />
          <View style={styles.buttons}>
            <View style={styles.flex}>
              <BigButton
                title="Разделить"
                loading={busy}
                disabled={busy || q.value == null || !!partError}
                onPress={() => run(() => splitMyWork(w.id!, q.value!))}
              />
            </View>
            <View style={styles.flex}>
              <BigButton title="Отмена" variant="secondary" disabled={busy} onPress={() => (setPanel(null), setErr(null))} />
            </View>
          </View>
        </View>
      ) : canEdit ? (
        <View style={styles.buttons}>
          <View style={styles.flex}>
            <BigButton
              title="Помощники"
              variant="secondary"
              size="small"
              onPress={() => {
                setPicked(helpers);
                setPanel('helpers');
              }}
            />
          </View>
          {canSplit && Number(w.quantity) > (w.integer_only ? 1 : 0.001) ? (
            <View style={styles.flex}>
              <BigButton
                title="Разделить"
                variant="secondary"
                size="small"
                onPress={() => {
                  setPart('');
                  setPanel('split');
                }}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {err ? <Text style={styles.err}>{err}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.s6, paddingVertical: space.s10 },
  line: { borderTopWidth: stroke.hair, borderTopColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s12 },
  flex: { flex: 1, gap: space.s2 },
  body: { fontSize: font.body },
  qty: { fontSize: font.body, fontWeight: '700' },
  meta: { fontSize: font.caption, color: colors.secondary },
  helpers: { fontSize: font.small },
  bold: { fontWeight: '700' },
  panel: { gap: space.s8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s6 },
  buttons: { flexDirection: 'row', gap: space.s8 },
  err: { fontSize: font.small, color: colors.danger },
});
