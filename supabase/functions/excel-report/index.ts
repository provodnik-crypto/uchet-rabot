// Выгрузка Excel-отчёта за период. Вызывает только руководитель.
// Данные берутся функциями базы под токеном вызывающего: они сами проверяют роль,
// поэтому сервисный ключ здесь не нужен.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { zipSync, strToU8 } from 'npm:fflate@0.8.2';
import { buildReport, type ReportData } from './report.ts';
import { buildXlsx } from './xlsx.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Только POST' }, 405);
  try {
    const { from, to } = await req.json().catch(() => ({}));
    if (!DATE.test(from ?? '') || !DATE.test(to ?? '') || from > to) return json({ error: 'Неверный период' }, 400);

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const call = async <T>(fn: string): Promise<T> => {
      const { data, error } = await db.rpc(fn, { p_from: from, p_to: to });
      if (error) {
        if (error.code === '42501') throw Object.assign(new Error('Доступно только руководителю'), { status: 403 });
        throw new Error(error.message);
      }
      return data as T;
    };

    const [totals, employees, months, monthEmployees, rows, works, time] = await Promise.all([
      call<ReportData['totals'][]>('report_totals'),
      call<ReportData['employees']>('report_by_employee'),
      call<ReportData['months']>('report_by_month'),
      call<ReportData['monthEmployees']>('report_month_employee'),
      call<ReportData['rows']>('report_rows'),
      call<ReportData['works']>('report_by_work'),
      call<ReportData['time']>('time_stats'),
    ]);
    const sheets = buildReport({ from, to, totals: totals[0], employees, months, monthEmployees, rows, works, time });
    const files = buildXlsx(sheets);
    const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });

    return json({
      file_name: `Учёт работ ${from.split('-').reverse().join('.')}–${to.split('-').reverse().join('.')}.xlsx`,
      base64: toBase64(zip),
      total_kop: totals[0].total_kop,
      pending: totals[0].pending,
    });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Ошибка сервера' }, status);
  }
});
