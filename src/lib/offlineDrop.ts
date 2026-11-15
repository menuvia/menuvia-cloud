// src/lib/offlineDrop.ts — motivul unei comenzi offline respinse DEFINITIV de
// server la trimitere (lotul L4d, restul din L4b). `useOfflineOrderQueue` ține
// eroarea ca DATE (mesaj + hint + cod), iar pagina o traduce la RANDARE:
//   - în ROMÂNĂ, textul de dinainte — mesajul serverului ca atare (de regulă
//     românesc) sau „eroare necunoscută”, în paranteză în `offline_dropped`;
//   - în altă limbă, un text românesc de la server ar face ecranul amestecat,
//     deci motivul vine din HINT (contractul cu serverul, convenția mig 290 —
//     aceleași hint-uri ca refuzurile de la trimiterea online, WaiterEntry),
//     iar un hint necunoscut sau lipsă → „respinsă de server”.
// Modul pur, fără importuri: testabil fără DOM.

export interface OfflineDrop {
  /** Mesajul serverului, sau „eroare necunoscută” (offlineSync.ts). */
  reason: string
  hint: string | null
  code: string | null
}

export type OfflineDropReasonKey =
  | 'offline_reason_soldOut'
  | 'offline_reason_gone'
  | 'offline_reason_options'
  | 'offline_reason_group'
  | 'offline_reason_quantity'
  | 'offline_reason_notes'
  | 'offline_reason_orderingOff'
  | 'offline_reason_other'

const BY_HINT: Readonly<Record<string, OfflineDropReasonKey>> = {
  product_sold_out: 'offline_reason_soldOut',
  product_inactive: 'offline_reason_gone',
  product_draft: 'offline_reason_gone',
  product_not_found: 'offline_reason_gone',
  product_unavailable: 'offline_reason_gone',
  product_wrong_restaurant: 'offline_reason_gone',
  invalid_options: 'offline_reason_options',
  duplicate_options: 'offline_reason_options',
  too_many_in_group: 'offline_reason_options',
  duplicate_extras: 'offline_reason_options',
  invalid_extras: 'offline_reason_options',
  missing_required_group: 'offline_reason_group',
  invalid_quantity: 'offline_reason_quantity',
  too_many_items: 'offline_reason_quantity',
  notes_too_long: 'offline_reason_notes',
  item_notes_too_long: 'offline_reason_notes',
  restaurant_inactive: 'offline_reason_orderingOff',
  plan_upgrade_required: 'offline_reason_orderingOff',
}

export function offlineDropReasonKey(hint: string | null | undefined): OfflineDropReasonKey {
  if (typeof hint !== 'string' || !Object.prototype.hasOwnProperty.call(BY_HINT, hint)) {
    return 'offline_reason_other'
  }
  return BY_HINT[hint]
}

/** Detaliul evenimentului `offline-order-dropped`, citit defensiv (un
 *  emițător vechi trimite doar `reason`). */
export function readOfflineDrop(detail: unknown): OfflineDrop {
  const d = detail != null && typeof detail === 'object' ? (detail as Record<string, unknown>) : {}
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  return {
    reason: typeof d.reason === 'string' ? d.reason : 'eroare necunoscută',
    hint: str(d.hint),
    code: str(d.code),
  }
}
