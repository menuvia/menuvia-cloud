// Fila Statistici în limba personalului (lotul L7): AnalyticsTab citește
// namespace-ul `analytics` („Reîncearcă” și clasele de erori din `common`).
// (Prefixul AY: verificat cu grep în src/, tests/, e2e/, supabase/tests, docs
// și CLAUDE.md, nefolosit înainte; AY6–AY7 sunt pure, în
// src/lib/__tests__/analyticsLang.test.ts.)
// recharts e înlocuit cu un dublu care randează EXACT ce ajunge la ecran din
// grafice: etichetele zilelor de pe axă (din `data`), numele feliilor (din
// `data` al lui Pie) și numele seriei din tooltip (al doilea element întors de
// `formatter`) — altfel testul ar fi orb la tot textul graficelor.
//   AY0  control POZITIV al verificării „fără text românesc”: fila randată în
//        română, comparată cu dicționarul englez, ARE resturi.
//   AY1  fără provider (azi, mereu româna): textele de dinainte, cu pluralele
//        FALSE („Ultimele 30 zile”, „7 zile”), „Bon mediu”, „Cant.”, feliile
//        „Cash”/„Tichete de masă”, ziua „03.11” pe axă, seria „Venit” în
//        tooltip, „Anonim” pentru un ospătar fără nume, sumele în „lei”.
//   AY2  fila în engleză, fără resturi românești: „Last 30 days”, „7 days”,
//        „Average ticket”, feliile „Meal vouchers”/„Waiter”, ziua „03/11”,
//        seria „Revenue”; banii rămân „… lei” (formatarea de azi). Mutația
//        care pică: `name: 'Tichete de masă'` readus în `payPie`.
//   AY3  germana și franceza: „Letzte 30 Tage”, ziua „03.11.”, „30 derniers
//        jours”, fără resturi.
//   AY4  eroarea de încărcare: în română EXACT textul românesc al serverului
//        (ca `toUserMessage`); în engleză rezerva tradusă, FĂRĂ mesajul
//        românesc, și „Try again”; pe ACEEAȘI rădăcină, trecut în germană, se
//        retraduce (eroarea e ținută ca DATĂ). Mutația care pică:
//        `setError(toUserMessage(e, …))` cu text compus la încărcare.
//   AY5  restaurantul din afara României (gate-ul fiscal neschimbat, nimic
//        nu se încarcă): mesajul în franceză, fără rest românesc.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ result: vi.fn() }))

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'gte', 'order', 'limit']) b[m] = () => b
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(h.result(table)).then(ok, ko)
      return b
    },
  },
}))
vi.mock('recharts', async () => {
  const { createElement, Fragment } = await import('react')
  type Kids = { children?: ReactNode }
  const Pass = ({ children }: Kids) => createElement(Fragment, null, children)
  const Nothing = () => null
  const Chart = ({ data, children }: Kids & { data?: Array<Record<string, unknown>> }) =>
    createElement(
      'div',
      null,
      createElement('span', null, (data ?? []).map((d) => String(d.day ?? d.hour ?? '')).join(' | ')),
      children,
    )
  const Pie = ({ data }: { data: Array<{ name: string }> }) =>
    createElement(
      'ul',
      null,
      data.map((d) => createElement('li', { key: d.name }, d.name)),
    )
  const Tooltip = ({ formatter }: { formatter?: (v: unknown) => unknown[] }) =>
    formatter ? createElement('span', null, `${String(formatter(12.5)[0])} ${String(formatter(12.5)[1] ?? '')}`) : null
  return {
    LineChart: Chart,
    BarChart: Chart,
    PieChart: Pass,
    ResponsiveContainer: Pass,
    Pie,
    Tooltip,
    Line: Nothing,
    Bar: Nothing,
    XAxis: Nothing,
    YAxis: Nothing,
    CartesianGrid: Nothing,
    Cell: Nothing,
  }
})

import AnalyticsTab from '../AnalyticsTab'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { analyticsNs } from '../../i18n/ns/analytics'
import { commonNs } from '../../i18n/ns/common'
import anRo from '../../i18n/ns/analytics/ro'
import anEn from '../../i18n/ns/analytics/en'
import anFr from '../../i18n/ns/analytics/fr'
import anDe from '../../i18n/ns/analytics/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(langs.flatMap((l) => [preloadNamespace(analyticsNs, l), preloadNamespace(commonNs, l)]))
})

const DATA: Record<string, { data: unknown[]; error: null }> = {
  v_daily_orders: {
    data: [
      {
        // `v_daily_orders.day` e o coloană `date`: PostgREST o întoarce ca
        // „YYYY-MM-DD”, iar axa o formatează ca DATĂ (`formatYmd`, lotul G2b).
        day: '2026-11-03',
        total_orders: 4,
        revenue: 200,
        qr_orders: 1,
        cash_revenue: 120,
        card_revenue: 0,
        voucher_revenue: 80,
        online_revenue: 0,
        other_revenue: 0,
      },
    ],
    error: null,
  },
  v_product_performance: {
    data: [{ product_name: 'Ciorbă de burtă', total_quantity: 3, order_appearances: 2, revenue: 75 }],
    error: null,
  },
  v_waiter_performance: {
    data: [{ user_id: 'u-anon', orders_entered: 3, orders_served: 2, revenue_collected: 150 }],
    error: null,
  },
  v_hourly_distribution: { data: [{ hour: 13, order_count: 4 }], error: null },
  restaurant_memberships: { data: [], error: null },
}

beforeEach(() => {
  h.result.mockReset().mockImplementation((table: string) => DATA[table] ?? { data: [], error: null })
})

// Cache-ul de sesiune al filei e pe (restaurant, zile): fiecare test are
// restaurantul lui, ca o rulare să nu servească datele alteia.
let seq = 0
const nextId = () => `r-ay-${++seq}`
function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const tab = (id: string, fiscalEnabled: boolean | null = true) => (
  <AnalyticsTab restaurantId={id} plan="pro" fiscalEnabled={fiscalEnabled} />
)

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [anEn as Dict, commonEn as Dict],
  fr: [anFr as Dict, commonFr as Dict],
  de: [anDe as Dict, commonDe as Dict],
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
function romanianLeftovers(text: string, lang: 'en' | 'fr' | 'de'): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const sources: readonly [Dict, Dict] = [anRo as Dict, commonRo as Dict]
  sources.forEach((src, i) => {
    const target = TARGETS[lang][i]!
    for (const [k, v] of Object.entries(src)) {
      const own = formsOf(target[k]).join('\n')
      for (const form of formsOf(v))
        for (const piece of form.split(/\{\w+\}/)) {
          const p = piece.trim()
          // ≥ 4: „Card”, „Cash”, „Venit” sunt scurte, dar sunt chiar textele filei.
          if (p.length >= 4 && !own.includes(p) && containsWhole(text, p)) out.push(`${k}: ${p}`)
        }
    }
  })
  return out
}

describe('Statistici în limba personalului', () => {
  it('AY0: control pozitiv — fila românească are resturi față de engleză', async () => {
    const { container } = render(tree(null, tab(nextId())))
    await screen.findByText('Venit pe zi')
    const left = romanianLeftovers(nodeText(container), 'en')
    expect(left.some((l) => l.startsWith('chart_revenue:'))).toBe(true)
    expect(left.some((l) => l.startsWith('method_voucher:'))).toBe(true)
  })

  it('AY1: fără provider, româna de dinainte', async () => {
    const { container } = render(tree(null, tab(nextId())))
    expect(await screen.findByText('Ultimele 30 zile')).toBeInTheDocument()
    for (const d of [7, 14, 30]) expect(screen.getByRole('button', { name: `${d} zile` })).toBeInTheDocument()
    for (const s of ['Comenzi', 'Venit', 'Bon mediu', 'Rata QR', 'Venit pe zi', 'Comenzi pe zi'])
      expect(screen.getAllByText(s).length, s).toBeGreaterThan(0)
    expect(screen.getByText('200 lei')).toBeInTheDocument()
    expect(screen.getByText('50.00 lei')).toBeInTheDocument()
    expect(screen.getByText('Sursă comenzi')).toBeInTheDocument()
    expect(screen.getByText('Metodă plată')).toBeInTheDocument()
    for (const s of ['Cash', 'Tichete de masă', 'QR', 'Ospătar']) expect(screen.getAllByText(s).length, s).toBeGreaterThan(0)
    expect(screen.getAllByText('03.11')).toHaveLength(2) // venit + comenzi pe zi
    expect(screen.getByText('12.50 lei Venit')).toBeInTheDocument()
    expect(screen.getAllByText('12.5 Comenzi').length).toBe(2)
    const text = container.textContent ?? ''
    expect(text).toContain('Ore de vârf · ultimele 30 de zile')
    expect(text).toContain('Top produse · total istoric')
    expect(text).toContain('Performanță ospătar · total istoric')
    for (const s of ['Produs', 'Cant.', 'Introduse', 'Servite', 'Anonim', 'Ciorbă de burtă'])
      expect(screen.getByText(s), s).toBeInTheDocument()
  })

  it('AY2: fila în engleză, fără resturi românești', async () => {
    const { container } = render(tree('en', tab(nextId())))
    expect(await screen.findByText('Last 30 days')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '7 days' })).toBeInTheDocument()
    expect(screen.getByText('Average ticket')).toBeInTheDocument()
    expect(screen.getByText('Revenue per day')).toBeInTheDocument()
    expect(screen.getByText('Meal vouchers')).toBeInTheDocument()
    expect(screen.getAllByText('Waiter').length).toBe(2) // felia + antetul tabelului
    expect(screen.getAllByText('03/11')).toHaveLength(2)
    expect(screen.getByText('12.50 lei Revenue')).toBeInTheDocument()
    expect(screen.getByText('Anonymous')).toBeInTheDocument()
    // Banii: formatarea de azi, în lei.
    expect(screen.getByText('200 lei')).toBeInTheDocument()
    // Datele nu se traduc.
    expect(screen.getByText('Ciorbă de burtă')).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), 'en')).toEqual([])
  })

  it('AY3: germana și franceza', async () => {
    const de = render(tree('de', tab(nextId())))
    expect(await screen.findByText('Letzte 30 Tage')).toBeInTheDocument()
    expect(screen.getAllByText('03.11.')).toHaveLength(2)
    expect(screen.getByText('Durchschnittsbon')).toBeInTheDocument()
    expect(screen.getByText('Essensgutscheine')).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(de.container), 'de')).toEqual([])
    de.unmount()
    const fr = render(tree('fr', tab(nextId())))
    expect(await screen.findByText('30 derniers jours')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '14 jours' })).toBeInTheDocument()
    expect(screen.getByText('Ticket moyen')).toBeInTheDocument()
    expect(screen.getAllByText('03/11')).toHaveLength(2)
    expect(romanianLeftovers(nodeText(fr.container), 'fr')).toEqual([])
  })

  it('AY4: eroarea de încărcare — româna serverului, rezerva tradusă, retradusă la schimbarea limbii', async () => {
    const SERVER_RO = 'Statisticile nu sunt disponibile pentru acest restaurant.'
    h.result.mockImplementation((table: string) =>
      table === 'v_daily_orders' ? { data: null, error: { message: SERVER_RO, code: 'P0001' } } : DATA[table],
    )
    const ro = render(tree(null, tab(nextId())))
    expect(await screen.findByText(SERVER_RO)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reîncearcă' })).toBeInTheDocument()
    ro.unmount()

    const id = nextId()
    const r = render(tree('en', tab(id)))
    expect(await screen.findByText('Couldn’t load the statistics')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(r.container.textContent).not.toContain(SERVER_RO)
    r.rerender(tree('de', tab(id)))
    expect(await screen.findByText('Die Statistiken konnten nicht geladen werden')).toBeInTheDocument()
    expect(screen.queryByText('Couldn’t load the statistics')).toBeNull()
    expect(r.container.textContent).not.toContain(SERVER_RO)
  })

  it('AY5: restaurantul din afara României, în franceză', async () => {
    const { container } = render(tree('fr', tab(nextId(), false)))
    expect(
      await screen.findByText(
        'Les statistiques d’encaissement reposent sur les données fiscales et ne sont disponibles que pour les restaurants situés en Roumanie.',
      ),
    ).toBeInTheDocument()
    expect(h.result).not.toHaveBeenCalled()
    expect(romanianLeftovers(nodeText(container), 'fr')).toEqual([])
    // Control în română: textul de dinainte.
    render(tree(null, tab(nextId(), false)))
    expect(
      screen.getByText(
        'Statisticile de încasări se bazează pe datele fiscale și sunt disponibile doar pentru restaurantele din România.',
      ),
    ).toBeInTheDocument()
  })
})
