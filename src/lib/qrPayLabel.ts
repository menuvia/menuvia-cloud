// Eticheta butonului de plată a mesei din coșul QR (QrCartSheet `payLabel`).
//
// Fără plata online activă (growth; Plan 3 fără modulul de plăți), butonul
// DOAR cheamă ospătarul cu nota (handleRequestBill) — eticheta veche
// „Plătește masa" promitea o plată din telefon care nu există. Eticheta urmează
// ACȚIUNEA reală a butonului, nu planul: așa nu poate minți nici pe Plan 3 cu
// modulul oprit, iar pe tier < 3 plata online e oricum respinsă server-side
// (begin_table_payment cere `online_payments`).
import { T } from './publicMenuStrings'

export interface QrPayLabelState {
  tablePaid: boolean
  // Modulul de plăți online activ ȘI sesiune de masă — singurul caz în care
  // butonul deschide PayTableSheet.
  onlinePay: boolean
  billRequested: boolean
  lang: string
}

export function qrPayTableLabel(s: QrPayLabelState): string {
  if (s.tablePaid) return 'Plătit online ✓'
  if (s.onlinePay) return 'Plătește online'
  if (s.billRequested) return 'Nota a fost cerută ✓'
  return T(s.lang, 'request_bill')
}
