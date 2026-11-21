import { useCallback, useEffect, useRef, useState } from 'react';
import { draftHasContent, sendDraft } from './sendShift';
import { useDraft } from './draft';
import { humanError } from './errors';

/**
 * Неотправленная смена, оставшаяся на телефоне от старого пути «Закрыть смену» (до 23.10.2026):
 * отправляется сама один раз при открытии; не вышло — на главной видно ошибку, «Повторить» и «Удалить».
 */
export function useLegacyDraft() {
  const { ready, draft, upsertEntry, clear, moveUnsent } = useDraft();
  const [state, setState] = useState<{ sending: boolean; error: string | null }>({ sending: false, error: null });
  const tried = useRef<string | null>(null);

  const send = useCallback(async () => {
    if (!draft || !draftHasContent(draft)) return;
    setState({ sending: true, error: null });
    try {
      await sendDraft(draft, upsertEntry, () => {});
      clear();
      setState({ sending: false, error: null });
    } catch (e) {
      const text = humanError(e);
      // смену уже нельзя менять (отправлена в другой день) — новое переносится в смену за сегодня, пробуем ещё раз
      if (/только в день отправки|уже обработал работы этой смены/.test(text) && (await moveUnsent())) {
        tried.current = null;
        setState({ sending: false, error: null });
        return;
      }
      setState({ sending: false, error: text });
    }
  }, [draft, upsertEntry, clear, moveUnsent]);

  useEffect(() => {
    if (!ready || !draft) return;
    if (!draftHasContent(draft)) {
      clear(); // пустой черновик (только время или ничего) больше не нужен
      return;
    }
    if (tried.current === draft.clientUuid) return;
    tried.current = draft.clientUuid;
    send();
  }, [ready, draft, send, clear]);

  return { draft: draft && draftHasContent(draft) ? draft : null, ...state, retry: send, remove: clear };
}
