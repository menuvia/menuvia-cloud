// CashRegisterTab — comutarea localului (PR #385, recenzia CodeRabbit CR-m17).
// Tab-ul NU se remontează la schimbarea restaurantului (DashboardPage nu-i dă
// `key`), deci tura din stare era a localului vechi până la reîncărcare:
// „Închide tură" deschidea închiderea EI sub noul `restaurantId`, iar
// `shift_closed` ajungea atribuit noului local.
//
//   CRS1  după comutare, cât localul nou se încarcă: tura localului vechi NU mai
//         e pe ecran și nici „Închide tură"; se vede spinner-ul. Control
//         pozitiv: înainte de comutare tura vechiului local și butonul există.
//         Mutația care pică: `current` citit din starea încărcată fără
//         verificarea restaurantului (tura veche rămâne, cu butonul de închidere).
//   CRS2  dialogul de închidere deschis pe localul vechi NU se redeschide singur
//         pe tura localului nou când aceasta sosește. Control pozitiv: tura nouă
//         chiar e pe ecran. Mutația care pică: resetarea dialogurilor la
//         comutare scoasă (`showClose` rămas aprins).
//   CRS3  închiderea turei localului nou după comutare: RPC-ul primește tura LUI,
//         iar evenimentul poartă restaurantul ei. Control pozitiv pe tot fluxul.
//         Mutația care pică: evenimentul pe un restaurant reținut la montare.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import type { CurrentShift } from '../../lib/cashShifts'

interface RpcCall {
  name: string
  args: Record<string, unknown>
}

interface Reply {
  data: unknown
  error: { message: string } | null
}

const { calls, shifts, closeReply, gate, trackMock } = vi.hoisted(() => ({
  calls: [] as RpcCall[],
  // Tura deschisă a fiecărui restaurant (lipsă = nicio tură).
  shifts: {} as Record<string, unknown>,
  closeReply: { value: null as unknown },
  // Răspunsurile RPC pentru acest restaurant rămân în zbor până la eliberare.
  gate: { heldFor: null as string | null, held: [] as Array<() => void> },
  trackMock: vi.fn(),
}))

// Doar transportul e fals: wrapper-ele reale din lib/cashShifts și
// lib/payments rulează neschimbate peste el (ca în CashRegisterTab.polling).
vi.mock('../../lib/supabase', () => {
  function rpc(name: string, args: Record<string, unknown>): Promise<Reply> {
    calls.push({ name, args })
    const rid = typeof args.p_restaurant_id === 'string' ? args.p_restaurant_id : null
    let data: unknown = []
    if (name === 'get_current_shift' && rid && shifts[rid]) data = [shifts[rid]]
    if (name === 'close_shift') data = closeReply.value
    const reply: Reply = { data, error: null }
    if (rid != null && rid === gate.heldFor) {
      return new Promise<Reply>((resolve) => {
        gate.held.push(() => resolve(reply))
      })
    }
    return Promise.resolve(reply)
  }

  // listSettleNotes: builder thenable, mereu gol.
  function chain(): Record<string, unknown> {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not', 'gte', 'order', 'limit']) {
      b[m] = vi.fn(() => b)
    }
    b.then = (onFulfilled: (v: Reply) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected)
    return b
  }

  return { supabase: { rpc: vi.fn(rpc), from: vi.fn(() => chain()) } }
})
vi.mock('../../lib/analytics', () => ({ track: trackMock }))

import CashRegisterTab from '../CashRegisterTab'

const SPINNER = 'Se încarcă casa...'
const NO_SHIFT = 'Nicio tură deschisă'
const ACTIVE = '● TURĂ ACTIVĂ'

function shift(id: string, over: Partial<CurrentShift> = {}): CurrentShift {
  return {
    id,
    opened_at: '2026-10-20T08:00:00Z',
    opened_by: 'u1',
    initial_float: 100,
    cash_collected: 0,
    cash_movements_total: 0,
    cash_expected: 100,
    movement_count: 0,
    order_count: 0,
    ...over,
  }
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function release(): Promise<void> {
  const held = gate.held.splice(0)
  gate.heldFor = null
  await act(async () => {
    for (const r of held) r()
  })
  await flush()
}

const closeButton = () => screen.queryByRole('button', { name: /Închide tură/ })
const closeDialog = () => screen.queryByRole('dialog', { name: 'Închidere tură' })

beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(shifts)) delete shifts[k]
  closeReply.value = null
  gate.heldFor = null
  gate.held.length = 0
  trackMock.mockReset()
  // Poll-ul de 20 s nu are ce căuta aici (vezi CashRegisterTab.polling).
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CashRegisterTab — tura aparține restaurantului pentru care a fost citită', () => {
  it('CRS1: după comutare, tura localului vechi și „Închide tură" dispar', async () => {
    shifts.r1 = shift('s1', { cash_expected: 321 })
    const view = render(<CashRegisterTab restaurantId="r1" />)
    expect(await screen.findByText(ACTIVE)).toBeInTheDocument()
    // Control pozitiv: tura lui r1 și butonul de închidere sunt acolo.
    expect(screen.getByText('321,00 lei')).toBeInTheDocument()
    expect(closeButton()).not.toBeNull()

    gate.heldFor = 'r2'
    view.rerender(<CashRegisterTab restaurantId="r2" />)
    await flush()
    // Anti-vacuitate: încărcarea lui r2 chiar a plecat și e în zbor.
    expect(
      calls.some((c) => c.name === 'get_current_shift' && c.args.p_restaurant_id === 'r2'),
    ).toBe(true)
    expect(gate.held.length).toBeGreaterThan(0)
    expect(screen.queryByText(ACTIVE)).toBeNull()
    expect(screen.queryByText('321,00 lei')).toBeNull()
    expect(closeButton()).toBeNull()
    expect(screen.getByText(SPINNER)).toBeInTheDocument()

    await release()
    expect(screen.getByText(NO_SHIFT)).toBeInTheDocument()
    expect(closeButton()).toBeNull()
  })

  it('CRS2: dialogul de închidere al localului vechi nu se redeschide pe tura nouă', async () => {
    shifts.r1 = shift('s1')
    shifts.r2 = shift('s2', { cash_expected: 777 })
    const view = render(<CashRegisterTab restaurantId="r1" />)
    expect(await screen.findByText(ACTIVE)).toBeInTheDocument()
    fireEvent.click(closeButton() as HTMLElement)
    expect(closeDialog()).not.toBeNull()

    view.rerender(<CashRegisterTab restaurantId="r2" />)
    await flush()
    // Control pozitiv: tura lui r2 e pe ecran (777 = „Așteptat în casă").
    expect(screen.getByText(ACTIVE)).toBeInTheDocument()
    expect(screen.getByText('777,00 lei')).toBeInTheDocument()
    expect(closeDialog()).toBeNull()
  })

  it('CRS3: închiderea după comutare: tura lui r2, eveniment pe r2', async () => {
    shifts.r1 = shift('s1')
    shifts.r2 = shift('s2', { cash_expected: 150 })
    closeReply.value = {
      shift_id: 's2',
      expected_cash: 150,
      counted_cash: 150,
      cash_diff: 0,
      z_sent: true,
      z_receipt_id: null,
      summary: null,
    }
    const view = render(<CashRegisterTab restaurantId="r1" />)
    expect(await screen.findByText(ACTIVE)).toBeInTheDocument()

    view.rerender(<CashRegisterTab restaurantId="r2" />)
    await flush()
    expect(screen.getByText('150,00 lei')).toBeInTheDocument()

    fireEvent.click(closeButton() as HTMLElement)
    expect(closeDialog()).not.toBeNull()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: 'Închide tura' }))
    await flush()

    const close = calls.filter((c) => c.name === 'close_shift')
    expect(close).toHaveLength(1)
    expect(close[0].args.p_shift_id).toBe('s2')
    expect(trackMock).toHaveBeenCalledTimes(1)
    expect(trackMock).toHaveBeenCalledWith('shift_closed', { restaurant_id: 'r2', z_sent: true })
  })
})
