// src/i18n/format.ts — bani, ore și date pentru ecranele personalului
// (lotul L0b). Trei axe separate, deliberat:
//   - LIMBA utilizatorului dă forma (separatori, numele lunii, 12h/24h);
//   - MONEDA restaurantului dă simbolul (o sumă în lei rămâne în lei pentru un
//     ospătar francez — nu se convertește nimic);
//   - FUSUL restaurantului dă ora (un manager în concediu vede ora LOCALULUI).
// În română ieșirea e BYTE-identică cu helperii de azi (`fmtPrice`,
// `formatTimeInZone`): migrarea unui ecran pe `fmt` nu schimbă nimic vizibil.
import { fmtPrice, resolveMenuCurrency } from '../lib/currency'
import { DEFAULT_RESTAURANT_TZ, formatTimeInZone, safeTimeZone } from '../lib/dates'
import type { StaffLang } from './langs'

const DEFAULT_LOCALE: Record<StaffLang, string> = {
  ro: 'ro-RO',
  en: 'en-GB',
  fr: 'fr-FR',
  de: 'de-DE',
}

/** Eticheta BCP 47 pentru formatare: limba + țara restaurantului când Intl o
 *  cunoaște (en + US → en-US, ora în 12h), altfel varianta europeană. */
export function staffLocale(lang: StaffLang, country?: string | null): string {
  const c = typeof country === 'string' && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null
  if (c) {
    const candidate = `${lang}-${c}`
    try {
      if (Intl.DateTimeFormat.supportedLocalesOf([candidate]).length > 0) return candidate
    } catch {
      /* etichetă respinsă de Intl — varianta implicită */
    }
  }
  return DEFAULT_LOCALE[lang]
}

export interface StaffFormatters {
  /** Suma în moneda restaurantului (cod ISO 4217; necunoscut → RON). */
  money: (amount: number, currency?: string | null) => string
  /** Ora (HH:mm în română) în fusul restaurantului; ISO invalid → ''. */
  time: (iso: string | null | undefined, timeZone?: string | null) => string
  /** Data scurtă în fusul restaurantului; ISO invalid → ''. */
  date: (iso: string | null | undefined, timeZone?: string | null) => string
}

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

export function makeFormatters(lang: StaffLang, country?: string | null): StaffFormatters {
  const locale = staffLocale(lang, country)
  return {
    money: (amount, currency) => {
      const cur = resolveMenuCurrency(currency)
      if (lang === 'ro') return fmtPrice(amount, cur)
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: cur }).format(amount)
      } catch {
        return fmtPrice(amount, cur)
      }
    },
    time: (iso, timeZone) => {
      const tz = safeTimeZone(timeZone ?? DEFAULT_RESTAURANT_TZ)
      if (lang === 'ro') return formatTimeInZone(iso, tz)
      const t = parse(iso)
      if (t === null) return ''
      return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(t)
    },
    date: (iso, timeZone) => {
      const t = parse(iso)
      if (t === null) return ''
      const tz = safeTimeZone(timeZone ?? DEFAULT_RESTAURANT_TZ)
      return new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: tz,
      }).format(t)
    },
  }
}
