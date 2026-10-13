import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { getDepartment, isWholeStore, setDefaultDepartment, updateDepartment } from '../../../lib/departments';
import { humanError } from '../../../lib/errors';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font } from '../../../theme';

export default function DepartmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const depId = Number(id);
  const { data: dep, error, loading, reload } = useFocusQuery(() => getDepartment(depId));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (dep) setName(dep.name);
  }, [dep]);

  async function run(key: string, fn: () => Promise<unknown>, okText: string) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      setMessage({ text: okText, ok: true });
      await reload();
    } catch (e) {
      setMessage({ text: humanError(e), ok: false });
    } finally {
      setBusy(null);
    }
  }

  if (!dep) {
    return (
      <Screen>
        <StateView loading={loading} error={error} onRetry={reload} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: dep.name }} />
      {isWholeStore(dep) ? (
        <Card style={styles.card}>
          <Text style={styles.meta}>
            «Магазин» — это весь магазин. В «Работах» им смотрят все работы по всем отделам; мастер его не выбирает.
            Старые записи с этим отделом сохранены.
          </Text>
        </Card>
      ) : (
        <>
          <Card style={styles.card}>
            <Text style={styles.meta}>
              {dep.is_active ? 'Активен' : 'Выключен'}
              {dep.is_default ? ' · подставляется мастеру по умолчанию' : ''}
            </Text>
            <Field label="Название" value={name} onChangeText={setName} />
            <BigButton
              title="Сохранить название"
              variant="secondary"
              disabled={!name.trim() || name.trim() === dep.name}
              loading={busy === 'name'}
              onPress={() => run('name', () => updateDepartment(dep.id, { name }), 'Название сохранено')}
            />
          </Card>

          {dep.is_active && !dep.is_default ? (
            <BigButton
              title="Сделать отделом по умолчанию"
              loading={busy === 'default'}
              onPress={() => run('default', () => setDefaultDepartment(dep.id), 'Теперь этот отдел подставляется по умолчанию')}
            />
          ) : null}

          {message ? <Text style={[styles.msg, { color: message.ok ? colors.success : colors.danger }]}>{message.text}</Text> : null}

          {dep.is_default ? (
            <Text style={styles.meta}>Отдел по умолчанию нельзя выключить: сначала назначьте другой.</Text>
          ) : (
            <BigButton
              title={dep.is_active ? 'Выключить отдел' : 'Включить отдел'}
              variant={dep.is_active ? 'danger' : 'primary'}
              loading={busy === 'active'}
              onPress={() =>
                run(
                  'active',
                  () => updateDepartment(dep.id, { is_active: !dep.is_active }),
                  dep.is_active ? 'Отдел выключен: в новых работах его не выбрать, старые записи сохранены' : 'Отдел включён',
                )
              }
            />
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  meta: { color: colors.muted, fontSize: font.small },
  msg: { fontSize: font.body },
});
