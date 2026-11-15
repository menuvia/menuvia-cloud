// Filele Categorii, Opțiuni și Promoții în limba personalului (lotul L5b) —
// partea PURĂ: pluralele românești comparate cu ternarele de dinainte și
// precondiția L4b/L4c ca clichet STRUCTURAL. Randarea e în
// src/components/__tests__/{Categories,Modifiers,HappyHour}Lang.test.tsx.
//   CG7  `categories`: în română fiecare plural e EXACT ternarul de dinainte
//        pe n = 0…200 — „{n} categorii” mereu (plural fals), `produs` +
//        (n !== 1 ? 'e' : ''), „Mută produsul…” / „Mută cele {n} produse…” —;
//        în en/fr/de forma de 1 diferă de cea de 2. Mutația care pică:
//        `few: '{n} de produse'` sau `one: '{n} categorie'` în ro.ts.
//   MG10 `modifiers`: la fel — „max {n} opțiune/opțiuni”, „Folosit de {n}
//        produs/produse”, „{n} produs ales / produse alese”, „Se șterg
//        definitiv și cele {n} opțiuni ale lui.” (și la 1), „cele {n} produs
//        care îl folosește nu se va / produse care îl folosesc nu se vor”.
//        Mutația care pică: `card_usedBy.other` cu „de”.
//   HP9  `promotions`: „ACTIVĂ ACUM” la 1, „ACTIVE ACUM ({n})” altfel.
//   CG8  precondiția L4b/L4c: fiecare filă cere SUS, în componenta exportată
//        și înaintea primului `return`, TOATE namespace-urile pe care le cer
//        subcomponentele ei (modale, carduri, editoare) — altfel prima
//        deschidere într-o limbă ne-română ar suspenda toată fila. Control
//        pozitiv: scanerul vede cererile de sus în fiecare fișier. Mutația
//        care pică: `useT(translationsNs)` scos din componenta exportată a
//        lui CategoriesTab sau `useT(commonNs)` scos din HappyHourTab.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { makeTranslator } from '../../i18n/core'
import categoriesRo from '../../i18n/ns/categories/ro'
import categoriesEn from '../../i18n/ns/categories/en'
import categoriesFr from '../../i18n/ns/categories/fr'
import categoriesDe from '../../i18n/ns/categories/de'
import modifiersRo from '../../i18n/ns/modifiers/ro'
import modifiersEn from '../../i18n/ns/modifiers/en'
import modifiersFr from '../../i18n/ns/modifiers/fr'
import modifiersDe from '../../i18n/ns/modifiers/de'
import promotionsRo from '../../i18n/ns/promotions/ro'

const N = Array.from({ length: 201 }, (_, i) => i)

describe('pluralele românești = ternarele de dinainte', () => {
  it('CG7 categories', () => {
    const ro = makeTranslator(categoriesRo, 'ro')
    for (const n of N) {
      expect(ro.tp('count', n)).toBe(`${n} categorii`)
      expect(ro.tp('productsCount', n)).toBe(`${n} produs${n !== 1 ? 'e' : ''}`)
      if (n > 0)
        expect(ro.tp('del_move', n)).toBe(
          n === 1 ? 'Mută produsul acestei categorii în:' : `Mută cele ${n} produse ale acestei categorii în:`,
        )
    }
    for (const [lang, d] of [['en', categoriesEn], ['fr', categoriesFr], ['de', categoriesDe]] as const) {
      const tr = makeTranslator(d, lang)
      for (const k of ['count', 'productsCount', 'del_move'] as const) expect(tr.tp(k, 1)).not.toBe(tr.tp(k, 2).replace('2', '1'))
      expect(tr.tp('productsCount', 2)).toContain('2')
    }
  })

  it('MG10 modifiers', () => {
    const ro = makeTranslator(modifiersRo, 'ro')
    for (const n of N) {
      expect(ro.tp('card_max', n)).toBe(`max ${n} ${n === 1 ? 'opțiune' : 'opțiuni'}`)
      if (n > 0) expect(ro.tp('card_usedBy', n)).toBe(n === 1 ? 'Folosit de 1 produs' : `Folosit de ${n} produse`)
      expect(ro.tp('pick_count', n)).toBe(n === 1 ? '1 produs ales' : `${n} produse alese`)
      if (n > 0) expect(ro.tp('del_descOptions', n)).toBe(`Se șterg definitiv și cele ${n} opțiuni ale lui.`)
      if (n > 0)
        expect(ro.tp('lastOff_desc', n)).toBe(
          `Grupul e obligatoriu: cele ${n} ${n === 1 ? 'produs care îl folosește nu se va' : 'produse care îl folosesc nu se vor'} mai putea comanda până marchezi din nou o opțiune disponibilă.`,
        )
    }
    for (const [lang, d] of [['en', modifiersEn], ['fr', modifiersFr], ['de', modifiersDe]] as const) {
      const tr = makeTranslator(d, lang)
      for (const k of ['card_max', 'card_usedBy', 'pick_count', 'del_descOptions', 'lastOff_desc'] as const)
        expect(tr.tp(k, 1)).not.toBe(tr.tp(k, 2).replace('2', '1'))
    }
  })

  it('HP9 promotions', () => {
    const ro = makeTranslator(promotionsRo, 'ro')
    for (const n of N.slice(1)) expect(ro.tp('activeNow', n)).toBe(n === 1 ? 'ACTIVĂ ACUM' : `ACTIVE ACUM (${n})`)
  })
})

describe('precondiția L4b/L4c', () => {
  const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')
  const nsUsed = (src: string) => new Set([...src.matchAll(/useT\((\w+Ns)\)/g)].map((m) => m[1]))

  const TABS = [
    { file: 'src/components/CategoriesTab.tsx', start: 'export default function CategoriesTab(', must: ['categoriesNs', 'commonNs', 'translationsNs'] },
    { file: 'src/components/ModifiersTab.tsx', start: 'export default function ModifiersTab(', must: ['modifiersNs', 'commonNs', 'translationsNs'] },
    { file: 'src/components/HappyHourTab.tsx', start: 'export default function HappyHourTab(', must: ['promotionsNs', 'commonNs'] },
  ] as const

  it('CG8 fiecare filă cere sus tot ce cer subcomponentele ei', () => {
    const missing: string[] = []
    for (const { file, start, must } of TABS) {
      const src = read(file)
      const s = src.indexOf(start)
      expect(s, file).toBeGreaterThan(0)
      // Primul `return` din COD (o linie care începe cu el sau cu `if (…) return`;
      // comentariile nu contează).
      const m = /^[ \t]*(?:if \([^\n]*\)\s*)?return\b/m.exec(src.slice(s))
      expect(m, file).not.toBeNull()
      const firstReturn = s + (m?.index ?? 0)
      const top = nsUsed(src.slice(s, firstReturn))
      // Control pozitiv: scanerul vede cererile de sus.
      expect([...top].sort(), file).toEqual([...must].sort())
      for (const ns of nsUsed(src)) if (!top.has(ns)) missing.push(`${file}: ${ns}`)
    }
    expect(missing).toEqual([])
  })
})
