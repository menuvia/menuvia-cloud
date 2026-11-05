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
import { MENU_CURRENCIES, type MenuCurrency } from './currency'
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
  // Zona euro (lotul G1 a completat-o: Croația din 2023, statele baltice,
  // Finlanda, Slovacia, Slovenia, Luxemburg, Malta, Cipru) + Muntenegru, care
  // folosește euro fără să fie în zonă.
  { code: 'AT', name: 'Austria', currency: 'EUR', timezone: 'Europe/Vienna' },
  { code: 'BE', name: 'Belgium', currency: 'EUR', timezone: 'Europe/Brussels' },
  { code: 'HR', name: 'Croatia', currency: 'EUR', timezone: 'Europe/Zagreb' },
  { code: 'CY', name: 'Cyprus', currency: 'EUR', timezone: 'Asia/Nicosia' },
  { code: 'EE', name: 'Estonia', currency: 'EUR', timezone: 'Europe/Tallinn' },
  { code: 'FI', name: 'Finland', currency: 'EUR', timezone: 'Europe/Helsinki' },
  { code: 'FR', name: 'France', currency: 'EUR', timezone: 'Europe/Paris' },
  { code: 'DE', name: 'Germany', currency: 'EUR', timezone: 'Europe/Berlin' },
  { code: 'GR', name: 'Greece', currency: 'EUR', timezone: 'Europe/Athens' },
  { code: 'IE', name: 'Ireland', currency: 'EUR', timezone: 'Europe/Dublin' },
  { code: 'IT', name: 'Italy', currency: 'EUR', timezone: 'Europe/Rome' },
  { code: 'LV', name: 'Latvia', currency: 'EUR', timezone: 'Europe/Riga' },
  { code: 'LT', name: 'Lithuania', currency: 'EUR', timezone: 'Europe/Vilnius' },
  { code: 'LU', name: 'Luxembourg', currency: 'EUR', timezone: 'Europe/Luxembourg' },
  { code: 'MT', name: 'Malta', currency: 'EUR', timezone: 'Europe/Malta' },
  { code: 'ME', name: 'Montenegro', currency: 'EUR', timezone: 'Europe/Podgorica' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', timezone: 'Europe/Amsterdam' },
  { code: 'PT', name: 'Portugal', currency: 'EUR', timezone: 'Europe/Lisbon' },
  { code: 'SK', name: 'Slovakia', currency: 'EUR', timezone: 'Europe/Bratislava' },
  { code: 'SI', name: 'Slovenia', currency: 'EUR', timezone: 'Europe/Ljubljana' },
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
 * Câmpul „Țara” din Setări → Restaurant: apare pe un host .com sau când
 * restaurantul e DEJA în afara României (ca owner-ul să-și poată corecta țara
 * de oriunde). Pe .ro, pentru un local RO (adică toate de azi), NU apare —
 * UI-ul românesc rămâne neschimbat. `null`/absent (bază fără mig 296) = 'RO'.
 */
export function countrySettingVisible(site: Site, country: string | null | undefined): boolean {
  if (site === 'com') return true
  const code = typeof country === 'string' ? country.trim().toUpperCase() : ''
  return code !== '' && code !== DEFAULT_COUNTRY
}

// ── Setările regionale ale unei locații (lotul G1) ───────────────────────────

/** Valorile implicite din DB pentru un restaurant nou (mig 049/205/296/298). */
export const REGIONAL_DEFAULTS = {
  country: DEFAULT_COUNTRY,
  currency: 'RON',
  timezone: 'Europe/Bucharest',
  language: 'ro',
} as const

// Limbile de bază ale meniului (CHECK-ul din mig 298, aceleași ca MENU_LANGS).
const MENU_BASE_LANGS: readonly string[] = ['ro', 'en', 'de', 'fr', 'it', 'hu', 'es']

export interface RegionalSource {
  country?: string | null
  currency?: string | null
  timezone?: string | null
  language?: string | null
}

export interface RegionalPatch {
  country?: string
  currency?: MenuCurrency
  timezone?: string
  language?: string
}

function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.trim() === '') return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Ce copiază o locație NOUĂ de la cea din care a fost creată (lotul G1): țara,
 * moneda, fusul și limba de bază a meniului, DOAR câmpurile valide care diferă
 * de valorile implicite din DB. `null` = nimic de copiat — fluxul românesc
 * (toate localurile de azi) nu face niciun apel în plus.
 */
export function regionalPatchFrom(source: RegionalSource | null | undefined): RegionalPatch | null {
  if (!source) return null
  const patch: RegionalPatch = {}
  const country = normalizeCountry(source.country)
  if (country && country !== REGIONAL_DEFAULTS.country) patch.country = country
  const currency = source.currency
  if (
    typeof currency === 'string' &&
    currency !== REGIONAL_DEFAULTS.currency &&
    (MENU_CURRENCIES as readonly string[]).includes(currency)
  )
    patch.currency = currency as MenuCurrency
  if (validTimeZone(source.timezone) && source.timezone !== REGIONAL_DEFAULTS.timezone) patch.timezone = source.timezone
  const language = source.language
  if (typeof language === 'string' && language !== REGIONAL_DEFAULTS.language && MENU_BASE_LANGS.includes(language))
    patch.language = language
  return Object.keys(patch).length > 0 ? patch : null
}

/**
 * Moneda și fusul după o schimbare de țară în Setări (lotul G1): fiecare
 * urmează noua țară DOAR dacă era încă valoarea implicită a țării vechi. Una
 * aleasă de mână (un local din Germania care afișează prețurile în lei)
 * rămâne. Țara veche necunoscută = România (default-ul din DB).
 */
export function followCountryDefaults(
  prevCountry: string | null | undefined,
  nextCountry: string,
  current: { currency?: string | null; timezone?: string | null },
): { currency: string; timezone: string } {
  const prev = countryOption(normalizeCountry(prevCountry) ?? DEFAULT_COUNTRY)
  const next = countryOption(normalizeCountry(nextCountry) ?? DEFAULT_COUNTRY)
  const currency = current.currency ?? REGIONAL_DEFAULTS.currency
  const timezone = current.timezone ?? REGIONAL_DEFAULTS.timezone
  if (!prev || !next) return { currency, timezone }
  return {
    currency: currency === prev.currency ? next.currency : currency,
    timezone: timezone === prev.timezone ? next.timezone : timezone,
  }
}

/**
 * Fusurile orare din selectorul din Setări: cele ale țărilor din listă, apoi
 * toate cele cunoscute de motor (`Intl.supportedValuesOf`), plus valoarea
 * curentă dacă lipsește (un fus scris de altundeva nu dispare din select).
 */
export function timeZoneOptions(current?: string | null): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (tz: string) => {
    if (!seen.has(tz)) {
      seen.add(tz)
      out.push(tz)
    }
  }
  if (typeof current === 'string' && current.trim() !== '') push(current)
  for (const c of COUNTRIES) push(c.timezone)
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  try {
    for (const tz of intl.supportedValuesOf?.('timeZone') ?? []) push(tz)
  } catch {
    /* motor fără supportedValuesOf — rămân fusurile țărilor */
  }
  return out
}
