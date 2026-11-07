// Уборка фото работ: удаляет из хранилища файлы удалённых или заменённых фото
// и загрузки, так и не прикреплённые к работе за сутки. Вызывается по расписанию (pg_cron),
// пароль расписания — в заголовке x-cron-secret.
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let removed = 0;
  for (let round = 0; round < 10; round++) {
    const { data, error } = await admin.rpc('photo_cleanup_batch', { p_limit: 200 });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const paths = [...new Set((data as { path: string }[]).map((r) => r.path))];
    if (!paths.length) break;
    const { error: rmError } = await admin.storage.from('work-photos').remove(paths);
    if (rmError) return Response.json({ error: rmError.message, removed }, { status: 500 });
    const { error: doneError } = await admin.rpc('photo_cleanup_done', { p_paths: paths });
    if (doneError) return Response.json({ error: doneError.message, removed }, { status: 500 });
    removed += paths.length;
  }
  return Response.json({ removed });
});
