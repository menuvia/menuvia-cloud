// ─────────────────────────────────────────────────────────────
// Pasul următor al ospătarului pe Planul 3 (lotul O7b, nov 2026).
//
// Defectul: pe Planul 3 cardul ospătarului arăta plata DOAR pe `served`, iar
// „Închide comanda” (nefiscal) e interzisă acolo (regula de aur). Singurul
// buton care împingea o comandă înainte pe /waiter era „Servit” din „Gata de
// servit” (doar pe `ready`), iar new → confirmed → preparing → ready îl făcea
// DOAR Bucătăria (/kitchen, la care ospătarul nu are acces). Un local pe
// Planul 3 fără ecran de bucătărie avea comenzile blocate pe „Nou”: nu le
// putea nici servi, nici încasa.
//
// Regula de aici: UN SINGUR apel `advance_order` per tap, pe o tranziție pe
// care serverul o acceptă DEJA pentru rolul de ospătar (mig 291, corpul viu):
//   new / confirmed → preparing   (start_preparing)
//   preparing       → served      (mark_served; nu la pickup, vezi mai jos)
//   preparing       → ready       (mark_ready; DOAR la pickup)
//   ready           → served      (mark_served)
// Nimic nu țintește `paid` / `closed` / `cancelled`: plata rămâne drumul
// existent din `served` (PayModal → mark_paid, cu bon), iar anularea rămâne
// butonul ei. Un lanț de două RPC-uri într-un tap (start_preparing +
// mark_served) a fost respins: nu e atomic — lacătul de pe comandă se
// eliberează între apeluri, un al doilea tap se poate intercala, iar un eșec
// la mijloc lasă un pas pe jumătate.
//
// Pickup-ul trece PRIN `ready`: `trg_sms_pickup_ready` trimite oaspetelui
// „comanda e gata” DOAR pe →ready, deci preparing → served i-ar sări tăcut
// SMS-ul.
//
// Tabela e înghețată de `tests/sql/auto/waiter_forward_steps.sql` (blocul
// FIXTURE, rulat ca ospătar REAL pe un restaurant de Plan 3) și oglindită de
// WS2 (`__tests__/waiterSteps.test.ts`): un pas nou intră în AMBELE locuri, în
// același PR.
// ─────────────────────────────────────────────────────────────
import type { Order, OrderStatus } from './orders'
import type { TapScope } from './tapGuard'

export interface WaiterForwardStep {
  /** Statusul-țintă; `advanceOrderStatus` derivă din el acțiunea serverului. */
  target: Extract<OrderStatus, 'preparing' | 'ready' | 'served'>
  /** Textul butonului — aceleași cuvinte ca Bucătăria și „Gata de servit”. */
  label: string
  /**
   * 'list' DOAR când pasul intră în `ready` sau iese din el: secțiunea „Gata
   * de servit” apare/dispare, iar „Stadiu mese” re-sortează mesele după
   * stare, deci sub deget urcă alt card. Altfel cardul stă pe loc ('card').
   */
  scope: TapScope
}

/** Pasul următor al ospătarului pe Planul 3, sau null când nu există (plată / terminal). */
export function waiterForwardStep(
  order: Pick<Order, 'status' | 'source'>,
): WaiterForwardStep | null {
  switch (order.status) {
    case 'new':
    case 'confirmed':
      // start_preparing e acceptat din AMBELE stări (confirm nu e necesar).
      return { target: 'preparing', label: 'Marchează în pregătire', scope: 'card' }
    case 'preparing':
      return order.source === 'pickup'
        ? { target: 'ready', label: 'Gata', scope: 'list' }
        : { target: 'served', label: 'Servit', scope: 'card' }
    case 'ready':
      return { target: 'served', label: 'Servit', scope: 'list' }
    default:
      // served → plata (PayModal); paid / closed / cancelled → terminale.
      return null
  }
}
