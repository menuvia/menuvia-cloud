// Pasul următor al ospătarului pe Planul 3 (lotul O7b, `lib/waiterSteps.ts`).
// Pe Planul 3 plata apare doar pe `served` și „Închide comanda” e interzisă,
// iar new → … → ready îl făcea doar Bucătăria: un local fără ecran de
// bucătărie avea comenzile blocate pe „Nou”. Cardul ospătarului primește acum
// UN pas, un singur `advance_order` per tap, pe tranziții pe care serverul le
// acceptă deja pentru ospătar.
//
//   WS1  tabela completă pe FIECARE status × sursă: new/confirmed → preparing
//        („Marchează în pregătire”); preparing → served („Servit”) la
//        waiter/qr și → ready („Gata”) la pickup; ready → served („Servit”);
//        served/paid/cancelled/closed → null.
//        [PICĂ: pickup preparing → served (sare SMS-ul „comanda e gata”);
//         un pas întors pe `served` (ar dubla butoanele de plată)]
//   WS2  paritate client ↔ server: blocul FIXTURE din
//        `tests/sql/auto/waiter_forward_steps.sql` (rulat în CI ca ospătar REAL
//        pe un restaurant de Plan 3) == pașii clientului, cu acțiunea pe care
//        `advanceOrderStatus` o trimite EFECTIV (`p_action` capturat din rpc).
//        Control: ≥ 8 rânduri parsate.
//        [PICĂ: ținta 'served' pentru `new` (ar trimite mark_served, refuzat
//         de server); o schimbare în STATUS_TO_ACTION (ex. 'confirmed→preparing'
//         → 'mark_ready'); FIXTURE editat fără codul TS, sau invers]
//   WS3  domeniul gărzii de dublu-tap e 'list' EXACT pentru pașii care intră în
//        `ready` sau ies din el (cardurile se re-așază), 'card' altfel.
//        [PICĂ: ready → served cu 'card' (în „Stadiu mese” tap-ul cădea pe
//         cardul vecin)]
//   WS4  niciun pas nu țintește paid / closed / cancelled (banii rămân pe
//        PayModal din `served`).
//        [PICĂ: un pas served → paid adăugat]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import { waiterForwardStep } from '../waiterSteps'
import { advanceOrderStatus, type OrderSource, type OrderStatus } from '../orders'

// Record-uri, nu liste: un status / o sursă nouă în tip face `tsc` roșu aici,
// deci tabela de mai jos nu poate rămâne tăcut incompletă.
const STATUS_KEYS: Record<OrderStatus, true> = {
  new: true,
  confirmed: true,
  preparing: true,
  ready: true,
  served: true,
  paid: true,
  cancelled: true,
  closed: true,
}
const SOURCE_KEYS: Record<OrderSource, true> = { qr: true, waiter: true, pickup: true }
const STATUSES = Object.keys(STATUS_KEYS) as OrderStatus[]
const SOURCES = Object.keys(SOURCE_KEYS) as OrderSource[]

beforeEach(() => {
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ data: null, error: null })
})

describe('waiterForwardStep — tabela pașilor (WS1)', () => {
  type Expected = { target: string; label: string } | null
  function expected(status: OrderStatus, source: OrderSource): Expected {
    if (status === 'new' || status === 'confirmed') {
      return { target: 'preparing', label: 'Marchează în pregătire' }
    }
    if (status === 'preparing') {
      return source === 'pickup'
        ? { target: 'ready', label: 'Gata' }
        : { target: 'served', label: 'Servit' }
    }
    if (status === 'ready') return { target: 'served', label: 'Servit' }
    return null
  }

  it('WS1 fiecare status × sursă', () => {
    let withStep = 0
    for (const status of STATUSES) {
      for (const source of SOURCES) {
        const step = waiterForwardStep({ status, source })
        const got: Expected = step == null ? null : { target: step.target, label: step.label }
        expect(got, `${status}/${source}`).toEqual(expected(status, source))
        if (step != null) withStep += 1
      }
    }
    // control: 4 stări deschise × 3 surse au pas (new, confirmed, preparing, ready)
    expect(withStep).toBe(12)
  })
})

describe('waiterForwardStep ↔ advance_order (WS2)', () => {
  function readFixture(): Set<string> {
    // Din process.cwd(), NU din import.meta.url/__dirname (capcana #269).
    const sql = readFileSync(
      resolve(process.cwd(), 'tests/sql/auto/waiter_forward_steps.sql'),
      'utf8',
    )
    const block = /-- FIXTURE-BEGIN([\s\S]*?)-- FIXTURE-END/.exec(sql)
    expect(block, 'blocul FIXTURE lipsește din waiter_forward_steps.sql').not.toBeNull()
    const rows = new Set<string>()
    for (const m of (block?.[1] ?? '').matchAll(
      /\('([a-z_]+)',\s*(true|false),\s*'([a-z_]+)',\s*'([a-z_]+)'\)/g,
    )) {
      rows.add(`${m[1]}|${m[2]}|${m[3]}|${m[4]}`)
    }
    return rows
  }

  /** Acțiunea pe care `advanceOrderStatus` o trimite EFECTIV serverului. */
  async function sentAction(status: OrderStatus, target: OrderStatus): Promise<string> {
    rpcMock.mockClear()
    await advanceOrderStatus('o-ws2', { status: target, _currentStatus: status }, { hydrate: false })
    expect(rpcMock).toHaveBeenCalledTimes(1)
    const [fn, args] = rpcMock.mock.calls[0] as [string, { p_action: string; p_order_id: string }]
    expect(fn).toBe('advance_order')
    expect(args.p_order_id).toBe('o-ws2')
    return args.p_action
  }

  it('WS2 pașii clientului == blocul FIXTURE din suita SQL', async () => {
    const frozen = readFixture()
    // control pozitiv: parserul chiar a citit tabela
    expect(frozen.size).toBeGreaterThanOrEqual(8)

    const fromTs = new Set<string>()
    for (const status of STATUSES) {
      for (const source of SOURCES) {
        const step = waiterForwardStep({ status, source })
        if (step == null) continue
        const action = await sentAction(status, step.target)
        const row = `${status}|${source === 'pickup'}|${action}|${step.target}`
        // qr și waiter sunt aceeași ramură (suita SQL le acoperă prin 'waiter')
        fromTs.add(row)
      }
    }
    expect([...fromTs].sort()).toEqual([...frozen].sort())
  })
})

describe('waiterForwardStep — domeniul gărzii și banii (WS3, WS4)', () => {
  it('WS3 scope "list" exact când pasul intră în `ready` sau iese din el', () => {
    let lists = 0
    for (const status of STATUSES) {
      for (const source of SOURCES) {
        const step = waiterForwardStep({ status, source })
        if (step == null) continue
        const movesReady = status === 'ready' || step.target === 'ready'
        expect(step.scope, `${status}/${source}`).toBe(movesReady ? 'list' : 'card')
        if (step.scope === 'list') lists += 1
      }
    }
    // control: ready × 3 surse + preparing/pickup
    expect(lists).toBe(4)
  })

  it('WS4 niciun pas nu țintește paid / closed / cancelled', () => {
    const forbidden: readonly string[] = ['paid', 'closed', 'cancelled']
    for (const status of STATUSES) {
      for (const source of SOURCES) {
        const step = waiterForwardStep({ status, source })
        if (step == null) continue
        expect(forbidden.includes(step.target), `${status}/${source} → ${step.target}`).toBe(false)
      }
    }
  })
})
