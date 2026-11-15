// Helperii puri ai filei Rezervări în limba personalului (lotul L6a),
// lib/reservationsLang.ts. Partea DOM e în
// src/components/__tests__/ReservationsLang.test.tsx (RV0–RV6).
// (Prefixul RV: verificat cu grep în src/, tests/ și supabase/tests, nefolosit
// înainte.)
//   RV7  contoarele în română sunt EXACT ieșirea lui `plural()` de dinainte din
//        ReservationsTab pe n = 0…300 — inclusiv 101/201 („101 de rezervări”),
//        unde regula veche diferă de `Intl.PluralRules('ro')`. Mutațiile care
//        pică: `reservationCountT` care trece româna direct prin `tp` (101 →
//        „101 rezervări”), sau `other: '{n} rezervări în interval'` în ro.
//   RV8  în celelalte limbi contoarele urmează regulile limbii: „1 guest” /
//        „2 guests”, franceza cu „0 réservation” (0 e „one”), germana „1
//        Person”. Mutația care pică: regula veche aplicată și în engleză.
//   RV9  statusurile: în română EXACT etichetele de dinainte (oracolul
//        `RESERVATION_STATUS_LABEL` e verificat și de RV1, pe DOM); în fiecare
//        limbă cele 7 etichete sunt ne-goale și „expirată” ≠ „anulată” ≠
//        „no-show” (decizia D1 din mig 289). Mutația care pică: `status_expired:
//        'Anulată'` în ro sau `'Cancelled'` în en.
//   RV10 data și ora: în română EXACT `toLocaleDateString('ro-RO', …)` /
//        `toLocaleTimeString('ro-RO', …)` de dinainte; în engleză/franceză/
//        germană formatul european al limbii (en-GB/fr-FR/de-DE). Mutația care
//        pică: `'ro-RO'` lăsat fix în helper (engleza ar ieși „joi, 12
//        noiembrie”).
//   RV11 linkul public rămâne ruta /rezervare/:slug (nu se traduce).
import { describe, expect, it } from 'vitest'
import { makeTranslator } from '../../i18n/core'
import type { StaffLang } from '../../i18n/langs'
import resvRo from '../../i18n/ns/reservations/ro'
import resvEn from '../../i18n/ns/reservations/en'
import resvFr from '../../i18n/ns/reservations/fr'
import resvDe from '../../i18n/ns/reservations/de'
import {
  formatReservationDay,
  formatReservationTime,
  legacyRoPluralCategory,
  publicReservationUrl,
  reservationCountT,
  reservationStatusLabelT,
} from '../reservationsLang'

// Copia EXACTĂ a funcției șterse din ReservationsTab (oracolul româniei).
function legacyPlural(n: number, one: string, many: string): string {
  if (n === 1) return `1 ${one}`
  const rem = n % 100
  const needsDe = n !== 0 && !(rem >= 2 && rem <= 19)
  return `${n} ${needsDe ? 'de ' : ''}${many}`
}

const DICTS = { ro: resvRo, en: resvEn, fr: resvFr, de: resvDe } as const
const tr = (lang: StaffLang) => makeTranslator<typeof resvRo>(DICTS[lang], lang)
const STATUSES = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show', 'expired'] as const

describe('contoarele filei Rezervări', () => {
  it('RV7: în română, exact regula veche pe 0…300', () => {
    const ro = tr('ro')
    for (let n = 0; n <= 300; n++) {
      expect(reservationCountT(ro, 'count_inRange', n)).toBe(
        `${legacyPlural(n, 'rezervare', 'rezervări')} în interval`,
      )
      expect(reservationCountT(ro, 'stale_title', n)).toBe(
        `Neconfirmate / expirate: ${legacyPlural(n, 'rezervare', 'rezervări')} din trecut`,
      )
      expect(reservationCountT(ro, 'party', n)).toBe(legacyPlural(n, 'persoană', 'persoane'))
    }
    // Punctele unde regula veche diferă de CLDR rămân pe forma veche.
    expect(reservationCountT(ro, 'count_inRange', 101)).toBe('101 de rezervări în interval')
    expect(new Intl.PluralRules('ro').select(101)).toBe('few')
    expect(legacyRoPluralCategory(101)).toBe('other')
    expect(legacyRoPluralCategory(0)).toBe('few')
    expect(legacyRoPluralCategory(1)).toBe('one')
    expect(legacyRoPluralCategory(20)).toBe('other')
  })

  it('RV8: în celelalte limbi, regulile limbii', () => {
    expect(reservationCountT(tr('en'), 'party', 1)).toBe('1 guest')
    expect(reservationCountT(tr('en'), 'party', 2)).toBe('2 guests')
    expect(reservationCountT(tr('en'), 'count_inRange', 101)).toBe('101 reservations in this period')
    expect(reservationCountT(tr('fr'), 'count_inRange', 0)).toBe('0 réservation sur la période')
    expect(reservationCountT(tr('fr'), 'party', 21)).toBe('21 personnes')
    expect(reservationCountT(tr('de'), 'party', 1)).toBe('1 Person')
    expect(reservationCountT(tr('de'), 'stale_title', 3)).toBe(
      'Unbestätigt / abgelaufen: 3 vergangene Reservierungen',
    )
  })
})

describe('statusurile, data și linkul', () => {
  it('RV9: statusurile în cele patru limbi', () => {
    const ro = tr('ro')
    expect(STATUSES.map((s) => reservationStatusLabelT(ro, s))).toEqual([
      'În așteptare',
      'Confirmată',
      'La masă',
      'Finalizată',
      'Anulată',
      'No-show',
      'Expirată',
    ])
    expect(STATUSES.map((s) => reservationStatusLabelT(tr('en'), s))).toEqual([
      'Pending',
      'Confirmed',
      'Seated',
      'Completed',
      'Cancelled',
      'No-show',
      'Expired',
    ])
    for (const lang of ['ro', 'en', 'fr', 'de'] as const) {
      const labels = STATUSES.map((s) => reservationStatusLabelT(tr(lang), s))
      for (const l of labels) expect(l.trim().length).toBeGreaterThan(0)
      const [expired, cancelled, noShow] = [labels[6], labels[4], labels[5]]
      expect(new Set([expired, cancelled, noShow]).size).toBe(3)
    }
  })

  it('RV10: data și ora — româna de dinainte, celelalte în formatul limbii', () => {
    const iso = '2026-11-12T18:30:00.000Z'
    const opts = { weekday: 'long', day: 'numeric', month: 'long' } as const
    const time = { hour: '2-digit', minute: '2-digit' } as const
    expect(formatReservationDay(iso, 'ro')).toBe(new Date(iso).toLocaleDateString('ro-RO', opts))
    expect(formatReservationTime(iso, 'ro')).toBe(new Date(iso).toLocaleTimeString('ro-RO', time))
    const locales = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE' } as const
    for (const [lang, loc] of Object.entries(locales) as ['en' | 'fr' | 'de', string][]) {
      expect(formatReservationDay(iso, lang)).toBe(new Date(iso).toLocaleDateString(loc, opts))
      expect(formatReservationTime(iso, lang)).toBe(new Date(iso).toLocaleTimeString(loc, time))
    }
    expect(formatReservationDay(iso, 'en')).not.toBe(formatReservationDay(iso, 'ro'))
  })

  it('RV11: linkul public rămâne ruta /rezervare/:slug', () => {
    expect(publicReservationUrl('https://menuvia.netlify.app', 'bistro')).toBe(
      'https://menuvia.netlify.app/rezervare/bistro',
    )
  })
})
