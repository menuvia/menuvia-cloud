// src/lib/countries.ts
// ─────────────────────────────────────────────────────────────
// Țara restaurantului (`restaurants.country`, mig 296) + valorile implicite
// propuse la onboarding (moneda meniului și fusul orar). În DB, țara decide
// DOAR regula de aur: feature-urile românești (fiscal, plăți în aplicație,
// TVA) nu există pentru un restaurant cu `country <> 'RO'`. Moneda și fusul
// rămân coloane separate, editabile (mig 205 / 049) — aici doar le PROPUNEM.
//
// Monedele de aici sunt TOATE din whitelist-ul CHECK-ului din mig 205
// (MENU_CURRENCIES) — testul CN2 o cere. Bulgaria e în zona euro din 1 ian
// 2026, deci EUR (nu BGN).
// ─────────────────────────────────────────────────────────────
import type { MenuCurrency } from './currency'
import type { Site } from './domain'

export interface CountryOption {
  code: string // ISO 3166-1 alpha-2, MAJUSCULE (CHECK-ul din mig 296)
  name: string // numele în engleză (lista apare pe site-ul .com)
  currency: MenuCurrency
  timezone: string // IANA
}

export const DEFAULT_COUNTRY = 'RO'

export const COUNTRIES: readonly CountryOption[] = [
  { code: 'RO', name: 'Romania', currency: 'RON', timezone: 'Europe/Bucharest' },
  { code: 'MD', name: 'Moldova', currency: 'MDL', timezone: 'Europe/Chisinau' },
  { code: 'HU', name: 'Hungary', currency: 'HUF', timezone: 'Europe/Budapest' },
  { code: 'BG', name: 'Bulgaria', currency: 'EUR', timezone: 'Europe/Sofia' },
  { code: 'AT', name: 'Austria', currency: 'EUR', timezone: 'Europe/Vienna' },
  { code: 'BE', name: 'Belgium', currency: 'EUR', timezone: 'Europe/Brussels' },
  { code: 'FR', name: 'France', currency: 'EUR', timezone: 'Europe/Paris' },
  { code: 'DE', name: 'Germany', currency: 'EUR', timezone: 'Europe/Berlin' },
  { code: 'GR', name: 'Greece', currency: 'EUR', timezone: 'Europe/Athens' },
  { code: 'IE', name: 'Ireland', currency: 'EUR', timezone: 'Europe/Dublin' },
  { code: 'IT', name: 'Italy', currency: 'EUR', timezone: 'Europe/Rome' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', timezone: 'Europe/Amsterdam' },
  { code: 'PT', name: 'Portugal', currency: 'EUR', timezone: 'Europe/Lisbon' },
  { code: 'ES', name: 'Spain', currency: 'EUR', timezone: 'Europe/Madrid' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', timezone: 'Europe/London' },
  { code: 'US', name: 'United States', currency: 'USD', timezone: 'America/New_York' },
]

const BY_CODE: ReadonlyMap<string, CountryOption> = new Map(COUNTRIES.map((c) => [c.code, c]))

/** Codul normalizat dacă e o țară cunoscută, altfel null. */
export function normalizeCountry(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toUpperCase()
  return BY_CODE.has(code) ? code : null
}

export function countryOption(code: string): CountryOption | null {
  return BY_CODE.get(code) ?? null
}

/**
 * Câmpurile de scris pe restaurant după creare, pentru țara aleasă. Pe 'RO'
 * întoarce `null`: default-urile din DB (country 'RO', RON, Europe/Bucharest)
 * sunt deja corecte, deci fluxul românesc nu face NICIUN apel în plus.
 */
export function restaurantCountryPatch(
  code: string,
): { country: string; currency: MenuCurrency; timezone: string } | null {
  const opt = countryOption(code)
  if (!opt || opt.code === DEFAULT_COUNTRY) return null
  return { country: opt.code, currency: opt.currency, timezone: opt.timezone }
}

/**
 * Câmpul „Țara” din Setări → Restaurant: apare pe menuvia.com sau când
 * restaurantul e DEJA în afara României (ca owner-ul să-și poată corecta țara
 * de oriunde). Pe .ro, pentru un local RO (adică toate de azi), NU apare —
 * UI-ul românesc rămâne neschimbat. `null`/absent (bază fără mig 296) = 'RO'.
 */
export function countrySettingVisible(site: Site, country: string | null | undefined): boolean {
  if (site === 'com') return true
  const code = typeof country === 'string' ? country.trim().toUpperCase() : ''
  return code !== '' && code !== DEFAULT_COUNTRY
}
