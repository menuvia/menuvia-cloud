// payoutFlow.ts — logica PURĂ a fluxului de payout din FounderPage (mig 294).
//
// Serverul e sursa de adevăr (trg_affiliate_payout_transition + RPC-urile
// admin_payout_*); aici doar oglindim matricea ca UI-ul să nu ofere butoane
// pe care serverul le-ar refuza oricum. Un buton în plus ar fi inofensiv
// (refuz cu cod), unul în minus ar bloca fluxul — de aceea testele
// (payoutFlow.test.ts) îngheață oglinda pe fiecare stare.

export type PayoutAction =
  | 'request_invoice'
  | 'match_invoice'
  | 'start_transfer'
  | 'mark_paid'
  | 'hold'
  | 'mark_failed'
  | 'cancel'

// Ordinea = ordinea butoanelor (acțiunea „fericită" prima).
export function availablePayoutActions(status: string, hasReference: boolean): PayoutAction[] {
  switch (status) {
    case 'draft':
      return ['request_invoice', 'cancel']
    case 'awaiting_invoice':
      return ['match_invoice', 'cancel']
    case 'invoice_matched':
      return ['start_transfer', 'cancel']
    case 'processing':
      return ['mark_paid', 'hold', 'mark_failed']
    case 'on_hold':
      return ['mark_paid', 'mark_failed']
    case 'failed':
      // Cu referință (banii POT fi plecat): doar anularea, după reconciliere.
      return hasReference ? ['cancel'] : ['match_invoice', 'cancel']
    default:
      return [] // paid / canceled = terminale
  }
}

export const PAYOUT_ACTION_LABELS: Record<PayoutAction, string> = {
  request_invoice: 'Cere factura',
  match_invoice: 'Confirmă factura',
  start_transfer: 'Am inițiat transferul',
  mark_paid: 'Marchează plătit',
  hold: 'Pune în verificare',
  mark_failed: 'Marchează eșuat',
  cancel: 'Anulează',
}

// Acțiunile care cer un câmp de text înainte de trimitere.
export function payoutActionNeedsInput(action: PayoutAction): boolean {
  return action === 'match_invoice' || action === 'start_transfer' || action === 'hold'
    || action === 'mark_failed' || action === 'cancel'
}

export const PAYMENT_METHOD_LABELS: Record<'wise' | 'bank_transfer' | 'other', string> = {
  bank_transfer: 'Virament bancar',
  wise: 'Wise',
  other: 'Altă metodă',
}

// Perioada batch-ului = luna curentă în ora ROMÂNIEI (ca automation-cron.js):
// la 00:30 pe 1 ale lunii, în UTC e încă luna precedentă. `sv-SE` dă nativ
// YYYY-MM-DD (tiparul mig 269 / Oblio).
export function currentPayoutPeriod(now: Date): string {
  const ymd = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return ymd.slice(0, 7) + '-01'
}

// IBAN în grupe de 4 — citibil la copiere în aplicația băncii.
export function formatIban(iban: string): string {
  return iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}

// Refuzul serverului → mesaj pentru fondator. RPC-urile de tranziție întorc
// deja `error` în română (cu starea curentă), deci îl păstrăm; suprascriem
// DOAR codurile al căror text e tehnic (excepția trigger-ului 106) sau lipsește
// (batch-ul ocupat întoarce doar `reason`).
const REFUSAL_OVERRIDES: Record<string, string> = {
  payout_exceeds_eligible:
    'Suma depășește ce i se datorează acum afiliatului (comision stornat după ciornă). Marchează eșuat, anulează și rulează din nou batch-ul.',
  batch_in_progress: 'Alt batch rulează chiar acum — încearcă din nou peste un minut.',
}

export function describePayoutRefusal(res: { reason?: string; error?: string }): string {
  if (res.reason && REFUSAL_OVERRIDES[res.reason]) return REFUSAL_OVERRIDES[res.reason]
  return res.error ?? res.reason ?? 'Acțiunea nu a putut fi salvată.'
}
