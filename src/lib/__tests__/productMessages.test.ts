// Fila Produse în limba personalului (lotul L5a, partea 1) — partea PURĂ:
// refuzurile serverului (`describeProductError`), pluralele listei și
// oglinzile românești ale datelor din lib/constants și lib/soldOut.
// Randarea (lista, fișa, ordinea, antetul) e în
// src/components/__tests__/ProductsTabLang.test.tsx (LV0–LV6).
// (Prefixul LV: verificat cu grep în src/, tests/ și supabase/tests,
// nefolosit înainte.)
//   LV7  pluralele: în română EXACT textele de dinainte — „1 extra” / „2
//        extra-uri” / „20 extra-uri”, „1 pereche” / „0 perechi”, „1
//        ingredient” / „2 ingrediente”, „✓ 1 produse importate” (plural fals
//        păstrat); în en/fr/de formele reale. Mutația care pică: o formă `few`
//        corectată în română („20 de extra-uri”).
//   LV8  `describeProductError`: în română EGAL cu `toUserMessage(err,
//        fallback)` pe toate formele de eroare (mesajul românesc al serverului
//        cu hint `product_limit` rămâne afișat ca atare — hint-urile NU se aplică
//        în română); în en/fr/de hint-ul are textul limbii, mesajul ROMÂNESC al
//        serverului NU trece, rețeaua are textul din `common`, un mesaj fără
//        hint cade pe textul de rezervă al contextului. Mutația care pică:
//        hint-urile trecute și în română (ar înlocui textul serverului), sau
//        `toUserMessage` readus în loc de `describeStaffError`.
//   LV9  oglinzile: etichetele alergenilor / etichetelor dietetice sunt în
//        română EXACT `label`/`desc` din lib/constants (toate id-urile au
//        cheie), iar insigna „EPUIZAT · …” e EXACT „EPUIZAT · ” +
//        `soldOutSourceLabel(...).toUpperCase()` — oracolul românesc de
//        dinainte. Mutația care pică: o etichetă de alergen tastată diferit în
//        `ro.ts` (ex. „Telina” fără diacritice).
//   LV11 unitățile ingredientelor (enum `IngredientUnit`, mig 026): în română
//        EXACT codul afișat înainte în rețetă („buc”, „pachet”); în en/fr/de
//        niciun cod românesc („buc”/„pachet”) nu rămâne; un cod din afara
//        enum-ului apare ca atare. Mutația care pică: `unit_buc: 'bucăți'` în
//        ro.ts.
//   LV10 precondiția L4b/L4c, ca clichet STRUCTURAL: ProductsTab cere SUS, în
//        componenta exportată și înaintea returnului timpuriu de eroare, TOATE
//        namespace-urile pe care le cer piesele montate condiționat (fișa,
//        ordinea, antetul, insigna, rețeta, extra-urile, traducerile fișei din
//        ProductTranslations/ExtraTranslations) — altfel, într-o limbă
//        ne-română, prima deschidere a fișei ar suspenda tot panoul (spinner-ul
//        rutei). Control pozitiv: scanerul găsește `useT(productsNs)` sus.
//        Mutația care pică: `useT(commonNs)` scos din componenta exportată.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { INGREDIENT_UNIT_KEYS, describeProductError, ingredientUnitLabel, productErrorHints } from '../productMessages'
import { toUserMessage } from '../userMessages'
import { ALLERGENS, DIETARY_TAGS } from '../constants'
import { soldOutSourceLabel } from '../soldOut'
import { makeTranslator, type Dict } from '../../i18n/core'
import productsRo from '../../i18n/ns/products/ro'
import productsEn from '../../i18n/ns/products/en'
import productsFr from '../../i18n/ns/products/fr'
import productsDe from '../../i18n/ns/products/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'

const ro = makeTranslator(productsRo, 'ro')
const roC = makeTranslator(commonRo, 'ro')
const LANGS = [
  { lang: 'en' as const, p: makeTranslator(productsEn, 'en'), c: makeTranslator(commonEn, 'en') },
  { lang: 'fr' as const, p: makeTranslator(productsFr, 'fr'), c: makeTranslator(commonFr, 'fr') },
  { lang: 'de' as const, p: makeTranslator(productsDe, 'de'), c: makeTranslator(commonDe, 'de') },
]

// Mesajul real al lui enforce_product_limit_stmt (mig 290), cu hint-ul lui.
const LIMIT_RO = {
  message: 'Limită produse atinsă: maxim 15 pe planul curent. Pentru mai multe e nevoie de un plan superior.',
  code: 'P0001',
  hint: 'product_limit',
}
const GROUP_GONE_RO = { message: 'Grupul nu există', code: 'P0002', hint: 'group_not_found' }
const PLAIN_RO = { message: 'Produsul nu poate fi salvat acum.', code: 'P0001' }
const NETWORK = new TypeError('Failed to fetch')
const DENIED = { message: 'Nu ai drepturi pentru această acțiune.', code: '42501' }

describe('pluralele listei de produse', () => {
  it('LV7 română de dinainte, formele reale în celelalte limbi', () => {
    expect(ro.tp('upsell_extrasCount', 1)).toBe('1 extra')
    expect(ro.tp('upsell_extrasCount', 0)).toBe('0 extra-uri')
    expect(ro.tp('upsell_extrasCount', 2)).toBe('2 extra-uri')
    expect(ro.tp('upsell_extrasCount', 20)).toBe('20 extra-uri')
    expect(ro.tp('upsell_pairingsCount', 1)).toBe('1 pereche')
    expect(ro.tp('upsell_pairingsCount', 0)).toBe('0 perechi')
    expect(ro.tp('upsell_pairingsCount', 21)).toBe('21 perechi')
    expect(ro.tp('recipe_count', 1)).toBe('1 ingredient')
    expect(ro.tp('recipe_count', 2)).toBe('2 ingrediente')
    expect(ro.tp('recipe_count', 20)).toBe('20 ingrediente')
    expect(ro.tp('toast_imported', 1)).toBe('✓ 1 produse importate')
    expect(ro.tp('toast_imported', 20)).toBe('✓ 20 produse importate')

    const [en, fr, de] = LANGS
    expect(en.p.tp('upsell_extrasCount', 1)).toBe('1 extra')
    expect(en.p.tp('upsell_extrasCount', 3)).toBe('3 extras')
    expect(en.p.tp('toast_imported', 1)).toBe('✓ 1 product imported')
    expect(fr.p.tp('recipe_count', 1)).toBe('1 ingrédient')
    expect(fr.p.tp('recipe_count', 2)).toBe('2 ingrédients')
    expect(fr.p.tp('recipe_count', 1000000)).toBe('1000000 d’ingrédients')
    expect(de.p.tp('upsell_pairingsCount', 2)).toBe('2 Empfehlungen')
    expect(de.p.tp('toast_imported', 1)).toBe('✓ 1 Produkt importiert')
  })
})

describe('describeProductError', () => {
  const CASES: Array<[string, unknown, string | undefined]> = [
    ['limita cu hint', LIMIT_RO, undefined],
    ['limita cu hint + rezervă', LIMIT_RO, 'Nu am putut adăuga extra-ul.'],
    ['grup dispărut', GROUP_GONE_RO, 'Nu am putut salva opțiunile produsului.'],
    ['mesaj românesc fără hint', PLAIN_RO, 'Nu am putut adăuga perechea.'],
    ['rețea', NETWORK, 'Nu am putut salva rețeta.'],
    ['refuz RLS (zeroRowsAsDenied)', DENIED, 'Nu am putut șterge extra-ul.'],
    ['null', null, 'Ordinea nu a putut fi salvată.'],
    ['nimic', undefined, undefined],
    ['Error simplu', new Error('boom'), 'Eroare la generarea imaginii.'],
  ]

  it('LV8 în română: EXACT toUserMessage(err, rezerva) de dinainte', () => {
    for (const [name, err, fallback] of CASES) {
      const before = fallback === undefined ? toUserMessage(err) : toUserMessage(err, fallback)
      expect(describeProductError(err, ro, roC, fallback), name).toBe(before)
    }
    // Controlul pozitiv al regulii: în română limita arată MESAJUL serverului.
    expect(describeProductError(LIMIT_RO, ro, roC)).toBe(LIMIT_RO.message)
  })

  it('LV8 în en/fr/de: hint-ul tradus, niciun mesaj românesc al serverului', () => {
    for (const { lang, p, c } of LANGS) {
      const hints = productErrorHints(p)
      const limit = describeProductError(LIMIT_RO, p, c)
      expect(limit, lang).toBe(p.t('hint_productLimit'))
      expect(limit, lang).not.toBe(ro.t('hint_productLimit'))
      expect(limit, lang).not.toContain('Limită produse')
      expect(describeProductError({ ...LIMIT_RO, hint: 'upgrade_plan' }, p, c), lang).toBe(hints.upgrade_plan)
      expect(describeProductError(GROUP_GONE_RO, p, c, p.t('err_groupsSave')), lang).toBe(p.t('hint_groupNotFound'))
      // Fără hint, textul românesc al serverului cade pe rezerva contextului.
      expect(describeProductError(PLAIN_RO, p, c, p.t('err_pairingAdd')), lang).toBe(p.t('err_pairingAdd'))
      expect(describeProductError(NETWORK, p, c, p.t('err_recipeSave')), lang).toBe(c.t('err_network'))
      expect(describeProductError(DENIED, p, c), lang).toBe(c.t('err_permission'))
      // Fără rezervă: textul generic al limbii, nu MSG_GENERIC românesc.
      expect(describeProductError(PLAIN_RO, p, c), lang).toBe(c.t('err_generic'))
    }
  })
})

describe('oglinzile românești ale datelor', () => {
  it('LV9 alergenii, etichetele dietetice și insigna „Epuizat” = textele de dinainte', () => {
    const roDict = productsRo as Dict
    for (const a of ALLERGENS) {
      expect(roDict[`allergen_${a.id}`], a.id).toBe(a.label)
      expect(roDict[`allergenDesc_${a.id}`], a.id).toBe(a.desc)
      for (const { lang, p } of LANGS) {
        const own = (p.t as (k: string) => string)(`allergen_${a.id}`)
        expect(own, `${lang} ${a.id}`).not.toBe(`allergen_${a.id}`)
      }
    }
    for (const tag of DIETARY_TAGS) expect(roDict[`diet_${tag.id}`], tag.id).toBe(tag.label)

    expect(productsRo.list_soldOutStock).toBe(`EPUIZAT · ${(soldOutSourceLabel(true, 'stock') ?? '').toUpperCase()}`)
    expect(productsRo.list_soldOutManual).toBe(`EPUIZAT · ${(soldOutSourceLabel(true, 'manual') ?? '').toUpperCase()}`)
    // `null` (nicio sursă) pe un produs epuizat = „manual”, ca înainte.
    expect(productsRo.list_soldOutManual).toBe(`EPUIZAT · ${(soldOutSourceLabel(true, null) ?? '').toUpperCase()}`)
    expect(productsRo.list_unblocked).toBe((soldOutSourceLabel(false, 'manual') ?? '').toUpperCase())
  })
})

describe('unitățile ingredientelor', () => {
  it('LV11 româna = codul de dinainte; fără coduri românești în rest', () => {
    const codes = ['g', 'kg', 'ml', 'l', 'buc', 'pachet'] as const
    expect(Object.keys(INGREDIENT_UNIT_KEYS).sort()).toEqual([...codes].sort())
    for (const u of codes) expect(ingredientUnitLabel(u, ro), u).toBe(u)
    expect(ingredientUnitLabel('oz', ro)).toBe('oz')
    for (const { lang, p } of LANGS) {
      for (const u of codes) {
        const out = ingredientUnitLabel(u, p)
        expect(out, `${lang} ${u}`).not.toBe(`unit_${u}`)
        expect(out, `${lang} ${u}`).not.toMatch(/^(buc|pachet)$/)
      }
      expect(ingredientUnitLabel('oz', p), lang).toBe('oz')
    }
  })
})

describe('precondiția namespace-urilor cerute sus', () => {
  const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')
  const nsUsed = (src: string) => new Set([...src.matchAll(/useT\((\w+Ns)\)/g)].map((m) => m[1]))

  it('LV10 ProductsTab cere sus tot ce cer piesele montate condiționat', () => {
    const tab = read('src/components/ProductsTab.tsx')
    const start = tab.indexOf('export default function ProductsTab(')
    const early = tab.indexOf('if ((error || catError) && !modal)', start)
    expect(start).toBeGreaterThan(0)
    expect(early).toBeGreaterThan(start)
    const top = nsUsed(tab.slice(start, early))
    // Control pozitiv: scanerul vede cererile de sus.
    expect([...top].sort()).toEqual(expect.arrayContaining(['commonNs', 'productsNs']))

    const pieces = [
      'src/components/ProductsTab.tsx',
      'src/components/_dashboard/ProductsToolbar.tsx',
      'src/components/_dashboard/ProductOrderModal.tsx',
      'src/components/_dashboard/ProductTranslations.tsx',
      'src/components/_dashboard/ExtraTranslations.tsx',
    ]
    const missing: string[] = []
    for (const f of pieces) for (const ns of nsUsed(read(f))) if (!top.has(ns)) missing.push(`${f}: ${ns}`)
    expect(missing).toEqual([])
  })
})
