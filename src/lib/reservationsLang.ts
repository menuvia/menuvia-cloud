// src/lib/reservationsLang.ts — textele fila Rezervări care NU stau direct în
// componentă (lotul L6a): eticheta statusului, contoarele cu regula de plural
// românească de dinainte, data și ora unei rezervări, adresa linkului public.
// Pur: primește traducătorul ca parametru și importă doar TIPUL namespace-ului
// (dicționarele rămân în chunk-ul leneș al filei).
import type { PluralKey, Translator } from '../i18n/core'
import { staffLocale } from '../i18n/format'
import type { StaffLang } from '../i18n/langs'
import type reservationsRo from '../i18n/ns/reservations/ro'
import type { ReservationStatus } from '../hooks/useReservations'

type ResvT = Translator<typeof reservationsRo>

// Statusurile (mig 289 include `expired`) sunt DATE în DB; aici se alege doar eticheta.
const STATUS_KEY = {
  pending: 'status_pending',
  confirmed: 'status_confirmed',
  seated: 'status_seated',
  completed: 'status_completed',
  cancelled: 'status_cancelled',
  no_show: 'status_no_show',
  expired: 'status_expired',
} as const satisfies Record<ReservationStatus, keyof typeof reservationsRo>

/** Eticheta statusului în limba personalului. În română EXACT
 *  `RESERVATION_STATUS_LABEL` (lib/reservations.ts, oracolul testelor). */
export function reservationStatusLabelT(tr: ResvT, status: ReservationStatus): string {
  return tr.t(STATUS_KEY[status])
}

/**
 * Categoria de plural a lui `plural()` de dinainte din ReservationsTab:
 * „1 rezervare”, „2 rezervări”, „21 de rezervări” — „de” când restul la 100 e
 * în afara 2–19 (și n ≠ 0). Diferă de `Intl.PluralRules('ro')` la 101, 201…
 * (CLDR: „few”, regula veche: „de”), deci în română categoria NU vine din `Intl`.
 */
export function legacyRoPluralCategory(n: number): 'one' | 'few' | 'other' {
  if (n === 1) return 'one'
  const rem = n % 100
  return n !== 0 && !(rem >= 2 && rem <= 19) ? 'other' : 'few'
}

// Un reprezentant al fiecărei categorii pentru `Intl.PluralRules('ro')`:
// `tp` alege forma după el, iar `{n}` primește numărul real.
const RO_REPRESENTATIVE = { one: 1, few: 2, other: 20 } as const

/** Contorul unei chei plurale a filei: în română cu regula veche (byte-identic),
 *  în celelalte limbi cu regulile limbii (`tp`). */
export function reservationCountT(tr: ResvT, key: PluralKey<typeof reservationsRo>, n: number): string {
  if (tr.lang !== 'ro') return tr.tp(key, n)
  return tr.tp(key, RO_REPRESENTATIVE[legacyRoPluralCategory(n)], { n: String(n) })
}

/** Antetul zilei („joi, 12 noiembrie” în română) — formatul de dinainte, în
 *  limba personalului; fusul rămâne al dispozitivului, ca înainte (G2). */
export function formatReservationDay(iso: string, lang: StaffLang): string {
  return new Date(iso).toLocaleDateString(staffLocale(lang), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/** Ora rezervării (HH:mm), în formatul limbii personalului; fusul
 *  dispozitivului, ca înainte. */
export function formatReservationTime(iso: string, lang: StaffLang): string {
  return new Date(iso).toLocaleTimeString(staffLocale(lang), {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Linkul public de rezervare (/rezervare/:slug) — o RUTĂ, nu text. */
export function publicReservationUrl(origin: string, slug: string): string {
  return `${origin}/rezervare/${slug}`
}
