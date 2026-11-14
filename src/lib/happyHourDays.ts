// src/lib/happyHourDays.ts — zilele săptămânii din fila Promoții (Happy Hour),
// în limba personalului (lotul L5b). Modul PUR (doar `import type`): testul
// lui rulează fără supabase.
//
// `happy_hour_rules.days_of_week` ține 1..7 cu 1 = DUMINICĂ (mig 077); afișarea
// citește indexul `d - 1`, exact ca `DAY_LABELS` din lib/happyHour.ts (care
// rămâne oracolul românesc). Etichetele vin din cheile `day_1`…`day_7` ale
// namespace-ului `promotions` — NU din `Intl.DateTimeFormat`: ICU-ul diferă
// între Node, jsdom și browser (abrevieri, puncte, majuscule), deci testele ar
// deveni fragile, iar în română textul de dinainte („Du”, „Sâ”) nu e cel ICU.
// Ordinea afișării nu se schimbă (duminica prima).
import type { StringKey, Translator } from '../i18n/core'
import type promotionsRo from '../i18n/ns/promotions/ro'

type PromotionsTranslator = Pick<Translator<typeof promotionsRo>, 't'>

/** Cheia zilei pentru indexul `d - 1` (0 = duminică … 6 = sâmbătă). */
export const DAY_KEYS = [
  'day_1',
  'day_2',
  'day_3',
  'day_4',
  'day_5',
  'day_6',
  'day_7',
] as const satisfies readonly StringKey<typeof promotionsRo>[]

/** Cele șapte etichete, în ordinea afișării (index 0 = duminică). */
export function dayLabels(tr: PromotionsTranslator): string[] {
  return DAY_KEYS.map((k) => tr.t(k))
}

/** Eticheta unei valori din `days_of_week` (1 = duminică). O valoare din
 *  afara 1..7 dă „?”, ca înainte. */
export function dayLabel(dow: number, tr: PromotionsTranslator): string {
  const k = DAY_KEYS[dow - 1]
  return k ? tr.t(k) : '?'
}
