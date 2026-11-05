// src/lib/pendingCountry.ts
// ─────────────────────────────────────────────────────────────
// Țara aleasă la onboarding (hostul .com), încă NESALVATĂ pe restaurant.
//
// Problema (review #288): `create_restaurant` (mig 221) nu primește țara, deci
// onboarding-ul o scrie printr-un UPDATE separat, DUPĂ creare. Dacă UPDATE-ul
// pică (blip de rețea, tab închis între cele două cereri), un reload sare peste
// onboarding (restaurantul există deja), iar localul rămâne TĂCUT pe 'RO' —
// adică pe regula fiscală românească, cu Planul 3 deblocat în DATE.
//
// Soluția: intenția se păstrează în localStorage ÎNAINTE de UPDATE (cheie per
// restaurant), se șterge DOAR pe succes, iar dashboard-ul owner-ului o
// reîncearcă la următoarea încărcare. Pe .ro nu se scrie niciodată nimic
// (patch-ul pentru 'RO' e null), deci fluxul românesc e neatins.
//
// Storage-ul care ARUNCĂ (Safari „Block All Cookies", RESID-15) e tratat
// fail-open: fără storage nu putem reîncerca, dar nici nu rupem pagina.
// ─────────────────────────────────────────────────────────────
import {
  normalizeCountry,
  regionalPatchFrom,
  restaurantCountryPatch,
  type RegionalPatch,
  type RegionalSource,
} from './countries'

export const PENDING_COUNTRY_PREFIX = 'menuvia_pending_country:'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function keyFor(restaurantId: string): string {
  return PENDING_COUNTRY_PREFIX + restaurantId
}

/** Păstrează intenția. No-op pe 'RO' (nimic de salvat) sau pe cod necunoscut. */
export function storePendingCountry(
  restaurantId: string,
  code: string,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (!storage || !restaurantCountryPatch(code)) return
  try {
    storage.setItem(keyFor(restaurantId), code)
  } catch {
    /* storage blocat — fail-open */
  }
}

/** Codul păstrat, dacă e o țară cunoscută; altfel null. */
export function readPendingCountry(
  restaurantId: string,
  storage: KeyValueStorage | null = browserStorage(),
): string | null {
  if (!storage) return null
  try {
    return normalizeCountry(storage.getItem(keyFor(restaurantId)))
  } catch {
    return null
  }
}

export function clearPendingCountry(
  restaurantId: string,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (!storage) return
  try {
    storage.removeItem(keyFor(restaurantId))
  } catch {
    /* storage blocat — fail-open */
  }
}

export type CountryPatch = NonNullable<ReturnType<typeof restaurantCountryPatch>>

export type PendingCountryResult =
  | 'none' // nimic păstrat
  | 'not_owner' // doar owner-ul poate schimba țara (trg_restaurants_country_owner_only, mig 296)
  | 'already_set' // restaurantul are deja țara păstrată → intenția se șterge
  | 'saved' // UPDATE reușit → intenția se șterge
  | 'failed' // UPDATE picat → intenția RĂMÂNE pentru următoarea încărcare

/**
 * Reîncearcă salvarea țării păstrate. `update` întoarce `{ error }` ca
 * supabase-js (care NU aruncă); o excepție e tratată la fel ca o eroare.
 * Intenția se șterge DOAR pe 'already_set' / 'saved' / cod invalid.
 */
export async function retryPendingCountry(opts: {
  restaurantId: string
  currentCountry: string | null | undefined
  isOwner: boolean
  update: (patch: CountryPatch) => Promise<{ error: unknown }>
  storage?: KeyValueStorage | null
}): Promise<PendingCountryResult> {
  const storage = opts.storage === undefined ? browserStorage() : opts.storage
  const code = readPendingCountry(opts.restaurantId, storage)
  if (!code) return 'none'
  const patch = restaurantCountryPatch(code)
  if (!patch) {
    clearPendingCountry(opts.restaurantId, storage)
    return 'none'
  }
  if (normalizeCountry(opts.currentCountry) === code) {
    clearPendingCountry(opts.restaurantId, storage)
    return 'already_set'
  }
  if (!opts.isOwner) return 'not_owner'
  try {
    const { error } = await opts.update(patch)
    if (error) return 'failed'
  } catch {
    return 'failed'
  }
  clearPendingCountry(opts.restaurantId, storage)
  return 'saved'
}

// ── Setările regionale ale unei LOCAȚII NOI (lotul G1) ───────────────────────
// „Adaugă o locație” copiază țara, moneda, fusul și limba de bază ale locației
// din care a fost creată, printr-un UPDATE separat după `create_restaurant`.
// Intenția păstrată e PATCH-UL ÎNTREG, nu doar țara (recenzia CodeRabbit pe
// #358): reîncercarea doar cu țara ar fi pus moneda și fusul IMPLICITE ale
// țării (nu cele alese de mână la sursă) și ar fi pierdut limba; iar o sursă
// românească cu o monedă sau un fus personalizat n-ar fi păstrat nimic.

export const PENDING_REGIONAL_PREFIX = 'menuvia_pending_regional:'

function regionalKeyFor(restaurantId: string): string {
  return PENDING_REGIONAL_PREFIX + restaurantId
}

/** Păstrează patch-ul regional (doar câmpurile valide, nesimplicite). */
export function storePendingRegional(
  restaurantId: string,
  patch: RegionalPatch,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  const clean = regionalPatchFrom(patch)
  if (!storage || !clean) return
  try {
    storage.setItem(regionalKeyFor(restaurantId), JSON.stringify(clean))
  } catch {
    /* storage blocat — fail-open */
  }
}

/** Patch-ul păstrat, re-validat (o valoare stricată sau străină → null). */
export function readPendingRegional(
  restaurantId: string,
  storage: KeyValueStorage | null = browserStorage(),
): RegionalPatch | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(regionalKeyFor(restaurantId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return regionalPatchFrom(parsed as RegionalSource)
  } catch {
    return null
  }
}

export function clearPendingRegional(
  restaurantId: string,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (!storage) return
  try {
    storage.removeItem(regionalKeyFor(restaurantId))
  } catch {
    /* storage blocat — fail-open */
  }
}

/**
 * Reîncearcă patch-ul regional păstrat, DOAR cu câmpurile care încă diferă de
 * restaurant (o parte poate fi deja salvată, sau schimbată între timp din
 * Setări — nu o suprascriem). Țara o poate schimba doar owner-ul (mig 296).
 * Intenția se șterge DOAR pe 'already_set' / 'saved' / valoare invalidă.
 */
export async function retryPendingRegional(opts: {
  restaurantId: string
  current: RegionalSource | null | undefined
  isOwner: boolean
  update: (patch: RegionalPatch) => Promise<{ error: unknown }>
  storage?: KeyValueStorage | null
}): Promise<PendingCountryResult> {
  const storage = opts.storage === undefined ? browserStorage() : opts.storage
  const raw = (() => {
    try {
      return storage?.getItem(regionalKeyFor(opts.restaurantId)) ?? null
    } catch {
      return null
    }
  })()
  if (!raw) return 'none'
  const patch = readPendingRegional(opts.restaurantId, storage)
  if (!patch) {
    clearPendingRegional(opts.restaurantId, storage)
    return 'none'
  }
  const cur = opts.current ?? {}
  const remaining: RegionalPatch = {}
  if (patch.country && normalizeCountry(cur.country) !== patch.country) remaining.country = patch.country
  if (patch.currency && cur.currency !== patch.currency) remaining.currency = patch.currency
  if (patch.timezone && cur.timezone !== patch.timezone) remaining.timezone = patch.timezone
  if (patch.language && cur.language !== patch.language) remaining.language = patch.language
  if (Object.keys(remaining).length === 0) {
    clearPendingRegional(opts.restaurantId, storage)
    return 'already_set'
  }
  if (remaining.country && !opts.isOwner) return 'not_owner'
  try {
    const { error } = await opts.update(remaining)
    if (error) return 'failed'
  } catch {
    return 'failed'
  }
  clearPendingRegional(opts.restaurantId, storage)
  return 'saved'
}
