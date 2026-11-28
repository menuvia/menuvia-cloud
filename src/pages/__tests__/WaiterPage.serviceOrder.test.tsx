// Ecranul ospătarului în ordinea serviciului (lotul C2b). Hook-urile de date
// sunt mock-uite, ca în WaiterPage.quickActions.test.tsx; ceasul e fixat la
// 2026-07-20T15:00Z = 18:00 la București (fusul implicit, fără restaurant activ).
//   WRV5 ordinea: apeluri → „Gata de servit” → comenzile deschise → rezervări
//        → fidelizare. [PICĂ: rezervările / fidelizarea readuse deasupra
//        apelurilor — bug-ul de dinainte, „Cere nota” sub ecran]
//   WRV6 rezervările: implicit doar nesosite din următoarele 2 ore (inclusiv
//        cea întârziată), titlul spune ora următoarei; „Toate (4)” arată restul
//        zilei și pe cea așezată, cu „Finalizează” → completed. [PICĂ: toată
//        ziua afișată implicit, sau `seated` fără nicio acțiune]
//   WRV7 dublu-tap: în „Toate”, „Finalizează” apare FIX în locul lui „Așezat”;
//        al doilea tap al unui dublu-tap NU încheie rezervarea abia așezată.
//        Control: un tap deliberat, după fereastră, o încheie.
//        [PICĂ: `tapGuard` scos din handleFinishReservation]
//   WCL1 „Preiau” refuzat de server → toast în limba personalului, apelul rămâne
//        și butonul se poate reapăsa. [PICĂ: `.then(...)` fără catch — nimic pe
//        ecran și o promisiune respinsă necapturată]
//   WCL2 cât cererea e în aer butonul e dezactivat și un al doilea tap nu mai
//        trimite; la succes apelul iese din listă (control pozitiv).
//        [PICĂ: `loading` scos de pe buton]
//   WCL3 „No-show” trece prin dialogul comun, distructiv (nu `window.confirm`):
//        refuzat → nimic; acceptat → no_show. [PICĂ: `confirm()` nativ readus]
//   WLY1 fidelizarea apare doar cu feature-ul de plan ȘI modulul `loyalty`
//        (modulele necitite nu o ascund). [PICĂ: LoyaltyRedeem montat
//        necondiționat, sau gate pe `profile.plan`/doar pe plan]
//   WRD1 Planul 2: comanda `ready` are UN singur card (cel complet, din „Gata de
//        servit”, cu Editează/Anulează + „Servit” + „Închide comanda”), iar
//        contorul listei n-o mai numără. [PICĂ: `ready` lăsat în lista grupată]
//   WRD2 plan necunoscut: „Servit” rămâne (servirea nu e bani), fără plată și
//        fără închidere. [PICĂ: „Servit” legat de pasul O7b (doar Planul 3)]
//   WRD3 doar comenzi gata → fără „Nicio comandă deschisă” sub ele; control:
//        fără nicio comandă mesajul apare.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { Order, WaiterCall } from '../../lib/orders'
import type { Reservation, ReservationStatus } from '../../hooks/useReservations'

const h = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useRestaurantCtx: vi.fn(),
  useOrders: vi.fn(),
  useFeatures: vi.fn(),
  useBridgeConnected: vi.fn(),
  useReservations: vi.fn(),
  useRestaurantModules: vi.fn(),
  useOfflineOrderQueue: vi.fn(),
  useAudioUnlock: vi.fn(),
  resolve: vi.fn<(id: string) => Promise<void>>(),
  confirm: vi.fn<(opts: { title: string; destructive?: boolean }) => Promise<boolean>>(),
  calls: [] as WaiterCall[],
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: h.useAuth }))
vi.mock('../../contexts/RestaurantContext', () => ({ useRestaurantCtx: h.useRestaurantCtx }))
vi.mock('../../hooks/useOrders', () => ({ useOrders: h.useOrders }))
vi.mock('../../hooks/useFeatures', () => ({ useFeatures: h.useFeatures }))
vi.mock('../../hooks/useBridgeConnected', () => ({ useBridgeConnected: h.useBridgeConnected }))
vi.mock('../../hooks/useReservations', () => ({ useReservations: h.useReservations }))
vi.mock('../../hooks/useRestaurantModules', () => ({ useRestaurantModules: h.useRestaurantModules }))
vi.mock('../../hooks/useOfflineOrderQueue', () => ({ useOfflineOrderQueue: h.useOfflineOrderQueue }))
vi.mock('../../hooks/useAudioUnlock', () => ({ useAudioUnlock: h.useAudioUnlock }))
vi.mock('../../components/ui/useToast', () => ({ useToast: () => h.toast }))
vi.mock('../../components/ui/confirm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/ui/confirm')>()),
  confirm: (opts: { title: string; destructive?: boolean }) => h.confirm(opts),
}))

// PostgREST: mesele, harta sălii și alocările de mese — toate goale.
vi.mock('../../lib/supabase', () => {
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'order', 'in', 'limit']) c[k] = () => c
    c.maybeSingle = () => Promise.resolve({ data: null, error: null })
    c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(ok, ko)
    return c
  }
  return {
    supabase: { from: () => chain(), rpc: () => Promise.resolve({ data: null, error: null }) },
  }
})

vi.mock('../../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orders')>()
  return {
    ...actual,
    fetchWaiterCalls: () => Promise.resolve(h.calls),
    subscribeToWaiterCalls: () => ({ unsubscribe: () => {} }),
    resolveWaiterCall: (id: string) => h.resolve(id),
  }
})

import WaiterPage from '../WaiterPage'
import { makeOrder, makeTable } from '../../components/__tests__/fixtures'
import { featuresFor } from '../../lib/__tests__/planSurfaceFixtures'
import { STAFF_TAP_GUARD_MS } from '../../lib/tapGuard'

const NOW = Date.parse('2026-07-20T15:00:00Z') // 18:00 la București
const at = (min: number): string => new Date(NOW + min * 60_000).toISOString()

function resv(id: string, status: ReservationStatus, startsAt: string, extra: Partial<Reservation> = {}): Reservation {
  return {
    id,
    restaurant_id: 'r1',
    table_id: null,
    customer_name: `Client ${id}`,
    customer_phone: '+40722000000',
    customer_email: null,
    party_size: 2,
    special_requests: null,
    starts_at: startsAt,
    ends_at: startsAt,
    status,
    source: 'phone',
    reminder_sent_at: null,
    confirmation_code: id,
    requested_zone: null,
    created_at: '2026-07-20T09:00:00Z',
    updated_at: '2026-07-20T09:00:00Z',
    table: null,
    ...extra,
  }
}

function setOrders(orders: Order[], advance = vi.fn().mockResolvedValue(true)) {
  h.useOrders.mockReturnValue({
    orders,
    loading: false,
    error: null,
    truncated: false,
    connectionStatus: 'connected',
    advance,
    byStatus: () => orders,
    pendingIds: new Set<string>(),
    actionErrors: {},
    dismissActionError: vi.fn(),
  })
  return advance
}

function setReservations(reservations: Reservation[]) {
  const updateStatus = vi.fn().mockResolvedValue(undefined)
  const seat = vi.fn().mockResolvedValue(undefined)
  h.useReservations.mockReturnValue({ reservations, updateStatus, seat })
  return { updateStatus, seat }
}

function modules(loyalty: boolean, loadError = false) {
  h.useRestaurantModules.mockReturnValue({
    isEnabled: (k: string) => k === 'loyalty' && loyalty,
    loadError,
    loading: false,
  })
}

const card = (container: HTMLElement, attr: string, id: string): HTMLElement => {
  const el = container.querySelector<HTMLElement>(`[${attr}="${id}"]`)
  if (el == null) throw new Error(`lipsește [${attr}="${id}"]`)
  return el
}
const follows = (a: Element, b: Element): boolean =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  h.calls = []
  h.resolve.mockResolvedValue(undefined)
  h.confirm.mockResolvedValue(true)
  h.useAuth.mockReturnValue({ user: { id: 'u1' } })
  h.useRestaurantCtx.mockReturnValue({
    activeId: 'r1',
    activeName: 'Bistro',
    activeRole: 'waiter',
    memberships: [],
    setActive: vi.fn(),
  })
  h.useFeatures.mockReturnValue({ features: featuresFor('pro'), loading: false, reload: vi.fn() })
  h.useBridgeConnected.mockReturnValue({ status: null, loading: false })
  modules(true)
  setReservations([])
  h.useOfflineOrderQueue.mockReturnValue({
    isOffline: false,
    pendingCount: 0,
    droppedReason: null,
    dismissDropped: vi.fn(),
    authRequired: false,
  })
  h.useAudioUnlock.mockReturnValue({ locked: false, unlock: vi.fn() })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const t7 = makeTable({ id: 't7', name: '7' })
const billCall: WaiterCall = {
  id: 'c1',
  restaurant_id: 'r1',
  table_id: 't7',
  call_type: 'bill',
  tip_amount: null,
  status: 'pending',
  created_at: '2026-07-20T14:55:00Z',
  resolved_at: null,
  table: { name: '7' },
}

describe('WaiterPage — ordinea serviciului (lotul C2b)', () => {
  it('WRV5 apeluri → Gata de servit → comenzile deschise → rezervări → fidelizare', async () => {
    h.calls = [billCall]
    setOrders([
      makeOrder({ id: 'R', status: 'ready', table_id: 't7', table: t7, order_items: [] }),
      makeOrder({ id: 'S', status: 'served', table_id: 't7', table: t7, order_items: [] }),
    ])
    setReservations([resv('A', 'confirmed', at(60))])
    render(<WaiterPage />)
    const calls = await screen.findByText('Apeluri ospătar')
    // „Gata de servit” e și insigna de stare a cardului: titlul secțiunii e primul.
    const ready = screen.getAllByText('Gata de servit')[0]!
    const open = screen.getByText('Toate comenzile deschise')
    const reservations = screen.getByText(/Rezervări azi/)
    const loyalty = screen.getByRole('button', { name: 'Fidelizare — cod client' })
    expect(follows(calls, ready)).toBe(true)
    expect(follows(ready, open)).toBe(true)
    expect(follows(open, reservations)).toBe(true)
    expect(follows(reservations, loyalty)).toBe(true)
  })
})

describe('WaiterPage — rezervările zilei pliate pe următoarele 2 ore (lotul C2b)', () => {
  const day = () => [
    resv('LATE', 'confirmed', at(-30), { table_id: 't7' }), // 17:30, întârziată
    resv('SOON', 'confirmed', at(60)), // 19:00
    resv('LATER', 'pending', at(270)), // 22:30
    resv('SEATED', 'seated', at(-60), { table_id: 't7', table: { id: 't7', name: '7', seats: 4, zone: null } }),
  ]

  it('WRV6 implicit nesosite din 2 ore; „Toate” arată restul și „Finalizează” pe cea așezată', async () => {
    setOrders([])
    const { updateStatus } = setReservations(day())
    const { container } = render(<WaiterPage />)
    expect(await screen.findByText('Rezervări azi (4) · următoarea 19:00')).toBeInTheDocument()
    const shownIds = () =>
      [...container.querySelectorAll('[data-reservation-id]')].map((e) => e.getAttribute('data-reservation-id'))
    expect(shownIds()).toEqual(['LATE', 'SOON'])
    expect(screen.queryByRole('button', { name: 'Finalizează' })).toBeNull()

    const toggle = screen.getByRole('button', { name: 'Toate (4)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(shownIds()).toEqual(['SEATED', 'LATE', 'SOON', 'LATER'])
    expect(screen.getByRole('button', { name: 'Doar următoarele 2 ore' })).toHaveAttribute('aria-expanded', 'true')
    // cea așezată: fără selector și fără „Așezat”, doar „Finalizează”
    const seated = card(container, 'data-reservation-id', 'SEATED')
    expect(within(seated).queryByRole('combobox')).toBeNull()
    fireEvent.click(within(seated).getByRole('button', { name: 'Finalizează' }))
    expect(updateStatus).toHaveBeenCalledWith('SEATED', 'completed')
  })

  it('WRV7 dublu-tap „Așezat” → „Finalizează” (același loc) NU încheie rezervarea', async () => {
    setOrders([])
    const { updateStatus, seat } = setReservations(day())
    const { container, rerender } = render(<WaiterPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Toate (4)' }))
    fireEvent.click(within(card(container, 'data-reservation-id', 'LATE')).getByRole('button', { name: 'Așezat' }))
    expect(seat).toHaveBeenCalledWith('LATE', 't7')
    // update-ul optimist din useReservations: LATE devine `seated` între tap-uri
    h.useReservations.mockReturnValue({
      reservations: day().map((x) => (x.id === 'LATE' ? { ...x, status: 'seated' as const } : x)),
      updateStatus,
      seat,
    })
    rerender(<WaiterPage />)
    const finish = within(card(container, 'data-reservation-id', 'LATE')).getByRole('button', { name: 'Finalizează' })
    fireEvent.click(finish)
    expect(updateStatus).not.toHaveBeenCalled()
    // control: un tap deliberat, după fereastra de dublu-tap, o încheie
    vi.setSystemTime(new Date(NOW + STAFF_TAP_GUARD_MS + 100))
    fireEvent.click(finish)
    expect(updateStatus).toHaveBeenCalledWith('LATE', 'completed')
  })

  it('WCL3 „No-show” cere dialogul comun, distructiv — nu `window.confirm`', async () => {
    setOrders([])
    const { updateStatus } = setReservations([resv('SOON', 'confirmed', at(60))])
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    h.confirm.mockResolvedValueOnce(false)
    render(<WaiterPage />)
    const noShow = await screen.findByRole('button', { name: 'No-show' })
    fireEvent.click(noShow)
    await vi.waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1))
    expect(h.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Marchezi ca no-show?', destructive: true }),
    )
    // lasă handler-ul să termine după refuz (doar Date e fals, setTimeout e real)
    await new Promise((ok) => setTimeout(ok, 0))
    expect(updateStatus).not.toHaveBeenCalled()
    // acceptat → no_show
    fireEvent.click(noShow)
    await vi.waitFor(() => expect(updateStatus).toHaveBeenCalledWith('SOON', 'no_show'))
    expect(nativeConfirm).not.toHaveBeenCalled()
  })
})

describe('WaiterPage — „Preiau” pe un apel (lotul C2b)', () => {
  it('WCL1 refuzul serverului apare ca toast, apelul rămâne și butonul revine', async () => {
    h.calls = [billCall]
    setOrders([])
    h.resolve.mockRejectedValueOnce(new Error('boom'))
    render(<WaiterPage />)
    const take = await screen.findByRole('button', { name: 'Preiau' })
    fireEvent.click(take)
    await vi.waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith('Apelul nu a putut fi preluat. Reîncearcă.'),
    )
    expect(h.resolve).toHaveBeenCalledWith('c1')
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Preiau' })).not.toBeDisabled())
  })

  it('WCL2 cât cererea e în aer butonul e blocat; la succes apelul dispare', async () => {
    h.calls = [billCall]
    setOrders([])
    const deferred: { resolve: (() => void) | null } = { resolve: null }
    h.resolve.mockImplementationOnce(
      () =>
        new Promise<void>((ok) => {
          deferred.resolve = ok
        }),
    )
    render(<WaiterPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Preiau' }))
    const busy = screen.getByRole('button', { name: 'Preiau' })
    expect(busy).toBeDisabled()
    fireEvent.click(busy)
    expect(h.resolve).toHaveBeenCalledTimes(1)
    deferred.resolve?.()
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Preiau' })).toBeNull())
    expect(h.toast.error).not.toHaveBeenCalled()
  })
})

describe('WaiterPage — fidelizarea doar cu feature + modul (lotul C2b)', () => {
  const LOYALTY = { name: 'Fidelizare — cod client' }
  it('WLY1 plan cu fidelizare + modul pornit → da; fără modul / fără feature → nu', async () => {
    setOrders([])
    const cases: Array<[string, () => void, boolean]> = [
      ['pro + modul', () => modules(true), true],
      ['pro fără modul', () => modules(false), false],
      [
        'starter + modul',
        () => {
          modules(true)
          h.useFeatures.mockReturnValue({ features: featuresFor('starter'), loading: false, reload: vi.fn() })
        },
        false,
      ],
      ['pro, modulele necitite', () => modules(false, true), true],
    ]
    for (const [label, arrange, visible] of cases) {
      h.useFeatures.mockReturnValue({ features: featuresFor('pro'), loading: false, reload: vi.fn() })
      arrange()
      const { unmount } = render(<WaiterPage />)
      await screen.findByText('Toate comenzile deschise')
      if (visible) expect(screen.getByRole('button', LOYALTY), label).toBeInTheDocument()
      else expect(screen.queryByRole('button', LOYALTY), label).toBeNull()
      unmount()
    }
  })
})

describe('WaiterPage — o comandă gata se randează o singură dată (lotul C2b)', () => {
  it('WRD1 Planul 2: un singur card, cel complet; contorul listei n-o numără', async () => {
    h.useFeatures.mockReturnValue({ features: featuresFor('growth'), loading: false, reload: vi.fn() })
    const advance = setOrders([
      makeOrder({ id: 'R', status: 'ready', table_id: 't7', table: t7 }),
      makeOrder({ id: 'S', status: 'served', table_id: 't7', table: t7 }),
    ])
    const { container } = render(<WaiterPage />)
    await screen.findByText('Toate comenzile deschise')
    expect(container.querySelectorAll('[data-order-id="R"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-order-id="S"]')).toHaveLength(1)
    const ready = card(container, 'data-order-id', 'R')
    // cardul complet: editare, anulare, „Servit” și (Planul 2) închiderea
    for (const name of ['Editează', 'Anulează', 'Servit', 'Închide comanda']) {
      expect(within(ready).getByRole('button', { name }), name).toBeInTheDocument()
    }
    // grupul mesei 7 are doar comanda servită
    expect(screen.getByText('1 comandă')).toBeInTheDocument()
    fireEvent.click(within(ready).getByRole('button', { name: 'Servit' }))
    expect(advance).toHaveBeenCalledWith('R', 'ready', { status: 'served', served_by: 'u1' })
  })

  it('WRD2 plan necunoscut: „Servit” rămâne, fără plată și fără închidere', async () => {
    h.useFeatures.mockReturnValue({ features: null, loading: true, reload: vi.fn() })
    setOrders([makeOrder({ id: 'R', status: 'ready', table_id: 't7', table: t7 })])
    const { container } = render(<WaiterPage />)
    // pagina așteaptă întâi alocările de mese („Se încarcă...”)
    await screen.findByText('Gata de servit', { selector: 'span' })
    const ready = card(container, 'data-order-id', 'R')
    expect(within(ready).getByRole('button', { name: 'Servit' })).toBeInTheDocument()
    expect(
      within(ready).queryByRole('button', { name: /^(plată integrală|plată parțială|închide comanda)$/i }),
    ).toBeNull()
  })

  it('WRD3 doar comenzi gata → fără „Nicio comandă deschisă”; control: fără comenzi apare', async () => {
    setOrders([makeOrder({ id: 'R', status: 'ready', table_id: 't7', table: t7 })])
    const { unmount } = render(<WaiterPage />)
    expect(await screen.findByText('Gata de servit', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText('Nicio comandă deschisă')).toBeNull()
    unmount()
    setOrders([])
    render(<WaiterPage />)
    expect(await screen.findByText('Nicio comandă deschisă')).toBeInTheDocument()
  })
})
