// src/lib/__tests__/guestI18n.test.ts
// Oaspetele străin vede TOT fluxul în limba aleasă (PR 3, Planurile 1–2
// universale). Trei clichete:
//   GI1–GI4  clichet de CLASĂ pe SURSĂ: componentele fluxului oaspetelui nu au
//            text vizibil scris direct (text JSX, aria-label/title/placeholder/
//            alt/label, șiruri românești) în afara unui registru de scutiri CU
//            MOTIV; fiecare scutire trebuie încă găsită (altfel registrul
//            putrezește) și scanerul are control POZITIV pe un eșantion.
//   GK1–GK4  tabela: toate cheile au cele 7 limbi, aceleași substituții `{x}`,
//            și acoperă toți alergenii/etichetele dietetice din constants.
//   GE1–GE9  describeGuestError: hint → cheie, mesaje brute mig 191 → cheie,
//            rețea, fallback — NICIODATĂ textul serverului; contextele plății
//            online (plafon 429 și gate-ul de plan „Featurea…", fără hint).
// ATENȚIE: scanerul ignoră comentariile, dar nu și șirurile — nu scrie aici
// tipare care să arate a text de UI în afara eșantionului de control.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { PUBLIC_MENU_STRINGS, T } from '../publicMenuStrings'
import { GUEST_STRINGS } from '../guestStrings'
import { describeGuestError, guestErrorKey, PAY_TABLE_ERROR_OPTS, SPLIT_BILL_ERROR_OPTS } from '../guestErrors'
import {
  Tf,
  modifierGroupHintT,
  TRANSLATED_ALLERGEN_IDS,
  TRANSLATED_DIETARY_IDS,
  allergenLabel,
  browserGuestLang,
} from '../guestI18n'
import { ALLERGENS, DIETARY_TAGS } from '../constants'
import { GUEST_FILES, scanSource } from './visibleTextScanner'
import { modifierGroupHint, modifierGroupMin } from '../qr'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const LANGS = ['ro', 'en', 'de', 'fr', 'it', 'hu', 'es'] as const

// Fluxul oaspetelui (GUEST_FILES) stă în `visibleTextScanner.ts`: îl folosește
// și clichetul personalului, ca să NU numere de două ori aceleași fișiere.

// Registrul de scutiri: (fișier, text normalizat) + MOTIV. Fără „urmează".
const ALLOWED: ReadonlyArray<{ file: string; text: string; reason: string }> = [
  {
    file: 'src/components/ProductSheet.tsx',
    text: '% Happy Hour',
    reason: 'numele programului, identic în toate limbile (ca happy_hour_active)',
  },
  {
    file: 'src/components/PickupCheckoutSheet.tsx',
    text: '07XX XXX XXX',
    reason: 'formatul numărului de telefon, nu un cuvânt',
  },
  {
    file: 'src/components/ReservationSheet.tsx',
    text: '/rezervare/',
    reason: 'rută URL a linkului de anulare, nu text afișat',
  },
  { file: 'src/components/PaymentConfirmedScreen.tsx', text: 'Menuvia', reason: 'marcă' },
  { file: 'src/components/OrderClosedScreen.tsx', text: 'Menuvia', reason: 'marcă' },
  { file: 'src/pages/ReservePage.tsx', text: 'Menuvia', reason: 'marcă' },
  { file: 'src/pages/PublicMenuPage.tsx', text: 'WiFi', reason: 'termen universal, același în cele 7 limbi' },
  { file: 'src/pages/PublicMenuPage.tsx', text: 'Facebook', reason: 'marcă' },
]

describe('clichet: fluxul oaspetelui nu are text vizibil în afara T()', () => {
  const sources = GUEST_FILES.map((f) => ({ file: f, src: readFileSync(resolve(ROOT, f), 'utf8') }))
  const hits = sources.flatMap((s) => scanSource(s.file, s.src))
  const allowed = new Set(ALLOWED.map((a) => `${a.file}|${a.text}`))

  it('GI1 anti-vacuitate: scanerul chiar citește sursa și vede apelurile T()', () => {
    expect(sources.length).toBe(GUEST_FILES.length)
    const tCalls = sources.reduce((s, x) => s + (x.src.match(/\bTf?\(/g) ?? []).length, 0)
    expect(tCalls).toBeGreaterThan(200)
  })

  it('GI2 niciun text vizibil scris direct în afara scutirilor', () => {
    expect(
      hits.filter((h) => !allowed.has(`${h.file}|${h.text}`)).map((h) => `${h.where} — ${h.text}`),
    ).toEqual([])
  })

  it('GI3 fiecare scutire e încă găsită (registrul nu putrezește)', () => {
    const found = new Set(hits.map((h) => `${h.file}|${h.text}`))
    expect(ALLOWED.filter((a) => !found.has(`${a.file}|${a.text}`)).map((a) => `${a.file}|${a.text}`)).toEqual([])
  })

  it('GI4 control pozitiv: scanerul prinde fiecare formă a clasei, nu și codul', () => {
    const sample = [
      'export function X({ lang }: { lang: string }) {',
      '  // Comentariu cu diacritice: Închide — nu trebuie prins',
      "  const label = cond ? 'Plătește masa' : T(lang, 'pay_table')",
      "  const err = 'Eroare la trimiterea comenzii'",
      '  return (',
      '    <div aria-label="Închide" title={`Adaugă ${name}`}>',
      '      Comanda a fost trimisă',
      '      {count} produse',
      "      <input placeholder=\"Ion Popescu\" onChange={(e) => set(e.target.value)} />",
      "      <span>{T(lang, 'close')}</span>",
      '    </div>',
      '  )',
      '}',
    ].join('\n')
    const texts = scanSource('sample.tsx', sample).map((h) => h.text)
    expect(texts).toEqual([
      'Plătește masa',
      'Eroare la trimiterea comenzii',
      'Închide',
      'Adaugă',
      'Comanda a fost trimisă',
      'produse',
      'Ion Popescu',
    ])
  })

  it('GI5 ecranul de plată nu mai folosește tabela RO/EN din lib/i18n (decizia C4)', () => {
    const src = sources.find((s) => s.file.endsWith('PaymentConfirmedScreen.tsx'))?.src ?? ''
    expect(src.length).toBeGreaterThan(0)
    expect(/from '\.\.\/lib\/i18n'/.test(src)).toBe(false)
  })
})

describe('tabela de texte a oaspetelui', () => {
  const placeholders = (s: string): string =>
    Array.from(s.matchAll(/\{(\w+)\}/g), (m) => m[1])
      .sort()
      .join(',')

  it('GK1 TOATE cheile PUBLIC_MENU_STRINGS au cele 7 limbi, ne-goale', () => {
    const table = PUBLIC_MENU_STRINGS as Record<string, Record<string, string>>
    const bad: string[] = []
    for (const [k, v] of Object.entries(table))
      for (const l of LANGS) if (typeof v[l] !== 'string' || v[l].trim() === '') bad.push(`${k}.${l}`)
    expect(bad).toEqual([])
    expect(Object.keys(table).length).toBeGreaterThan(300)
  })

  it('GK2 substituțiile {x} sunt identice în toate limbile (Tf nu lasă „{name}" în UI)', () => {
    const table = PUBLIC_MENU_STRINGS as Record<string, Record<string, string>>
    const bad: string[] = []
    for (const [k, v] of Object.entries(table))
      for (const l of LANGS) if (placeholders(v[l]) !== placeholders(v.ro)) bad.push(`${k}.${l}`)
    expect(bad).toEqual([])
    expect(Tf('de', 'add_named', { name: 'Ciorbă' })).toBe('Ciorbă hinzufügen')
  })

  it('GK3 tabela oaspetelui chiar a intrat în PUBLIC_MENU_STRINGS (spread-ul)', () => {
    for (const k of Object.keys(GUEST_STRINGS)) expect(k in PUBLIC_MENU_STRINGS).toBe(true)
    expect(T('fr', 'qc_send_order')).toBe('Envoyer la commande')
  })

  it('GK4 toți alergenii și toate etichetele dietetice din constants au traducere', () => {
    expect(ALLERGENS.map((a) => a.id).filter((id) => !TRANSLATED_ALLERGEN_IDS.includes(id))).toEqual([])
    expect(DIETARY_TAGS.map((d) => d.id).filter((id) => !TRANSLATED_DIETARY_IDS.includes(id))).toEqual([])
    expect(allergenLabel('en', 'telina', 'Țelină')).toBe('Celery')
    // Id necunoscut → eticheta din constants (nu dispare din fișă).
    expect(allergenLabel('en', 'nou_alergen', 'Etichetă')).toBe('Etichetă')
  })

  it('GK5 microcopy-ul grupurilor de opțiuni e oglinda exactă a lui modifierGroupHint pe RO', () => {
    const groups = [
      { selection_type: 'multiple', is_required: true, min_select: 2, max_select: 2 },
      { selection_type: 'multiple', is_required: false, min_select: 1, max_select: 3 },
      { selection_type: 'multiple', is_required: true, min_select: 0, max_select: null },
      { selection_type: 'multiple', is_required: false, min_select: 0, max_select: 4 },
      { selection_type: 'multiple', is_required: false, min_select: 0, max_select: null },
      { selection_type: 'single', is_required: true, min_select: 1, max_select: 1 },
    ] as const
    for (const g of groups) {
      const shaped = { ...g, max_select: g.max_select as number | null }
      expect(modifierGroupHintT('ro', shaped, modifierGroupMin(shaped))).toBe(modifierGroupHint(shaped))
    }
  })

  it('GK6 limba browserului: una din cele 7, altfel EN', () => {
    const nav = Object.getOwnPropertyDescriptor(window.navigator, 'language')
    try {
      Object.defineProperty(window.navigator, 'language', { value: 'hu-HU', configurable: true })
      expect(browserGuestLang()).toBe('hu')
      Object.defineProperty(window.navigator, 'language', { value: 'pl-PL', configurable: true })
      expect(browserGuestLang()).toBe('en')
    } finally {
      if (nav) Object.defineProperty(window.navigator, 'language', nav)
      else Reflect.deleteProperty(window.navigator, 'language')
    }
  })
})

describe('describeGuestError — niciodată text brut de server', () => {
  const values = (lang: (typeof LANGS)[number]): Set<string> =>
    new Set(Object.values(PUBLIC_MENU_STRINGS as Record<string, Record<string, string>>).map((v) => v[lang]))

  it('GE1 hint-urile create_order (mig 191) → cheia lor, în limba cerută', () => {
    // Mesaj NEUTRU: hint-ul singur trebuie să decidă (altfel tiparul pe mesaj
    // din GE2 ar masca un hint scos din hartă).
    const e = Object.assign(new Error('P0001'), { hint: 'product_inactive' })
    expect(guestErrorKey(e)).toBe('err_product_unavailable')
    expect(describeGuestError('it', e)).toBe(T('it', 'err_product_unavailable'))
    expect(guestErrorKey({ hint: 'missing_required_group' })).toBe('err_missing_required_group')
    expect(guestErrorKey({ hint: 'table_unavailable' })).toBe('err_table_unavailable')
    expect(guestErrorKey({ hint: 'pickup_rate_limit' })).toBe('err_rate_limit_order')
    expect(guestErrorKey({ hint: 'session_required' })).toBe('err_session_closed')
    expect(guestErrorKey({ hint: 'overpayment' })).toBe('err_amount_mismatch')
    expect(guestErrorKey({ hint: 'module_disabled' })).toBe('err_module_disabled')
    expect(guestErrorKey({ hint: 'invalid_code' })).toBe('err_invalid_code')
  })

  it('GE2 mesajele BRUTE fără hint (servere/căi vechi) → cheie, nu text', () => {
    expect(guestErrorKey(new Error('Product "Ciorbă" is not available'))).toBe('err_product_unavailable')
    expect(guestErrorKey(new Error('Invalid quantity: 25 (must be 1-20)'))).toBe('err_invalid_quantity')
    expect(
      guestErrorKey(new Error('Masa a fost închisă sau sesiunea a expirat. Scanează din nou QR-ul ca să începi o comandă nouă.')),
    ).toBe('err_session_closed')
    expect(guestErrorKey(new Error('Restaurantul nu acceptă rezervări în această zi'))).toBe(
      'err_reservation_day_closed',
    )
  })

  it('GE3 eroarea de rețea are cheia ei (configurabilă per context)', () => {
    expect(guestErrorKey(new TypeError('Failed to fetch'))).toBe('err_network')
    expect(guestErrorKey(new Error('Failed to fetch'), { network: 'err_order_not_sent_network' })).toBe(
      'err_order_not_sent_network',
    )
  })

  it('GE4 necunoscut → fallback-ul contextului, NU mesajul serverului', () => {
    const raw = 'column "x" of relation "orders" does not exist'
    const out = describeGuestError('de', new Error(raw), { fallback: 'err_order_not_sent' })
    expect(out).toBe(T('de', 'err_order_not_sent'))
    expect(out.includes('orders')).toBe(false)
  })

  it('GE5 overrides per context (rezervări: modul oprit / plafon au textul lor)', () => {
    const opts = {
      overrides: { err_module_disabled: 'err_reservations_off', err_rate_limit_order: 'err_rate_limit_reservation' },
    } as const
    expect(guestErrorKey({ hint: 'module_disabled' }, opts)).toBe('err_reservations_off')
    expect(guestErrorKey(new Error('rate limit exceeded'), opts)).toBe('err_rate_limit_reservation')
  })

  it('GE6 proprietate: pentru orice intrare, ieșirea e un text din tabelă, în limba cerută', () => {
    const inputs: unknown[] = [
      null,
      undefined,
      42,
      'string brut',
      {},
      { message: 'internal error 0xDEAD' },
      { hint: 'necunoscut', message: 'Ceva intern' },
      new Error(''),
      Object.assign(new Error('x'), { code: '23505' }),
    ]
    for (const l of LANGS) {
      const allowed = values(l)
      for (const inp of inputs) expect(allowed.has(describeGuestError(l, inp))).toBe(true)
    }
  })

  it('GE7 limbă nesuportată → EN (aceeași regulă ca T)', () => {
    expect(describeGuestError('pl', { hint: 'no_items' })).toBe(T('en', 'err_no_items'))
  })

  // Forma EXACTĂ pe care o aruncă lib/payments.ts din răspunsul table-payment.js:
  // Error(body.error) cu `hint` = body.hint ?? undefined.
  const paymentError = (message: string, hint?: string): Error & { hint?: string } =>
    Object.assign(new Error(message), { hint })

  it('GE8 plafonul de încercări al plății (429, fără hint) NU spune „prea multe comenzi"', () => {
    const e = paymentError('Prea multe încercări. Reîncearcă în câteva minute.')
    // Control pozitiv: fără contextul plății, tiparul generic dă cheia comenzii.
    expect(guestErrorKey(e)).toBe('err_rate_limit_order')
    expect(guestErrorKey(e, PAY_TABLE_ERROR_OPTS)).toBe('err_rate_limit_payment')
    expect(guestErrorKey(e, SPLIT_BILL_ERROR_OPTS)).toBe('err_rate_limit_payment')
    expect(describeGuestError('en', e, PAY_TABLE_ERROR_OPTS)).toBe(T('en', 'err_rate_limit_payment'))
    expect(T('en', 'err_rate_limit_payment') === T('en', 'err_rate_limit_order')).toBe(false)
  })

  it('GE9 gate-ul de plan („Featurea…", hint null) → funcție indisponibilă, nu eroare generică', () => {
    const e = paymentError(
      'Featurea online_payments nu e disponibilă pe planul curent (growth). Upgrade la Growth sau mai sus.',
    )
    expect(guestErrorKey(e)).toBe('err_feature_disabled')
    expect(guestErrorKey(e, PAY_TABLE_ERROR_OPTS)).toBe('err_online_pay_off')
    expect(guestErrorKey(e, SPLIT_BILL_ERROR_OPTS)).toBe('err_split_off')
    expect(describeGuestError('de', e, SPLIT_BILL_ERROR_OPTS)).toBe(T('de', 'err_split_off'))
    // Ancorat la început: „Featurea" în mijlocul unui mesaj nu e gate-ul de plan.
    expect(guestErrorKey(new Error('eroare internă: Featurea'), PAY_TABLE_ERROR_OPTS)).toBe('err_payment_failed')
  })
})
