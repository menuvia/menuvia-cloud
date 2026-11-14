// Importurile meniului în limba personalului (lotul L5a2) — partea PURĂ:
// antetele CSV acceptate în toate limbile, șabloanele, erorile de rând și ale
// importului, refuzurile asistentului AI, plafonul planului, pluralele.
// Randarea (AiMenuImport și în onboarding, AiBulkGenerate, ProductsCsvImport)
// e în src/components/__tests__/ImportsLang.test.tsx (IM/IK/IZ).
// (Prefixul IY: verificat cu grep în src/, tests/ și supabase/tests,
// nefolosit înainte.)
//   IY1  antetele: fiecare coloană se recunoaște în ro/en/fr/de, fără
//        majuscule, fără diacritice și cu BOM; regula de dinainte câștigă
//        întâi (`pret` înaintea lui `preț`, `nume` înaintea lui `name`); fără
//        TVA pe plan, coloana TVA nu se citește. Mutațiile care pică (verificate):
//        aliasurile scoase (doar antetele românești), comparația cu diacritice
//        (NFC în loc de NFD), un antet de șablon fără alias (`csv_head_vat:
//        'USt.'` — o coloană TVA nerecunoscută NU dă eroare de rând, cade pe 1,
//        deci doar IY1 o vede).
//   IY2  șablonul FIECĂREI limbi (cu și fără TVA) se re-importă fără nicio
//        eroare, cu aceleași prețuri/TVA în toate limbile. Mutațiile care pică:
//        aliasurile scoase; o virgulă într-o celulă-exemplu (coloana TVA se
//        deplasează → „TVA trebuie 1-4”).
//   IY3  româna BYTE-identică: șablonul descărcabil, varianta fără TVA,
//        caseta „Format așteptat” și placeholder-ul sunt exact literalii de
//        dinainte. Mutația care pică (verificată): un rând-exemplu românesc
//        schimbat („spuma” fără diacritic).
//   IY4  plafonul AI înainte de salvare: în română EXACT `describeProductLimit`
//        (oracolul de dinainte) pe o grilă selecție × locuri; în en/fr/de
//        pluralul limbii.
//   IY5  pluralele false ale românei păstrate: „Am găsit 1 produse”, „Cele
//        1 produse”, „Importă 1 produse →”, iar textele care aveau ternar pe
//        `=== 1` îl au exact (n = 0…200); „N texte traduse” = `roCount`.
//        Mutația care pică (verificată): `other: 'Salvează {n} de produse'`.
//   IY6  erorile de RÂND sunt coduri: în română textele de dinainte („preț
//        neparsabil ("abc")”), în en/fr/de niciun rest românesc.
//   IY7  eșecul importului CSV: în română EXACT `toUserMessage(new
//        Error(textul vechi), 'Eroare necunoscută la import')` pe toate
//        felurile (inclusiv cauza `network` și una de drepturi); în en/fr/de
//        textul limbii, cauza tradusă (hint `product_limit`, drepturi) și
//        NICIUN mesaj românesc al serverului. Mutația care pică (verificată):
//        `toUserMessage` și în celelalte limbi.
//   IY8  refuzurile AI au UN text: `imports.err_ai*` = `translations.err_ai*`
//        în toate cele patru limbi. Mutația care pică (verificată): un
//        `err_aiBusy` englezesc reformulat doar în `imports`.
//   IY9  un refuz al asistentului AI: în română mesajul lui (ca înainte); în
//        en/fr/de textul codului, fără mesajul românesc și fără textul brut
//        ENGLEZESC al furnizorului; fișierul ilizibil și pozele prea mari au
//        textul lor. Mutația care pică (verificată): `describeAiError` ocolit
//        (`toUserMessage` direct).
//   IY10 erorile lotului AI (`BulkIssue`) și linia de progres: în română
//        textele compuse de dinainte (cu mesajul românesc al serverului, ex.
//        furnizorul fără imagini); în en/fr/de fără rest românesc, cu textul
//        codului `provider_no_images`.
//   IY11 plafonul respins de server: în română cu mesajul serverului; în
//        altă limbă fără el.
//   IY12 precondiția de suspendare, clichet STRUCTURAL: cele trei componente
//        cer `useT(importsNs)` înaintea oricărui `return`, iar fiecare
//        montare (Produse, Traduceri, onboarding) e `lazy` și stă sub un
//        `<Suspense>` propriu — într-o limbă ne-română se suspendă modalul,
//        nu ecranul de dedesubt. Mutația care pică (verificată): `<Suspense>`
//        scos din jurul lui `<AiMenuImport>` din onboarding.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { makeTranslator, type Dict } from '../../i18n/core'
import importsRo from '../../i18n/ns/imports/ro'
import importsEn from '../../i18n/ns/imports/en'
import importsFr from '../../i18n/ns/imports/fr'
import importsDe from '../../i18n/ns/imports/de'
import trRo from '../../i18n/ns/translations/ro'
import trEn from '../../i18n/ns/translations/en'
import trFr from '../../i18n/ns/translations/fr'
import trDe from '../../i18n/ns/translations/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import {
  CsvImportFailure,
  bulkCurrentText,
  bulkIssueText,
  csvExample,
  csvHeaderLine,
  csvPlaceholder,
  csvRowErrorText,
  csvTemplate,
  describeCsvImportError,
  describeMenuImportFailure,
  fileReadError,
  importIssueText,
  menuImportErrorText,
  productLimitText,
  type BulkIssue,
  type CsvFailureInfo,
} from '../importMessages'
import { csvColumnIndexes, normalizeCsvHeader, parseProductsCsv, type CsvRowError } from '../productsCsv'
import { describeProductLimit, productLimitState } from '../aiImportDraft'
import { roCount } from '../menuTranslations'
import { toUserMessage } from '../userMessages'

const ro = makeTranslator(importsRo, 'ro')
const roC = makeTranslator(commonRo, 'ro')
const LANGS = [
  { lang: 'en' as const, t: makeTranslator(importsEn, 'en'), c: makeTranslator(commonEn, 'en') },
  { lang: 'fr' as const, t: makeTranslator(importsFr, 'fr'), c: makeTranslator(commonFr, 'fr') },
  { lang: 'de' as const, t: makeTranslator(importsDe, 'de'), c: makeTranslator(commonDe, 'de') },
]
const ALL = [{ lang: 'ro' as const, t: ro, c: roC }, ...LANGS]

// Literalii de DINAINTE (ProductsCsvImport.tsx înainte de L5a2) — oracolul IY3.
const OLD_TEMPLATE = `nume,categorie,pret,emoji,descriere,tva
Espresso,Cafele,8.00,☕,Cafea italiană pură,1
Cappuccino,Cafele,14.00,☕,Cu spumă de lapte,1
Latte Macchiato,Cafele,16.00,🥛,,1
Limonadă,Băuturi reci,14.00,🍋,Cu mentă proaspătă,1
Cheesecake,Prăjituri,16.00,🍰,Cu fructe de pădure,1
`
const OLD_TEMPLATE_NO_VAT = OLD_TEMPLATE.split('\n')
  .map((line) => line.replace(/,[^,]*$/, ''))
  .join('\n')

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** `piece` apare în `text` ca bucată întreagă (nu în mijlocul unui cuvânt:
 *  „categorie” nu e rest românesc în „categories”). */
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)

/** Fragmentele românești (≥ 6 caractere, fără locuri `{x}`) ale lui `imports`
 *  + `common` rămase într-un text tradus. */
function romanianLeftovers(text: string, target: Dict, targetCommon: Dict): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const pairs: [Dict, Dict][] = [
    [importsRo as Dict, target],
    [commonRo as Dict, targetCommon],
  ]
  for (const [src, tgt] of pairs) {
    for (const [k, v] of Object.entries(src)) {
      const own = formsOf(tgt[k]).join('\n')
      for (const form of formsOf(v))
        for (const piece of form.split(/\{\w+\}/)) {
          const p = piece.trim()
          if (p.length >= 6 && !own.includes(p) && containsWhole(text, p)) out.push(`${k}: ${p}`)
        }
    }
  }
  return out
}

describe('antetele și șabloanele CSV', () => {
  it('IY1 fiecare coloană se recunoaște în cele patru limbi', () => {
    for (const { lang, t } of ALL) {
      const head = csvHeaderLine(t).split(',')
      expect(csvColumnIndexes(head, true), lang).toEqual({
        name: 0,
        category: 1,
        price: 2,
        emoji: 3,
        description: 4,
        vat: 5,
      })
      // Majuscule, fără TVA pe plan.
      expect(csvColumnIndexes(head.map((h) => h.toUpperCase()), false).vat, lang).toBe(-1)
      expect(csvColumnIndexes(head.map((h) => h.toUpperCase()), false).price, lang).toBe(2)
    }
    // Ce mergea înainte: „preț” cu diacritic, majuscule și spații.
    expect(csvColumnIndexes([' Nume ', 'CATEGORIE', 'preț'], true)).toMatchObject({ name: 0, category: 1, price: 2 })
    // Variante: diacritice, BOM, „MwSt.” cu punct, ordine amestecată.
    expect(
      csvColumnIndexes(['\uFEFFPreis', 'Catégorie', 'Nom', 'MwSt.', 'Beschreibung', 'EMOJI'], true),
    ).toEqual({ name: 2, category: 1, price: 0, emoji: 5, description: 4, vat: 3 })
    // Regula de dinainte câștigă: antetul românesc exact înaintea aliasurilor.
    expect(csvColumnIndexes(['name', 'nume', 'preț', 'pret'], true)).toMatchObject({ name: 1, price: 3 })
    expect(normalizeCsvHeader('  Preț ')).toBe('pret')
    expect(csvColumnIndexes(['necunoscut'], true).name).toBe(-1)
  })

  it('IY2 șablonul fiecărei limbi se re-importă fără erori', () => {
    for (const showVat of [true, false]) {
      const shapes: string[] = []
      for (const { lang, t } of ALL) {
        const rows = parseProductsCsv(csvTemplate(t, showVat), showVat)
        expect(rows.length, `${lang}/${showVat}`).toBe(5)
        expect(rows.filter((r) => r.errors.length > 0), `${lang}/${showVat}`).toEqual([])
        expect(rows.every((r) => r.name && r.category), lang).toBe(true)
        shapes.push(JSON.stringify(rows.map((r) => [r.price, r.vat, r.emoji, r.rowNum])))
        // Și exemplul din casetă.
        const ex = parseProductsCsv(csvExample(t, showVat), showVat)
        expect(ex.length, lang).toBe(2)
        expect(ex.filter((r) => r.errors.length > 0), lang).toEqual([])
      }
      // Aceleași prețuri, cote, emoji în toate limbile.
      expect(new Set(shapes).size).toBe(1)
    }
    // Un șablon în germană se importă la fel de un coleg în română (parserul
    // nu depinde de limba personalului).
    const de = LANGS[2]!.t
    expect(parseProductsCsv(csvTemplate(de, true), true).map((r) => r.name)).toEqual([
      'Espresso',
      'Cappuccino',
      'Latte Macchiato',
      'Limonade',
      'Cheesecake',
    ])
  })

  it('IY3 româna: șablonul, exemplul și placeholder-ul de dinainte', () => {
    expect(csvTemplate(ro, true)).toBe(OLD_TEMPLATE)
    expect(csvTemplate(ro, false)).toBe(OLD_TEMPLATE_NO_VAT)
    expect(csvExample(ro, true)).toBe('nume,categorie,pret,emoji,descriere,tva\nEspresso,Cafele,8.00,☕,,1\nLatte,Cafele,14.00,🥛,Cu lapte,1')
    expect(csvExample(ro, false)).toBe('nume,categorie,pret,emoji,descriere\nEspresso,Cafele,8.00,☕,\nLatte,Cafele,14.00,🥛,Cu lapte')
    expect(csvPlaceholder(ro, true)).toBe('nume,categorie,pret,emoji,descriere,tva...')
    expect(csvPlaceholder(ro, false)).toBe('nume,categorie,pret,emoji,descriere...')
    expect(ro.t('csv_templateFile')).toBe('template-produse-menuvia.csv')
    for (const { lang, t } of LANGS) expect(csvHeaderLine(t), lang).not.toBe(csvHeaderLine(ro))
  })
})

describe('plafonul, pluralele, erorile de rând', () => {
  it('IY4 plafonul: în română EXACT describeProductLimit', () => {
    let checked = 0
    for (let remaining = -1; remaining <= 130; remaining++)
      for (const selected of [0, 1, 2, 3, 19, 20, 21, 101, 120, 140]) {
        const st = productLimitState(selected, remaining)
        const old = describeProductLimit(selected, remaining)
        expect(st === null ? null : productLimitText(st, ro)).toBe(old)
        if (old) checked++
      }
    expect(checked).toBeGreaterThan(100)
    expect(productLimitState(5, undefined)).toBeNull()
    const en = LANGS[0]!.t
    expect(productLimitText({ kind: 'over', remaining: 1, selected: 3, excess: 2 }, en)).toBe(
      'Your plan allows 1 more product, and you selected 3. Untick 2 products or upgrade your plan. Nothing has been saved yet.',
    )
  })

  it('IY5 pluralele false ale românei rămân cum erau', () => {
    for (let n = 0; n <= 200; n++) {
      expect(ro.tp('ai_found', n)).toBe(`Am găsit ${n} produse. E totul corect?`)
      expect(ro.tp('ai_discardDesc', n)).toBe(`Cele ${n} produse extrase, încă nesalvate, se pierd definitiv.`)
      expect(ro.tp('ai_saveN', n)).toBe(`Salvează ${n} produse`)
      expect(ro.tp('csv_importN', n)).toBe(`Importă ${n} produse →`)
      expect(ro.tp('csv_imported', n)).toBe(`${n} produse importate!`)
      expect(ro.tp('ai_doneAdded', n)).toBe(`${n} produse adăugate!`)
      expect(ro.tp('ai_resume', n)).toBe(
        `Ai un import început: ${n} ${n === 1 ? 'produs extras' : 'produse extrase'}, încă nesalvate. Ai un import nesalvat — reia-l sau renunță la el.`,
      )
      expect(ro.tp('ai_leftInDraft', n)).toBe(
        `${n} ${n === 1 ? 'produs a rămas' : 'produse au rămas'} în draft, nesalvate. Redeschide importul și apasă „Reia importul”.`,
      )
      expect(ro.tp('ai_deferred', n)).toBe(
        `${n === 1 ? 'Un produs n-a încăput' : `${n} produse n-au încăput`} în planul curent. Le salvezi din draft după ce treci la un plan superior.`,
      )
      if (n > 0)
        expect(ro.tp('ai_keepWithin', n)).toBe(
          n === 1 ? 'Păstrează primul produs, restul rămân în draft' : `Păstrează primele ${n} produse, restul rămân în draft`,
        )
      expect(ro.tp('bulk_generateFor', n)).toBe(`Generează pentru ${n} ${n === 1 ? 'produs' : 'produse'}`)
      expect(ro.tp('bulk_translateIn', n, { todo: 3 })).toBe(`Traduceri în ${n} ${n === 1 ? 'limbă' : 'limbi'} (3 de tradus)`)
      expect(ro.tp('csv_slotsRest', n)).toBe(`${n} ${n === 1 ? 'rând rămâne' : 'rânduri rămân'}`)
    }
    for (let n = 0; n <= 1000; n++)
      expect(ro.tp('bulk_textsTranslated', n)).toBe(`✨ ${roCount(n, 'text tradus', 'texte traduse')} — marcate «de verificat».`)
  })

  it('IY6 erorile de rând: coduri, traduse la randare', () => {
    const rows = parseProductsCsv(
      'nume,categorie,pret,tva\n,Cafele,abc,1\nEspresso,,-3,9\nLatte,Cafele,,1\n' + 'X'.repeat(101) + ',C,1,1\n',
      true,
    )
    const codes = rows.map((r) => r.errors.map((e) => e.code))
    expect(codes).toEqual([
      ['missing_name', 'bad_price'],
      ['missing_category', 'negative_price', 'bad_vat'],
      ['missing_price'],
      ['name_too_long'],
    ])
    const all: CsvRowError[] = rows.flatMap((r) => r.errors)
    expect(all.map((e) => csvRowErrorText(e, ro))).toEqual([
      'lipsește numele',
      'preț neparsabil ("abc")',
      'lipsește categoria',
      'preț negativ',
      'TVA trebuie 1-4',
      'lipsește prețul',
      'nume prea lung (>100)',
    ])
    // Valoarea brută rămâne neatinsă, între ghilimelele tipografice ale limbii.
    const QUOTED_RAW = { en: '(“abc”)', fr: '(« abc »)', de: '(„abc“)' } as const
    for (const { lang, t } of LANGS) {
      const text = all.map((e) => csvRowErrorText(e, t)).join(', ')
      expect(text, lang).toContain(QUOTED_RAW[lang])
      expect(romanianLeftovers(text, importsByLang(lang), commonByLang(lang)), lang).toEqual([])
    }
  })
})

function importsByLang(lang: 'en' | 'fr' | 'de'): Dict {
  return (lang === 'en' ? importsEn : lang === 'fr' ? importsFr : importsDe) as Dict
}
function commonByLang(lang: 'en' | 'fr' | 'de'): Dict {
  return (lang === 'en' ? commonEn : lang === 'fr' ? commonFr : commonDe) as Dict
}

describe('refuzurile: importul CSV, asistentul AI, lotul', () => {
  const NET = { message: 'network' }
  const RLS = { message: 'new row violates row-level security policy for table "categories"', code: '42501' }
  const LIMIT = {
    message: 'Limită produse atinsă: maxim 15 pe planul curent. Pentru mai multe e nevoie de un plan superior.',
    code: 'P0001',
    hint: 'product_limit',
  }
  const OLD: [CsvFailureInfo, string][] = [
    [{ kind: 'baseline' }, 'Nu am putut citi meniul existent, deci importul nu a pornit (nu s-a adăugat nimic). Reîncearcă.'],
    [
      { kind: 'verifyProducts' },
      'Nu am putut verifica ce s-a importat deja, deci nu am reluat importul (ca să nu dublăm produse). Reîncearcă.',
    ],
    [
      { kind: 'verifyCategories' },
      'Nu am putut verifica categoriile create deja, deci nu am reluat importul (ca să nu dublăm categorii). Reîncearcă.',
    ],
    [{ kind: 'category', name: 'Cafele', cause: NET }, 'Eroare la categoria "Cafele": network'],
    [{ kind: 'category', name: 'Cafele', cause: RLS }, `Eroare la categoria "Cafele": ${RLS.message}`],
    [{ kind: 'batch', index: 20, cause: LIMIT }, `Eroare la batch 20: ${LIMIT.message}`],
  ]

  it('IY7 eșecul importului CSV', () => {
    for (const [info, oldText] of OLD) {
      const err = new CsvImportFailure(info)
      expect(err.message).toBe(oldText)
      expect(describeCsvImportError(err, ro, roC)).toBe(toUserMessage(new Error(oldText), 'Eroare necunoscută la import'))
    }
    // O eroare oarecare: tot ca înainte.
    expect(describeCsvImportError({ message: 'boom' }, ro, roC)).toBe('Eroare necunoscută la import')
    expect(describeCsvImportError(new CsvImportFailure(OLD[3]![0]), ro, roC)).toBe('Eroare la categoria "Cafele": network')

    for (const { lang, t, c } of LANGS) {
      for (const [info] of OLD) {
        const text = describeCsvImportError(new CsvImportFailure(info), t, c)
        expect(romanianLeftovers(text, importsByLang(lang), commonByLang(lang)), `${lang}/${info.kind}`).toEqual([])
        expect(text, lang).not.toContain('Limită produse')
        expect(text, lang).not.toContain('row-level')
      }
      expect(describeCsvImportError(new CsvImportFailure(OLD[4]![0]), t, c), lang).toContain(c.t('err_permission'))
      expect(describeCsvImportError(new CsvImportFailure(OLD[5]![0]), t, c), lang).toContain(t.t('csv_hintProductLimit'))
      expect(describeCsvImportError({ message: 'boom' }, t, c), lang).toBe(t.t('csv_errUnknown'))
    }
  })

  it('IY8 refuzurile AI au același text în importuri și în Traduceri', () => {
    const keys = ['err_aiQuota', 'err_aiSession', 'err_aiForbidden', 'err_aiUnavailable', 'err_aiBusy'] as const
    const pairs: [Dict, Dict][] = [
      [importsRo as Dict, trRo as Dict],
      [importsEn as Dict, trEn as Dict],
      [importsFr as Dict, trFr as Dict],
      [importsDe as Dict, trDe as Dict],
    ]
    for (const [im, tr] of pairs) for (const k of keys) expect(im[k]).toBe(tr[k])
  })

  it('IY9 un refuz al asistentului AI, tradus fără mesajul brut', () => {
    const quota = Object.assign(new Error('Ai atins limita lunară a asistentului AI.'), {
      code: 'quota_exceeded',
      status: 429,
    })
    // Un text englezesc de la furnizor, purtat de un cod cunoscut.
    const upstream = Object.assign(new Error('Upstream provider returned 502 Bad Gateway'), {
      code: 'provider_failed',
      status: 502,
    })
    const tooBig = Object.assign(new Error('Pozele trimise sunt prea mari. Încearcă cu mai puține poze sau cu poze mai mici.'), {
      code: 'payload_too_large',
      status: 413,
    })
    // Română: ca înainte (`toUserMessage(e, 'Eroare la procesarea pozelor.')`).
    for (const e of [quota, upstream, tooBig, fileReadError(), { message: 'Internal error' }])
      expect(describeMenuImportFailure(e, ro, roC)).toBe(toUserMessage(e, 'Eroare la procesarea pozelor.'))
    expect(describeMenuImportFailure(fileReadError(), ro, roC)).toBe('Nu am putut citi fișierul.')

    for (const { lang, t, c } of LANGS) {
      expect(describeMenuImportFailure(quota, t, c), lang).toBe(t.t('err_aiQuota'))
      const up = describeMenuImportFailure(upstream, t, c)
      expect(up, lang).toBe(t.t('err_aiBusy'))
      expect(up, lang).not.toContain('Upstream')
      expect(describeMenuImportFailure(tooBig, t, c), lang).toBe(t.t('ai_tooLarge'))
      expect(describeMenuImportFailure(fileReadError(), t, c), lang).toBe(t.t('ai_errFileRead'))
      const raw = describeMenuImportFailure({ message: 'TypeError: cannot read properties of undefined' }, t, c)
      expect(raw, lang).toBe(t.t('ai_errProcess'))
      for (const e of [quota, tooBig])
        expect(describeMenuImportFailure(e, t, c), lang).not.toBe(e.message)
    }
  })

  it('IY10 erorile lotului AI și linia de progres', () => {
    const e = { message: 'Upstream exploded' }
    const cases: [BulkIssue, string][] = [
      [{ kind: 'trStopped', err: e }, 'Traduceri oprite: eroare la generare'],
      [{ kind: 'trBatch', of: 'groups', err: e }, 'Traducere grupuri de opțiuni: eroare la generare'],
      [{ kind: 'trRow', of: 'products', name: 'Ciorbă', err: e }, 'Ciorbă (traducere): eroare la generare'],
      [{ kind: 'trRow', of: 'categories', name: 'Supe', err: e }, 'Supe (categorie): eroare la generare'],
      [{ kind: 'nutritionStopped', err: e }, 'Macronutrienți opriți: eroare la generare Restul produselor au fost sărite.'],
      [{ kind: 'nutritionRow', name: 'Ciorbă', err: e }, 'Ciorbă (nutriție): eroare la generare'],
      [{ kind: 'imagesStopped', err: e }, 'Imagini oprite: eroare la generare Restul produselor au fost sărite.'],
      [{ kind: 'imageRow', name: 'Ciorbă', err: e }, 'Ciorbă (imagine): eroare la generare'],
    ]
    for (const [issue, old] of cases) expect(bulkIssueText(issue, ro, roC)).toBe(old)
    // Mesajul românesc al serverului rămâne în română, ca înainte.
    expect(bulkIssueText({ kind: 'imageRow', name: 'X', err: new Error('Furnizorul nu poate genera imagini.') }, ro, roC)).toBe(
      'X (imagine): Furnizorul nu poate genera imagini.',
    )
    // Furnizorul fără imagini: în română mesajul serverului; altfel textul lui.
    const noImages = Object.assign(
      new Error('Generarea de imagini merge doar cu OpenAI sau Gemini. Schimbă furnizorul în Setări → Asistent AI.'),
      { code: 'provider_no_images', status: 400 },
    )
    expect(bulkIssueText({ kind: 'imagesStopped', err: noImages }, ro, roC)).toBe(
      `Imagini oprite: ${noImages.message} Restul produselor au fost sărite.`,
    )
    expect(bulkCurrentText({ kind: 'translating', of: 'extras', n: 4 }, ro)).toBe('Traduc extra-uri (4)…')
    expect(bulkCurrentText({ kind: 'product', name: 'Ciorbă' }, ro)).toBe('Ciorbă')
    expect(bulkCurrentText(null, ro)).toBe('')
    for (const { lang, t, c } of LANGS) {
      const text = cases.map(([i]) => bulkIssueText(i, t, c)).join('\n')
      expect(romanianLeftovers(text, importsByLang(lang), commonByLang(lang)), lang).toEqual([])
      expect(text, lang).not.toContain('Upstream')
      expect(
        bulkIssueText({ kind: 'imageRow', name: 'X', err: new Error('Furnizorul nu poate genera imagini.') }, t, c),
        lang,
      ).not.toContain('Furnizorul')
      expect(bulkIssueText({ kind: 'imagesStopped', err: noImages }, t, c), lang).toContain(t.t('bulk_errNoImages'))
    }
  })

  it('IY11 plafonul respins de server, problemele de pe ecranul final', () => {
    const msg = 'Limită produse atinsă: maxim 15 pe planul curent.'
    expect(menuImportErrorText({ kind: 'serverLimit', message: msg }, ro, roC, 4)).toBe(
      `Nimic nu a fost salvat. ${msg} Debifează produse sau treci la un plan superior.`,
    )
    expect(menuImportErrorText({ kind: 'tooMany' }, ro, roC, 4)).toBe(
      'Poți încărca maximum 4 poze odată. Importă restul paginilor într-o a doua rundă — produsele se adaugă, nu se înlocuiesc.',
    )
    expect(importIssueText({ kind: 'category', name: 'Băuturi' }, ro)).toBe(
      'categoria „Băuturi": nu a putut fi creată (produsele ei intră fără categorie)',
    )
    expect(importIssueText({ kind: 'product', name: '' }, ro)).toBe('produs fără nume: nu a putut fi salvat')
    for (const { lang, t, c } of LANGS) {
      const text = menuImportErrorText({ kind: 'serverLimit', message: msg }, t, c, 4)
      expect(text, lang).not.toContain('Limită')
      expect(text, lang).toContain(t.t('ai_limitReached'))
      expect(importIssueText({ kind: 'product', name: '' }, t), lang).toContain(t.t('ai_unnamedProduct'))
    }
  })
})

const read = (f: string): string => readFileSync(resolve(process.cwd(), f), 'utf8')

describe('precondiția de suspendare', () => {
  it('IY12 useT(importsNs) sus; fiecare montare e lazy și sub <Suspense>', () => {
    for (const [file, fn] of [
      ['src/components/AiMenuImport.tsx', 'export default function AiMenuImport('],
      ['src/components/AiBulkGenerate.tsx', 'export default function AiBulkGenerate('],
      ['src/components/ProductsCsvImport.tsx', 'export default function ProductsCsvImport('],
    ] as const) {
      const src = read(file)
      const start = src.indexOf(fn)
      expect(start, file).toBeGreaterThan(0)
      const body = src.slice(start)
      const useT = body.indexOf('useT(importsNs)')
      const ret = body.search(/\n\s+return\b|\n\s+if \([^)]*\) return\b/)
      expect(useT, file).toBeGreaterThan(0)
      expect(useT, file).toBeLessThan(ret)
    }
    const mounts: [string, string][] = [
      ['src/components/ProductsTab.tsx', 'ProductsCsvImport'],
      ['src/components/ProductsTab.tsx', 'AiMenuImport'],
      ['src/components/ProductsTab.tsx', 'AiBulkGenerate'],
      ['src/components/TranslationsTab.tsx', 'AiBulkGenerate'],
      ['src/pages/OnboardingPage.tsx', 'AiMenuImport'],
    ]
    for (const [file, comp] of mounts) {
      const src = read(file)
      expect(src, `${file}: ${comp} lazy`).toMatch(new RegExp(`const ${comp} = lazy\\(\\(\\) => import\\(`))
      const at = src.indexOf(`<${comp}\n`)
      expect(at, `${file}: <${comp}`).toBeGreaterThan(0)
      // Cel mai apropiat <Suspense> deschis înaintea montării nu e închis între timp.
      const open = src.lastIndexOf('<Suspense', at)
      const close = src.lastIndexOf('</Suspense>', at)
      expect(open, `${file}: ${comp} sub <Suspense>`).toBeGreaterThan(close)
    }
    // Onboarding-ul: sub FunnelLangProvider (limba funnel-ului).
    expect(read('src/pages/OnboardingPage.tsx')).toMatch(/<FunnelLangProvider>\s*<OnboardingFlow/)
  })
})
