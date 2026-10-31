// Canalul realtime al rezervărilor se abonează O SINGURĂ DATĂ per restaurant.
//
// Defectul (audit oct 2026): efectul canalului depindea de `fetchReservations`,
// care se recreează la fiecare schimbare de interval — deci un clic pe „Mâine”
// sau „Săptămâna” în tab-ul Rezervări dezabona și re-abona canalul, iar un
// eveniment sosit în fereastra dintre ele se pierdea. Comentariul de sub efect
// (și un eslint-disable) pretindeau exact contrariul.
//
//   UR1  schimbarea intervalului NU re-abonează canalul (un singur `channel`,
//        zero `removeChannel`), dar re-încarcă lista pe intervalul nou.
//        Mutația care îl pică: dependențele vechi `[restaurantId, fetchReservations]`.
//   UR2  după schimbarea intervalului, un INSERT din intervalul NOU (în afara
//        celui vechi) intră în listă — handler-ul citește intervalul CURENT.
//        Mutația care îl pică: „reparația naivă” — doar `[restaurantId]` în
//        dependențe, cu `range` capturat în închiderea primului render.
//   UR3  un eveniment fără id cade pe refetch-ul integral cu intervalul CURENT
//        (aceeași mutație naivă ar re-încărca intervalul vechi).
//   UR4  control pozitiv: schimbarea RESTAURANTULUI re-abonează (topic nou), iar
//        demontarea închide canalul — dovada că spionul vede o re-abonare și
//        că UR1 nu trece din orbire.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

interface QueryResult {
  data: unknown
  error: { message: string } | null
}
interface Call {
  method: string
  args: unknown[]
}
interface Builder extends PromiseLike<QueryResult> {
  select: (...args: unknown[]) => Builder
  eq: (...args: unknown[]) => Builder
  gte: (...args: unknown[]) => Builder
  lte: (...args: unknown[]) => Builder
  order: (...args: unknown[]) => Builder
  maybeSingle: () => Promise<QueryResult>
}
interface FakeChannel {
  topic: string
  on: (event: string, filter: unknown, cb: (payload: unknown) => void) => FakeChannel
  subscribe: () => FakeChannel
}

const h = vi.hoisted(() => {
  const state = {
    listRows: [] as unknown[],
    singleRow: null as unknown,
    queries: [] as Call[][],
    channels: [] as string[],
    removed: [] as string[],
    handler: null as ((payload: unknown) => void) | null,
  }
  function makeBuilder(): Builder {
    const calls: Call[] = []
    state.queries.push(calls)
    const record =
      (method: string) =>
      (...args: unknown[]): Builder => {
        calls.push({ method, args })
        return builder
      }
    const builder: Builder = {
      select: record('select'),
      eq: record('eq'),
      gte: record('gte'),
      lte: record('lte'),
      order: record('order'),
      maybeSingle: () => {
        calls.push({ method: 'maybeSingle', args: [] })
        return Promise.resolve({ data: state.singleRow, error: null })
      },
      then: (onFulfilled, onRejected) =>
        Promise.resolve<QueryResult>({ data: state.listRows, error: null }).then(
          onFulfilled,
          onRejected,
        ),
    }
    return builder
  }
  const supabase = {
    from: () => makeBuilder(),
    channel: (topic: string): FakeChannel => {
      state.channels.push(topic)
      const ch: FakeChannel = {
        topic,
        on: (_event, _filter, cb) => {
          state.handler = cb
          return ch
        },
        subscribe: () => ch,
      }
      return ch
    },
    removeChannel: (ch: FakeChannel) => {
      state.removed.push(ch.topic)
      return Promise.resolve('ok')
    },
  }
  return { state, supabase }
})

vi.mock('../../lib/supabase', () => ({ supabase: h.supabase }))

import { useReservations, type DateRange } from '../useReservations'

const R1: DateRange = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-01T23:59:59.999Z' }
const R2: DateRange = { from: '2026-10-02T00:00:00.000Z', to: '2026-10-08T23:59:59.999Z' }

function row(id: string, startsAt: string) {
  return {
    id,
    restaurant_id: 'rest-1',
    table_id: null,
    customer_name: 'Ana',
    customer_phone: '+40722000000',
    customer_email: null,
    party_size: 2,
    special_requests: null,
    starts_at: startsAt,
    ends_at: startsAt,
    status: 'pending',
    source: 'public',
    reminder_sent_at: null,
    confirmation_code: 'ABC123',
    requested_zone: null,
    created_at: startsAt,
    updated_at: startsAt,
    table: null,
  }
}

/** Interogările de LISTĂ (cele pe interval), în ordinea în care au plecat. */
function listQueries(): Call[][] {
  return h.state.queries.filter((q: Call[]) => q.some((c: Call) => c.method === 'gte'))
}
function gteOf(q: Call[]): unknown[] | undefined {
  return q.find((c: Call) => c.method === 'gte')?.args
}
function emit(payload: { eventType: string; new: unknown; old: unknown }) {
  const handler = h.state.handler
  if (!handler) throw new Error('canalul nu are handler')
  act(() => handler(payload))
}

beforeEach(() => {
  h.state.listRows = []
  h.state.singleRow = null
  h.state.queries = []
  h.state.channels = []
  h.state.removed = []
  h.state.handler = null
})

function mount(initial: { restaurantId: string; range: DateRange }) {
  return renderHook(
    ({ restaurantId, range }: { restaurantId: string; range: DateRange }) =>
      useReservations(restaurantId, range),
    { initialProps: initial },
  )
}

function idsOf(view: ReturnType<typeof mount>): string[] {
  return view.result.current.reservations.map((r: { id: string }) => r.id)
}

/** Mută hook-ul pe R2 și așteaptă ca lista intervalului nou să fie încărcată. */
async function switchToR2(view: ReturnType<typeof mount>) {
  h.state.listRows = [row('r2-existing', '2026-10-03T12:00:00.000Z')]
  view.rerender({ restaurantId: 'rest-1', range: R2 })
  await waitFor(() => expect(idsOf(view)).toEqual(['r2-existing']))
}

describe('useReservations — canalul realtime', () => {
  it('UR1: schimbarea intervalului re-încarcă lista, dar NU re-abonează canalul', async () => {
    const view = mount({ restaurantId: 'rest-1', range: R1 })
    await waitFor(() => expect(listQueries()).toHaveLength(1))
    await switchToR2(view)

    expect(listQueries()).toHaveLength(2)
    expect(gteOf(listQueries()[1])).toEqual(['starts_at', R2.from])
    expect(h.state.channels).toEqual(['reservations:rest-1'])
    expect(h.state.removed).toEqual([])
  })

  it('UR2: un INSERT din intervalul NOU intră în listă (handler-ul vede intervalul curent)', async () => {
    const view = mount({ restaurantId: 'rest-1', range: R1 })
    await waitFor(() => expect(listQueries()).toHaveLength(1))
    await switchToR2(view)

    // 5 octombrie: în R2, în afara lui R1.
    h.state.singleRow = row('new-1', '2026-10-05T18:00:00.000Z')
    emit({ eventType: 'INSERT', new: { id: 'new-1' }, old: {} })

    await waitFor(() => expect(idsOf(view)).toEqual(['r2-existing', 'new-1']))
  })

  it('UR3: un eveniment fără id re-încarcă intervalul CURENT, nu pe cel vechi', async () => {
    const view = mount({ restaurantId: 'rest-1', range: R1 })
    await waitFor(() => expect(listQueries()).toHaveLength(1))
    await switchToR2(view)

    emit({ eventType: 'UPDATE', new: {}, old: {} })

    await waitFor(() => expect(listQueries()).toHaveLength(3))
    expect(gteOf(listQueries()[2])).toEqual(['starts_at', R2.from])
    expect(h.state.channels).toEqual(['reservations:rest-1'])
  })

  it('UR4: alt restaurant re-abonează pe topicul nou; demontarea închide canalul', async () => {
    const view = mount({ restaurantId: 'rest-1', range: R1 })
    await waitFor(() => expect(listQueries()).toHaveLength(1))

    view.rerender({ restaurantId: 'rest-2', range: R1 })
    expect(h.state.channels).toEqual(['reservations:rest-1', 'reservations:rest-2'])
    expect(h.state.removed).toEqual(['reservations:rest-1'])

    view.unmount()
    expect(h.state.removed).toEqual(['reservations:rest-1', 'reservations:rest-2'])
  })
})
