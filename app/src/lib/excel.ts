import { Platform } from 'react-native';
import type { Period } from './manager';
import { supabase } from './supabase';

type ExcelResponse = { file_name: string; base64: string; total_kop: number; pending: number };

/** Формирует отчёт на сервере (функция excel-report) и открывает меню «Поделиться». */
export async function exportExcel(period: Period): Promise<{ fileName: string; totalKop: number; pending: number }> {
  const { data, error } = await supabase.functions.invoke('excel-report', { body: { from: period.from, to: period.to } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const payload = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    throw new Error(payload?.error ?? error.message);
  }
  const res = data as ExcelResponse;
  const fileName = res.file_name.replace(/[\\/:*?"<>|]/g, '_');
  if (Platform.OS === 'web') downloadOnWeb(fileName, res.base64);
  else await shareOnPhone(fileName, res.base64);
  return { fileName, totalKop: res.total_kop, pending: res.pending };
}

async function shareOnPhone(fileName: string, base64: string) {
  // Модули подключаются здесь, а не в начале файла: в старой версии приложения их нет,
  // и вместо падения экрана покажем понятное сообщение.
  let fs: typeof import('expo-file-system');
  let sharing: typeof import('expo-sharing');
  try {
    fs = require('expo-file-system');
    sharing = require('expo-sharing');
  } catch {
    throw new Error('Для выгрузки нужна новая версия приложения. Установите её по ссылке от администратора.');
  }
  const file = new fs.File(fs.Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: 'base64' });
  if (!(await sharing.isAvailableAsync())) throw new Error('На этом телефоне нет меню «Поделиться»');
  await sharing.shareAsync(file.uri, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    UTI: 'org.openxmlformats.spreadsheetml.sheet',
    dialogTitle: fileName,
  });
}

function downloadOnWeb(fileName: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
