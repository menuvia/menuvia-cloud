// Teste pe OrderCard (WaiterOrderCard) — TRISTATE-ul de plan (audit v3 DS-1 /
// RES-24). Regula de aur în UI: pe `served`, Plan 3 (true) arată Plată
// integrală/parțială; Plan 1/2 (false) arată „Închide comanda" (nefiscal);
// NECUNOSCUT (null) nu arată NICIUN buton de finalizare — o închidere nefiscală
// pe Plan 3 ar însemna bani fără bon. Default-ul prop-ului e null (fail-closed).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrderCard } from '../WaiterOrderCard'
import { makeOrder } from './fixtures'
import type { Order } from '../../lib/orders'

// Dialogul de confirmare e un singleton montat în App (<ConfirmRoot/>); în test
// îl înlocuim cu un mock controlabil, ca să vedem DACĂ și CU CE se cere confirmare.
const confirmMock = vi.hoisted(() =>
  vi.fn<(opts: { title: string; description?: string }) => Promise<boolean>>(),
)
vi.mock('../ui/confirm', () => ({ confirm: confirmMock }))

beforeEach(() => {
  confirmMock.mockReset()
  confirmMock.mockResolvedValue(true)
})

const FINAL_BUTTON = /^(plată integrală|plată parțială|închide comanda)$/i

function renderCard(order: Order, paymentsEnabled?: boolean | null) {
  const onPayOpen = vi.fn()
  const onSplitOpen = vi.fn()
  const onCloseOrder = vi.fn()
  const props = {
    order,
    onPayOpen,
    onSplitOpen,
    onCloseOrder,
    ...(paymentsEnabled === undefined ? {} : { paymentsEnabled }),
  }
  render(<OrderCard {...props} />)
  return { onPayOpen, onSplitOpen, onCloseOrder }
}

describe('OrderCard — tristate paymentsEnabled', () => {
  it('T1 true (Plan 3) → Plată integrală + parțială, fără „Închide comanda"', async () => {
    const order = makeOrder({ status: 'served' })
    const { onPayOpen, onCloseOrder } = renderCard(order, true)
    expect(screen.getByRole('button', { name: /^plată integrală$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^plată parțială$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^închide comanda$/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^plată integrală$/i }))
    expect(onPayOpen).toHaveBeenCalledWith(order)
    expect(onCloseOrder).not.toHaveBeenCalled()
  })

  it('T2 false (Plan 1/2) → „Închide comanda" nefiscal, fără butoane de plată', async () => {
    const order = makeOrder({ status: 'served' })
    const { onPayOpen, onCloseOrder } = renderCard(order, false)
    expect(screen.getByRole('button', { name: /^închide comanda$/i })).toBeInTheDocument()
    expect(screen.getByText(/plata și bonul se fac pe casa de marcat existentă/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^plată integrală$/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^închide comanda$/i }))
    expect(onCloseOrder).toHaveBeenCalledWith(order)
    expect(onPayOpen).not.toHaveBeenCalled()
  })

  it('T3 null (plan NECUNOSCUT) → NICIUN buton de finalizare, chiar cu handler-ele prezente', () => {
    renderCard(makeOrder({ status: 'served' }), null)
    expect(screen.queryByRole('button', { name: FINAL_BUTTON })).toBeNull()
    expect(screen.getByText(/se verifică planul restaurantului/i)).toBeInTheDocument()
  })

  it('T4 status ≠ served → fără finalizare pe Plan 3 și pe plan necunoscut', () => {
    // (pe Plan 1/2 comanda are „Închide comanda" din orice stare deschisă — T6/T8)
    for (const pe of [true, null] as const) {
      const { unmount } = render(
        <OrderCard
          order={makeOrder({ status: 'ready' })}
          onPayOpen={vi.fn()}
          onSplitOpen={vi.fn()}
          onCloseOrder={vi.fn()}
          paymentsEnabled={pe}
        />,
      )
      expect(screen.queryByRole('button', { name: FINAL_BUTTON })).toBeNull()
      unmount()
    }
  })

  it('T5 prop OMIS → se comportă ca null (default fail-closed)', () => {
    renderCard(makeOrder({ status: 'served' }))
    expect(screen.queryByRole('button', { name: FINAL_BUTTON })).toBeNull()
    expect(screen.getByText(/se verifică planul restaurantului/i)).toBeInTheDocument()
  })
})

// ── Închidere din ORICE stare deschisă (Plan 1/2) + „Închide masa" ───────────
// Pe producție 5 comenzi de ospătar stăteau în `new` de 2–89 zile: butonul
// exista doar din `served`, iar niciun alt drum nu le scotea din Bucătărie.
// Serverul (advance_order close_order, mig 270) acceptă deja toate aceste stări.
describe('OrderCard — „Închide comanda" din orice stare deschisă (Plan 1/2)', () => {
  const OPEN = ['new', 'confirmed', 'preparing', 'ready', 'served'] as const
  const TERMINAL = ['paid', 'cancelled', 'closed'] as const

  function renderPlain(order: Order, paymentsEnabled: boolean | null) {
    return render(
      <OrderCard
        order={order}
        onPayOpen={vi.fn()}
        onSplitOpen={vi.fn()}
        onCloseOrder={vi.fn()}
        paymentsEnabled={paymentsEnabled}
      />,
    )
  }

  it('T6 false → butonul apare pe FIECARE stare deschisă și pe NICIUNA terminală', () => {
    for (const status of OPEN) {
      const { unmount } = renderPlain(makeOrder({ status }), false)
      expect(screen.getByRole('button', { name: /^închide comanda$/i }), status).toBeInTheDocument()
      unmount()
    }
    for (const status of TERMINAL) {
      const { unmount } = renderPlain(makeOrder({ status }), false)
      expect(screen.queryByRole('button', { name: /^închide comanda$/i }), status).toBeNull()
      unmount()
    }
  })

  it('T7 true / null → NICIO „Închide comanda" pe stările ne-servite (regula de aur)', () => {
    for (const pe of [true, null] as const) {
      for (const status of ['new', 'confirmed', 'preparing', 'ready'] as const) {
        const { unmount } = renderPlain(makeOrder({ status }), pe)
        expect(
          screen.queryByRole('button', { name: /^închide comanda$/i }),
          `${String(pe)}/${status}`,
        ).toBeNull()
        unmount()
      }
    }
  })

  it('T8 din `new` cere confirmare (avertizează că se scade stoc / se dau puncte) și închide doar după „da"', async () => {
    const order = makeOrder({ status: 'new' })
    const { onCloseOrder } = renderCard(order, false)
    await userEvent.click(screen.getByRole('button', { name: /^închide comanda$/i }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    const opts = confirmMock.mock.calls[0]![0]
    expect(opts.title).toMatch(/înainte să fie servită/i)
    expect(opts.description).toMatch(/stocul/i)
    expect(opts.description).toMatch(/anulează/i)
    await waitFor(() => expect(onCloseOrder).toHaveBeenCalledWith(order))
  })

  it('T9 confirmare REFUZATĂ → comanda NU se închide', async () => {
    confirmMock.mockResolvedValue(false)
    const { onCloseOrder } = renderCard(makeOrder({ status: 'preparing' }), false)
    await userEvent.click(screen.getByRole('button', { name: /^închide comanda$/i }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(onCloseOrder).not.toHaveBeenCalled()
  })

  it('T10 din `served` NU se cere confirmare (pasul normal, ca înainte)', async () => {
    const order = makeOrder({ status: 'served' })
    const { onCloseOrder } = renderCard(order, false)
    await userEvent.click(screen.getByRole('button', { name: /^închide comanda$/i }))
    expect(confirmMock).not.toHaveBeenCalled()
    expect(onCloseOrder).toHaveBeenCalledWith(order)
  })
})

describe('OrderCard — „Închide masa" (închide sesiunea)', () => {
  function renderWithTable(
    order: Order,
    paymentsEnabled: boolean | null,
    sessionUnservedCount?: number | null,
  ) {
    const onCloseTable = vi.fn()
    render(
      <OrderCard
        order={order}
        onPayOpen={vi.fn()}
        onSplitOpen={vi.fn()}
        onCloseOrder={vi.fn()}
        onCloseTable={onCloseTable}
        paymentsEnabled={paymentsEnabled}
        sessionUnservedCount={sessionUnservedCount}
      />,
    )
    return { onCloseTable }
  }

  it('T11 comandă cu session_id + Plan 1/2 → „Închide masa" cere confirmare apoi cheamă handlerul', async () => {
    const order = makeOrder({ status: 'ready', session_id: 'sess-1' })
    const { onCloseTable } = renderWithTable(order, false)
    await userEvent.click(screen.getByRole('button', { name: /^închide masa$/i }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(confirmMock.mock.calls[0]![0].title).toMatch(/închizi masa/i)
    await waitFor(() => expect(onCloseTable).toHaveBeenCalledWith(order))
  })

  it('T14 dialogul spune că rundele NEservite se anulează (mig 288), cu numărul când e cunoscut', async () => {
    const cases: [number | null, RegExp, RegExp | null][] = [
      [2, /2 runde neservite.*ANULATE/, null],
      [1, /1 rundă neservită.*ANULATĂ/, null],
      [null, /neservite.*se anulează/, null],
      [0, /închid toate comenzile/i, /anul/i],
    ]
    for (const [count, expected, forbidden] of cases) {
      confirmMock.mockClear()
      const { unmount } = render(
        <OrderCard
          order={makeOrder({ status: 'served', session_id: 'sess-1' })}
          onPayOpen={vi.fn()}
          onSplitOpen={vi.fn()}
          onCloseOrder={vi.fn()}
          onCloseTable={vi.fn()}
          paymentsEnabled={false}
          sessionUnservedCount={count}
        />,
      )
      await userEvent.click(screen.getByRole('button', { name: /^închide masa$/i }))
      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
      const description = String(confirmMock.mock.calls[0]![0].description)
      expect(description).toMatch(expected)
      if (forbidden) expect(description).not.toMatch(forbidden)
      unmount()
    }
  })

  it('T12 confirmare refuzată → sesiunea NU se închide', async () => {
    confirmMock.mockResolvedValue(false)
    const { onCloseTable } = renderWithTable(
      makeOrder({ status: 'served', session_id: 'sess-1' }),
      false,
    )
    await userEvent.click(screen.getByRole('button', { name: /^închide masa$/i }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(onCloseTable).not.toHaveBeenCalled()
  })

  it('T13 fără session_id (comandă de ospătar) sau pe Plan 3 / plan necunoscut → fără „Închide masa"', () => {
    const cases: [Order, boolean | null][] = [
      [makeOrder({ status: 'served', session_id: null }), false],
      [makeOrder({ status: 'served' }), false],
      [makeOrder({ status: 'served', session_id: 'sess-1' }), true],
      [makeOrder({ status: 'served', session_id: 'sess-1' }), null],
    ]
    for (const [order, pe] of cases) {
      const { unmount } = render(
        <OrderCard
          order={order}
          onPayOpen={vi.fn()}
          onSplitOpen={vi.fn()}
          onCloseOrder={vi.fn()}
          onCloseTable={vi.fn()}
          paymentsEnabled={pe}
        />,
      )
      expect(screen.queryByRole('button', { name: /^închide masa$/i })).toBeNull()
      unmount()
    }
  })
})

describe('OrderCard — acțiunea în curs și refuzul ei (ux-staff-double-tap-advance / action-errors)', () => {
  it('T15 pending → „Închide comanda" dezactivat („Se salvează…"), fără al doilea apel', async () => {
    // Mutație: scoate `disabled={pending}` / garda din handleCloseClick → al
    // doilea tap închide din nou (sau, după re-așezare, comanda vecină).
    const onCloseOrder = vi.fn()
    render(
      <OrderCard
        order={makeOrder({ status: 'served' })}
        onPayOpen={vi.fn()}
        onSplitOpen={vi.fn()}
        onCloseOrder={onCloseOrder}
        paymentsEnabled={false}
        pending
      />,
    )
    expect(screen.queryByRole('button', { name: /^închide comanda$/i })).toBeNull()
    const btn = screen.getByRole('button', { name: /se salvează/i })
    expect(btn).toBeDisabled()
    await userEvent.click(btn)
    expect(onCloseOrder).not.toHaveBeenCalled()
  })

  it('T16 refuzul serverului apare PE CARD, în română, cu buton de închidere', async () => {
    const onDismissError = vi.fn()
    const order = makeOrder({ id: 'o-err', status: 'served' })
    render(
      <OrderCard
        order={order}
        onPayOpen={vi.fn()}
        onSplitOpen={vi.fn()}
        onCloseOrder={vi.fn()}
        paymentsEnabled={false}
        actionError="Fără conexiune — acțiunea nu a fost salvată. Reîncearcă."
        onDismissError={onDismissError}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/fără conexiune/i)
    await userEvent.click(within(alert).getByRole('button', { name: 'Închide mesajul' }))
    expect(onDismissError).toHaveBeenCalledWith('o-err')
  })

  it('T17 control: fără eroare → niciun alert pe card', () => {
    renderCard(makeOrder({ status: 'served' }), false)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// Lotul G: vârsta comenzii e colorată și la ospătar, cu pragurile Bucătăriei.
//   WA1  25 de minute, încă în preparare → „întârziată", în roșu (data-age
//        late); 12 minute → atenție (warn); 3 minute → calm. Mutația care pică:
//        vârsta randată fără nivel (codul vechi).
//   WA2  după „Servit" culoarea dispare: comanda nu mai așteaptă bucătăria.
//   WA3  pickup programat, plasat acum 3 ore, ora promisă trecută de 25 de
//        minute: cifra afișată e „25m", nu „3h …" — aceeași ancoră ca culoarea.
//        Înainte de ora promisă cifra rămâne vârsta de la plasare. Mutația care
//        pică: `useElapsed(order.created_at)` (cifra veche, „3h 0m · întârziată").
describe('OrderCard — vârsta colorată (lotul G)', () => {
  // Ceas înghețat: cifrele afișate („25m", „30m") nu au voie să depindă de
  // milisecundele dintre construcția fixturii și randare.
  const NOW = new Date('2026-07-20T12:00:00Z').getTime()
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  const ago = (m: number) => new Date(NOW - m * 60_000).toISOString()

  it('WA1 pragurile 10 / 20 de minute', () => {
    const { container, unmount } = render(
      <OrderCard order={makeOrder({ status: 'preparing', created_at: ago(25) })} paymentsEnabled={null} onPayOpen={vi.fn()} onSplitOpen={vi.fn()} />,
    )
    expect(container.querySelector('[data-age]')?.getAttribute('data-age')).toBe('late')
    expect(screen.getByText(/întârziată/)).toBeInTheDocument()
    unmount()
    const warn = render(
      <OrderCard order={makeOrder({ status: 'confirmed', created_at: ago(12) })} paymentsEnabled={null} onPayOpen={vi.fn()} onSplitOpen={vi.fn()} />,
    )
    expect(warn.container.querySelector('[data-age]')?.getAttribute('data-age')).toBe('warn')
    expect(screen.queryByText(/întârziată/)).toBeNull()
    warn.unmount()
    const calm = render(
      <OrderCard order={makeOrder({ status: 'new', created_at: ago(3) })} paymentsEnabled={null} onPayOpen={vi.fn()} onSplitOpen={vi.fn()} />,
    )
    expect(calm.container.querySelector('[data-age]')?.getAttribute('data-age')).toBe('calm')
  })

  it('WA3 pickup programat: vârsta afișată e față de ora promisă', () => {
    const late = render(
      <OrderCard
        order={makeOrder({ status: 'preparing', source: 'pickup', created_at: ago(180), pickup_time: ago(25) })}
        paymentsEnabled={null}
        onPayOpen={vi.fn()}
        onSplitOpen={vi.fn()}
      />,
    )
    const span = late.container.querySelector('[data-age]')
    expect(span?.getAttribute('data-age')).toBe('late')
    expect(span?.textContent).toBe('25m · întârziată')
    late.unmount()
    const ahead = render(
      <OrderCard
        order={makeOrder({ status: 'preparing', source: 'pickup', created_at: ago(30), pickup_time: ago(-40) })}
        paymentsEnabled={null}
        onPayOpen={vi.fn()}
        onSplitOpen={vi.fn()}
      />,
    )
    const calm = ahead.container.querySelector('[data-age]')
    expect(calm?.getAttribute('data-age')).toBe('calm')
    expect(calm?.textContent).toBe('30m')
  })

  it('WA2 servită → fără culoare de întârziere', () => {
    const { container } = render(
      <OrderCard order={makeOrder({ status: 'served', created_at: ago(45) })} paymentsEnabled={null} onPayOpen={vi.fn()} onSplitOpen={vi.fn()} />,
    )
    expect(container.querySelector('[data-age]')?.getAttribute('data-age')).toBe('calm')
    expect(screen.queryByText(/întârziată/)).toBeNull()
  })
})

// Lotul O7b: pe Planul 3 cardul ospătarului poartă PASUL URMĂTOR
// (lib/waiterSteps.ts). Înainte plata apărea doar pe `served`, „Închide
// comanda” e interzisă pe Plan 3, iar new → … → ready îl făcea doar Bucătăria
// — un local fără ecran de bucătărie avea comenzile blocate pe „Nou”.
//   T18  new / confirmed → „Marchează în pregătire”; click → onAdvance(order);
//        niciun buton de plată / închidere. [PICĂ: codul vechi — butonul lipsea]
//   T19  preparing (ospătar) → „Servit”; preparing (pickup) → „Gata”; ready →
//        „Servit”; served → FĂRĂ pas, dar cu Plată integrală + parțială.
//        [PICĂ: un pas pe served, sau dublura lângă butoanele de plată]
//   T20  Plan 1/2 (false) și plan necunoscut (null) → niciun pas pe nicio stare
//        deschisă; control: aceeași randare cu true îl arată.
//        [PICĂ: gate `paymentsEnabled !== false` (apare pe necunoscut) sau
//         gate-ul de plan scos]
//   T21  pending → pasul dezactivat („Se salvează…”), click fără apel.
//        [PICĂ: `loading={pending}` scos]
//   T22  onAdvance omis (Plan 3, `new`) → fără pas: contractul call-site-ului
//        din listă pentru `ready` (acolo „Servit” stă în „Gata de servit”).
describe('OrderCard — pasul următor pe Planul 3 (lotul O7b)', () => {
  const FORWARD = /^(marchează în pregătire|servit|gata|se salvează…)$/i
  const OPEN = ['new', 'confirmed', 'preparing', 'ready'] as const

  function renderStep(
    order: Order,
    paymentsEnabled: boolean | null,
    opts: { pending?: boolean; withAdvance?: boolean } = {},
  ) {
    const onAdvance = vi.fn()
    const onPayOpen = vi.fn()
    const utils = render(
      <OrderCard
        order={order}
        onPayOpen={onPayOpen}
        onSplitOpen={vi.fn()}
        onCloseOrder={vi.fn()}
        onAdvance={opts.withAdvance === false ? undefined : onAdvance}
        paymentsEnabled={paymentsEnabled}
        pending={opts.pending ?? false}
      />,
    )
    return { ...utils, onAdvance, onPayOpen }
  }

  it('T18 new / confirmed → „Marchează în pregătire”, fără plată sau închidere', async () => {
    for (const status of ['new', 'confirmed'] as const) {
      const order = makeOrder({ id: `o-${status}`, status })
      const { onAdvance, unmount } = renderStep(order, true)
      await userEvent.click(screen.getByRole('button', { name: /^marchează în pregătire$/i }))
      expect(onAdvance, status).toHaveBeenCalledTimes(1)
      expect(onAdvance, status).toHaveBeenCalledWith(order)
      expect(screen.queryByRole('button', { name: FINAL_BUTTON }), status).toBeNull()
      unmount()
    }
  })

  it('T19 preparing → „Servit” / „Gata” (pickup); ready → „Servit”; served → doar plata', async () => {
    const cases: [Order, RegExp][] = [
      [makeOrder({ status: 'preparing', source: 'waiter' }), /^servit$/i],
      [makeOrder({ status: 'preparing', source: 'qr' }), /^servit$/i],
      [makeOrder({ status: 'preparing', source: 'pickup' }), /^gata$/i],
      [makeOrder({ status: 'ready', source: 'waiter' }), /^servit$/i],
      [makeOrder({ status: 'ready', source: 'pickup' }), /^servit$/i],
    ]
    for (const [order, name] of cases) {
      const label = `${order.status}/${order.source}`
      const { onAdvance, unmount } = renderStep(order, true)
      // exact UN pas pe card
      expect(screen.getAllByRole('button', { name: FORWARD }), label).toHaveLength(1)
      await userEvent.click(screen.getByRole('button', { name }))
      expect(onAdvance, label).toHaveBeenCalledWith(order)
      expect(screen.queryByRole('button', { name: FINAL_BUTTON }), label).toBeNull()
      unmount()
    }
    // served: plata, fără pas (T1 rămâne adevărat și cu onAdvance prezent)
    const served = makeOrder({ status: 'served' })
    const servedCard = renderStep(served, true)
    expect(screen.queryByRole('button', { name: FORWARD })).toBeNull()
    expect(screen.getByRole('button', { name: /^plată parțială$/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^plată integrală$/i }))
    expect(servedCard.onPayOpen).toHaveBeenCalledWith(served)
    expect(servedCard.onAdvance).not.toHaveBeenCalled()
  })

  it('T20 Plan 1/2 și plan necunoscut → niciun pas; control: Plan 3 îl arată', () => {
    for (const pe of [false, null] as const) {
      for (const status of OPEN) {
        const { unmount } = renderStep(makeOrder({ status }), pe)
        expect(screen.queryByRole('button', { name: FORWARD }), `${String(pe)}/${status}`).toBeNull()
        unmount()
      }
    }
    for (const status of OPEN) {
      const { unmount } = renderStep(makeOrder({ status }), true)
      expect(screen.getAllByRole('button', { name: FORWARD }), `true/${status}`).toHaveLength(1)
      unmount()
    }
  })

  it('T21 pending → pasul dezactivat („Se salvează…”), fără al doilea apel', async () => {
    const { onAdvance } = renderStep(makeOrder({ status: 'new' }), true, { pending: true })
    expect(screen.queryByRole('button', { name: /^marchează în pregătire$/i })).toBeNull()
    const btn = screen.getByRole('button', { name: /se salvează/i })
    expect(btn).toBeDisabled()
    await userEvent.click(btn)
    expect(onAdvance).not.toHaveBeenCalled()
  })

  it('T22 onAdvance omis → fără pas, chiar pe Plan 3', () => {
    renderStep(makeOrder({ status: 'new' }), true, { withAdvance: false })
    expect(screen.queryByRole('button', { name: FORWARD })).toBeNull()
  })
})
