// FloorPlanEditor — salvarea anunță panoul DOAR după ce RPC-ul a reușit (mig 322).
// Harta se scrie numai prin `save_floor_layout`; panoul aplică apoi harta
// salvată în lista de restaurante (`onSaved` → useRestaurants.patchLocal), ca o
// remontare a editorului (schimbare de tab) să pornească de la ea, nu de la
// copia încărcată la boot.
//
//   FE1  RPC reușit → `onSaved` chemat O SINGURĂ dată, cu exact harta trimisă
//        RPC-ului (iar etajele trimise sunt cele inițiale). Mutația care pică:
//        `onSaved(payload)` scos din handleSave.
//   FE2  RPC respins (gate de plan) → `onSaved` NU e chemat, iar bannerul de
//        eroare apare. Mutația care pică: `onSaved` mutat înaintea ramurii
//        `if (error)`. FE1 e controlul pozitiv al lui FE2 (același harness,
//        callback-ul chiar se declanșează pe succes).
//   FE3  lotul G2b: în modul Live rezervările de AZI se cer în fusul dat prin
//        prop-ul `timeZone`. Acum = 15 nov 03:30Z = 14 nov 22:30 la New York →
//        `starts_at` în [14 nov 05:00Z, 15 nov 04:59:59.999Z]; control fără prop
//        (București, 15 nov) → [14 nov 22:00Z, 15 nov 21:59:59.999Z]. Mutația
//        care pică: prop-ul ignorat în calculul zilei sau scos din DashboardPage
//        (ZT5).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FloorLayout } from '../../lib/floorPlan'

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  // Filtrele de interval pe fiecare tabelă: [tabelă, metodă, coloană, valoare].
  filters: [] as [string, string, string, unknown][],
}))

vi.mock('../../lib/supabase', () => {
  // Interogările de mese / status live: lanț „thenable” care se rezolvă gol.
  function chain(table: string) {
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'neq', 'not', 'in', 'order']) {
      b[k] = () => b
    }
    for (const k of ['gte', 'lte']) {
      b[k] = (col: string, val: unknown) => {
        m.filters.push([table, k, col, val])
        return b
      }
    }
    b.then = (
      onFulfilled: (v: { data: unknown[]; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected)
    return b
  }
  return { supabase: { from: (t: string) => chain(t), rpc: m.rpc } }
})
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }))

import FloorPlanEditor from '../FloorPlanEditor'

const LAYOUT: FloorLayout = {
  floors: [
    {
      id: 'f1',
      name: 'Sala 1',
      tables: [
        {
          id: 't1',
          x: 100,
          y: 100,
          w: 80,
          h: 80,
          shape: 'round',
          label: '1',
          seats: 4,
          rotation: 0,
          status: 'free',
        },
      ],
      walls: [],
      decos: [],
      zones: [],
    },
  ],
  version: 1,
  savedAt: '2026-11-01T10:00:00.000Z',
}

beforeEach(() => {
  m.rpc.mockReset()
  m.filters.length = 0
})
afterEach(() => {
  vi.useRealTimers()
})

describe('FloorPlanEditor — onSaved după save_floor_layout', () => {
  it('FE1: RPC reușit → onSaved o singură dată, cu harta trimisă', async () => {
    m.rpc.mockResolvedValue({ data: null, error: null })
    const onSaved = vi.fn()
    render(<FloorPlanEditor restaurantId="r1" initialLayout={LAYOUT} onSaved={onSaved} />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Salvează' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(m.rpc).toHaveBeenCalledTimes(1)
    expect(m.rpc.mock.calls[0][0]).toBe('save_floor_layout')
    const args = m.rpc.mock.calls[0][1] as { p_restaurant_id: string; p_layout: FloorLayout }
    expect(args.p_restaurant_id).toBe('r1')
    expect(onSaved.mock.calls[0][0]).toEqual(args.p_layout)
    expect(args.p_layout.floors).toEqual(LAYOUT.floors)
    expect(await screen.findByRole('button', { name: '✓ Salvat' })).toBeInTheDocument()
  })

  it('FE2: RPC respins → onSaved nechemat, eroarea afișată', async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Funcția „floor_plan” cere un plan superior' },
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onSaved = vi.fn()
    render(<FloorPlanEditor restaurantId="r1" initialLayout={LAYOUT} onSaved={onSaved} />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Salvează' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Harta sălii e disponibilă pe planul Fiscalizare.',
    )
    expect(m.rpc).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('FE3: rezervările de azi din modul Live urmează prop-ul timeZone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-15T03:30:00Z'))
    const resv = () => m.filters.filter(([t, , c]) => t === 'reservations' && c === 'starts_at')
    const ny = render(
      <FloorPlanEditor
        restaurantId="r1"
        initialLayout={LAYOUT}
        onSaved={vi.fn()}
        timeZone="America/New_York"
      />,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: /comută pe vizualizare live/ }))
    await waitFor(() => expect(resv().length).toBeGreaterThanOrEqual(2))
    expect(resv()).toContainEqual(['reservations', 'gte', 'starts_at', '2026-11-14T05:00:00.000Z'])
    expect(resv()).toContainEqual(['reservations', 'lte', 'starts_at', '2026-11-15T04:59:59.999Z'])
    ny.unmount()

    m.filters.length = 0
    render(<FloorPlanEditor restaurantId="r1" initialLayout={LAYOUT} onSaved={vi.fn()} />)
    await userEvent.setup().click(screen.getByRole('button', { name: /comută pe vizualizare live/ }))
    await waitFor(() => expect(resv().length).toBeGreaterThanOrEqual(2))
    expect(resv()).toContainEqual(['reservations', 'gte', 'starts_at', '2026-11-14T22:00:00.000Z'])
    expect(resv()).toContainEqual(['reservations', 'lte', 'starts_at', '2026-11-15T21:59:59.999Z'])
  })
})
