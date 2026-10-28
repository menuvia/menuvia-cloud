// src/lib/affiliateEarnings.ts
// Logică PURĂ pentru cifrele afiliatului (fără React, fără supabase), ca să
// fie testabilă direct.
//
// 1. summarizeEarnings — ce afișează panoul. Sursa de adevăr e SERVERUL
//    (get_affiliate_dashboard, mig 295: cifre nete, disponibil = confirmat −
//    angajat, cu ACEEAȘI formulă ca batch-ul de plăți). Pe o bază fără 295
//    câmpurile noi lipsesc, iar panoul cade pe calculul vechi, brut.
// 2. estimateAffiliateEarnings — calculatorul public, pe modelul comunicat:
//    activarea = % din PRIMA factură (plătită după ce clientul achită și a
//    doua), recurentul = % din fiecare dintre URMĂTOARELE `capInvoices`
//    facturi lunare. Nu există facturare anuală: 12 facturi = 12 luni.

export const DEFAULT_MIN_PAYOUT_CENTS = 5000

export interface EarningsInput {
  confirmed_cents: number
  pending_cents: number
  paid_cents: number
  total_cents: number
  net_earned_cents?: number
  pending_net_cents?: number
  in_progress_cents?: number
  available_cents?: number
  min_payout_cents?: number
}

export interface EarningsSummary {
  /** Disponibil pentru următorul batch (net, minus ce e deja angajat). */
  availableCents: number
  /** În hold, net de stornări. */
  pendingCents: number
  /** Total câștigat net (confirmat + în așteptare). */
  netEarnedCents: number
  /** Plăți create dar încă neplătite (0 pe o DB fără 295). */
  inProgressCents: number
  minPayoutCents: number
  /** Disponibilul nu atinge pragul → se reportează luna următoare. */
  belowMinimum: boolean
  /** Cifrele vin de la server (mig 295), nu din calculul vechi. */
  serverNet: boolean
}

function num(v: number | undefined | null): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function summarizeEarnings(e: EarningsInput | null | undefined): EarningsSummary {
  const minPayoutCents = num(e?.min_payout_cents) ?? DEFAULT_MIN_PAYOUT_CENTS
  if (!e) {
    return {
      availableCents: 0,
      pendingCents: 0,
      netEarnedCents: 0,
      inProgressCents: 0,
      minPayoutCents,
      belowMinimum: true,
      serverNet: false,
    }
  }
  const serverAvailable = num(e.available_cents)
  const serverNet = serverAvailable !== null
  const availableCents = serverNet
    ? Math.max(0, serverAvailable)
    : Math.max(0, (e.confirmed_cents ?? 0) - (e.paid_cents ?? 0))
  const pendingCents = num(e.pending_net_cents) ?? e.pending_cents ?? 0
  const netEarnedCents = num(e.net_earned_cents) ?? e.total_cents ?? 0
  return {
    availableCents,
    pendingCents,
    netEarnedCents,
    inProgressCents: num(e.in_progress_cents) ?? 0,
    minPayoutCents,
    belowMinimum: availableCents < minPayoutCents,
    serverNet,
  }
}

export interface EstimateInput {
  /** Câte restaurante. */
  count: number
  /** Prețul lunar al planului, în lei. */
  priceMonthly: number
  setupBps: number
  recurringBps: number
  /** Câte facturi recurente se plătesc per restaurant (cap). */
  capInvoices: number
}

export interface EstimateResult {
  /** Activarea: % din prima factură, o dată per restaurant. */
  setupBonus: number
  /** Recurentul per lună (toate restaurantele). */
  monthly: number
  /** Câte facturi recurente intră în primele 12 luni (prima e activarea). */
  recurringInFirstYear: number
  /** Total pe primele 12 facturi lunare (activare + recurent). */
  firstYear: number
  /** Total pe toată durata (activare + `capInvoices` facturi recurente). */
  lifetime: number
}

export function estimateAffiliateEarnings(i: EstimateInput): EstimateResult {
  const count = Math.max(0, i.count)
  const cap = Math.max(0, Math.floor(i.capInvoices))
  const setupBonus = count * (i.setupBps / 10000) * i.priceMonthly
  const monthly = count * (i.recurringBps / 10000) * i.priceMonthly
  // În primele 12 luni sunt 12 facturi: prima aduce activarea, următoarele 11
  // aduc recurentul (dacă plafonul o permite).
  const recurringInFirstYear = Math.min(11, cap)
  return {
    setupBonus,
    monthly,
    recurringInFirstYear,
    firstYear: setupBonus + recurringInFirstYear * monthly,
    lifetime: setupBonus + cap * monthly,
  }
}
