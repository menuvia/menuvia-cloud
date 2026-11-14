// Ecranul Meniu → Traduceri și traducerile din fișa produsului în limba
// personalului (lotul L5a, partea 2) — partea pură. Randarea e în
// src/components/__tests__/TranslationsLang.test.tsx (LX0–LX6).
// (Prefixul LX: verificat cu grep în src/, tests/ și supabase/tests,
// nefolosit înainte; LT era deja luat.)
//   LX7  numele limbilor MENIULUI: în română EXACT etichetele de dinainte
//        (`MENU_LANGS[].label`, numele fiecărei limbi în limba ei); tabela
//        acoperă exact cele 7 coduri; în en/fr/de numele e în limba
//        personalului (fr „allemand” în propoziție, „Allemand” la începutul
//        pastilei); un cod necunoscut cade pe codul cu majuscule, ca înainte.
//        Mutația care pică: `menuLang_de: 'Germană'` în ro.ts (sau o limbă
//        nouă în MENU_LANGS fără cheie).
//   LX8  pluralele: în română EGALE cu `roCount` pe 0…1000 („1 câmp”,
//        „2 câmpuri”, „20 de câmpuri”, „101 texte”), iar „lipsă” invariabil;
//        en/fr/de cu formele reale. Mutația care pică: `few` cu „de”.
//   LX9  refuzurile: în română `describeTranslationError` = `toUserMessage`
//        pe 10 forme de eroare (cota AI cu mesajul românesc al serverului,
//        `not_found` din saveRowTranslations, 42501, rețea, text englezesc,
//        null…); în en/fr/de codurile cunoscute au textul lor, iar NICIUN
//        mesaj românesc al serverului nu ajunge în rezultat. Mutația care
//        pică: maparea pe cod aplicată și în română (textul serverului s-ar
//        schimba) sau scoasă din celelalte limbi (ar cădea pe „generic”).
//   LX11 `describeAiError` (apelurile AI din fișa produsului: imagine,
//        valori nutriționale): în română EXACT `toUserMessage(err, rezerva)`;
//        în en/fr/de același text ca `describeTranslationError` pentru
//        codurile AiError (cotă, drepturi, rețea), dar `not_found` NU e
//        „nu mai e în meniu” (acela e al salvării traducerilor). Mutația care
//        pică: `describeAiError` fără maparea pe cod (ca `describeProductError`
//        — cota ar deveni textul de rezervă, „Eroare la generarea imaginii”).
//   LX10 precondiția L4b/L4c, ca clichet STRUCTURAL: TranslationsTab cere SUS,
//        înaintea primului return timpuriu, tot ce cer TranslationRow și
//        insigna AiReviewMark (din ProductTranslations) — altfel, într-o limbă
//        ne-română, primul rând randat ar suspenda tot ecranul. Control
//        pozitiv: scanerul vede cererile de sus. Mutația care pică:
//        `useT(commonNs)` scos din TranslationsTab.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  MENU_LANG_KEYS,
  describeAiError,
  describeTranslationError,
  menuLangName,
  menuLangTitle,
} from '../translationMessages'
import { MENU_LANGS } from '../i18nMenu'
import { roCount } from '../menuTranslations'
import { toUserMessage } from '../userMessages'
import { makeTranslator } from '../../i18n/core'
import trRo from '../../i18n/ns/translations/ro'
import trEn from '../../i18n/ns/translations/en'
import trFr from '../../i18n/ns/translations/fr'
import trDe from '../../i18n/ns/translations/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'

const ro = makeTranslator(trRo, 'ro')
const roC = makeTranslator(commonRo, 'ro')
const LANGS = [
  { lang: 'en' as const, t: makeTranslator(trEn, 'en'), c: makeTranslator(commonEn, 'en') },
  { lang: 'fr' as const, t: makeTranslator(trFr, 'fr'), c: makeTranslator(commonFr, 'fr') },
  { lang: 'de' as const, t: makeTranslator(trDe, 'de'), c: makeTranslator(commonDe, 'de') },
]

describe('numele limbilor meniului', () => {
  it('LX7 româna de dinainte, limba personalului în rest', () => {
    expect(Object.keys(MENU_LANG_KEYS).sort()).toEqual(MENU_LANGS.map((l) => l.code).sort())
    for (const l of MENU_LANGS) {
      expect(menuLangName(l.code, ro), l.code).toBe(l.label)
      expect(menuLangTitle(l.code, ro), l.code).toBe(l.label)
    }
    const [en, fr, de] = LANGS
    expect(menuLangName('de', en.t)).toBe('German')
    expect(menuLangName('ro', en.t)).toBe('Romanian')
    expect(menuLangName('de', fr.t)).toBe('allemand')
    expect(menuLangTitle('de', fr.t)).toBe('Allemand')
    expect(menuLangName('en', de.t)).toBe('Englisch')
    expect(menuLangName('hu', de.t)).toBe('Ungarisch')
    for (const { lang, t } of LANGS) {
      for (const l of MENU_LANGS) {
        const name = menuLangName(l.code, t)
        expect(name, `${lang} ${l.code}`).not.toMatch(/^menuLang_/)
        // Titlul diferă de nume doar prin prima literă.
        expect(menuLangTitle(l.code, t).toLowerCase(), `${lang} ${l.code}`).toBe(name.toLowerCase())
        if (lang !== 'fr') expect(menuLangTitle(l.code, t)).toBe(name)
      }
    }
    // Codul necunoscut: ca înainte (`code.toUpperCase()`), sau rezerva dată.
    expect(menuLangName('pl', ro)).toBe('PL')
    expect(menuLangName('pl', LANGS[1].t)).toBe('PL')
    expect(menuLangName('pl', ro, 'pl')).toBe('pl')
    expect(menuLangName('toString', ro)).toBe('TOSTRING')
  })
})

describe('pluralele ecranului Traduceri', () => {
  it('LX8 româna = roCount pe 0…1000; formele reale în rest', () => {
    for (let n = 0; n <= 1000; n++) {
      expect(ro.tp('pt_filled', n)).toBe(`Am completat ${roCount(n, 'câmp', 'câmpuri')} — verifică-le, apoi Salvează.`)
      expect(ro.tp('tab_progress', n, { done: 3, pct: 60 })).toBe(
        `3 din ${roCount(n, 'text tradus', 'texte traduse')} (60%)`,
      )
      expect(ro.tp('tab_unsaved', n)).toBe(`Ai ${roCount(n, 'rând nesalvat', 'rânduri nesalvate')}`)
      expect(ro.tp('tab_missing', n)).toBe(`${n} lipsă`)
    }
    expect(ro.tp('pt_filled', 20)).toBe('Am completat 20 de câmpuri — verifică-le, apoi Salvează.')
    expect(ro.tp('tab_progress', 5, { done: 3, pct: 60 })).toBe('3 din 5 texte traduse (60%)')

    const [en, fr, de] = LANGS
    expect(en.t.tp('pt_filled', 1)).toBe('Filled in 1 field — check it, then Save.')
    expect(en.t.tp('pt_filled', 3)).toBe('Filled in 3 fields — check them, then Save.')
    expect(en.t.tp('tab_unsaved', 2)).toBe('You have 2 unsaved rows')
    expect(fr.t.tp('tab_missing', 1)).toBe('1 manquant')
    expect(fr.t.tp('tab_missing', 2)).toBe('2 manquants')
    expect(fr.t.tp('tab_progress', 5, { done: 3, pct: 60 })).toBe('3 sur 5 textes traduits (60 %)')
    expect(de.t.tp('tab_missing', 1)).toBe('1 fehlt')
    expect(de.t.tp('tab_missing', 5)).toBe('5 fehlen')
    expect(de.t.tp('tab_progress', 1, { done: 0, pct: 0 })).toBe('0 von 1 Text übersetzt (0 %)')
  })
})

// Mesajele reale ale lui lib/ai (AiError) și ale lui saveRowTranslations.
const QUOTA = Object.assign(new Error('Ai atins limita lunară a asistentului AI.'), {
  code: 'quota_exceeded',
  status: 429,
})
const AI_NETWORK = Object.assign(
  new Error('Nu am putut contacta serverul. Verifică internetul și reîncearcă.'),
  { code: 'network', status: 0 },
)
const AI_DOWN = Object.assign(new Error('Asistentul AI nu a putut răspunde acum. Reîncearcă în câteva momente.'), {
  code: 'provider_failed',
  status: 502,
})
const NOT_IN_MENU = Object.assign(new Error('Elementul nu mai e în meniu.'), { code: 'not_found' })
const SHAPES: unknown[] = [
  QUOTA,
  AI_NETWORK,
  AI_DOWN,
  NOT_IN_MENU,
  Object.assign(new Error('permission denied for table products'), { code: '42501' }),
  new TypeError('Failed to fetch'),
  'permission denied for table products',
  { message: 'boom', code: 'XX000' },
  { message: 'Produsul nu poate fi salvat acum.', code: 'P0001' },
  null,
]
const ROMANIAN_SERVER = [
  'Ai atins limita lunară',
  'Nu am putut contacta serverul',
  'Asistentul AI nu a putut răspunde',
  'Elementul nu mai e în meniu',
  'Produsul nu poate fi salvat acum',
]

describe('refuzurile ecranului Traduceri', () => {
  it('LX9 româna = toUserMessage; codurile cunoscute traduse în rest, fără text românesc', () => {
    const fb = ro.t('tab_saveFailed')
    for (const err of SHAPES) expect(describeTranslationError(err, ro, roC, fb)).toBe(toUserMessage(err, fb))
    // Controlul românesc: mesajul serverului apare ca înainte.
    expect(describeTranslationError(QUOTA, ro, roC, fb)).toBe('Ai atins limita lunară a asistentului AI.')
    expect(describeTranslationError(NOT_IN_MENU, ro, roC, fb)).toBe('Elementul nu mai e în meniu.')

    for (const { lang, t, c } of LANGS) {
      const own = t.t('tab_saveFailed')
      expect(describeTranslationError(QUOTA, t, c, own), lang).toBe(t.t('err_aiQuota'))
      expect(describeTranslationError(AI_DOWN, t, c, own), lang).toBe(t.t('err_aiBusy'))
      expect(describeTranslationError(NOT_IN_MENU, t, c, own), lang).toBe(t.t('err_notInMenu'))
      expect(describeTranslationError(AI_NETWORK, t, c, own), lang).toBe(c.t('err_network'))
      expect(describeTranslationError(SHAPES[4], t, c, own), lang).toBe(c.t('err_permission'))
      expect(describeTranslationError(SHAPES[8], t, c, own), lang).toBe(own)
      for (const err of SHAPES) {
        const out = describeTranslationError(err, t, c, own)
        for (const r of ROMANIAN_SERVER) expect(out, `${lang}: ${r}`).not.toContain(r)
      }
    }
  })
})

describe('refuzurile AI din fișa produsului', () => {
  const FORBIDDEN = Object.assign(new Error('Nu ai drepturi să folosești asistentul AI.'), {
    code: 'forbidden',
    status: 403,
  })
  it('LX11 româna = toUserMessage; codurile AiError traduse ca pe ecranul Traduceri', () => {
    const fb = 'Eroare la generarea imaginii.'
    for (const err of [...SHAPES, FORBIDDEN]) expect(describeAiError(err, ro, roC, fb)).toBe(toUserMessage(err, fb))
    expect(describeAiError(QUOTA, ro, roC, fb)).toBe('Ai atins limita lunară a asistentului AI.')

    for (const { lang, t, c } of LANGS) {
      const own = 'FALLBACK'
      expect(describeAiError(QUOTA, t, c, own), lang).toBe(t.t('err_aiQuota'))
      expect(describeAiError(QUOTA, t, c, own), lang).toBe(describeTranslationError(QUOTA, t, c, own))
      expect(describeAiError(FORBIDDEN, t, c, own), lang).toBe(t.t('err_aiForbidden'))
      expect(describeAiError(AI_NETWORK, t, c, own), lang).toBe(c.t('err_network'))
      expect(describeAiError(AI_DOWN, t, c, own), lang).toBe(t.t('err_aiBusy'))
      expect(describeAiError(NOT_IN_MENU, t, c, own), lang).not.toBe(t.t('err_notInMenu'))
      for (const err of [...SHAPES, FORBIDDEN]) {
        const out = describeAiError(err, t, c, own)
        for (const r of ROMANIAN_SERVER) expect(out, `${lang}: ${r}`).not.toContain(r)
        expect(out, lang).not.toContain('Nu ai drepturi')
      }
    }
  })
})

describe('precondiția namespace-urilor cerute sus', () => {
  const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')
  const nsUsed = (src: string) => new Set([...src.matchAll(/useT\((\w+Ns)\)/g)].map((m) => m[1]))

  it('LX10 TranslationsTab cere sus tot ce cer rândurile și insigna', () => {
    const tab = read('src/components/TranslationsTab.tsx')
    const start = tab.indexOf('export default function TranslationsTab(')
    const early = tab.indexOf('if (langs.length === 0)', start)
    expect(start).toBeGreaterThan(0)
    expect(early).toBeGreaterThan(start)
    const top = nsUsed(tab.slice(start, early))
    // Control pozitiv: scanerul vede cererile de sus.
    expect([...top].sort()).toEqual(expect.arrayContaining(['commonNs', 'translationsNs']))

    const pieces = [
      'src/components/TranslationsTab.tsx',
      'src/components/_dashboard/TranslationRow.tsx',
      'src/components/_dashboard/ProductTranslations.tsx',
    ]
    const missing: string[] = []
    for (const f of pieces) for (const ns of nsUsed(read(f))) if (!top.has(ns)) missing.push(`${f}: ${ns}`)
    expect(missing).toEqual([])
  })
})
