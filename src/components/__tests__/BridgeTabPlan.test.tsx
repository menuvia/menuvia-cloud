// Fila casei de marcat pe planul restaurantului (lotul P, nov 2026). Pe
// Planul 2 fila e DOAR imprimanta din bucătărie: titlul „Imprimantă
// bucătărie", fără „Brand nedefinit" (marca e a CASEI de marcat), fără
// upsell-ul „Bonuri fiscale automate" și fără să citească bonurile sau cotele.
// (Pe Planul 1 fila nu există: NAV_GROUPS minTier 2.)
//
//   BP1  Planul 2: titlul „Imprimantă bucătărie", device-ul fără „Brand
//        nedefinit", niciun termen fiscal (TVA / bon fiscal / casă de marcat /
//        Bridge fiscal), iar `pending_receipts` și `vat_rates` NU se citesc.
//        Mutația care pică: „Brand nedefinit" randat necondiționat, upsell-ul
//        compact readus, sau propoziția „Tichetele NU sunt bonuri fiscale".
//   BP2  control pozitiv pe Planul 3: „Casă de marcat & tichete", „Brand
//        nedefinit" pe device-ul fără marcă, secțiunea „Bonuri fiscale" și
//        citirea bonurilor + cotelor.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const { tables, reads } = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  reads: [] as string[],
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
    ) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(onFulfilled, onRejected)
    return b
  }
  return {
    supabase: {
      from: vi.fn((t: string) => {
        reads.push(t)
        return chain(t)
      }),
      rpc: vi.fn(),
    },
  }
})

import BridgeTab from '../BridgeTab'

const FISCAL = /\bTVA\b|bon(ul|uri)? fiscal|cas[aă] de marcat|Bridge fiscal/i

beforeEach(() => {
  reads.length = 0
  tables.bridge_devices = [
    {
      id: 'd1',
      name: 'PC bucătărie',
      status: 'online',
      last_seen_at: '2026-11-02T10:00:00Z',
      fiscalnet_brand: null,
      fiscalnet_model: null,
      prints_kitchen_receipts: true,
    },
  ]
  tables.kitchen_tickets = []
  tables.pending_receipts = []
  tables.vat_rates = []
})

describe('BridgeTab — Planul 2 e doar imprimanta din bucătărie', () => {
  it('BP1: „Imprimantă bucătărie", fără „Brand nedefinit" și fără nimic fiscal', async () => {
    const { container } = render(<BridgeTab restaurantId="r1" fiscalEnabled={false} />)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Imprimantă bucătărie' }),
    ).toBeInTheDocument()
    // Ancora: device-ul e listat (deci absența mărcii e reală).
    expect(await screen.findByText('PC bucătărie')).toBeInTheDocument()
    expect(screen.queryByText(/Brand nedefinit/)).toBeNull()
    expect(screen.queryByText(/Bonuri fiscale automate/)).toBeNull()
    expect(container.textContent ?? '').not.toMatch(FISCAL)
    expect(reads).not.toContain('pending_receipts')
    expect(reads).not.toContain('vat_rates')
  })

  it('BP2: control pozitiv — pe Planul 3 casa, marca, bonurile și cotele', async () => {
    render(<BridgeTab restaurantId="r1" fiscalEnabled />)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Casă de marcat & tichete' }),
    ).toBeInTheDocument()
    expect(await screen.findByText(/Brand nedefinit/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bonuri fiscale' })).toBeInTheDocument()
    expect(reads).toContain('pending_receipts')
    expect(reads).toContain('vat_rates')
  })
})
