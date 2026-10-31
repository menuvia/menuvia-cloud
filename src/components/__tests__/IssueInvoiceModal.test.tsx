// IssueInvoiceModal — lista comenzilor „fără factură" e construită printr-o
// GARDĂ (facturile existente), iar o gardă care ignoră eroarea minte
// (code-health-error-ignored-guards).
//
//   II1  citirea facturilor EȘUEAZĂ → nicio comandă oferită ca „liberă", alertă
//        cu motivul, fără „Nicio comandă plătită fără factură"
//        Mutația care pică: `const { data: existing } = …` fără `error` (codul
//        vechi) — toate comenzile plătite apar ca libere, inclusiv cele cu
//        factură emisă sau cu eșec AMBIGUU la Oblio (= duplicat fiscal).
//   II2  control pozitiv: facturile citite → doar comenzile chiar libere (o
//        factură `failed` clară rămâne re-emisibilă; una ambiguă, nu)
//   II3  citirea comenzilor eșuează → alertă, fără empty-state-ul fals
//        Mutația care pică: empty-state randat și pe eroare (codul vechi).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const { replies } = vi.hoisted(() => ({
  replies: {} as Record<string, { data: unknown[] | null; error: unknown }>,
}))

vi.mock('../../lib/supabase', () => {
  function chain(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'gte', 'order', 'limit', 'in']) {
      b[m] = vi.fn(() => b)
    }
    b.then = (
      onFulfilled: (v: { data: unknown[] | null; error: unknown }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(replies[table] ?? { data: [], error: null }).then(onFulfilled, onRejected)
    return b
  }
  return { supabase: { from: vi.fn((t: string) => chain(t)), rpc: vi.fn() } }
})

import IssueInvoiceModal from '../IssueInvoiceModal'

function order(id: string, table: string) {
  return { id, table_name: table, total: 42, created_at: '2026-10-20T10:00:00Z' }
}

function renderModal() {
  return render(<IssueInvoiceModal restaurantId="r1" onClose={vi.fn()} onIssued={vi.fn()} />)
}

beforeEach(() => {
  for (const k of Object.keys(replies)) delete replies[k]
  replies.orders = {
    data: [
      order('o1-aaaaaaa', 'Masa 1'),
      order('o2-bbbbbbb', 'Masa 2'),
      order('o3-ccccccc', 'Masa 3'),
    ],
    error: null,
  }
})

describe('IssueInvoiceModal — garda facturilor existente', () => {
  it('II1: citirea facturilor eșuează → nicio comandă „liberă", alertă cu motivul', async () => {
    replies.invoices = { data: null, error: { message: 'permission denied', code: '42501' } }
    renderModal()
    expect(await screen.findByRole('alert')).toHaveTextContent(/deja factură/)
    expect(screen.queryByText(/Masa 1/)).toBeNull()
    expect(screen.queryByText(/Masa 2/)).toBeNull()
    expect(screen.queryByText('Nicio comandă plătită fără factură.')).toBeNull()
  })

  it('II2: control pozitiv — doar comenzile chiar libere', async () => {
    replies.invoices = {
      data: [
        { order_id: 'o1-aaaaaaa', status: 'issued', last_error: null },
        { order_id: 'o2-bbbbbbb', status: 'failed', last_error: 'HTTP 400: CIF invalid' },
        {
          order_id: 'o3-ccccccc',
          status: 'failed',
          last_error: 'POSIBIL DUPLICAT — timeout la Oblio',
        },
      ],
      error: null,
    }
    renderModal()
    expect(await screen.findByText(/Masa 2/)).toBeInTheDocument()
    expect(screen.queryByText(/Masa 1/)).toBeNull()
    expect(screen.queryByText(/Masa 3/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('II3: citirea comenzilor eșuează → alertă, fără „Nicio comandă…" fals', async () => {
    replies.orders = { data: null, error: { message: 'boom', code: '500' } }
    renderModal()
    expect(await screen.findByRole('alert')).toHaveTextContent(/comenzile plătite/)
    expect(screen.queryByText('Nicio comandă plătită fără factură.')).toBeNull()
  })
})
