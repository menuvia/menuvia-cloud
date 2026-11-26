// Rapoarte pe planul restaurantului (lotul P, nov 2026). Fila e de la Planul 2
// (NAV_GROUPS minTier 2); sumele sunt ale planului cu bon (`fiscalReports` =
// planSurface.fiscal în DashboardPage).
//
//   RP1  Planul 2: tabelul „Top produse" are DOAR #, Produs, Buc. — coloanele
//        „Venituri" și „Preț mediu" nu se arată deloc (fost „—" pe fiecare
//        rând); alerta galbenă „nu este raport fiscal" e acum o notă discretă
//        de o linie, iar nota despre raportul Z dispare; niciun termen fiscal.
//        Mutația care pică: coloanele randate cu „—", alerta veche readusă sau
//        nota despre raportul Z necondiționată.
//   RP2  control pozitiv pe Planul 3: coloanele de sume și nota despre raportul
//        Z apar.
//   RP3  lotul G2b: prop-ul `timeZone` decide granițele zilei cerute serverului.
//        Acum = 15 nov 03:30Z = 14 nov 22:30 la New York; pe „Azi” comenzile se
//        cer pe [14 nov 05:00Z, 15 nov 04:59:59.999Z] (ziua New York-ului).
//        Control: fără prop (București) aceeași clipă e 15 nov → de la 14 nov
//        22:00Z. Mutația care pică: prop-ul ignorat (`zonedDayRange(…,
//        DEFAULT_RESTAURANT_TZ)`) sau scos din DashboardPage (ZT5).
//   XP6  lotul C6a: perioada aleasă („7 zile”) supraviețuiește demontării
//        filei (DashboardPage montează filele condiționat), iar pe Planul 2
//        graficul „Comenzi pe zi” apare pe un interval de mai multe zile (pe
//        „Azi”, o singură zi, nu). Control POZITIV: cu `sessionStorage` golit,
//        fila pornește iar pe „Azi”. Mutația care pică: `useState('today')`
//        readus în locul `useSessionChoice`.
// `sessionStorage` se golește înaintea fiecărui test: RP3 cere perioada „Azi”.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { rows, filters } = vi.hoisted(() => {
  const now = new Date().toISOString()
  return {
    // Filtrele de interval cerute pe fiecare tabelă: [tabelă, metodă, coloană, valoare].
    filters: [] as [string, string, string, unknown][],
    rows: {
      orders: [
        {
          id: 'o1',
          source: 'qr',
          status: 'served',
          total: 30,
          paid_amount: 30,
          payment_method: 'cash',
          created_at: now,
          paid_at: now,
        },
      ],
      order_items: [
        { product_name_snapshot: 'Supă de roșii', quantity: 2, unit_price_snapshot: 15, product_id: 'p1' },
      ],
      products: [{ id: 'p1', emoji: '🍅' }],
      v_daily_payments_by_method: [],
    } as Record<string, unknown[]>,
  }
})

vi.mock('../../lib/supabase', () => {
  function chain(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'order', 'range', 'in']) {
      b[m] = vi.fn(() => b)
    }
    for (const m of ['gte', 'lte']) {
      b[m] = vi.fn((col: string, val: unknown) => {
        filters.push([table, m, col, val])
        return b
      })
    }
    b.then = (
      onFulfilled: (v: { data: unknown[]; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(onFulfilled, onRejected)
    return b
  }
  return { supabase: { from: vi.fn((t: string) => chain(t)), rpc: vi.fn() } }
})
vi.mock('../../lib/reports', () => ({
  fetchWaiterSales: async () => [],
  fetchHourlySales: async () => [],
  fetchCategorySales: async () => [],
  toCsv: () => '',
  csvCell: (v: unknown) => String(v ?? ''),
  downloadCsv: vi.fn(),
}))
vi.mock('../../lib/pdf', () => ({ patchPdfDiacritics: vi.fn() }))
// recharts măsoară containerul (ResponsiveContainer) — inert în jsdom.
vi.mock('recharts', () => {
  const Box = () => null
  return {
    BarChart: Box,
    Bar: Box,
    XAxis: Box,
    YAxis: Box,
    Tooltip: Box,
    ResponsiveContainer: Box,
    CartesianGrid: Box,
    Cell: Box,
  }
})

import ReportsTab from '../ReportsTab'

const FISCAL = /\bTVA\b|bon(ul|uri)? fiscal|cas[aă] de marcat|Bridge fiscal|raport fiscal|raportul Z/i

describe('ReportsTab — sumele doar pe planul cu bon', () => {
  it('RP1: Planul 2 — top produse fără Venituri/Preț mediu, notă de o linie, nimic fiscal', async () => {
    const { container } = render(<ReportsTab restaurantId="r1" fiscalReports={false} />)
    // Ancora: produsul e în top (raportul s-a încărcat).
    expect(await screen.findByText('Supă de roșii')).toBeInTheDocument()
    expect(screen.getByText('Evidența comenzilor: cantități și produse, fără sume.')).toBeInTheDocument()
    expect(screen.queryByText('Venituri')).toBeNull()
    expect(screen.queryByText('Preț mediu')).toBeNull()
    expect(screen.queryByText(/Evidență operațională/)).toBeNull()
    expect(container.textContent ?? '').not.toMatch(FISCAL)
    expect(container.textContent ?? '').not.toMatch(/\blei\b/)
  })

  it('RP2: control pozitiv — pe Planul 3 coloanele de sume și nota despre raportul Z', async () => {
    const { container } = render(<ReportsTab restaurantId="r1" fiscalReports />)
    expect(await screen.findByText('Supă de roșii')).toBeInTheDocument()
    expect(screen.getAllByText('Preț mediu').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Venituri').length).toBeGreaterThanOrEqual(1)
    expect(container.textContent ?? '').toMatch(/raportul Z fiscal/)
  })

  it('RP3: granițele zilei urmează prop-ul timeZone (New York vs București)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-15T03:30:00Z'))
    filters.length = 0
    const ny = render(<ReportsTab restaurantId="r1" fiscalReports={false} timeZone="America/New_York" />)
    expect(await screen.findByText('Supă de roșii')).toBeInTheDocument()
    const orders = filters.filter(([t, , c]) => t === 'orders' && c === 'created_at')
    expect(orders).toContainEqual(['orders', 'gte', 'created_at', '2026-11-14T05:00:00.000Z'])
    expect(orders).toContainEqual(['orders', 'lte', 'created_at', '2026-11-15T04:59:59.999Z'])
    ny.unmount()

    filters.length = 0
    render(<ReportsTab restaurantId="r1" fiscalReports={false} />)
    expect(await screen.findByText('Supă de roșii')).toBeInTheDocument()
    const ro = filters.filter(([t, , c]) => t === 'orders' && c === 'created_at')
    expect(ro).toContainEqual(['orders', 'gte', 'created_at', '2026-11-14T22:00:00.000Z'])
    expect(ro).toContainEqual(['orders', 'lte', 'created_at', '2026-11-15T21:59:59.999Z'])
  })

  it('XP6: perioada aleasă rămâne după demontarea filei; graficul de comenzi pe Planul 2', async () => {
    const user = userEvent.setup()
    const first = render(<ReportsTab restaurantId="r1" fiscalReports={false} />)
    expect(await screen.findByText('Supă de roșii')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Azi' })).toHaveAttribute('aria-pressed', 'true')
    // O singură zi = fără grafic, ca înainte.
    expect(screen.queryByText('Comenzi pe zi')).toBeNull()
    await user.click(screen.getByRole('button', { name: '7 zile' }))
    expect(await screen.findByText('Comenzi pe zi')).toBeInTheDocument()
    first.unmount()

    // Fila revenită (remontată) pornește de unde a rămas.
    const second = render(<ReportsTab restaurantId="r1" fiscalReports={false} />)
    expect(await screen.findByText('Supă de roșii')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '7 zile' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Ultimele 7 zile', { selector: 'p' })).toBeInTheDocument()
    second.unmount()

    // Control: fără alegerea salvată, iar „Azi”.
    window.sessionStorage.clear()
    render(<ReportsTab restaurantId="r1" fiscalReports={false} />)
    expect(await screen.findByText('Supă de roșii')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Azi' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '7 zile' })).toHaveAttribute('aria-pressed', 'false')
  })
})

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})
