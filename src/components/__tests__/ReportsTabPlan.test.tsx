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
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const { rows } = vi.hoisted(() => {
  const now = new Date().toISOString()
  return {
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
    for (const m of ['select', 'eq', 'neq', 'gte', 'lte', 'order', 'range', 'in']) {
      b[m] = vi.fn(() => b)
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
})
