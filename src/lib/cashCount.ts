// ─────────────────────────────────────────────────────────────
// Numerarul tastat la deschiderea și la închiderea turei (lotul C2a).
//
// „Închide tura” cu câmpul GOL închidea tura cu 0 lei numărați: `Number('')`
// e 0, deci validarea trecea, butonul era activ, „Trimite Raport Z” era bifat
// implicit, iar un singur tap închidea tura DEFINITIV (`close_shift`, mig 032,
// nu are redeschidere), cu toată casa trecută drept lipsă. Pe browserele unde
// `type=number` refuză virgula, „12,5” ajungea tot ca '' → 0. Același tipar la
// deschiderea turei: câmp golit = fond 0.
//
// Acum suma se citește cu `parseDecimalCents` (virgulă SAU punct), un câmp gol
// înseamnă NICIO sumă (nu 0), iar valoarea se ține în CENȚI întregi, rotunjiți
// zecimal ca `numeric(10,2)` din `cash_shifts`. Validarea e de INPUT, nu un
// gate de business: serverul rămâne autoritatea pe tură.
//
// Textele de mai jos sunt în română și DOAR în română: Casă & Tură e ecran
// fiscal (raportul Z, sertarul — lib/fiscalScreens.ts), deci nu au chei în
// dicționarele personalului. Stau aici, lângă funcțiile pure care le compun.
// ─────────────────────────────────────────────────────────────
import { parseDecimalCents } from './decimal'

export interface CashInput {
  /** 'empty' = nimic tastat (NU 0); 'invalid' = text care nu e o sumă. */
  state: 'empty' | 'invalid' | 'ok'
  /** Suma în cenți întregi; `null` cât timp `state` nu e 'ok'. */
  cents: number | null
}

/** „1250,50”, „1250.5”, „0” → cenți; „” → empty; „-5”, „12,5,3”, „abc” → invalid. */
export function readCashInput(text: string): CashInput {
  const cents = parseDecimalCents(text)
  if (cents == null) return { state: 'empty', cents: null }
  // `parseDecimalCents` respinge deja semnul și orice sumă care nu încape
  // într-un întreg sigur de cenți (NaN): „1” urmat de 307 zerouri era finit ca
  // lei, dar Infinity ca cenți, și pleca la `close_shift` ca `null`.
  if (Number.isNaN(cents)) return { state: 'invalid', cents: null }
  return { state: 'ok', cents }
}

/** Suma din server (lei, posibil cu zecimale binare) în cenți întregi. */
export function leiToCents(lei: number): number {
  return Math.round(lei * 100)
}

/** Ca `ron()` din CashRegisterTab: „1250,50 lei”. */
export function formatLeiCents(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + ' lei'
}

/** Peste această diferență (în valoare absolută) închiderea cere confirmare: 1 leu. */
export const CLOSE_DIFF_CONFIRM_CENTS = 100

/**
 * Închiderea cere confirmare când Raportul Z pleacă la casă (ireversibil) sau
 * când numărătoarea diferă de așteptat cu MAI MULT de 1 leu.
 */
export function closeShiftNeedsConfirm(diffCents: number, sendZ: boolean): boolean {
  return sendZ || Math.abs(diffCents) > CLOSE_DIFF_CONFIRM_CENTS
}

export interface CloseShiftConfirmCopy {
  title: string
  description: string
  confirmLabel: string
}

/** Textul confirmării de închidere: suma numărată, diferența și ce nu se mai poate anula. */
export function closeShiftConfirmCopy(
  countedCents: number,
  expectedCents: number,
  sendZ: boolean,
): CloseShiftConfirmCopy {
  const diff = countedCents - expectedCents
  const diffText =
    diff === 0
      ? 'exact cât era așteptat'
      : diff < 0
        ? `lipsă ${formatLeiCents(-diff)}`
        : `surplus ${formatLeiCents(diff)}`
  const parts = [`Așteptat în sertar: ${formatLeiCents(expectedCents)} — ${diffText}.`]
  if (sendZ) parts.push('Raportul Z se tipărește la casa de marcat și nu se poate anula.')
  parts.push('O tură închisă nu se mai poate redeschide.')
  return {
    title: `Închizi tura cu ${formatLeiCents(countedCents)} numărați?`,
    description: parts.join(' '),
    confirmLabel: 'Închide tura',
  }
}

/** Sub câmpul de sumă, când textul tastat nu e o sumă. */
export const CASH_INPUT_INVALID =
  'Sumă invalidă: scrie doar cifre, cu virgulă sau punct pentru bani (ex: 1250,50).'
