// Asistentul AI din panou în limba personalului (lotul L7) — părțile pure.
// (Prefixul XA: verificat cu grep în src/, tests/, e2e/, supabase/tests, docs
// și CLAUDE.md, nefolosit înainte; XA0–XA5 sunt testele cu DOM din
// src/components/__tests__/AssistantLang.test.tsx.)
//   XA6  refuzurile AI au UN text pe tot panoul: `assistant.err_ai*` =
//        `imports.err_ai*` (= `translations.err_ai*`, IY8) în toate cele patru
//        limbi. Mutația care pică: un `err_aiBusy` reformulat doar aici.
//   XA7  PROMPT-ul pentru model NU s-a schimbat la mutarea în
//        lib/aiChatPrompt.ts: ieșirea e byte cu byte cea de dinainte (textul
//        vechi e copiat aici ca literal), inclusiv „STOC EPUIZAT”, „(niciuna)”,
//        plafonul de 200 de produse și „Răspunzi mereu în română” (reziduul
//        consemnat: asistentul răspunde în română în orice limbă a
//        personalului). Mutația care pică: o linie a promptului tradusă.
//   XA8  precondiția de suspendare, clichet STRUCTURAL: AiChatbot,
//        AiChatbotPanel și ActionCard cer `assistant` + `common` SUS, înaintea
//        primului `return`; fișierul nu mai conține textul promptului; panoul
//        rămâne `lazy` în DashboardPage. Mutația care pică: `useT(assistantNs)`
//        mutat sub `if (!open) return null`.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import type { Dict } from '../../i18n/core'
import aRo from '../../i18n/ns/assistant/ro'
import aEn from '../../i18n/ns/assistant/en'
import aFr from '../../i18n/ns/assistant/fr'
import aDe from '../../i18n/ns/assistant/de'
import imRo from '../../i18n/ns/imports/ro'
import imEn from '../../i18n/ns/imports/en'
import imFr from '../../i18n/ns/imports/fr'
import imDe from '../../i18n/ns/imports/de'
import { AI_CHAT_EMPTY_REPLY, buildChatSystemPrompt } from '../aiChatPrompt'

const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')

// Corpul VECHI al lui `buildSystem()` din AiChatbot.tsx (înainte de L7),
// copiat ca oracol.
function oldPrompt(
  restaurantName: string,
  categories: { id: string; emoji: string; name: string }[],
  products: { id: string; name: string; price: number; is_sold_out?: boolean; category_id?: string | null }[],
): string {
  const cats = categories.map((c) => `- ${c.id} · ${c.emoji} ${c.name}`).join('\n')
  const prods = products
    .slice(0, 200)
    .map((p) => `- ${p.id} · ${p.name} · ${p.price} lei${p.is_sold_out ? ' · STOC EPUIZAT' : ''}${p.category_id ? ` · cat:${p.category_id}` : ''}`)
    .join('\n')
  return [
    `Ești asistentul AI al restaurantului „${restaurantName}" din platforma Menuvia.`,
    'Ajuți la gestionarea meniului digital QR. Răspunzi mereu în română, concis și prietenos.',
    '',
    'Poți PROPUNE modificări pe meniu. Când propui modificări, adaugă la FINALUL răspunsului un bloc ```json``` cu forma:',
    '{"actions":[{"type":"create_product","name":"...","price":25,"description":"...","category_id":"<id categorie>","emoji":"🍕"}]}',
    'Tipuri de acțiuni permise:',
    '- create_product: {name, price (lei, număr), description?, category_id?, emoji?}',
    '- update_product: {product_id, name?, price?, description?, emoji?}',
    '- toggle_sold_out: {product_id, sold_out (true/false)}',
    '- create_category: {name, emoji?}',
    'Folosește DOAR id-urile reale din contextul de mai jos. Nu inventa id-uri.',
    'Nu aplica tu nimic — utilizatorul confirmă manual fiecare acțiune. Dacă userul doar pune o întrebare, NU adăuga bloc json.',
    '',
    'CATEGORII:',
    cats || '(niciuna)',
    '',
    'PRODUSE:',
    prods || '(niciunul)',
  ].join('\n')
}

describe('Asistentul AI — părțile pure', () => {
  it('XA6: refuzurile AI au același text ca în importuri, în toate limbile', () => {
    const keys = ['err_aiQuota', 'err_aiSession', 'err_aiForbidden', 'err_aiUnavailable', 'err_aiBusy'] as const
    const pairs: [Dict, Dict][] = [
      [aRo as Dict, imRo as Dict],
      [aEn as Dict, imEn as Dict],
      [aFr as Dict, imFr as Dict],
      [aDe as Dict, imDe as Dict],
    ]
    for (const [a, im] of pairs)
      for (const k of keys) {
        expect(typeof a[k], k).toBe('string')
        expect(a[k], k).toBe(im[k])
      }
  })

  it('XA7: promptul pentru model e byte cu byte cel de dinainte', () => {
    const cats = [
      { id: 'c1', emoji: '🍕', name: 'Pizza' },
      { id: 'c2', emoji: '🍰', name: 'Deserturi' },
    ]
    const prods = Array.from({ length: 205 }, (_, i) => ({
      id: `p${i}`,
      name: `Produs ${i}`,
      price: 10 + i / 2,
      is_sold_out: i % 3 === 0,
      category_id: i % 2 === 0 ? 'c1' : null,
    }))
    const got = buildChatSystemPrompt('Bistro „Ana”', cats, prods)
    expect(got).toBe(oldPrompt('Bistro „Ana”', cats, prods))
    expect(buildChatSystemPrompt('X', [], [])).toBe(oldPrompt('X', [], []))
    // Control pozitiv: plafonul de 200 și marcajul de stoc sunt chiar acolo.
    expect(got).toContain('- p199 · Produs 199')
    expect(got).not.toContain('- p200 ·')
    expect(got).toContain(' · STOC EPUIZAT')
    expect(got).toContain('Răspunzi mereu în română')
    // Opțiunile implicite = română + română + RON = promptul de dinainte.
    expect(buildChatSystemPrompt('Bistro „Ana”', cats, prods, { replyLang: 'ro', menuLang: 'ro', currency: 'RON' })).toBe(
      oldPrompt('Bistro „Ana”', cats, prods),
    )
    expect(AI_CHAT_EMPTY_REPLY).toBe('(fără răspuns)')
    // Pe ecran, „(fără răspuns)” e cheia `no_reply` — în română același text.
    expect(aRo.no_reply).toBe(AI_CHAT_EMPTY_REPLY)
  })

  it('XA8: AiChatbot cere namespace-urile sus în fiecare componentă; promptul nu mai e în .tsx', () => {
    const src = read('src/components/AiChatbot.tsx')
    for (const start of ['export default function AiChatbot(', 'function AiChatbotPanel(', 'function ActionCard(']) {
      const s = src.indexOf(start)
      expect(s, start).toBeGreaterThan(0)
      const body = src.slice(s)
      const m = /^[ \t]*(?:if \([^\n]*\)\s*)?return\b/m.exec(body)
      expect(m, start).not.toBeNull()
      const top = body.slice(0, m?.index ?? 0)
      expect(top, start).toContain('useT(assistantNs)')
      expect(top, start).toContain('useT(commonNs)')
    }
    const used = [...new Set([...src.matchAll(/useT\((\w+)\)/g)].map((m) => m[1]))].sort()
    expect(used).toEqual(['assistantNs', 'commonNs'])
    expect(src).not.toContain('Răspunzi mereu în română')
    expect(src).not.toContain('toUserMessage(')
    expect(read('src/pages/DashboardPage.tsx')).toContain("lazy(() => import('../components/AiChatbot'))")
  })
})

// XA9 (activarea limbilor): răspunsul în limba PERSONALULUI, conținutul de
// meniu propus în limba de BAZĂ a meniului (doar când diferă), prețurile în
// moneda localului. Mutația care pică: „Răspunzi mereu în română” fix.
describe('XA9 promptul urmează limba personalului, a meniului și moneda', () => {
  it('XA9 răspuns în germană, meniu în franceză, prețuri în EUR', () => {
    const p = buildChatSystemPrompt('Le Bistro', [], [{ id: 'p1', name: 'Croque', price: 9.5 }], {
      replyLang: 'de',
      menuLang: 'fr',
      currency: 'EUR',
    })
    expect(p).toContain('Răspunzi mereu în germană')
    expect(p).toContain('le scrii în franceză (limba meniului)')
    expect(p).toContain('- p1 · Croque · 9.5 EUR')
    expect(p).toContain('price (EUR, număr)')
    expect(p).not.toMatch(/\blei\b/)
    // Aceeași limbă pentru răspuns și meniu: fără instrucțiunea suplimentară.
    const same = buildChatSystemPrompt('X', [], [], { replyLang: 'en', menuLang: 'en' })
    expect(same).toContain('Răspunzi mereu în engleză')
    expect(same).not.toContain('limba meniului')
    // Limbă necunoscută → română (nu „undefined”).
    expect(buildChatSystemPrompt('X', [], [], { replyLang: 'xx' })).toContain('Răspunzi mereu în română')
  })
})
