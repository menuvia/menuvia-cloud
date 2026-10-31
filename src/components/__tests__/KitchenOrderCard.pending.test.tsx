// Bucătăria (KDS): dublu-tap și erorile acțiunilor rapide.
//   - cardul cu acțiune în curs are butonul DEZACTIVAT („Se salvează…"):
//     după primul tap, starea optimistă arată deja PASUL URMĂTOR pe același
//     buton, iar al doilea tap al dublu-tap-ului îl apăsa;
//   - „Gata" mută cardul în altă coloană, iar cardul de dedesubt urcă sub
//     deget: un tap pe ALT card, venit în fereastra de dublu-tap, e ignorat;
//   - refuzul serverului stă SUB butonul apăsat, în română (nu sus, în pagină);
//   - sunetul blocat de browser e anunțat, cu un buton care îl pornește.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

const { useOrdersMock, useCtxMock, usePushMock, useAudioMock } = vi.hoisted(() => ({
  useOrdersMock: vi.fn(),
  useCtxMock: vi.fn(),
  usePushMock: vi.fn(),
  useAudioMock: vi.fn(),
}))
vi.mock('../../contexts/RestaurantContext', () => ({ useRestaurantCtx: useCtxMock }))
vi.mock('../../hooks/useOrders', () => ({ useOrders: useOrdersMock }))
vi.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: usePushMock }))
vi.mock('../../hooks/useAudioUnlock', () => ({ useAudioUnlock: useAudioMock }))

import KitchenPage, { KitchenOrderCard } from '../../pages/KitchenPage'
import { createTapGuard, STAFF_TAP_GUARD_MS } from '../../lib/tapGuard'
import type { Order, OrderStatus } from '../../lib/orders'
import { makeOrder } from './fixtures'

const NOW = new Date('2026-07-20T09:20:00Z')

describe('KitchenOrderCard — acțiunea în curs și eroarea ei', () => {
  it('KP1 pending → buton dezactivat „Se salvează…", fără onAdvance la tap', () => {
    // Mutație: scoate `disabled={pending}` → al doilea tap cheamă onAdvance.
    const onAdvance = vi.fn()
    render(
      <KitchenOrderCard
        order={makeOrder({ id: 'A', status: 'confirmed' })}
        onAdvance={onAdvance}
        pending
      />,
    )
    const btn = screen.getByRole('button', { name: 'Se salvează…' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(btn)
    expect(onAdvance).not.toHaveBeenCalled()
  })

  it('KP2 control: fără pending, butonul arată pasul și avansează', () => {
    const onAdvance = vi.fn()
    render(<KitchenOrderCard order={makeOrder({ id: 'A', status: 'new' })} onAdvance={onAdvance} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmă' }))
    expect(onAdvance).toHaveBeenCalledWith('A', 'new', 'confirmed')
  })

  it('KP3 refuzul stă PE CARD, sub buton, și se poate închide', () => {
    const onDismiss = vi.fn()
    render(
      <KitchenOrderCard
        order={makeOrder({ id: 'A', status: 'preparing' })}
        onAdvance={vi.fn()}
        actionError="Comanda s-a schimbat între timp — probabil a mutat-o deja un coleg."
        onDismissError={onDismiss}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/s-a schimbat între timp/)
    fireEvent.click(within(alert).getByRole('button', { name: 'Închide mesajul' }))
    expect(onDismiss).toHaveBeenCalledWith('A')
  })
})

describe('createTapGuard', () => {
  it('TG1 un tap în fereastra de dublu-tap e respins, după fereastră e acceptat', () => {
    let t = 1_000
    const allow = createTapGuard(STAFF_TAP_GUARD_MS, () => t)
    expect(allow()).toBe(true)
    t += 120 // al doilea tap al unui dublu-tap
    expect(allow()).toBe(false)
    t += STAFF_TAP_GUARD_MS
    expect(allow()).toBe(true)
  })

  it('TG2 domeniul „card": alt card trece în fereastră, ACELAȘI card nu; după o mutare, niciunul', () => {
    // Mutație: o singură fereastră globală (varianta de dinainte) → al doilea
    // „Confirmă", pe alt card, e înghițit tăcut.
    let t = 1_000
    const allow = createTapGuard(STAFF_TAP_GUARD_MS, () => t)
    expect(allow('A', 'card')).toBe(true)
    t += 120
    expect(allow('B', 'card')).toBe(true) // alt card, rămas pe loc: tap deliberat
    t += 60
    expect(allow('A', 'list')).toBe(false) // același card: al doilea tap al dublu-tap-ului
    t += STAFF_TAP_GUARD_MS
    expect(allow('A', 'list')).toBe(true) // A iese din coloană
    t += 100
    expect(allow('C', 'card')).toBe(false) // sub deget poate fi acum vecinul
  })

  it('TG3 ceasul sărit înapoi (corecție NTP) nu blochează tap-urile', () => {
    // Mutație: `t - last < windowMs` fără garda pe diferența negativă → orice
    // tap e respins până ajunge ceasul din urmă.
    let t = 100_000
    const allow = createTapGuard(STAFF_TAP_GUARD_MS, () => t)
    expect(allow('A')).toBe(true)
    t -= 60_000
    expect(allow('B')).toBe(true)
  })
})

function ordersHook(orders: Order[], advance: ReturnType<typeof vi.fn>) {
  return {
    orders,
    loading: false,
    error: null,
    truncated: false,
    connectionStatus: 'connected',
    advance,
    byStatus: (statuses: OrderStatus[]) => orders.filter((o) => statuses.includes(o.status)),
    pendingIds: new Set<string>(),
    actionErrors: {},
    dismissActionError: vi.fn(),
  }
}

describe('KitchenPage — dublu-tap peste carduri vecine și sunetul', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    useCtxMock.mockReturnValue({
      activeId: 'r1',
      activeName: 'Bistro',
      memberships: [],
      setActive: vi.fn(),
      loading: false,
    })
    usePushMock.mockReturnValue({
      supported: false,
      permission: 'unsupported',
      subscribed: false,
      loading: false,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    })
    useAudioMock.mockReturnValue({ locked: false, unlock: vi.fn() })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const twoPreparing = () => [
    makeOrder({ id: 'A', status: 'preparing', created_at: '2026-07-20T09:00:00Z' }),
    makeOrder({ id: 'B', status: 'preparing', created_at: '2026-07-20T09:05:00Z' }),
  ]

  it('KP4 „Gata" pe A, apoi imediat „Gata" pe B (a urcat sub deget) → doar A avansează', () => {
    // Mutație: scoate `if (!tapGuard()) return` din handleAdvance → advance
    // e chemat și pentru B, comanda VECINĂ.
    const advance = vi.fn().mockResolvedValue(true)
    useOrdersMock.mockReturnValue(ordersHook(twoPreparing(), advance))
    render(<KitchenPage />)
    const [gataA, gataB] = screen.getAllByRole('button', { name: 'Gata' })
    fireEvent.click(gataA)
    vi.advanceTimersByTime(150)
    fireEvent.click(gataB)
    expect(advance).toHaveBeenCalledTimes(1)
    expect(advance).toHaveBeenCalledWith('A', 'preparing', { status: 'ready' })
  })

  it('KP5 control: un tap DELIBERAT pe B, după fereastra de dublu-tap, avansează', () => {
    const advance = vi.fn().mockResolvedValue(true)
    useOrdersMock.mockReturnValue(ordersHook(twoPreparing(), advance))
    render(<KitchenPage />)
    const [gataA, gataB] = screen.getAllByRole('button', { name: 'Gata' })
    fireEvent.click(gataA)
    vi.advanceTimersByTime(STAFF_TAP_GUARD_MS + 50)
    fireEvent.click(gataB)
    expect(advance).toHaveBeenCalledTimes(2)
    expect(advance).toHaveBeenLastCalledWith('B', 'preparing', { status: 'ready' })
  })

  const twoNew = () => [
    makeOrder({ id: 'A', status: 'new', created_at: '2026-07-20T09:00:00Z' }),
    makeOrder({ id: 'B', status: 'new', created_at: '2026-07-20T09:05:00Z' }),
  ]

  it('KP8 „Confirmă" pe A, apoi repede „Confirmă" pe B (A NU s-a mutat) → ambele avansează', () => {
    // new și confirmed stau în aceeași coloană: nimic nu urcă sub deget, deci
    // al doilea tap e DELIBERAT (trei comenzi confirmate la rând). Mutație:
    // garda globală (orice card, orice acțiune) → B e înghițită tăcut.
    const advance = vi.fn().mockResolvedValue(true)
    useOrdersMock.mockReturnValue(ordersHook(twoNew(), advance))
    render(<KitchenPage />)
    const [confA, confB] = screen.getAllByRole('button', { name: 'Confirmă' })
    fireEvent.click(confA)
    vi.advanceTimersByTime(150)
    fireEvent.click(confB)
    expect(advance).toHaveBeenCalledTimes(2)
    expect(advance).toHaveBeenNthCalledWith(1, 'A', 'new', { status: 'confirmed' })
    expect(advance).toHaveBeenNthCalledWith(2, 'B', 'new', { status: 'confirmed' })
  })

  it('KP9 dublu-tap pe ACELAȘI card cu RPC rapid: al doilea tap nu-l mai avansează un pas', () => {
    // RPC-ul a răspuns înainte de al doilea tap: butonul lui A e din nou activ
    // și arată deja „Marchează în pregătire". Mutație: fără fereastra pe card
    // → A sare două stări (new → preparing) dintr-un dublu-tap.
    const advance = vi.fn().mockResolvedValue(true)
    useOrdersMock.mockReturnValue(ordersHook(twoNew(), advance))
    const { rerender } = render(<KitchenPage />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirmă' })[0])
    useOrdersMock.mockReturnValue(
      ordersHook(
        [
          makeOrder({ id: 'A', status: 'confirmed', created_at: '2026-07-20T09:00:00Z' }),
          makeOrder({ id: 'B', status: 'new', created_at: '2026-07-20T09:05:00Z' }),
        ],
        advance,
      ),
    )
    rerender(<KitchenPage />)
    vi.advanceTimersByTime(150)
    fireEvent.click(screen.getByRole('button', { name: 'Marchează în pregătire' }))
    expect(advance).toHaveBeenCalledTimes(1)
    expect(advance).toHaveBeenCalledWith('A', 'new', { status: 'confirmed' })
  })

  it('KP6 sunet blocat → bannerul cere o atingere; „Pornește sunetul" îl deblochează', () => {
    // Mutație: scoate bannerul → beep-ul rămâne mut fără niciun semn.
    const unlock = vi.fn()
    useAudioMock.mockReturnValue({ locked: true, unlock })
    useOrdersMock.mockReturnValue(ordersHook([], vi.fn()))
    render(<KitchenPage />)
    expect(screen.getByText(/sunetul pentru comenzile noi e oprit/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pornește sunetul' }))
    expect(unlock).toHaveBeenCalledTimes(1)
  })

  it('KP7 control: sunet deblocat → fără banner', () => {
    useOrdersMock.mockReturnValue(ordersHook([], vi.fn()))
    render(<KitchenPage />)
    expect(screen.queryByText(/sunetul pentru comenzile noi e oprit/i)).toBeNull()
  })
})
