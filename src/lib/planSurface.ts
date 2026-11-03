// ─────────────────────────────────────────────────────────────
// planSurface — CE VEDE fiecare plan în panou, într-un singur loc.
//
// Decizia fondatorului (lotul P, nov 2026): planurile inferioare NU văd nimic
// din cele superioare — nici funcția, nici un lacăt, nici un text despre ea —
// iar upsell-ul e UNUL singur, pe Acasă (`PlanUpsellCard`). Pe Planul 1 nu
// există comenzi, deci nici coș, ridicare, ospătar sau TVA; pe Planul 2
// comenzile există, dar plata și bonul rămân pe casa existentă, deci nicio
// cotă TVA, nicio sumă din rapoarte și nimic „fiscal".
//
// Tab-urile citesc DOAR de aici (clichetul `tests/functions/plan-surface-ratchet.test.js` pică pe
// orice `tier >= N` / `planTier(...)` scris de mână în src/components sau
// src/pages, cu registru de scutiri motivate). Gating-ul REAL rămâne în
// server (RPC/RLS, regula de aur); aici se decide doar ce se ARATĂ.
//
// Sursele, pe cele două tier-uri din `surfaceTiers` (lib/features.ts):
//   - `general` = planul owner-ului; `money` = coborât sub 3 în afara RO
//     (mig 296). Pe un restaurant RO cele două sunt IDENTICE.
//   - `payments` și `vat` stau pe `general`: pe Planul 3 din afara României
//     cardul de plăți online își explică singur restricția de țară, iar
//     editorul de cote rămâne — exact ca înainte (pe Planul 3 nu se schimbă
//     nimic).
//   - `fiscal` stă pe `money`: bon, casă, încasări, facturi, sumele din
//     rapoarte și butoanele reale de plată — aceleași suprafețe care citeau
//     deja `money >= 3`.
// ─────────────────────────────────────────────────────────────
import { hasFeature, surfaceTiers, type RestaurantFeatures } from './features'

export interface PlanSurface {
  /** Comenzi de la masă (QR): coș, sugestii la coș, nota de flipbook. */
  ordering: boolean
  /** Ecranele echipei (ospătar, bucătărie): „Vezi ca ospătar". */
  staff: boolean
  /** Comenzi pentru ridicare (click-and-collect). */
  pickup: boolean
  /** Extras & Pereche pe produs. */
  extras: boolean
  /** Gestiune: stocuri și rețete. */
  stocks: boolean
  /** Ascunderea badge-ului „Creat cu Menuvia". */
  branding: boolean
  /** SMS-uri tranzacționale (`sms_notifications`, de la starter — Planul 1 inclus). */
  sms: boolean
  /** Suprafețele de plată ale Planului 3 (cardul „Plăți online la masă"). */
  payments: boolean
  /** Bon, casă de marcat, încasări, facturi, sume în rapoarte, plata reală. */
  fiscal: boolean
  /** Cote TVA: editorul, câmpul de produs, badge-ul, CSV-ul, stocurile, NIR-ul. */
  vat: boolean
}

/**
 * Suprafața planului RESTAURANTULUI (regula 3: din `useFeatures(restaurantId)`,
 * nu din `profile.plan`). TRISTATE: `null` = features neîncărcate (sau citirea
 * a eșuat fără cache) — pe `null` nu se arată nici funcția, nici upsell-ul.
 */
export function planSurface(features: RestaurantFeatures | null): PlanSurface | null {
  if (!features) return null
  const { general, money } = surfaceTiers(features)
  return {
    ordering: hasFeature(features, 'order_qr'),
    staff: hasFeature(features, 'waiter_manual'),
    pickup: hasFeature(features, 'pickup_orders'),
    extras: hasFeature(features, 'extras_pairings'),
    stocks: hasFeature(features, 'stocks'),
    branding: hasFeature(features, 'remove_branding'),
    sms: hasFeature(features, 'sms_notifications'),
    payments: general === 3,
    fiscal: money === 3,
    vat: general === 3,
  }
}

/** Planul spre care trimite upsell-ul unic de pe Acasă. */
export type PlanUpsellTarget = 'ordering' | 'payments'

/**
 * Upsell-ul UNIC: Planul 1 → „Meniu + Comenzi", Planul 2 → „Plata la masă"
 * (Fiscalizarea), Planul 3 → niciunul. `fiscalMarket` = restaurant din România
 * pe site-ul .ro: Plata la masă și bonul există doar acolo (mig 296), iar .com
 * vinde doar Planurile 1–2 (`lib/siteMarket.ts`), deci în afara lui Planul 2
 * nu primește nicio ofertă. Cine vede cardul (doar PROPRIETARUL — managerul
 * n-are ce cumpăra) decide apelantul.
 */
export function planUpsellTarget(
  surface: PlanSurface | null,
  opts: { fiscalMarket: boolean },
): PlanUpsellTarget | null {
  if (!surface) return null
  if (!surface.ordering) return 'ordering'
  if (!surface.payments) return opts.fiscalMarket ? 'payments' : null
  return null
}
