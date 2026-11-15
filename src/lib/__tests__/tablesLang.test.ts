// Fila Mese & QR în limba personalului (lotul L6a) — partea PURĂ, rulabilă
// fără DOM. Ecranul randat e în src/components/__tests__/TablesLang.test.tsx.
// (Prefixul TQ: verificat cu grep în src/, tests/ și supabase/tests,
// nefolosit înainte.)
//   TQ8  textele despre ridicare (`pickupCopyT`): în română EXACT
//        `generalMenuQrText` / `pickupOnlyEmptyStateText` (oracolul din
//        lib/pickupCopy, pe toate stările feature × flipbook); în en/fr/de fără
//        litere românești, cu motivul flipbook EXACT când feature = true și
//        stilul e Flipbook, cu numele COMERCIAL al planului DOAR pe modul
//        suspendat. Mutația care pică: `po_head` cu „nu ai nevoie de mese ”
//        (spațiu în plus) în ro, sau `gm_flipbook` fără `{why}`.
//   TQ9  pluralele românești = textele de dinainte, pe n = 0…200 („Ai deja 1
//        mese configurate”, „1 mese create, fiecare cu QR-ul ei”, „1
//        locuri”); en/fr/de acordă la singular. Mutația care pică: `seats` cu
//        `one: '{n} loc'` în ro.
//   TQ10 slug-ul mesei (lib/tableSlug.ts) e EXACT funcția de dinainte din
//        TablesManager (`masa` / `masa-N` în orice limbă — generarea rapidă își
//        caută numerele libere după el). Mutația care pică: un prefix tradus.
//        La fel NUMELE mesei din generarea rapidă: `Masa N` (dată — apare pe
//        cardul QR tipărit și în meniul oaspetelui), apelat din TablesManager
//        prin `bulkTableName`, fără nicio cheie de traducere. Mutația care
//        pică: `name: tm.t('bulk_tableName', …)` readus.
//   TQ11 precondiția L4b/L4c, ca clichet STRUCTURAL: componenta exportată și
//        FIECARE subcomponentă cu text din TablesManager cer namespace-urile SUS,
//        înaintea primului `return`; fișierul nu folosește alt namespace decât
//        `tables` + `common`; fila rămâne `lazy` în DashboardPage, iar
//        lib/pickupCopy (în graful static al panoului) importă din `tables`
//        doar TIPUL. Mutația care pică: `useT(tablesNs)` mutat sub
//        `if (!src) return` în QRImage.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { makeTranslator } from '../../i18n/core'
import tablesRo from '../../i18n/ns/tables/ro'
import tablesEn from '../../i18n/ns/tables/en'
import tablesFr from '../../i18n/ns/tables/fr'
import tablesDe from '../../i18n/ns/tables/de'
import { generalMenuQrText, pickupCopyT, pickupOnlyEmptyStateText, pickupPlanName } from '../pickupCopy'
import { bulkTableName, bulkTableNumber, bulkTableSlug, slugifyTable } from '../tableSlug'

const STATES = [true, false, null] as const
const FLIPBOOK = [true, false] as const
const N = Array.from({ length: 201 }, (_, i) => i)
const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')
const TARGETS = [
  ['en', tablesEn],
  ['fr', tablesFr],
  ['de', tablesDe],
] as const

describe('textele despre ridicare din Mese', () => {
  it('TQ8: româna = oracolul din pickupCopy; en/fr/de fără resturi', () => {
    const ro = pickupCopyT(makeTranslator(tablesRo, 'ro'))
    for (const f of STATES)
      for (const fb of FLIPBOOK) {
        expect(ro.generalMenuQrText(f, fb)).toBe(generalMenuQrText(f, fb))
        expect(ro.pickupOnlyEmptyStateText(f, fb)).toBe(pickupOnlyEmptyStateText(f, fb))
      }
    for (const [lang, d] of TARGETS) {
      const tr = makeTranslator(d, lang)
      const copy = pickupCopyT(tr)
      const why = tr.t('pk_flipbookNoOrders')
      for (const f of STATES)
        for (const fb of FLIPBOOK) {
          const ctx = `${lang} feature=${String(f)} flipbook=${fb}`
          for (const text of [copy.generalMenuQrText(f, fb), copy.pickupOnlyEmptyStateText(f, fb)]) {
            expect(text, ctx).not.toMatch(/[ăĂșȘțȚ]/)
            expect(text, ctx).not.toMatch(/\{\w+\}/)
            expect(text.includes(why), ctx).toBe(f === true && fb)
          }
          expect(copy.pickupOnlyEmptyStateText(f, fb).includes(pickupPlanName()), ctx).toBe(f === false)
        }
    }
  })
})

describe('pluralele românești = textele de dinainte', () => {
  it('TQ9: bulk_alreadyHave / bulk_created / seats', () => {
    const ro = makeTranslator(tablesRo, 'ro')
    for (const n of N) {
      expect(ro.tp('bulk_alreadyHave', n)).toBe(`Ai deja ${n} mese configurate`)
      expect(ro.tp('bulk_created', n)).toBe(`${n} mese create, fiecare cu QR-ul ei`)
      expect(ro.tp('seats', n)).toBe(`${n} locuri`)
    }
    for (const [lang, d] of TARGETS) {
      const tr = makeTranslator(d, lang)
      for (const k of ['bulk_alreadyHave', 'bulk_created', 'seats'] as const) {
        expect(tr.tp(k, 1), `${lang}.${k}`).not.toBe(tr.tp(k, 2).replace('2', '1'))
        expect(tr.tp(k, 2), `${lang}.${k}`).toContain('2')
      }
    }
    // Franceza: `many` cu „de” (1 000 000 de places), ca products/stocks.
    expect(makeTranslator(tablesFr, 'fr').tp('seats', 1000000)).toBe('1000000 de places')
  })
})

describe('slug-ul mesei', () => {
  // Funcția de dinainte din TablesManager, copiată ca oracol.
  function oldSlugify(s: string) {
    return (
      s
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/^-|-$/g, '') || 'masa'
    )
  }
  it('TQ10: identic cu cel de dinainte, `masa` / `masa-N` în orice limbă', () => {
    for (const s of ['Masa 1', 'Terasă A', '  ', '', 'Tisch 12', 'Table 3', 'Ăăă', '-x-', 'Bar  VIP'])
      expect(slugifyTable(s)).toBe(oldSlugify(s))
    for (const n of [1, 7, 80]) {
      expect(bulkTableSlug(n)).toBe(`masa-${n}`)
      expect(bulkTableNumber(bulkTableSlug(n))).toBe(n)
    }
    for (const s of ['table-1', 'masa-1a', 'masa-', '', null, undefined, 'Masa-3']) expect(bulkTableNumber(s)).toBeNull()
    for (const n of [1, 7, 80]) expect(bulkTableName(n)).toBe(`Masa ${n}`)
    const tm = read('src/components/TablesManager.tsx')
    expect(tm).toContain('name: bulkTableName(idx), slug: bulkTableSlug(idx)')
    expect(tm).not.toContain('bulk_tableName')
    for (const d of [tablesRo, tablesEn, tablesFr, tablesDe]) expect(Object.keys(d)).not.toContain('bulk_tableName')
  })
})

describe('precondiția L4b/L4c (Mese)', () => {
  const nsUsed = (src: string) => new Set([...src.matchAll(/useT\((\w+Ns)\)/g)].map((m) => m[1]))
  const SRC = 'src/components/TablesManager.tsx'
  const PARTS = [
    { start: 'function QRImage(', must: ['tablesNs'] },
    { start: 'function TableModal(', must: ['tablesNs', 'commonNs'] },
    { start: 'function GeneralMenuQrCard(', must: ['tablesNs'] },
    { start: 'export default function TablesManager(', must: ['tablesNs', 'commonNs'] },
  ] as const

  it('TQ11: fiecare componentă cere namespace-urile înaintea primului return', () => {
    const src = read(SRC)
    for (const { start, must } of PARTS) {
      const s = src.indexOf(start)
      expect(s, start).toBeGreaterThan(0)
      const m = /^[ \t]*(?:if \([^\n]*\)\s*)?return\b/m.exec(src.slice(s))
      expect(m, start).not.toBeNull()
      const top = nsUsed(src.slice(s, s + (m?.index ?? 0)))
      // Control pozitiv: scanerul vede cererile de sus.
      expect([...top].sort(), start).toEqual([...must].sort())
    }
    // Niciun alt namespace în fișier (o subcomponentă cu un ns nou ar suspenda fila).
    expect([...nsUsed(src)].sort()).toEqual(['commonNs', 'tablesNs'])
    expect([...src.matchAll(/from '\.\.\/i18n\/ns\/(\w+)'/g)].map((m) => m[1]).sort()).toEqual(['common', 'tables'])
    // Fila e leneșă în panou; pickupCopy (static în panou) ia din `tables` doar TIPUL.
    expect(read('src/pages/DashboardPage.tsx')).toContain("lazy(() => import('../components/TablesManager'))")
    const pc = read('src/lib/pickupCopy.ts')
    expect(pc).toContain("import type tablesRo from '../i18n/ns/tables/ro'")
    expect(pc).not.toMatch(/^import (?!type)[^\n]*i18n\/ns\//m)
  })
})
