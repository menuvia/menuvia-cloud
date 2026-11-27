// FloorPlanEditor — modul Live și legarea meselor (lotul C5b).
// Mock-ul de supabase APLICĂ filtrele pe un fixture, ca serverul (`eq`, `in`,
// `not(col,'in','(a,b)')`, `not(col,'is',null)`; `gte`/`lte` nu filtrează),
// deci testul vede ce rânduri ar întoarce interogarea reală.
// (Prefixul FLV: verificat cu grep în src/, tests/, e2e/, supabase/, docs/ și
// CLAUDE.md, nefolosit înainte.)
//   FLV1 o masă legată care are doar comenzi `closed`/`paid`/`cancelled`
//        rămâne „Liberă”; una cu o comandă `served` e „Ocupată” (subsolul:
//        „1 libere”, „1 ocupate”). `closed` e starea FINALĂ normală unde bonul
//        fiscal e oprit (Planurile 1–2, Planul 3 în afara României, comenzile
//        închise de `expire_stale_orders`). Mutația care pică: filtrul vechi
//        `.not('status','in','(paid,cancelled)')` (masa cu `closed` ieșea
//        „Ocupată” pe veci). Masa `served` e controlul POZITIV — fără ea, un
//        filtru care nu întoarce nimic ar trece FLV1.
//   FLV2 sursa unică a stărilor deschise: interogarea cere lista POZITIVĂ
//        `OPEN_ORDER_STATUSES` (lib/homeMetrics.ts) și nu mai are niciun
//        `not` pe `status`. Mutația care pică: o listă scrisă de mână.
//   FLV3 dropdown-ul de legare („Masă reală (POS)”) e în ordinea NATURALĂ
//        (Masa 1, Masa 2, Masa 10), deși serverul le dă în ordinea de text.
//        Mutația care pică: `sortTablesByName` scos din FloorPlanEditor.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FloorLayout } from '../../lib/floorPlan'
import { OPEN_ORDER_STATUSES } from '../../lib/homeMetrics'

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  realTables: [] as Row[],
  orders: [] as Row[],
  orderCalls: [] as Array<[string, string, unknown]>,
}))

vi.mock('../../lib/supabase', () => {
  function chain(table: string) {
    const preds: Array<(r: Row) => boolean> = []
    const log = (m: string, c: string, v: unknown) => {
      if (table === 'orders') h.orderCalls.push([m, c, v])
    }
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'order', 'gte', 'lte']) b[k] = () => b
    b.eq = (c: string, v: unknown) => {
      log('eq', c, v)
      preds.push((r) => r[c] === v)
      return b
    }
    b.in = (c: string, vs: readonly unknown[]) => {
      log('in', c, vs)
      preds.push((r) => vs.includes(r[c]))
      return b
    }
    b.not = (c: string, op: string, v: unknown) => {
      log('not', c, [op, v])
      if (op === 'in') {
        const list = String(v)
          .replace(/^\(|\)$/g, '')
          .split(',')
        preds.push((r) => !list.includes(String(r[c])))
      } else if (op === 'is' && v === null) {
        preds.push((r) => r[c] !== null && r[c] !== undefined)
      }
      return b
    }
    b.then = (onOk: (v: unknown) => unknown, onKo?: (e: unknown) => unknown) => {
      const src = table === 'tables' ? h.realTables : table === 'orders' ? h.orders : []
      return Promise.resolve({
        data: src.filter((r) => preds.every((p) => p(r))),
        error: null,
      }).then(onOk, onKo)
    }
    return b
  }
  return {
    supabase: {
      from: (t: string) => chain(t),
      rpc: async () => ({ data: null, error: null }),
    },
  }
})
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../../hooks/usePollWhileVisible', () => ({ startPollingWhileVisible: () => () => {} }))

import FloorPlanEditor from '../FloorPlanEditor'

const realTable = (id: string, name: string): Row => ({
  id,
  name,
  restaurant_id: 'r1',
  is_active: true,
})
const order = (table_id: string, status: string): Row => ({ restaurant_id: 'r1', table_id, status })

const LAYOUT: FloorLayout = {
  floors: [
    {
      id: 'f1',
      name: 'Sala 1',
      tables: [
        {
          id: 'fa',
          x: 100,
          y: 100,
          w: 80,
          h: 80,
          shape: 'round',
          label: 'X1',
          seats: 4,
          rotation: 0,
          status: 'free',
          tableId: 'rt1',
        },
        {
          id: 'fb',
          x: 300,
          y: 100,
          w: 80,
          h: 80,
          shape: 'round',
          label: 'X2',
          seats: 4,
          rotation: 0,
          status: 'free',
          tableId: 'rt2',
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

const editor = () => <FloorPlanEditor restaurantId="r1" initialLayout={LAYOUT} onSaved={() => {}} />
const tableBox = (label: string) => screen.getByText(label).parentElement as HTMLElement

beforeEach(() => {
  h.realTables = [realTable('rt1', 'Masa 1'), realTable('rt2', 'Masa 2')]
  h.orders = [
    order('rt1', 'closed'),
    order('rt1', 'paid'),
    order('rt1', 'cancelled'),
    order('rt2', 'served'),
  ]
  h.orderCalls = []
})

describe('FloorPlanEditor — Live pe comenzile deschise', () => {
  it('FLV1: comenzile `closed` nu țin masa „Ocupată”; `served` da', async () => {
    render(editor())
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /comută pe vizualizare live/ }))
    await waitFor(() => expect(within(tableBox('X2')).getByText('Ocupată')).toBeInTheDocument())
    expect(within(tableBox('X1')).getByText('Liberă')).toBeInTheDocument()
    expect(within(tableBox('X1')).queryByText('Ocupată')).not.toBeInTheDocument()
    expect(screen.getByText(/1 libere/)).toBeInTheDocument()
    expect(screen.getByText(/1 ocupate/)).toBeInTheDocument()
  })

  it('FLV2: interogarea cere lista pozitivă OPEN_ORDER_STATUSES', async () => {
    render(editor())
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /comută pe vizualizare live/ }))
    await waitFor(() => expect(h.orderCalls.some(([m]) => m === 'in')).toBe(true))
    // Efectul poate rula de mai multe ori (mesele reale sosesc după montare):
    // FIECARE interogare cere exact lista pozitivă.
    const statusIn = h.orderCalls.filter(([m, c]) => m === 'in' && c === 'status')
    expect(statusIn.length).toBeGreaterThan(0)
    for (const call of statusIn) expect(call).toEqual(['in', 'status', [...OPEN_ORDER_STATUSES]])
    expect(h.orderCalls.some(([m, c]) => m === 'not' && c === 'status')).toBe(false)
  })
})

describe('FloorPlanEditor — legarea meselor în ordinea naturală', () => {
  it('FLV3: „Masă reală (POS)” listează Masa 1, Masa 2, Masa 10', async () => {
    // Ordinea de TEXT, ca `.order('name')`.
    h.realTables = [
      realTable('rt1', 'Masa 1'),
      realTable('rt10', 'Masa 10'),
      realTable('rt2', 'Masa 2'),
    ]
    render(editor())
    fireEvent.mouseDown(screen.getByText('X1'))
    const select = screen.getByLabelText('Masă reală din POS legată de această masă')
    await within(select).findByRole('option', { name: 'Masa 10' })
    const names = within(select)
      .getAllByRole('option')
      .slice(1)
      .map((o) => o.textContent)
    expect(names).toEqual(['Masa 1', 'Masa 2', 'Masa 10'])
  })
})
