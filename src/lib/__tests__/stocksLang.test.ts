// Fila Stocuri în limba personalului (lotul L5b) — partea PURĂ: unitățile
// (`formatStockT`/`unitSymbolT`/`unitLabelT` din lib/stocks.ts), eticheta cotei
// TVA și refuzurile serverului (`vatGroupLabel`/`describeStockError`/
// `stockFormErrorText` din lib/stockMessages.ts), pluralele false românești și
// clichetul structural al precondiției L4b/L4c. Randarea e în
// src/components/__tests__/StocksLang.test.tsx (KS0–KS8).
// (Prefixul KS: alocat lotului, verificat cu grep în src/, tests/ și
// supabase/tests, nefolosit înainte.)
//   KS9  româna e IDENTICĂ: `formatStockT` == `formatStock` pe toate unitățile
//        și pe o grilă de cantități (conversia g→kg, ml→L, zecimale),
//        `unitSymbolT` == codul, `unitLabelT` == `unitLabel`; un cod din afara
//        enum-ului apare ca atare în orice limbă. Mutația care pică: `unit_buc:
//        'bucăți'` în ro.ts, sau `formatStockT` fără conversia la kg.
//   KS10 en/fr/de: „buc”/„pachet” traduse (pcs/pk, pce/paq., Stk./Pck.),
//        simbolurile SI neatinse, conversia păstrată, numele lungi fără cuvinte
//        românești — și ACELEAȘI simboluri ca în namespace-ul `products` (rețeta
//        din fișa produsului), în fiecare limbă. Mutația care pică: `unit_buc:
//        'buc'` lăsat în en.ts, sau un simbol diferit între cele două namespace-uri.
//   KS11 `vatGroupLabel`: în română EXACT `getVatLabel` (lib/vat.ts — oracolul,
//        neatins), pe grupe găsite și negăsite; rezerva tradusă în en/fr/de,
//        iar eticheta din `vat_rates` rămâne DATĂ. Mutația care pică: „Grupa
//        {n}” lăsat în en.ts.
//   KS12 refuzurile: în română `describeStockError` == `toUserMessage(err)` pe
//        toate formele (inclusiv cu hint — hint-urile NU se aplică în română);
//        în en/fr/de hint-urile mig 066 au textul limbii, mesajul ROMÂNESC al
//        serverului NU trece, rețeaua are textul din `common`. Erorile de fișă
//        (DATE) dau în română EXACT literalii de dinainte. Mutația care pică:
//        hint-urile aplicate și în română, sau `toUserMessage` readus.
//   KS13 pluralele false românești, pe 0…200, EXACT textele de dinainte („1
//        furnizori”, „1 NIR-uri totale”, „Termen plată: 1 zile”, ternarul „1
//        ingredient sub prag” / „2 ingrediente sub prag”); în en/fr/de formele
//        reale. Mutația care pică: `one: '{n} furnizor'` în ro.ts.
//   KS14 precondiția L4b/L4c, STRUCTURAL: StocksTab cere `stocksNs` ȘI
//        `commonNs` SUS, înaintea primului `return`, fiecare componentă din
//        fișier care afișează text își cere namespace-ul înaintea primului ei
//        `return`, și niciuna nu cere alt namespace (altfel, într-o limbă nouă,
//        prima deschidere a unei fișe ar suspenda fila); tab-ul e LENEȘ în
//        DashboardPage. Nota implicită a ajustării rămâne DATA românească de
//        dinainte. Mutația care pică: `useT(commonNs)` scos din StocksTab.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi } from 'vitest'

// lib/stocks.ts importă clientul Supabase; testul nu-l folosește.
vi.mock('../supabase', () => ({ supabase: {} }))

import { MANUAL_ADJUST_NOTE, formatStock, formatStockT, unitLabel, unitLabelT, unitSymbolT } from '../stocks'
import type { IngredientUnit } from '../stocks'
import { describeStockError, stockErrorHints, stockFormErrorText, vatGroupLabel } from '../stockMessages'
import { getVatLabel, type VatRate } from '../vat'
import { toUserMessage } from '../userMessages'
import { makeTranslator, type Dict } from '../../i18n/core'
import stocksRo from '../../i18n/ns/stocks/ro'
import stocksEn from '../../i18n/ns/stocks/en'
import stocksFr from '../../i18n/ns/stocks/fr'
import stocksDe from '../../i18n/ns/stocks/de'
import productsRo from '../../i18n/ns/products/ro'
import productsEn from '../../i18n/ns/products/en'
import productsFr from '../../i18n/ns/products/fr'
import productsDe from '../../i18n/ns/products/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'

const UNITS: IngredientUnit[] = ['g', 'kg', 'ml', 'l', 'buc', 'pachet']
const AMOUNTS = [0, 0.5, 1, 1.25, 2.5, 3, 10, 99.99, 100, 999, 999.99, 1000, 1500, 2750, 3333, 10000, 50000, 100000]

const ro = makeTranslator(stocksRo, 'ro')
const roC = makeTranslator(commonRo, 'ro')
const LANGS = [
  {
    lang: 'en' as const,
    s: makeTranslator(stocksEn, 'en'),
    c: makeTranslator(commonEn, 'en'),
    p: productsEn as Dict,
    sym: { buc: 'pcs', pachet: 'pk' },
  },
  {
    lang: 'fr' as const,
    s: makeTranslator(stocksFr, 'fr'),
    c: makeTranslator(commonFr, 'fr'),
    p: productsFr as Dict,
    sym: { buc: 'pce', pachet: 'paq.' },
  },
  {
    lang: 'de' as const,
    s: makeTranslator(stocksDe, 'de'),
    c: makeTranslator(commonDe, 'de'),
    p: productsDe as Dict,
    sym: { buc: 'Stk.', pachet: 'Pck.' },
  },
]

const RATES: VatRate[] = [
  { restaurant_id: 'r', vat_group: 1, rate_percent: 11, label: 'Mâncare', description: null, is_active: true, updated_at: '' },
  { restaurant_id: 'r', vat_group: 2, rate_percent: 21, label: 'Alcool', description: null, is_active: true, updated_at: '' },
  { restaurant_id: 'r', vat_group: 4, rate_percent: 0, label: 'Neimpozabil', description: null, is_active: false, updated_at: '' },
]

describe('unitățile ingredientelor', () => {
  it('KS9 româna e identică cu formatStock / unitLabel', () => {
    for (const u of UNITS) {
      expect(unitSymbolT(u, ro), u).toBe(u)
      expect(unitLabelT(u, ro), u).toBe(unitLabel(u))
      for (const a of AMOUNTS) expect(formatStockT(a, u, ro), `${a} ${u}`).toBe(formatStock(a, u))
    }
    // Ancore: oracolul însuși (stocks.test.ts), ca egalitatea să nu fie vidă.
    expect(formatStockT(1500, 'g', ro)).toBe('1.50 kg')
    expect(formatStockT(1000, 'ml', ro)).toBe('1.00 L')
    expect(formatStockT(3, 'pachet', ro)).toBe('3 pachet')
    expect(unitLabelT('buc', ro)).toBe('bucăți')
    // Un cod din afara enum-ului, ca înainte.
    expect(formatStockT(2, 'oz', ro)).toBe(formatStock(2, 'oz' as IngredientUnit))
    for (const { s } of LANGS) {
      expect(unitSymbolT('oz', s)).toBe('oz')
      expect(unitLabelT('oz', s)).toBe('oz')
    }
  })

  it('KS10 en/fr/de: „buc”/„pachet” traduse, SI neatinse, aliniate cu `products`', () => {
    for (const { lang, s, p, sym } of LANGS) {
      for (const u of ['g', 'kg', 'ml', 'l'] as const) expect(unitSymbolT(u, s), `${lang} ${u}`).toBe(u)
      expect(unitSymbolT('buc', s), lang).toBe(sym.buc)
      expect(unitSymbolT('pachet', s), lang).toBe(sym.pachet)
      // Aceleași simboluri ca rețeta din fișa produsului (namespace `products`).
      for (const u of UNITS) {
        expect(unitSymbolT(u, s), `${lang} ${u}`).toBe(p[`unit_${u}`])
        expect(unitSymbolT(u, ro)).toBe((productsRo as Dict)[`unit_${u}`])
      }
      // Conversia rămâne; doar simbolul tradus diferă.
      expect(formatStockT(1500, 'g', s)).toBe('1.50 kg')
      expect(formatStockT(2500, 'ml', s)).toBe('2.50 L')
      expect(formatStockT(3, 'buc', s)).toBe(`3 ${sym.buc}`)
      expect(formatStockT(1.5, 'pachet', s)).toBe(`1.50 ${sym.pachet}`)
      for (const u of UNITS) {
        const name = unitLabelT(u, s)
        expect(name, `${lang} ${u}`).not.toBe(unitLabel(u))
        expect(name).not.toMatch(/bucăți|pachete|grame|litri|mililitri|kilograme/)
      }
    }
  })
})

describe('eticheta cotei TVA', () => {
  it('KS11 în română EXACT getVatLabel; rezerva tradusă în celelalte limbi', () => {
    for (const g of [1, 2, 3, 4, 99]) {
      expect(vatGroupLabel(RATES, g, ro), String(g)).toBe(getVatLabel(RATES, g))
      expect(vatGroupLabel([], g, ro)).toBe(getVatLabel([], g))
    }
    expect(vatGroupLabel(RATES, 3, ro)).toBe('Grupa 3')
    const fallback = { en: 'Group 3', fr: 'Groupe 3', de: 'Gruppe 3' }
    for (const { lang, s } of LANGS) {
      expect(vatGroupLabel(RATES, 3, s), lang).toBe(fallback[lang])
      // Eticheta cotei e DATĂ (vat_rates), aceeași în orice limbă.
      expect(vatGroupLabel(RATES, 1, s)).toBe('11% (Mâncare)')
    }
  })
})

describe('refuzurile serverului și erorile fișelor', () => {
  // Mesajele reale ale RPC-urilor (mig 066 / 165), cu hint-urile lor.
  const QTY = { message: 'Item quantity must be positive (got 0)', code: 'P0001', hint: 'invalid_quantity' }
  const WRONG = {
    message: 'Ingredient 7 does not belong to this restaurant',
    code: 'P0001',
    hint: 'ingredient_wrong_restaurant',
  }
  const PLAIN_RO = { message: 'Ingredientul nu poate fi salvat acum.', code: 'P0001' }
  const DENIED = { message: 'Ingredient not found or permission denied', code: 'P0001' }
  const NET = new TypeError('Failed to fetch')
  const ALL = [QTY, WRONG, PLAIN_RO, DENIED, NET, null, 'oops']

  it('KS12 româna = toUserMessage; hint-urile traduse doar în celelalte limbi', () => {
    for (const e of ALL) {
      expect(describeStockError(e, ro, roC)).toBe(toUserMessage(e))
      expect(stockFormErrorText({ kind: 'server', err: e }, ro, roC)).toBe(toUserMessage(e))
    }
    // Controlul: mesajul românesc al serverului apare ca atare în română.
    expect(describeStockError(PLAIN_RO, ro, roC)).toBe(PLAIN_RO.message)
    // Hint-ul NU se aplică în română (ar schimba textul de dinainte).
    expect(describeStockError(QTY, ro, roC)).not.toBe(stocksRo.hint_invalidQuantity)
    // Erorile de fișă: literalii de dinainte.
    expect(stockFormErrorText({ kind: 'nameRequired' }, ro, roC)).toBe('Numele e obligatoriu')
    expect(stockFormErrorText({ kind: 'qtyInvalid' }, ro, roC)).toBe('Cantitate invalidă')
    expect(stockFormErrorText({ kind: 'noValidItems' }, ro, roC)).toBe(
      'Adaugă cel puțin un ingredient cu cantitate validă',
    )

    for (const { lang, s, c } of LANGS) {
      const hints = stockErrorHints(s)
      expect(describeStockError(QTY, s, c), lang).toBe(hints.invalid_quantity)
      expect(describeStockError(WRONG, s, c), lang).toBe(hints.ingredient_wrong_restaurant)
      const plain = describeStockError(PLAIN_RO, s, c)
      expect(plain, lang).toBe(c.t('err_generic'))
      expect(plain).not.toContain('Ingredientul')
      expect(describeStockError(NET, s, c), lang).toBe(c.t('err_network'))
      expect(describeStockError(DENIED, s, c), lang).toBe(c.t('err_permission'))
      for (const k of ['nameRequired', 'qtyInvalid', 'noValidItems'] as const) {
        const txt = stockFormErrorText({ kind: k }, s, c)
        expect(txt, `${lang} ${k}`).not.toBe(stockFormErrorText({ kind: k }, ro, roC))
        expect(txt).not.toMatch(/[ăâîșț]/)
      }
    }
  })
})

describe('pluralele', () => {
  it('KS13 pluralele false românești rămân EXACT; formele reale în celelalte limbi', () => {
    for (let n = 0; n <= 200; n++) {
      expect(ro.tp('sup_count', n)).toBe(`${n} furnizori`)
      expect(ro.tp('nir_count', n)).toBe(`${n} NIR-uri totale`)
      expect(ro.tp('ing_count', n)).toBe(`${n} ingrediente active`)
      expect(ro.tp('sup_terms', n)).toBe(`Termen plată: ${n} zile`)
      expect(ro.tp('stat_belowMin', n)).toBe(`${n} sub prag`)
      // Ternarul de dinainte: `n === 1 ? 'ingredient sub prag' : 'ingrediente sub prag'`.
      expect(ro.tp('ing_lowCount', n)).toBe(`${n} ${n === 1 ? 'ingredient sub prag' : 'ingrediente sub prag'}`)
      expect(ro.tp('ing_lowMore', n, { names: 'A, B, C' })).toBe(`A, B, C și încă ${n}`)
      expect(ro.tp('prof_more', n, { names: 'A' })).toBe(`A și încă ${n} produse`)
    }
    const en = LANGS[0].s
    const fr = LANGS[1].s
    const de = LANGS[2].s
    expect(en.tp('sup_count', 1)).toBe('1 supplier')
    expect(en.tp('sup_count', 2)).toBe('2 suppliers')
    expect(fr.tp('nir_count', 1)).toBe('1 réception au total')
    expect(fr.tp('nir_count', 3)).toBe('3 réceptions au total')
    expect(de.tp('sup_terms', 1)).toBe('Zahlungsziel: 1 Tag')
    expect(de.tp('sup_terms', 30)).toBe('Zahlungsziel: 30 Tage')
    expect(de.tp('prof_more', 1, { names: 'A' })).toBe('A und 1 weiteres Produkt')
  })
})

describe('precondiția L4b/L4c (structural)', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
  const nsUsed = (src: string) => new Set([...src.matchAll(/useT\((\w+Ns)\)/g)].map((m) => m[1]))

  it('KS14 namespace-urile cerute sus, aceleași în toată fila; tab-ul e leneș', () => {
    const tab = read('src/components/StocksTab.tsx')
    // Componentele: fiecare `function X(` cu literă mare.
    const starts = [...tab.matchAll(/^(?:export default )?function ([A-Z]\w*)\(/gm)].map((m) => ({
      name: m[1],
      at: m.index ?? 0,
    }))
    expect(starts.map((s) => s.name)).toEqual(
      expect.arrayContaining(['StocksTab', 'IngredientsSection', 'IngredientModal', 'NirCreateModal', 'LoadErrorBox']),
    )
    const bodies = starts.map((s, i) => ({ ...s, body: tab.slice(s.at, starts[i + 1]?.at ?? tab.length) }))

    const main = bodies.find((b) => b.name === 'StocksTab')
    expect(main).toBeDefined()
    const mainTop = main ? main.body.slice(0, main.body.indexOf('return (')) : ''
    // Control pozitiv: scanerul vede cererile de sus.
    expect([...nsUsed(mainTop)].sort()).toEqual(['commonNs', 'stocksNs'])

    const offenders: string[] = []
    for (const b of bodies) {
      const used = nsUsed(b.body)
      for (const ns of used) if (ns !== 'stocksNs' && ns !== 'commonNs') offenders.push(`${b.name}: ${ns}`)
      const showsText = /\bt\(|\btp\(|tc\.t\(/.test(b.body)
      if (!showsText) continue
      const firstReturn = b.body.search(/\breturn\b/)
      const firstUseT = b.body.indexOf('useT(')
      if (firstUseT < 0 || (firstReturn >= 0 && firstUseT > firstReturn)) offenders.push(`${b.name}: useT după return`)
    }
    expect(offenders).toEqual([])

    const dash = read('src/pages/DashboardPage.tsx')
    expect(dash).toMatch(/const StocksTab = lazy\(\(\) => import\('\.\.\/components\/StocksTab'\)\)/)

    // Nota implicită a ajustării e DATĂ (stock_movements.notes): neschimbată.
    expect(MANUAL_ADJUST_NOTE).toBe('Ajustare manuală')
    expect(tab).toContain('notes || MANUAL_ADJUST_NOTE')
  })
})
