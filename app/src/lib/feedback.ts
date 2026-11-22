import { supabase } from './supabase';

/** Этап «Обратная связь»: «Написать разработчику» во всех трёх ролях.
 *  Сообщения видит только аккаунт разработчика (логин 60133303) — RPC на сервере, 20261122000004_feedback.sql. */

export type DeveloperFeedback = {
  id: number;
  author: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

export async function submitDeveloperFeedback(text: string): Promise<void> {
  const { error } = await supabase.rpc('submit_developer_feedback', { p_text: text });
  if (error) throw error;
}

export async function developerFeedbackList(): Promise<DeveloperFeedback[]> {
  const { data, error } = await supabase.rpc('developer_feedback_list');
  if (error) throw error;
  return (data ?? []) as DeveloperFeedback[];
}

export async function developerFeedbackMarkRead(): Promise<void> {
  const { error } = await supabase.rpc('developer_feedback_mark_read');
  if (error) throw error;
}
