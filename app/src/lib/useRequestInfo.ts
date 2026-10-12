import { useEffect, useState } from 'react';
import type { Draft } from './draft';
import { requestsTime, type RequestTime } from './shift';

/** План и время прошлых смен по заявкам черновика. Без связи — пусто, экран работает и так. */
export function useRequestInfo(draft: Draft | null): Record<string, RequestTime> {
  const [info, setInfo] = useState<Record<string, RequestTime>>({});
  const numbers = Array.from(
    new Set([...(draft?.requests ?? []).map((r) => r.number), ...(draft?.entries ?? []).map((e) => e.requestNumber)].filter((n): n is string => !!n)),
  ).sort();
  const key = numbers.join(',');
  const exclude = draft?.editing ? draft.clientUuid : null;
  useEffect(() => {
    let alive = true;
    requestsTime(key ? key.split(',') : [], exclude)
      .then((rows) => alive && setInfo(Object.fromEntries(rows.map((r) => [r.number, r]))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, exclude]);
  return info;
}
