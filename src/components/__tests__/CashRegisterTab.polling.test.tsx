// CashRegisterTab — reîmprospătarea din fundal (poll la 20 s, revenirea în
// filă) NU are voie să demonteze OpenShiftModal (lotul O7a).
//
// Bug-ul: `load()` punea `loading = true` la FIECARE rulare, inclusiv la poll,
// iar garda `if (loading && current == null && recent.length === 0)` întorcea
// doar spinner-ul. Pe un restaurant fără nicio tură (exact cazul în care omul
// deschide PRIMA tură) arborele principal se demonta la fiecare tick, cu tot
// cu OpenShiftModal (copil ne-portal): fondul și nota tastate reveneau la
// „100" și gol.
//
//   CRT1  tick-ul de 20 s cu formularul de deschidere completat: dialogul
//         rămâne pe ecran cât cererea e în zbor, fără spinner, iar valorile
//         tastate rămân și după răspuns
//         Mutația care pică: poll-ul înapoi pe `load()` sau `setLoading(true)`
//         redevenit necondiționat (dialogul lipsește în zbor și revine cu
//         „100" și notă goală).
//   CRT2  același scenariu, declanșat de revenirea în filă (tableta care se
//         trezește — onVisibility citește imediat)
//         Mutația care pică: aceeași, pe cealaltă declanșare.
//   CRT3  CONTROL POZITIV pe garda care trebuie să RĂMÂNĂ: la prima încărcare
//         a unui restaurant cu tură deschisă se vede spinner-ul, NU „Nicio tură
//         deschisă" cu butonul „Deschide tură"
//         Mutația care pică: garda de spinner ștearsă/dezactivată („reparația”
//         naivă).
//   CRT4  un tick EȘUAT păstrează dialogul și valorile și arată banner-ul;
//         următorul tick reușit îl șterge
//         Mutațiile care pică: `setErr(null)` mutat doar pe prim-plan (banner-ul
//         rămâne după succes); revenirea la bug (dialogul se reface la eșec).
//   CRT5  tick-ul din fundal chiar APLICĂ datele (cash_collected live)
//         Mutația care pică: o ramură de fundal care sare peste setteri (poll
//         făcut no-op) — CRT1 n-ar vedea-o, dialogul doar „nu se demontează".
//   CRT6  revenirea în filă CHIAR în timpul încărcării inițiale nu lasă
//         spinner-ul aprins pe veci (analogul BP5)
//         Mutația care pică: `setLoading(false)` din `finally` condiționat de
//         `!opts.background` (răspunsul montării e aruncat de guard-ul de
//         secvență, iar cel din fundal nu mai stinge spinner-ul).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import type { CurrentShift, RecentShift } from '../../lib/cashShifts'

interface RpcCall {
  name: string
  args: Record<string, unknown>
}

interface Reply {
  data: unknown
  error: { message: string } | null
}

const { calls, replies, failOnce, gate } = vi.hoisted(() => ({
  calls: [] as RpcCall[],
  // Rândurile întoarse per RPC (implicit []).
  replies: {} as Record<string, unknown[]>,
  // RPC-urile al căror URMĂTOR apel eșuează (o singură dată).
  failOnce: new Set<string>(),
  // Cât `held` nu e null, răspunsurile rămân în zbor până le eliberează testul.
  gate: { held: null as Array<() => void> | null },
}))

// Doar transportul e fals: wrapper-ele reale din lib/cashShifts și
// lib/payments rulează neschimbate peste el.
vi.mock('../../lib/supabase', () => {
  // Poarta se citește la CONSTRUIREA cererii (sincron, în load()) — `.then`-ul
  // unui builder îl cheamă abia un microtask mai târziu.
  function respond(held: Array<() => void> | null, reply: Reply): Promise<Reply> {
    if (!held) return Promise.resolve(reply)
    return new Promise<Reply>((resolve) => {
      held.push(() => resolve(reply))
    })
  }

  function rpc(name: string, args: Record<string, unknown>): Promise<Reply> {
    calls.push({ name, args })
    // `delete` întoarce true doar dacă RPC-ul era marcat: eșec o singură dată.
    const fail = failOnce.delete(name)
    const reply: Reply = fail
      ? { data: null, error: { message: 'boom' } }
      : { data: replies[name] ?? [], error: null }
    return respond(gate.held, reply)
  }

  // listSettleNotes: from('table_payments').select().eq().eq().not().gte()
  // .order().limit() — builder thenable, mereu gol.
  function chain(): Record<string, unknown> {
    const held = gate.held
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not', 'gte', 'order', 'limit']) {
      b[m] = vi.fn(() => b)
    }
    b.then = (onFulfilled: (v: Reply) => unknown, onRejected?: (e: unknown) => unknown) =>
      respond(held, { data: [], error: null }).then(onFulfilled, onRejected)
    return b
  }

  return { supabase: { rpc: vi.fn(rpc), from: vi.fn(() => chain()) } }
})

import CashRegisterTab from '../CashRegisterTab'

const SPINNER = 'Se încarcă casa...'
const NO_SHIFT = 'Nicio tură deschisă'
const ACTIVE = '● TURĂ ACTIVĂ'
const NOTES_PLACEHOLDER = 'ex: tura matinală Andrei'
const LOAD_ERROR = 'Eroare la încărcare'

function shift(over: Partial<CurrentShift> = {}): CurrentShift {
  return {
    id: 's1',
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

const RECENT_OPEN: RecentShift = {
  id: 's1',
  status: 'open',
  opened_at: '2026-10-20T08:00:00Z',
  closed_at: null,
  initial_float: 100,
  expected_cash: null,
  counted_cash: null,
  cash_diff: null,
  order_count: 0,
}

let visibility: 'visible' | 'hidden' = 'visible'
function setVisibility(v: 'visible' | 'hidden'): void {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

function callsOf(name: string): number {
  return calls.filter((c: RpcCall) => c.name === name).length
}

// Doar cronometrul periodic e fals (setInterval): findBy* și acest flush au
// nevoie de setTimeout REAL — lasă încărcarea să se așeze în act().
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function tick20s(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(20_000)
  })
  await flush()
}

// Câmpurile se citesc DIN NOU la fiecare verificare: o referință ținută dintr-un
// dialog demontat își păstrează valoarea veche și ar face testul vacuu.
function amountInput(): HTMLElement {
  return screen.getByRole('spinbutton')
}
function notesInput(): HTMLElement {
  return screen.getByPlaceholderText(NOTES_PLACEHOLDER)
}

function expectFormIntact(): void {
  expect(screen.getByRole('dialog', { name: 'Deschidere tură' })).toBeInTheDocument()
  expect(screen.queryByText(SPINNER)).toBeNull()
  expect(amountInput()).toHaveValue(250)
  expect(notesInput()).toHaveValue('tura de seară')
}

// Restaurant fără nicio tură: „Deschide tură" → fond 250, notă tastată.
async function openFormOnEmptyRestaurant(): Promise<void> {
  render(<CashRegisterTab restaurantId="r1" />)
  await screen.findByText(NO_SHIFT)
  fireEvent.click(screen.getByRole('button', { name: /Deschide tură/ }))
  fireEvent.change(amountInput(), { target: { value: '250' } })
  fireEvent.change(notesInput(), { target: { value: 'tura de seară' } })
  // Control pozitiv: câmpurile chiar țin ce s-a tastat, iar până acum a rulat
  // doar încărcarea de la montare.
  expect(amountInput()).toHaveValue(250)
  expect(notesInput()).toHaveValue('tura de seară')
  expect(callsOf('get_current_shift')).toBe(1)
}

async function releaseAll(held: Array<() => void>): Promise<void> {
  gate.held = null
  await act(async () => {
    for (const release of held) release()
  })
  await flush()
}

beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(replies)) delete replies[k]
  failOnce.clear()
  gate.held = null
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('CashRegisterTab — reîmprospătarea din fundal nu demontează deschiderea turei', () => {
  it('CRT1: tick-ul de 20 s păstrează dialogul și valorile tastate', async () => {
    await openFormOnEmptyRestaurant()

    const held: Array<() => void> = []
    gate.held = held
    await tick20s()
    // Anti-vacuitate: tick-ul chiar a plecat și e în zbor (2 RPC + notele).
    expect(callsOf('get_current_shift')).toBe(2)
    expect(held).toHaveLength(3)
    expectFormIntact()

    await releaseAll(held)
    expectFormIntact()
    expect(callsOf('get_current_shift')).toBe(2)
  })

  it('CRT2: revenirea în filă păstrează dialogul și valorile tastate', async () => {
    await openFormOnEmptyRestaurant()

    const held: Array<() => void> = []
    gate.held = held
    act(() => {
      setVisibility('hidden')
      setVisibility('visible')
    })
    await flush()
    expect(callsOf('get_current_shift')).toBe(2)
    expect(held).toHaveLength(3)
    expectFormIntact()

    await releaseAll(held)
    expectFormIntact()
    expect(callsOf('get_current_shift')).toBe(2)
  })

  it('CRT3: prima încărcare cu tură deschisă arată spinner-ul, nu NoShiftCard', async () => {
    replies.get_current_shift = [shift()]
    replies.list_recent_shifts = [RECENT_OPEN]
    const held: Array<() => void> = []
    gate.held = held
    render(<CashRegisterTab restaurantId="r1" />)

    expect(screen.getByText(SPINNER)).toBeInTheDocument()
    expect(screen.queryByText(NO_SHIFT)).toBeNull()
    expect(screen.queryByRole('button', { name: /Deschide tură/ })).toBeNull()

    await flush()
    expect(held).toHaveLength(3)
    await releaseAll(held)
    expect(await screen.findByText(ACTIVE)).toBeInTheDocument()
    expect(screen.queryByText(SPINNER)).toBeNull()
    expect(screen.queryByText(NO_SHIFT)).toBeNull()
  })

  it('CRT4: tick eșuat → dialogul rămâne + eroare; tick reușit → eroarea dispare', async () => {
    await openFormOnEmptyRestaurant()
    expect(screen.queryByText(LOAD_ERROR)).toBeNull()

    failOnce.add('get_current_shift')
    await tick20s()
    expect(callsOf('get_current_shift')).toBe(2)
    expect(screen.getByText(LOAD_ERROR)).toBeInTheDocument()
    expectFormIntact()

    await tick20s()
    expect(callsOf('get_current_shift')).toBe(3)
    expect(screen.queryByText(LOAD_ERROR)).toBeNull()
    expectFormIntact()
  })

  it('CRT5: tick-ul din fundal aplică datele noi ale turei', async () => {
    replies.get_current_shift = [shift({ cash_collected: 10, cash_expected: 110 })]
    replies.list_recent_shifts = [RECENT_OPEN]
    render(<CashRegisterTab restaurantId="r1" />)
    await screen.findByText(ACTIVE)
    expect(screen.getByText('10,00 lei')).toBeInTheDocument()
    expect(screen.getByText('110,00 lei')).toBeInTheDocument()

    replies.get_current_shift = [shift({ cash_collected: 55, cash_expected: 155 })]
    await tick20s()
    expect(callsOf('get_current_shift')).toBe(2)
    expect(screen.getByText('55,00 lei')).toBeInTheDocument()
    expect(screen.getByText('155,00 lei')).toBeInTheDocument()
    expect(screen.queryByText('10,00 lei')).toBeNull()
    expect(screen.queryByText('110,00 lei')).toBeNull()
  })

  it('CRT6: revenirea în filă în timpul încărcării inițiale stinge totuși spinner-ul', async () => {
    const held: Array<() => void> = []
    gate.held = held
    render(<CashRegisterTab restaurantId="r1" />)
    // Control pozitiv: prima încărcare chiar arată spinner-ul.
    expect(screen.getByText(SPINNER)).toBeInTheDocument()

    // Citirea din fundal o înlocuiește pe cea de la montare (guard de secvență).
    act(() => {
      setVisibility('hidden')
      setVisibility('visible')
    })
    await flush()
    // Anti-vacuitate: ambele încărcări (3 + 3 cereri) erau încă în zbor.
    expect(callsOf('get_current_shift')).toBe(2)
    expect(held).toHaveLength(6)
    expect(screen.getByText(SPINNER)).toBeInTheDocument()

    await releaseAll(held)
    expect(screen.queryByText(SPINNER)).toBeNull()
    expect(screen.getByText(NO_SHIFT)).toBeInTheDocument()
  })
})
