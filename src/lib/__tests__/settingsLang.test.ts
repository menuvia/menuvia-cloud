// Fila Setări în limba personalului (lotul L6b) — partea PURĂ, rulabilă fără
// DOM. Ecranul randat e în src/components/__tests__/SettingsLang.test.tsx
// (TW0–TW7). (Prefixul TW: verificat cu grep în src/, tests/, e2e/,
// supabase/tests și docs, nefolosit înainte.)
//   TW8  textele despre ridicare (`pickupSettingsCopyT`): în română EXACT
//        `pickupCardDescription` / `pickupOnlyToggleDescription` (oracolul din
//        lib/pickupCopy, pe toate stările feature × flipbook, cu ACEEAȘI formă
//        `{lead, tail}`); en/fr/de fără litere românești și fără `{x}`
//        rămase, cu motivul flipbook EXACT pe feature = true + Flipbook, iar
//        calea din motiv = titlul secțiunii „Așezarea produselor” în fiecare
//        limbă (aliniat și cu `tables`). Mutația care pică: `pk_activeTail`
//        fără spațiul de la început în ro, sau `pk_flipbookTail` fără `{why}`.
//   TW9  zilele: în română EXACT `WEEK_DAY_LABELS` de dinainte; en/fr/de au
//        șapte nume distincte, niciunul românesc. Mutația care pică:
//        `day_tue: 'Marti'` (fără diacritică) în ro.
//   TW10 etichetele cu oracol în altă sursă: în română EXACT `labelRo`
//        (AMENITIES), `name`/`description` (THEMES), `name` (ACCENT_SWATCHES);
//        fiecare id cunoscut are cheie; un id NOU cade pe eticheta sursei, nu
//        pe numele cheii. Mutația care pică: o temă nouă în THEMES fără cheie
//        (eticheta ar rămâne românească pe un ecran englezesc).
//   TW11 pluralele: în română textele de dinainte pe n = 0…200 (inclusiv
//        pluralul fals „încarc doar primele 1”); en/fr/de acordă la singular;
//        franceza pune „de” pe `many`. Mutația care pică: `fb_added.other` cu
//        „de pagini” în ro.
//   TW12 țările: în română și engleză EXACT numele din `COUNTRIES` (lista de
//        dinainte); în franceză/germană numele CLDR, iar un cod necunoscut
//        cade pe numele primit. Mutația care pică: `countryLabel` care trece
//        și româna prin `Intl.DisplayNames` („Germania” în loc de „Germany”).
//   TW13 precondiția L4b/L4c, ca clichet STRUCTURAL: SettingsTab cere SUS,
//        înaintea primului `return`, `settings` + `settingsCards` + `common` +
//        `translations` + `home` (al SubscriptionCard, montat doar pe
//        „Abonament & cont”) și niciun alt namespace; fila rămâne `lazy` în
//        DashboardPage; lib/pickupCopy și lib/settingsLang iau din `settings`
//        doar TIPUL; mesajul implicit al sugestiilor la coș (o DATĂ salvată,
//        văzută de oaspete) rămâne cel de dinainte și e scris prin constantă;
//        `toUserMessage` nu mai e chemat direct (doar prin
//        `describeStaffError`). Mutația care pică: `useT(settingsCardsNs)`
//        scos din SettingsTab, sau `message: st.t('sugg_msgPh')` la pornire.
//   TW14 DATELE implicite văzute de oaspete (mesajul sugestiilor la coș,
//        recompensa fidelizării) urmează limba de BAZĂ a meniului, nu a
//        personalului: româna EXACT textul de dinainte, cele 7 limbi ale
//        meniului au textul lor, o limbă necunoscută cade pe română, iar
//        LoyaltySettingsCard pornește din `loyaltyDefaultReward(baseLang)`.
//        Mutația care pică: tabelul cu româna pe toate limbile.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { makeTranslator } from '../../i18n/core'
import settingsRo from '../../i18n/ns/settings/ro'
import settingsEn from '../../i18n/ns/settings/en'
import settingsFr from '../../i18n/ns/settings/fr'
import settingsDe from '../../i18n/ns/settings/de'
import tablesEn from '../../i18n/ns/tables/en'
import tablesFr from '../../i18n/ns/tables/fr'
import tablesDe from '../../i18n/ns/tables/de'
import tablesRo from '../../i18n/ns/tables/ro'
import { pickupCardDescription, pickupOnlyToggleDescription, pickupSettingsCopyT } from '../pickupCopy'
import {
  ACCENT_KEYS,
  AMENITY_KEYS,
  CHECKOUT_SUGGESTION_DEFAULT_MESSAGE,
  LOYALTY_DEFAULT_REWARD,
  THEME_KEYS,
  WEEK_DAY_KEYS,
  WEEK_DAY_LABELS,
  accentName,
  amenityLabel,
  checkoutSuggestionDefaultMessage,
  countryLabel,
  loyaltyDefaultReward,
  themeDescription,
  themeName,
  weekDayLabel,
} from '../settingsLang'
import { AMENITIES } from '../constants'
import { THEMES } from '../themes'
import { ACCENT_SWATCHES } from '../accentPalette'
import { COUNTRIES } from '../countries'
import { MENU_LANGS } from '../i18nMenu'

const STATES = [true, false, null] as const
const FLIPBOOK = [true, false] as const
const RO_LETTERS = /[ăĂâÂîÎșȘțȚşŞţŢ]/
const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')
const TARGETS = [
  ['en', settingsEn, tablesEn],
  ['fr', settingsFr, tablesFr],
  ['de', settingsDe, tablesDe],
] as const

describe('textele despre ridicare din Setări', () => {
  it('TW8: româna = oracolul din pickupCopy; en/fr/de fără resturi', () => {
    const ro = pickupSettingsCopyT(makeTranslator(settingsRo, 'ro'))
    for (const f of STATES) {
      expect(ro.pickupOnlyToggleDescription(f)).toBe(pickupOnlyToggleDescription(f))
      for (const fb of FLIPBOOK) expect(ro.pickupCardDescription(f, fb)).toEqual(pickupCardDescription(f, fb))
    }
    // Motivul flipbook are aceeași formulare în Setări și în Mese (o frază, două ecrane).
    expect(settingsRo.pk_flipbookNoOrders).toBe(tablesRo.pk_flipbookNoOrders)
    for (const [lang, d, tables] of TARGETS) {
      const tr = makeTranslator(d, lang)
      const copy = pickupSettingsCopyT(tr)
      const why = tr.t('pk_flipbookNoOrders')
      expect(why, lang).toBe(tables.pk_flipbookNoOrders)
      // Calea din motiv se termină cu titlul secțiunii din această filă.
      expect(why.trimEnd().replace(/\.$/, '').endsWith(d.layout_title), lang).toBe(true)
      for (const f of STATES) {
        const desc = copy.pickupOnlyToggleDescription(f)
        expect(desc, `${lang} ${String(f)}`).not.toMatch(RO_LETTERS)
        for (const fb of FLIPBOOK) {
          const ctx = `${lang} feature=${String(f)} flipbook=${fb}`
          const { lead, tail } = copy.pickupCardDescription(f, fb)
          const text = `${lead} /m/x${tail}`
          expect(text, ctx).not.toMatch(RO_LETTERS)
          expect(text, ctx).not.toMatch(/\{\w+\}/)
          expect(text.includes(why), ctx).toBe(f === true && fb)
          expect(text.includes(d.pk_activeTail), ctx).toBe(f === true && !fb)
        }
      }
    }
  })
})

describe('zilele programului', () => {
  it('TW9: româna = WEEK_DAY_LABELS; en/fr/de distincte, fără română', () => {
    const ro = makeTranslator(settingsRo, 'ro')
    expect(WEEK_DAY_KEYS).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
    for (const day of WEEK_DAY_KEYS) expect(weekDayLabel(day, ro)).toBe(WEEK_DAY_LABELS[day])
    expect(Object.values(WEEK_DAY_LABELS)).toEqual(['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'])
    for (const [lang, d] of TARGETS) {
      const tr = makeTranslator(d, lang)
      const names = WEEK_DAY_KEYS.map((day) => weekDayLabel(day, tr))
      expect(new Set(names).size, lang).toBe(7)
      for (const n of names) {
        expect(n, lang).not.toMatch(RO_LETTERS)
        expect(Object.values(WEEK_DAY_LABELS), lang).not.toContain(n)
      }
    }
    expect(WEEK_DAY_KEYS.map((day) => weekDayLabel(day, makeTranslator(settingsEn, 'en')))[0]).toBe('Monday')
  })
})

describe('etichetele cu oracol în altă sursă', () => {
  it('TW10: facilitățile, temele și mostrele de accent', () => {
    const ro = makeTranslator(settingsRo, 'ro')
    // Fiecare id cunoscut are cheie (anti-vacuitate: listele nu sunt goale).
    expect(AMENITIES.length).toBeGreaterThan(5)
    expect(THEMES.length).toBeGreaterThan(5)
    expect(ACCENT_SWATCHES.length).toBeGreaterThan(5)
    expect(Object.keys(AMENITY_KEYS).sort()).toEqual(AMENITIES.map((a) => a.id).sort())
    expect(Object.keys(THEME_KEYS).sort()).toEqual(THEMES.map((t) => t.id).sort())
    expect(Object.keys(ACCENT_KEYS).sort()).toEqual(ACCENT_SWATCHES.map((s) => s.hex.slice(1).toUpperCase()).sort())
    for (const a of AMENITIES) expect(amenityLabel(a, ro)).toBe(a.labelRo)
    for (const t of THEMES) {
      expect(themeName(t, ro)).toBe(t.name)
      expect(themeDescription(t, ro)).toBe(t.description)
    }
    for (const s of ACCENT_SWATCHES) expect(accentName(s, ro)).toBe(s.name)
    // Un id NOU fără cheie: eticheta sursei, nu numele cheii.
    const en = makeTranslator(settingsEn, 'en')
    expect(amenityLabel({ id: 'rooftop', labelRo: 'Rooftop' }, en)).toBe('Rooftop')
    expect(themeName({ id: 'nou', name: 'Temă nouă' }, en)).toBe('Temă nouă')
    expect(themeDescription({ id: 'nou', description: 'Descriere' }, en)).toBe('Descriere')
    expect(accentName({ hex: '#000000', name: 'Negru' }, en)).toBe('Negru')
    // În celelalte limbi: textul limbii, fără litere românești.
    for (const [lang, d] of TARGETS) {
      const tr = makeTranslator(d, lang)
      const out = [
        ...AMENITIES.map((a) => amenityLabel(a, tr)),
        ...THEMES.flatMap((t) => [themeName(t, tr), themeDescription(t, tr)]),
        ...ACCENT_SWATCHES.map((s) => accentName(s, tr)),
      ]
      for (const x of out) expect(x, lang).not.toMatch(RO_LETTERS)
    }
    expect(accentName({ hex: '#c8963c', name: 'Auriu' }, makeTranslator(settingsDe, 'de'))).toBe('Gold')
    expect(amenityLabel({ id: 'outdoor_seating', labelRo: 'Terasă' }, makeTranslator(settingsFr, 'fr'))).toBe('Terrasse')
  })
})

describe('pluralele', () => {
  it('TW11: română = textele de dinainte; en/fr/de acordă', () => {
    const ro = makeTranslator(settingsRo, 'ro')
    for (let n = 0; n <= 200; n++) {
      expect(ro.tp('fb_added', n)).toBe(`${n} ${n === 1 ? 'pagină adăugată' : 'pagini adăugate'} — nu uita să salvezi`)
      expect(ro.tp('fb_partial', n, { max: 30 })).toBe(`Maxim 30 pagini — încarc doar primele ${n}`)
    }
    expect(ro.t('fb_full', { max: 30 })).toBe('Maxim 30 pagini — șterge una ca să adaugi alta')
    for (const [lang, d] of TARGETS) {
      const tr = makeTranslator(d, lang)
      for (const k of ['fb_added', 'fb_partial'] as const) {
        const one = tr.tp(k, 1, { max: 30 })
        const two = tr.tp(k, 2, { max: 30 })
        expect(one, `${lang}.${k}`).not.toBe(two.replace('2', '1'))
        expect(two, `${lang}.${k}`).toContain('2')
        expect(one + two, `${lang}.${k}`).not.toMatch(/\{\w+\}/)
      }
    }
    expect(makeTranslator(settingsFr, 'fr').tp('fb_added', 1000000)).toMatch(/^1000000 de pages/)
  })
})

describe('țările', () => {
  it('TW12: ro/en = COUNTRIES; fr/de = numele limbii; necunoscut = numele primit', () => {
    for (const c of COUNTRIES) {
      expect(countryLabel(c.code, c.name, 'ro')).toBe(c.name)
      expect(countryLabel(c.code, c.name, 'en')).toBe(c.name)
      for (const lang of ['fr', 'de'] as const) expect(countryLabel(c.code, c.name, lang).length).toBeGreaterThan(1)
    }
    expect(countryLabel('DE', 'Germany', 'fr')).toBe('Allemagne')
    expect(countryLabel('DE', 'Germany', 'de')).toBe('Deutschland')
    expect(countryLabel('HU', 'Hungary', 'de')).toBe('Ungarn')
    // Cod pe care CLDR nu-l cunoaște → numele primit (nu codul).
    expect(countryLabel('QZ', 'Somewhere', 'fr')).toBe('Somewhere')
  })
})

describe('precondiția L4b/L4c (Setări)', () => {
  const SRC = 'src/components/SettingsTab.tsx'
  const nsUsed = (src: string) => new Set([...src.matchAll(/useT\((\w+Ns)\)/g)].map((m) => m[1]))

  it('TW13: SettingsTab cere SUS cele cinci namespace-uri; graful static rămâne curat', () => {
    const src = read(SRC)
    const s = src.indexOf('export default function SettingsTab(')
    expect(s).toBeGreaterThan(0)
    const m = /^[ \t]*return\b/m.exec(src.slice(s))
    expect(m).not.toBeNull()
    const top = nsUsed(src.slice(s, s + (m?.index ?? 0)))
    // Control pozitiv: scanerul vede cererile de sus.
    expect([...top].sort()).toEqual(['commonNs', 'homeNs', 'settingsCardsNs', 'settingsNs', 'translationsNs'])
    expect([...nsUsed(src)].sort()).toEqual(['commonNs', 'homeNs', 'settingsCardsNs', 'settingsNs', 'translationsNs'])
    expect([...src.matchAll(/from '\.\.\/i18n\/ns\/(\w+)'/g)].map((x) => x[1]).sort()).toEqual([
      'common',
      'home',
      'settings',
      'settingsCards',
      'translations',
    ])
    // `home` e cerut pentru SubscriptionCard (montat doar pe „Abonament & cont”).
    expect(read('src/components/_dashboard/SubscriptionCard.tsx')).toContain('useT(homeNs)')
    expect(read('src/pages/DashboardPage.tsx')).toContain("lazy(() => import('../components/SettingsTab'))")
    for (const f of ['src/lib/pickupCopy.ts', 'src/lib/settingsLang.ts']) {
      const lib = read(f)
      expect(lib, f).toContain("import type settingsRo from '../i18n/ns/settings/ro'")
      expect(lib, f).not.toMatch(/^import (?!type)[^\n]*i18n\/ns\//m)
    }
    // Mesajul IMPLICIT salvat la pornirea sugestiilor e o dată a meniului: în
    // limba de BAZĂ a meniului (româna = textul de dinainte), nu a personalului.
    expect(CHECKOUT_SUGGESTION_DEFAULT_MESSAGE).toBe('🍰 Înainte să trimiți... ai vrea ceva în plus?')
    expect(src).toContain('message: checkoutSuggestionDefaultMessage(menuBaseLang(form.language)),')
    expect(src).not.toMatch(/message: st\.t\(/)
    // Erorile trec doar prin describeStaffError (în română = toUserMessage).
    expect(src).not.toMatch(/\btoUserMessage\(/)
    expect(src).toContain('describeStaffError(')
  })
})

describe('TW14 datele implicite văzute de oaspete', () => {
  it('TW14 urmează limba de bază a meniului; româna e textul de dinainte', () => {
    expect(checkoutSuggestionDefaultMessage('ro')).toBe('🍰 Înainte să trimiți... ai vrea ceva în plus?')
    expect(loyaltyDefaultReward('ro')).toBe('Un desert din partea casei')
    expect(LOYALTY_DEFAULT_REWARD).toBe('Un desert din partea casei')
    const ROMANIAN = /[ăâîșțĂÂÎȘȚ]|\b(desert|casei|trimiți|plus)\b/
    const seenMsg = new Set<string>()
    const seenReward = new Set<string>()
    for (const { code } of MENU_LANGS) {
      const msg = checkoutSuggestionDefaultMessage(code)
      const reward = loyaltyDefaultReward(code)
      expect(msg.startsWith('🍰 '), code).toBe(true)
      seenMsg.add(msg)
      seenReward.add(reward)
      if (code !== 'ro') {
        expect(msg, code).not.toMatch(ROMANIAN)
        expect(reward, code).not.toMatch(ROMANIAN)
      }
    }
    // Fiecare limbă a meniului are textul EI (nu româna copiată).
    expect(seenMsg.size).toBe(MENU_LANGS.length)
    expect(seenReward.size).toBe(MENU_LANGS.length)
    // Necunoscută → română.
    expect(checkoutSuggestionDefaultMessage('xx')).toBe(CHECKOUT_SUGGESTION_DEFAULT_MESSAGE)
    expect(loyaltyDefaultReward('')).toBe(LOYALTY_DEFAULT_REWARD)
    // Cardul pornește din limba de bază primită de la SettingsTab.
    expect(read('src/components/LoyaltySettingsCard.tsx')).toContain('useState<string>(() => loyaltyDefaultReward(baseLang))')
    expect(read('src/components/SettingsTab.tsx')).toContain('baseLang={menuBaseLang(form.language)}')
  })
})
