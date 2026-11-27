// Fila Bridge în limba personalului (lotul C7a). Pe Planul 2 e DOAR imprimanta
// din bucătărie (nefiscală, vândută și restaurantelor străine) și urmează
// limba personalului prin namespace-ul `bridge`; pe Planul 3 e ecran FISCAL și
// rămâne în română prin lege (lib/fiscalScreens.ts). Prefixul BY: verificat cu
// grep în src/, tests/, e2e/, supabase/, docs/, bridge/ și CLAUDE.md,
// nefolosit înainte.
//
//   BY0  control POZITIV al verificării „fără resturi românești": fila randată
//        în română (fără provider), comparată cu dicționarul englez, ARE
//        resturi. Fără el, BY1–BY2 ar trece și cu o verificare stricată.
//   BY1  Planul 2 în engleză, franceză și germană: antetul, dispozitivul (cu
//        „ultim semnal" și pastila), tichetele (stări, încercări, reprint,
//        antete), fără niciun rest românesc în text sau atribute.
//        Mutația care pică: `{'Ultim semnal '}` lăsat literal.
//   BY2  Planul 2 în engleză: fereastra de înregistrare și fereastra cheii (cei
//        3 pași) — fără resturi.
//   BY3  Planul 3 cu personalul în engleză: fila rămâne ÎN ROMÂNĂ, inclusiv
//        părțile comune cu Planul 2 („Ultim semnal", „Tichete bucătărie").
//        Mutația care pică: `useT(bridgeNs)` fără `lang: 'ro'` pe Planul 3.
//   BY4  confirmările: pe Planul 2 în germană titlul, butonul de confirmare ȘI
//        cel de renunțare în germană, plus `lang: 'de'` pe dialog (portalat);
//        pe Planul 3 `FISCAL_CONFIRM` („Anulează", `lang: 'ro'`).
//        Mutația care pică: `...FISCAL_CONFIRM` lăsat necondiționat.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ConfirmOptions } from '../ui/confirm'

const SECRET = 'dev-secret-0123456789abcdef-zz99'

const { h } = vi.hoisted(() => ({
  h: {
    tables: {} as Record<string, unknown[]>,
    confirm: [] as ConfirmOptions[],
  },
}))

vi.mock('../../lib/supabase', () => {
  function chain(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit', 'delete', 'update', 'insert']) {
      b[m] = vi.fn(() => b)
    }
    b.then = (
      onFulfilled: (v: { data: unknown[]; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: h.tables[table] ?? [], error: null }).then(onFulfilled, onRejected)
    return b
  }
  return {
    supabase: {
      from: vi.fn((t: string) => chain(t)),
      rpc: vi.fn((fn: string) =>
        Promise.resolve(
          fn === 'bridge_register'
            ? { data: [{ device_id: 'dev-new', device_secret: SECRET }], error: null }
            : { data: null, error: null },
        ),
      ),
    },
  }
})
vi.mock('../../lib/bridgeSetup', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getBridgeDownloadUrl: () => 'https://files.example.org/menuvia-bridge-setup.exe',
  getBridgePublicConfig: () => ({ supabaseUrl: 'https://proj.supabase.co', supabaseAnonKey: 'anon-test' }),
}))
vi.mock('../ui/confirm', () => ({
  confirm: async (o: ConfirmOptions) => {
    h.confirm.push(o)
    return false
  },
}))

import BridgeTab from '../BridgeTab'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { bridgeNs } from '../../i18n/ns/bridge'
import { commonNs } from '../../i18n/ns/common'
import bridgeRo from '../../i18n/ns/bridge/ro'
import bridgeEn from '../../i18n/ns/bridge/en'
import bridgeFr from '../../i18n/ns/bridge/fr'
import bridgeDe from '../../i18n/ns/bridge/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(langs.flatMap((l) => [preloadNamespace(bridgeNs, l), preloadNamespace(commonNs, l)]))
})

const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString()

beforeEach(() => {
  h.confirm = []
  h.tables = {
    bridge_devices: [
      {
        id: 'd1',
        name: 'Kitchen PC 1',
        last_seen_at: minutesAgo(10),
        fiscalnet_brand: null,
        fiscalnet_model: null,
        prints_kitchen_receipts: true,
      },
    ],
    kitchen_tickets: [
      { id: 't1', order_id: 'abcdef12-0000-0000-0000-000000000001', status: 'error', error_code: 'PRINTER_TIMEOUT', retry_count: 2, is_reprint: true, created_at: minutesAgo(5) },
      { id: 't2', order_id: 'abcdef12-0000-0000-0000-000000000002', status: 'pending', error_code: null, retry_count: 1, is_reprint: false, created_at: minutesAgo(90) },
      { id: 't3', order_id: 'abcdef12-0000-0000-0000-000000000003', status: 'sent', error_code: null, retry_count: 0, is_reprint: false, created_at: minutesAgo(60 * 50) },
      { id: 't4', order_id: 'abcdef12-0000-0000-0000-000000000004', status: 'success', error_code: null, retry_count: 0, is_reprint: false, created_at: minutesAgo(0) },
    ],
    pending_receipts: [],
    vat_rates: [],
  }
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const inLang = (lang: StaffLang | null, fiscal = false) =>
  render(tree(lang, <BridgeTab restaurantId="r1" fiscalEnabled={fiscal} />))

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [bridgeEn as Dict, commonEn as Dict],
  fr: [bridgeFr as Dict, commonFr as Dict],
  de: [bridgeDe as Dict, commonDe as Dict],
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)
// Textul pe NODURI (un text împărțit în două noduri nu se lipește fals).
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
  const sources: readonly [Dict, Dict] = [bridgeRo as Dict, commonRo as Dict]
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

describe('BridgeTab — limba personalului pe Planul 2 (C7a)', () => {
  it('BY0 control pozitiv: în română fila are resturi față de engleză', async () => {
    inLang(null)
    expect(await screen.findByText('Kitchen PC 1')).toBeInTheDocument()
    const left = romanianLeftovers(visible(document.body), 'en')
    expect(left.length).toBeGreaterThan(5)
    expect(screen.getByText('Ultim semnal 10 min')).toBeInTheDocument()
  })

  it.each(['en', 'fr', 'de'] as const)('BY1 Planul 2 în %s: fila, dispozitivul și tichetele fără resturi', async (lang) => {
    const view = inLang(lang)
    const [bt, tc] = TARGETS[lang]
    expect(await screen.findByText(String(bt.intro_kitchen))).toBeInTheDocument()
    expect(screen.getByText('Kitchen PC 1')).toBeInTheDocument()
    expect(screen.getByTestId('bridge-device-status')).toHaveTextContent(String(bt.status_offline))
    expect(screen.getByRole('heading', { name: String(bt.tickets_title) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: String(tc.retry) })).toBeInTheDocument()
    expect(screen.getByText(String(bt.st_sentPrinter))).toBeInTheDocument()
    expect(romanianLeftovers(visible(view.container), lang)).toEqual([])
  })

  it('BY2 Planul 2 în engleză: înregistrarea și fereastra cheii fără resturi', async () => {
    const user = userEvent.setup()
    inLang('en')
    await user.click(await screen.findByRole('button', { name: 'Register device' }))
    expect(screen.getByText('Register a Bridge device')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. Kitchen PC')).toBeInTheDocument()
    expect(romanianLeftovers(visible(document.body), 'en')).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByTestId('bridge-key-steps')).toBeInTheDocument()
    expect(screen.getByText('Device registered')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Download the installer/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download config\.json/ })).toBeInTheDocument()
    expect(romanianLeftovers(visible(document.body), 'en')).toEqual([])
  })

  it('BY3 Planul 3 cu personalul în engleză: fila rămâne în română', async () => {
    const view = inLang('en', true)
    expect(await screen.findByText(/^Integrare FiscalNet/)).toBeInTheDocument()
    expect(screen.getByText(/Ultim semnal 10 min/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tichete bucătărie' })).toBeInTheDocument()
    expect(screen.getByTestId('bridge-device-status')).toHaveTextContent('○ Offline')
    const text = visible(view.container)
    expect(text).not.toMatch(/Last signal|Kitchen tickets|Sent to printer/)
  })

  it('BY4 confirmările: în limba personalului pe Planul 2, FISCAL_CONFIRM pe Planul 3', async () => {
    const user = userEvent.setup()
    const de = inLang('de')
    await user.click(await screen.findByRole('button', { name: String(commonDe.delete) }))
    expect(h.confirm).toHaveLength(1)
    expect(h.confirm[0]).toMatchObject({
      title: bridgeDe.delete_title,
      description: bridgeDe.delete_descKitchen,
      confirmLabel: bridgeDe.delete_confirm,
      cancelLabel: commonDe.cancel,
      lang: 'de',
    })
    de.unmount()

    inLang('en', true)
    await user.click(await screen.findByRole('button', { name: 'Șterge' }))
    expect(h.confirm).toHaveLength(2)
    expect(h.confirm[1]).toMatchObject({ title: 'Ștergi acest dispozitiv?', cancelLabel: 'Anulează', lang: 'ro' })
  })
})
