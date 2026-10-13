import { router } from 'expo-router';

// Работу добавляют из карточки заявки — после «Добавить в смену» вернуться в карточку, а не в список смены.
let cardReturn: number | null = null;
export const returnToCardAfterEntry = (requestId: number | null) => {
  cardReturn = requestId;
};

/** Перейти к списку работ смены так, чтобы «Назад» с него вёл на главную. */
export function goToShiftList() {
  if (router.canDismiss()) router.dismissAll();
  if (cardReturn != null) {
    const id = cardReturn;
    cardReturn = null;
    router.push({ pathname: '/req/[id]', params: { id: String(id) } });
    return;
  }
  router.push('/shift/list');
}

/** Открыть список смены с главной («Продолжить смену»). */
export function openShiftList() {
  cardReturn = null;
  goToShiftList();
}
