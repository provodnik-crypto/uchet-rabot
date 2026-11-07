/** Деньги в базе — целые копейки. Здесь только перевод в текст и обратно. */
export function formatKop(kop: number | null | undefined): string {
  if (kop == null) return '—';
  const rub = Math.trunc(kop / 100);
  const k = Math.abs(kop % 100);
  const whole = rub.toLocaleString('ru-RU').replace(/ |,/g, ' ');
  return k ? `${whole},${String(k).padStart(2, '0')} ₽` : `${whole} ₽`;
}

/** «1 234,5» → 123450. null — если введено не число или больше двух знаков после запятой. */
export function parseRubToKop(raw: string): number | null {
  const s = raw.replace(/\s|₽/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [rub, frac = ''] = s.split('.');
  const kop = Number(rub) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(kop) ? kop : null;
}
