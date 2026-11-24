// ─────────────────────────────────────────────────────────────
// Aritmetica plății parțiale de pe ecranul ospătarului (lotul C2a).
//
// Totul în CENȚI întregi: `add_partial_payment` (mig 291) cere egalitate
// EXACTĂ pe cenți între registru și totalul comenzii, iar o sumă de lei în
// virgulă mobilă (0,1 + 0,2) ar spune „acoperă restul” când nu acoperă, sau
// invers. Validarea e de INPUT (formă, > 0); supra-încasarea e doar semnalată
// — serverul rămâne gate-ul și o respinge cu `overpayment`.
// ─────────────────────────────────────────────────────────────
import { parseDecimalInput } from './decimal'

/** Suma plăților din registru, în cenți întregi (fiecare plată rotunjită separat). */
export function sumPaymentsCents(payments: ReadonlyArray<{ amount: number }>): number {
  return payments.reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0)
}

/** Cât a mai rămas de plată, în cenți (niciodată negativ). */
export function remainingCents(total: number, payments: ReadonlyArray<{ amount: number }>): number {
  return Math.max(0, Math.round(total * 100) - sumPaymentsCents(payments))
}

export type SplitAmountCheck =
  /** Nimic tastat: butonul e dezactivat, fără mesaj. */
  | { kind: 'empty' }
  /** Nu e o sumă sau nu e mai mare ca 0: butonul e dezactivat, cu motivul. */
  | { kind: 'invalid' }
  /** O sumă acceptabilă; `coversRest` = achită exact restul (comanda devine Plătită). */
  | { kind: 'ok'; cents: number; coversRest: boolean }
  /** Peste rest: serverul o va respinge (`overpayment`); semnalat, NU blocat. */
  | { kind: 'over'; cents: number; overByCents: number }

/**
 * Suma tastată pentru o plată parțială („12,50” sau „12.5”), comparată în
 * cenți cu restul. `rest` null = restul nu e cunoscut (plățile nu s-au citit).
 */
export function checkSplitAmount(text: string, rest: number | null): SplitAmountCheck {
  const n = parseDecimalInput(text)
  if (n == null) return { kind: 'empty' }
  if (!Number.isFinite(n)) return { kind: 'invalid' }
  const cents = Math.round(n * 100)
  if (cents <= 0) return { kind: 'invalid' }
  if (rest == null) return { kind: 'ok', cents, coversRest: false }
  if (cents > rest) return { kind: 'over', cents, overByCents: cents - rest }
  return { kind: 'ok', cents, coversRest: cents === rest }
}

/** Cenți → „12.50”, forma de bani a ecranului ospătarului (`toFixed(2)`). */
export function centsText(cents: number): string {
  return (cents / 100).toFixed(2)
}
