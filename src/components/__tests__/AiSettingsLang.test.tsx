// Setări → Asistent AI în limba personalului (lotul L6b): AiSettingsTab
// citește namespace-ul `aiSettings` („Reîncearcă” din `common`). Testele de
// comportament (AiSettingsTab.test AIS1–AIS7) rămân NESCHIMBATE — aici e doar
// limba.
// (Prefixul LQ: verificat cu grep în src/, tests/ și supabase/tests, nefolosit
// înainte.)
//   LQ0  control POZITIV al verificării „fără text românesc”: fila randată în
//        română, comparată cu dicționarul englez, ARE resturi.
//   LQ1  fără provider (azi, mereu româna): consumul „1.234” + „/ 50.000
//        incluse”, „+ 2.000 credite”, „… Ai 50.000 tokens incluși pe lună.”
//        (textContent-ul paragrafului), pachetele „100.000 tokens” / „19 lei”,
//        „Se încarcă...” cu TREI puncte.
//   LQ2  fila în engleză: numerele în formatul limbii (1,234 / 100,000), prețul
//        rămâne „19 lei” (bani, ca azi), secțiunea „Advanced (optional)” cu
//        furnizorii (mărcile neschimbate), placeholderul modelului și indicația
//        furnizorului, fără resturi. Mutația care pică: `{p.label}` cu eticheta
//        românească „Personalizat (OpenAI-compatible)” readusă.
//   LQ3  refuzul serverului la salvare: în română EXACT textul serverului; în
//        engleză textul propriu al `code`-ului (`rate_limited`), FĂRĂ mesajul
//        românesc; pe aceeași rădăcină, trecut în germană, se retraduce (mesajul
//        e ținut ca DATĂ); un `code` necunoscut → rezerva „Couldn’t save.”.
//        Mutația care pică: `setMsg({ kind: 'err', text: toUserMessage(…) })`.
//   LQ4  validarea furnizorului personalizat în germană, retradusă în franceză
//        la schimbarea limbii; mesajul de succes la fel. Mutația care pică:
//        `setMsg({ kind: 'err', text: '…' })` cu text compus la salvare.
//   LQ5  citirea eșuată și modul fondator în franceză.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

interface ConfigRead {
  data: unknown
  error: { message: string; code: string } | null
}

const h = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  saveAiConfig: vi.fn(),
}))

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({ maybeSingle: () => h.maybeSingle(id) }),
      }),
    }),
    rpc: (fn: string, args: unknown) => h.rpc(fn, args),
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  },
}))
vi.mock('../../lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/ai')>()
  return { ...actual, saveAiConfig: h.saveAiConfig }
})

import AiSettingsTab from '../AiSettingsTab'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { aiSettingsNs } from '../../i18n/ns/aiSettings'
import { commonNs } from '../../i18n/ns/common'
import aiRo from '../../i18n/ns/aiSettings/ro'
import aiEn from '../../i18n/ns/aiSettings/en'
import aiFr from '../../i18n/ns/aiSettings/fr'
import aiDe from '../../i18n/ns/aiSettings/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(
    langs.flatMap((l) => [preloadNamespace(aiSettingsNs, l), preloadNamespace(commonNs, l)]),
  )
})

const NO_ROW: ConfigRead = { data: null, error: null }
const READ_FAILED: ConfigRead = { data: null, error: { message: 'Failed to fetch', code: '' } }
const QUOTA = {
  used_tokens: 1234,
  included_tokens: 50000,
  included_remaining: 48766,
  credit_balance: 2000,
}

beforeEach(() => {
  h.maybeSingle.mockReset().mockResolvedValue(NO_ROW)
  h.rpc.mockReset().mockResolvedValue({ data: QUOTA, error: null })
  h.saveAiConfig.mockReset().mockResolvedValue({
    ok: true,
    config: {
      restaurant_id: 'r1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      base_url: null,
      enabled: true,
      key_masked: null,
    },
  })
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const tab = (readOnly = false) => <AiSettingsTab restaurantId="r1" readOnly={readOnly} />
const inLang = (lang: StaffLang | null, node: ReactNode) => render(tree(lang, node))

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [aiEn as Dict, commonEn as Dict],
  fr: [aiFr as Dict, commonFr as Dict],
  de: [aiDe as Dict, commonDe as Dict],
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
  const sources: readonly [Dict, Dict] = [aiRo as Dict, commonRo as Dict]
  sources.forEach((src, i) => {
    const target = TARGETS[lang][i]!
    for (const [k, v] of Object.entries(src)) {
      const own = formsOf(target[k]).join('\n')
      for (const form of formsOf(v))
        for (const piece of form.split(/\{\w+\}/)) {
          const p = piece.trim()
          if (p.length >= 6 && !own.includes(p) && containsWhole(text, p)) out.push(`${k}: ${p}`)
        }
    }
  })
  return out
}

const aiError = (code: string, message: string) =>
  Object.assign(new Error(message), { code, status: 429 })

describe('Asistentul AI în limba personalului', () => {
  it('LQ0: control pozitiv — fila românească are resturi față de engleză', async () => {
    const { container } = inLang(null, tab())
    await screen.findByRole('button', { name: 'Salvează configurația' })
    const left = romanianLeftovers(visible(container), 'en')
    expect(left.some((l) => l.startsWith('intro:'))).toBe(true)
    expect(left.some((l) => l.startsWith('credits_title:'))).toBe(true)
  })

  it('LQ1: fără provider, româna de dinainte', async () => {
    h.maybeSingle.mockReturnValueOnce(new Promise(() => {}))
    const pending = inLang(null, tab())
    expect(screen.getByText('Se încarcă...')).toBeInTheDocument()
    pending.unmount()

    const { container } = inLang(null, tab())
    await screen.findByRole('button', { name: 'Salvează configurația' })
    expect(screen.getByText('1.234')).toBeInTheDocument()
    expect(screen.getByText('/ 50.000 incluse')).toBeInTheDocument()
    expect(screen.getByText('+ 2.000 credite')).toBeInTheDocument()
    const desc = [...container.querySelectorAll('p')].find((p) =>
      p.textContent?.startsWith('Asistentul e activ'),
    )
    expect(desc?.textContent).toBe(
      'Asistentul e activ implicit pentru contul tău — cheia e gestionată de Menuvia, nu ai nevoie de ' +
        'nicio configurare tehnică. Ai 50.000 tokens incluși pe lună.',
    )
    expect(screen.getByText('100.000 tokens')).toBeInTheDocument()
    expect(screen.getByText('2.000.000 tokens')).toBeInTheDocument()
    expect(screen.getByText('19 lei')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Avansat \(opțional\)/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Cumpără' })).toHaveLength(3)
  })

  it('LQ2: fila în engleză, fără resturi românești', async () => {
    const user = userEvent.setup()
    const { container } = inLang('en', tab())
    await screen.findByRole('button', { name: 'Save configuration' })
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(screen.getByText('/ 50,000 included')).toBeInTheDocument()
    expect(screen.getByText('+ 2,000 credits')).toBeInTheDocument()
    expect(screen.getByText('100,000 tokens')).toBeInTheDocument()
    expect(screen.getByText('19 lei')).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'Turn on the AI assistant for this restaurant' }),
    ).toBeChecked()
    await user.click(screen.getByRole('button', { name: /Advanced \(optional\)/ }))
    for (const name of [
      'OpenAI',
      'Anthropic (Claude)',
      'Google Gemini',
      'Custom (OpenAI-compatible)',
    ])
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. gpt-4o, gpt-4o-mini')).toBeInTheDocument()
    expect(screen.getByText('Key from platform.openai.com (starts with sk-…)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Leave empty to use the Menuvia key')).toBeInTheDocument()
    expect(romanianLeftovers(visible(container), 'en')).toEqual([])
    expect(nodeText(container)).not.toMatch(/[ăĂșȘțȚ]/)
  })

  it('LQ3: refuzul serverului la salvare — română = serverul; engleză/germană după `code`', async () => {
    const SERVER = 'Prea multe cereri către asistentul AI. Așteaptă puțin și reîncearcă.'
    h.saveAiConfig.mockRejectedValue(aiError('rate_limited', SERVER))
    const user = userEvent.setup()
    const ro = inLang(null, tab())
    await user.click(await screen.findByRole('button', { name: 'Salvează configurația' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(SERVER)
    ro.unmount()

    const r = inLang('en', tab())
    await user.click(await screen.findByRole('button', { name: 'Save configuration' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many requests to the AI assistant. Wait a moment and try again.',
    )
    expect(screen.queryByText(SERVER)).not.toBeInTheDocument()
    r.rerender(tree('de', tab()))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Zu viele Anfragen an den KI-Assistenten. Warten Sie kurz und versuchen Sie es erneut.',
    )
    r.unmount()

    h.saveAiConfig.mockRejectedValue(aiError('something_new', 'Ceva nou nu a mers pe server.'))
    inLang('en', tab())
    await user.click(await screen.findByRole('button', { name: 'Save configuration' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save.')
    expect(screen.queryByText('Ceva nou nu a mers pe server.')).not.toBeInTheDocument()
  })

  it('LQ4: validarea furnizorului personalizat și succesul se retraduc', async () => {
    const user = userEvent.setup()
    const r = inLang('de', tab())
    await screen.findByRole('button', { name: 'Konfiguration speichern' })
    await user.click(screen.getByRole('button', { name: /Erweitert \(optional\)/ }))
    await user.click(screen.getByRole('button', { name: 'Benutzerdefiniert (OpenAI-kompatibel)' }))
    expect(screen.getByPlaceholderText('https://api.beispiel.de/v1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Konfiguration speichern' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Der benutzerdefinierte Anbieter braucht eine https-URL.',
    )
    expect(h.saveAiConfig).not.toHaveBeenCalled()
    expect(romanianLeftovers(visible(r.container), 'de')).toEqual([])
    r.rerender(tree('fr', tab()))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Le fournisseur personnalisé a besoin d’une URL https.',
    )
    r.unmount()

    const s = inLang('en', tab())
    await user.click(await screen.findByRole('button', { name: 'Save configuration' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Configuration saved. The key is managed by Menuvia.',
      ),
    )
    s.rerender(tree('fr', tab()))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Configuration enregistrée. La clé est gérée par Menuvia.',
    )
  })

  it('LQ5: citirea eșuată și modul fondator în franceză', async () => {
    h.maybeSingle.mockResolvedValue(READ_FAILED)
    const r = inLang('fr', tab())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nous n’avons pas pu lire la configuration IA enregistrée.',
    )
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
    expect(romanianLeftovers(visible(r.container), 'fr')).toEqual([])
    r.unmount()

    h.maybeSingle.mockResolvedValue(NO_ROW)
    const founder = inLang('fr', tab(true))
    expect(
      await screen.findByText(/^En mode fondateur, vous voyez la configuration/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enregistrer la configuration' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Acheter' })).toBeNull()
    expect(romanianLeftovers(visible(founder.container), 'fr')).toEqual([])
  })
})
