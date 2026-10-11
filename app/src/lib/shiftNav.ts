import { router } from 'expo-router';

/** Перейти к списку работ смены так, чтобы «Назад» с него вёл на главную. */
export function goToShiftList() {
  if (router.canDismiss()) router.dismissAll();
  router.push('/shift/list');
}
