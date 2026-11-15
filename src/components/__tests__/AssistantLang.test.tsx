// Asistentul AI din panou în limba personalului (lotul L7): AiChatbot citește
// namespace-ul `assistant` („Închide” și clasele de erori din `common`).
// PROMPT-ul trimis modelului și răspunsurile lui NU se traduc.
// (Prefixul XA: verificat cu grep în src/, tests/, e2e/, supabase/tests, docs
// și CLAUDE.md, nefolosit înainte; XA6–XA8 sunt pure, în
// src/lib/__tests__/assistantLang.test.ts.)
//   XA0  control POZITIV al verificării „fără text românesc”: panoul randat în
//        română, comparat cu dicționarul englez, ARE resturi.
//   XA1  fără provider (azi, mereu româna): butonul flotant „Deschide
//        asistentul AI”, salutul și exemplele cu ghilimeaua DREAPTĂ de
//        închidere (textContent identic cu cel de dinainte), „Scrie un
//        mesaj…”, „Trimite mesajul”; cardul de acțiune „Disponibilitate
//        produs” cu fraza „Marchează „Tiramisu" ca STOC EPUIZAT.”,
//        „Confirmă” / „Respinge”.
//   XA2  panoul în engleză, fără resturi românești, pe tot drumul (salut,
//        card de acțiune, răspuns gol „(no reply)”); PROMPT-ul trimis modelului
//        rămâne cel românesc („Răspunzi mereu în română”), iar în istoricul
//        trimis înapoi răspunsul gol e tot „(fără răspuns)”, ca înainte.
//        Mutația care pică: `text: replyText || ta.t('no_reply')` pus în
//        istoric.
//   XA3  refuzul serverului la trimitere: în română EXACT textul serverului
//        (AiError `rate_limited`); în engleză textul codului (= `imports`),
//        FĂRĂ mesajul românesc; pe ACEEAȘI rădăcină, trecut în franceză, se
//        retraduce (eroarea e ținută ca DATĂ). Mutația care pică:
//        `setError(toUserMessage(e, …))`.
//   XA4  eșecul aplicării unei acțiuni: în română textul românesc al
//        serverului; în germană rezerva din `common`, fără el; retradus în
//        engleză la schimbarea limbii. Mutația care pică: `errorMsg:
//        toUserMessage(res.error)` compus la aplicare.
//   XA5  franceza și germana: cardul de acțiune și salutul, fără resturi.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({
  aiChat: vi.fn(),
  toggle: vi.fn(),
}))

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../hooks/useData', () => ({
  useProducts: () => ({
    products: [{ id: 'p1', name: 'Tiramisu', price: 20, is_sold_out: false, category_id: null }],
    create: vi.fn(async () => ({ error: null })),
    update: vi.fn(async () => ({ error: null })),
    toggleSoldOut: h.toggle,
  }),
  useCategories: () => ({
    categories: [{ id: 'c1', name: 'Deserturi', emoji: '🍰' }],
    create: vi.fn(async () => ({ error: null })),
  }),
}))
vi.mock('../../lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/ai')>()
  return { ...actual, aiChat: h.aiChat }
})

import AiChatbot from '../AiChatbot'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { assistantNs } from '../../i18n/ns/assistant'
import { commonNs } from '../../i18n/ns/common'
import aRo from '../../i18n/ns/assistant/ro'
import aEn from '../../i18n/ns/assistant/en'
import aFr from '../../i18n/ns/assistant/fr'
import aDe from '../../i18n/ns/assistant/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import importsEn from '../../i18n/ns/imports/en'
import importsFr from '../../i18n/ns/imports/fr'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(langs.flatMap((l) => [preloadNamespace(assistantNs, l), preloadNamespace(commonNs, l)]))
})

const SOLD_OUT_REPLY =
  'Sigur, îl marchez.\n```json\n{"actions":[{"type":"toggle_sold_out","product_id":"p1","sold_out":true}]}\n```'

beforeEach(() => {
  h.aiChat.mockReset().mockResolvedValue({ text: SOLD_OUT_REPLY })
  h.toggle.mockReset().mockResolvedValue({ error: null })
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const bot = <AiChatbot restaurantId="r1" restaurantName="Bistro" />

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [aEn as Dict, commonEn as Dict],
  fr: [aFr as Dict, commonFr as Dict],
  de: [aDe as Dict, commonDe as Dict],
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)
function nodeText(root: Node): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '')
  return parts.join('\n')
}
function attrText(root: Element): string {
  const out: string[] = []
  for (const el of root.querySelectorAll('[aria-label],[title],[placeholder],[alt]'))
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
      const v = el.getAttribute(a)
      if (v) out.push(v)
    }
  return out.join('\n')
}
const visible = (root: Element): string => `${nodeText(root)}\n${attrText(root)}`

function romanianLeftovers(text: string, lang: 'en' | 'fr' | 'de'): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const sources: readonly [Dict, Dict] = [aRo as Dict, commonRo as Dict]
  sources.forEach((src, i) => {
    const target = TARGETS[lang][i]!
    for (const [k, v] of Object.entries(src)) {
      const own = formsOf(target[k]).join('\n')
      for (const form of formsOf(v))
        for (const piece of form.split(/\{\w+\}/)) {
          const p = piece.trim()
          if (p.length >= 4 && !own.includes(p) && containsWhole(text, p)) out.push(`${k}: ${p}`)
        }
    }
  })
  return out
}

/** Deschide panoul și trimite un mesaj; întoarce după ce răspunsul a sosit. */
async function openAndSend(user: ReturnType<typeof userEvent.setup>, fab: string, placeholder: string, send: string) {
  await user.click(await screen.findByRole('button', { name: fab }))
  await user.type(screen.getByPlaceholderText(placeholder), 'Tiramisu e gata')
  await user.click(screen.getByRole('button', { name: send }))
}

describe('Asistentul AI în limba personalului', () => {
  it('XA0: control pozitiv — panoul românesc are resturi față de engleză', async () => {
    const user = userEvent.setup()
    const { container } = render(tree(null, bot))
    await user.click(await screen.findByRole('button', { name: 'Deschide asistentul AI' }))
    const left = romanianLeftovers(visible(container), 'en')
    expect(left.some((l) => l.startsWith('intro:'))).toBe(true)
    expect(left.some((l) => l.startsWith('input_placeholder:'))).toBe(true)
  })

  it('XA1: fără provider, româna de dinainte', async () => {
    const user = userEvent.setup()
    const { container } = render(tree(null, bot))
    await user.click(await screen.findByRole('button', { name: 'Deschide asistentul AI' }))
    expect(screen.getByText('Asistent AI')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Închide' })).toBeInTheDocument()
    expect(container.textContent).toContain(
      'Salut! Sunt asistentul tău. Pot răspunde la întrebări și pot propune modificări pe meniul QR.' +
        'Încearcă: „Adaugă o pizza Margherita la 32 lei" sau „Marchează Tiramisu ca epuizat".',
    )
    expect(screen.getByText('„Adaugă o pizza Margherita la 32 lei"').tagName).toBe('EM')
    await user.type(screen.getByPlaceholderText('Scrie un mesaj…'), 'Tiramisu e gata')
    await user.click(screen.getByRole('button', { name: 'Trimite mesajul' }))
    expect(await screen.findByText('Disponibilitate produs')).toBeInTheDocument()
    // Răspunsul modelului: ca atare.
    expect(screen.getByText('Sigur, îl marchez.')).toBeInTheDocument()
    expect(container.textContent).toContain('Marchează „Tiramisu" ca STOC EPUIZAT.')
    expect(screen.getByText('STOC EPUIZAT').tagName).toBe('STRONG')
    expect(screen.getByRole('button', { name: 'Confirmă' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Respinge' }))
    expect(await screen.findByText('· respins')).toBeInTheDocument()
  })

  it('XA2: panoul în engleză; promptul și istoricul pentru model rămân românești', async () => {
    const user = userEvent.setup()
    const { container } = render(tree('en', bot))
    await openAndSend(user, 'Open the AI assistant', 'Write a message…', 'Send the message')
    expect(await screen.findByText('Product availability')).toBeInTheDocument()
    expect(container.textContent).toContain('Mark “Tiramisu” as SOLD OUT.')
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    // Promptul de sistem nu se traduce.
    const first = h.aiChat.mock.calls[0]?.[0] as { system: string; messages: { content: string }[] }
    expect(first.system).toContain('Răspunzi mereu în română')
    expect(first.system).toContain('- p1 · Tiramisu · 20 lei')
    expect(first.system).toContain('Ești asistentul AI al restaurantului „Bistro" din platforma Menuvia.')
    // Un răspuns gol: „(no reply)” pe ecran, „(fără răspuns)” în istoric.
    h.aiChat.mockResolvedValueOnce({ text: '' })
    await user.type(screen.getByPlaceholderText('Write a message…'), 'Și altceva?')
    await user.click(screen.getByRole('button', { name: 'Send the message' }))
    expect(await screen.findByText('(no reply)')).toBeInTheDocument()
    h.aiChat.mockResolvedValueOnce({ text: 'Ok.' })
    await user.type(screen.getByPlaceholderText('Write a message…'), 'Mersi')
    await user.click(screen.getByRole('button', { name: 'Send the message' }))
    expect(await screen.findByText('Ok.')).toBeInTheDocument()
    const third = h.aiChat.mock.calls[2]?.[0] as { messages: { role: string; content: string }[] }
    expect(third.messages.map((m) => m.content)).toContain('(fără răspuns)')
    expect(third.messages.map((m) => m.content)).not.toContain('(no reply)')
    // Răspunsul modelului (românesc, ca atare) e DATĂ — se scoate din verificare.
    const text = visible(container).split('Sigur, îl marchez.').join('')
    expect(romanianLeftovers(text, 'en')).toEqual([])
  })

  it('XA3: refuzul serverului — româna serverului, textul codului, retradus la schimbarea limbii', async () => {
    const SERVER_RO = 'Prea multe cereri către asistentul AI. Așteaptă puțin și reîncearcă.'
    const refuse = () => Object.assign(new Error(SERVER_RO), { code: 'rate_limited', status: 429 })
    h.aiChat.mockRejectedValue(refuse())
    const user = userEvent.setup()
    const ro = render(tree(null, bot))
    await openAndSend(user, 'Deschide asistentul AI', 'Scrie un mesaj…', 'Trimite mesajul')
    expect(await screen.findByText(SERVER_RO)).toBeInTheDocument()
    ro.unmount()

    const r = render(tree('en', bot))
    await openAndSend(user, 'Open the AI assistant', 'Write a message…', 'Send the message')
    expect(await screen.findByText(importsEn.err_aiQuota)).toBeInTheDocument()
    expect(r.container.textContent).not.toContain(SERVER_RO)
    r.rerender(tree('fr', bot))
    expect(await screen.findByText(importsFr.err_aiQuota)).toBeInTheDocument()
    expect(screen.queryByText(importsEn.err_aiQuota)).toBeNull()
    // Un cod necunoscut cade pe rezerva contextului.
    r.unmount()
    h.aiChat.mockRejectedValue(Object.assign(new Error('Răspuns neașteptat de la server.'), { code: 'bad_response' }))
    render(tree('de', bot))
    await openAndSend(user, 'KI-Assistenten öffnen', 'Nachricht schreiben…', 'Nachricht senden')
    expect(await screen.findByText('Fehler beim KI-Assistenten.')).toBeInTheDocument()
  })

  it('XA4: eșecul aplicării — româna serverului, rezerva tradusă, retradusă', async () => {
    const SERVER_RO = 'Produsul nu mai există în meniu.'
    h.toggle.mockResolvedValue({ error: { message: SERVER_RO } })
    const user = userEvent.setup()
    const ro = render(tree(null, bot))
    await openAndSend(user, 'Deschide asistentul AI', 'Scrie un mesaj…', 'Trimite mesajul')
    await user.click(await screen.findByRole('button', { name: 'Confirmă' }))
    expect(await screen.findByText(SERVER_RO)).toBeInTheDocument()
    expect(screen.getByText('· eroare')).toBeInTheDocument()
    ro.unmount()

    const r = render(tree('de', bot))
    await openAndSend(user, 'KI-Assistenten öffnen', 'Nachricht schreiben…', 'Nachricht senden')
    await user.click(await screen.findByRole('button', { name: 'Bestätigen' }))
    expect(await screen.findByText(commonDe.err_generic)).toBeInTheDocument()
    expect(screen.getByText('· Fehler')).toBeInTheDocument()
    expect(r.container.textContent).not.toContain(SERVER_RO)
    r.rerender(tree('en', bot))
    expect(await screen.findByText(commonEn.err_generic)).toBeInTheDocument()
    expect(screen.getByText('· error')).toBeInTheDocument()
  })

  it('XA5: franceza și germana — salutul și cardul de acțiune', async () => {
    const user = userEvent.setup()
    const fr = render(tree('fr', bot))
    await openAndSend(user, 'Ouvrir l’assistant IA', 'Écrivez un message…', 'Envoyer le message')
    expect(await screen.findByText('Disponibilité du produit')).toBeInTheDocument()
    expect(fr.container.textContent).toContain('Marquer « Tiramisu » comme ÉPUISÉ.')
    expect(screen.getByRole('button', { name: 'Refuser' })).toBeInTheDocument()
    expect(romanianLeftovers(visible(fr.container).split('Sigur, îl marchez.').join(''), 'fr')).toEqual([])
    fr.unmount()
    const user2 = userEvent.setup()
    const de = render(tree('de', bot))
    await user2.click(await screen.findByRole('button', { name: 'KI-Assistenten öffnen' }))
    expect(de.container.textContent).toContain(
      'Probieren Sie: „Pizza Margherita für 32 lei hinzufügen“ oder „Tiramisu als ausverkauft markieren“.',
    )
    expect(romanianLeftovers(visible(de.container), 'de')).toEqual([])
  })
})
