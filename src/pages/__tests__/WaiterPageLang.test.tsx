// Pagina ospătarului în limba personalului (lotul L4b): antetul, bannerele
// (conexiune, offline, listă trunchiată), rezervările zilei, apelurile cu
// bacșiș propus, lista grupată pe mese, plata parțială și fidelizarea citesc
// namespace-ul `waiter` (+ `common`). Panoul „Stadiu mese”, alocările și
// helperii au suita lor: src/components/__tests__/WaiterLang.test.tsx.
//   LW8  control — fără provider (azi, mereu româna) pagina are textele de
//        dinainte, inclusiv pluralele false păstrate („2 comenzi în
//        așteptare”, „2 persoane · fără masă · ”) și „bacșiș propus”.
//        Mutația care pică: o cheie din `waiter/ro.ts` cu textul schimbat.
//   LW9  pagina în engleză: antetul, starea conexiunii (aria-label), bannerul
//        offline cu pluralul, lista trunchiată, rezervarea, apelul „cere nota”
//        cu bacșișul, secțiunile, gruparea pe mese — și NICIUN text românesc al
//        namespace-ului `waiter`. Mutația care pică: un literal românesc lăsat
//        în pagină (ex. „Rezervări azi” scris în cod, sau `'Fără masă'` ca
//        cheie de grupare).
//   LW10 în germană: modalul de plată parțială (metodele, „Offen:”, suma) și
//        fidelizarea — rezultatul se compune la RANDARE din date (puncte,
//        prag), nu e textul românesc memorat. Mutația care pică: `setResult`
//        cu textul românesc (`Puncte insuficiente: …`) readus.
//   LW11 în germană: refuzurile de business ale serverului pe „Închide masa”
//        (`fiscal_plan_requires_payment`, `cancel_over_payments`, mig 288) și
//        pe plata parțială (`insufficient_role`, mig 291) au textul lor, nu
//        „Bitte erneut versuchen” — un retry pe care serverul îl respinge din
//        nou. Mutația care pică: `hints` scos din `describeStaffError`.
// Hook-urile de date sunt mock-uite, ca în WaiterPage.quickActions.test.tsx.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Order, WaiterCall } from '../../lib/orders'

const h = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useRestaurantCtx: vi.fn(),
  useOrders: vi.fn(),
  useFeatures: vi.fn(),
  useBridgeConnected: vi.fn(),
  useReservations: vi.fn(),
  useOfflineOrderQueue: vi.fn(),
  useAudioUnlock: vi.fn(),
  redeem: vi.fn(),
  closeSessionOrders: vi.fn(),
  addPartialPayment: vi.fn(),
  calls: [] as WaiterCall[],
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: h.useAuth }))
vi.mock('../../contexts/RestaurantContext', () => ({ useRestaurantCtx: h.useRestaurantCtx }))
vi.mock('../../hooks/useOrders', () => ({ useOrders: h.useOrders }))
vi.mock('../../hooks/useFeatures', () => ({ useFeatures: h.useFeatures }))
vi.mock('../../hooks/useBridgeConnected', () => ({ useBridgeConnected: h.useBridgeConnected }))
vi.mock('../../hooks/useReservations', () => ({ useReservations: h.useReservations }))
vi.mock('../../hooks/useOfflineOrderQueue', () => ({ useOfflineOrderQueue: h.useOfflineOrderQueue }))
vi.mock('../../hooks/useAudioUnlock', () => ({ useAudioUnlock: h.useAudioUnlock }))
vi.mock('../../components/ui/useToast', () => ({ useToast: () => h.toast }))
vi.mock('../../lib/loyalty', () => ({ redeemLoyaltyReward: h.redeem }))
// „Închide masa” cere confirmare: dialogul imperativ e acceptat direct.
vi.mock('../../components/ui/confirm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/ui/confirm')>()),
  confirm: () => Promise.resolve(true),
}))

// PostgREST: mesele, harta sălii, alocările și plățile — toate goale.
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
    closeSessionOrders: (...a: unknown[]) => h.closeSessionOrders(...a),
    addPartialPayment: (...a: unknown[]) => h.addPartialPayment(...a),
  }
})

import WaiterPage from '../WaiterPage'
import { makeOrder, makeTable } from '../../components/__tests__/fixtures'
import { featuresFor } from '../../lib/__tests__/planSurfaceFixtures'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { waiterNs } from '../../i18n/ns/waiter'
import { ordersNs } from '../../i18n/ns/orders'
import { commonNs } from '../../i18n/ns/common'
import { paymentsNs } from '../../i18n/ns/payments'
import waiterRo from '../../i18n/ns/waiter/ro'
import waiterEn from '../../i18n/ns/waiter/en'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'
import type { Reservation } from '../../hooks/useReservations'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(
    // `payments` e cerut de pagină (partea a doua a lotului: modalele de plată).
    langs.flatMap((l) => [
      preloadNamespace(waiterNs, l),
      preloadNamespace(ordersNs, l),
      preloadNamespace(commonNs, l),
      preloadNamespace(paymentsNs, l),
    ]),
  )
})

function inLang(lang: StaffLang | null, node: ReactNode) {
  const tree = <Suspense fallback={null}>{node}</Suspense>
  return render(lang ? <UiLangScope lang={lang}>{tree}</UiLangScope> : tree)
}

/** Fragmentele românești ale namespace-ului `waiter` rămase în text (fără cele
 *  identice în limba țintă). Bucățile fixe ale unui text cu `{x}`, ≥ 6 caractere. */
function romanianLeftovers(text: string, target: Dict): string[] {
  const forms = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  for (const [k, v] of Object.entries(waiterRo as Dict)) {
    const own = forms(target[k]).join('\n')
    for (const f of forms(v)) {
      for (const piece of f.split(/\{\w+\}/)) {
        const p = piece.trim()
        if (p.length >= 6 && !own.includes(p) && text.includes(p)) out.push(`${k}: ${p}`)
      }
    }
  }
  return out
}

const RESERVATION: Reservation = {
  id: 'rv1',
  restaurant_id: 'r1',
  table_id: null,
  customer_name: 'Ana Pop',
  customer_phone: '+40722000000',
  customer_email: null,
  party_size: 2,
  special_requests: 'Window seat',
  starts_at: '2026-07-20T18:00:00Z',
  ends_at: '2026-07-20T20:00:00Z',
  status: 'confirmed',
  source: 'phone',
  reminder_sent_at: null,
  confirmation_code: 'ABC123',
  requested_zone: 'Terrace',
  created_at: '2026-07-20T09:00:00Z',
  updated_at: '2026-07-20T09:00:00Z',
  table: null,
}

function setup(orders: Order[], opts: { truncated?: boolean } = {}) {
  h.useOrders.mockReturnValue({
    orders,
    loading: false,
    error: null,
    truncated: opts.truncated ?? false,
    connectionStatus: 'connected',
    advance: vi.fn().mockResolvedValue(true),
    byStatus: () => orders,
    pendingIds: new Set<string>(),
    actionErrors: {},
    dismissActionError: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.calls = []
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
  h.useReservations.mockReturnValue({ reservations: [RESERVATION], updateStatus: vi.fn(), seat: vi.fn() })
  h.useOfflineOrderQueue.mockReturnValue({
    isOffline: true,
    pendingCount: 2,
    droppedReason: null,
    dismissDropped: vi.fn(),
    authRequired: false,
  })
  h.useAudioUnlock.mockReturnValue({ locked: false, unlock: vi.fn() })
})

function busyRestaurant(): Order[] {
  const t7 = makeTable({ id: 't7', name: '7' })
  h.calls = [
    {
      id: 'c1',
      restaurant_id: 'r1',
      table_id: 't7',
      call_type: 'bill',
      tip_amount: 5,
      status: 'pending',
      created_at: '2026-07-20T09:10:00Z',
      resolved_at: null,
      table: { name: '7' },
    },
  ]
  return [
    makeOrder({ id: 'R', status: 'ready', table_id: 't7', table: t7, created_at: '2026-07-20T09:00:00Z' }),
    makeOrder({ id: 'S', status: 'served', table_id: 't7', table: t7, created_at: '2026-07-20T09:05:00Z' }),
  ]
}

describe('pagina ospătarului în limba personalului', () => {
  it('LW8: control — fără provider, româna de dinainte', async () => {
    setup(busyRestaurant(), { truncated: true })
    const { container } = inLang(null, <WaiterPage />)
    expect(await screen.findByText('CERE NOTA', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ospătar' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Live conectat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Comandă nouă' })).toBeInTheDocument()
    expect(container).toHaveTextContent(
      'Mod Offline — Comenzile se salvează pe telefon și pleacă singure când revine conexiunea.',
    )
    expect(screen.getByText('2 comenzi în așteptare')).toBeInTheDocument()
    expect(container).toHaveTextContent(
      'Se afișează doar cele mai noi 500 comenzi deschise — finalizează sau anulează comenzile vechi ca lista să fie completă.',
    )
    expect(container).toHaveTextContent('Rezervări azi (1)')
    expect(screen.getByText('CONFIRMAT')).toBeInTheDocument()
    expect(container).toHaveTextContent('2 persoane · fără masă · +40722000000')
    expect(screen.getByText('Cere zona: Terrace')).toBeInTheDocument()
    expect(screen.getByText('„Window seat"')).toBeInTheDocument()
    expect(container).toHaveTextContent('CERE NOTA · bacșiș propus 5.00 lei')
    expect(screen.getByRole('button', { name: 'Preiau' })).toBeInTheDocument()
    expect(screen.getByText('Apeluri ospătar')).toBeInTheDocument()
    expect(screen.getByText('Toate comenzile deschise')).toBeInTheDocument()
    expect(screen.getByText('2 comenzi')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fidelizare — cod client' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Stadiu mese' })).toBeInTheDocument()
  })

  it('LW9: în engleză — fără text românesc al ecranului', async () => {
    setup(busyRestaurant(), { truncated: true })
    const { container } = inLang('en', <WaiterPage />)
    expect(await screen.findByText('BILL REQUESTED', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Waiter' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Live — connected' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New order' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sold-out items — mark what has run out' })).toBeInTheDocument()
    expect(screen.getByText('2 orders waiting')).toBeInTheDocument()
    expect(container).toHaveTextContent('Only the 500 most recent open orders are shown')
    expect(container).toHaveTextContent('Today’s reservations (1)')
    expect(screen.getByText('CONFIRMED')).toBeInTheDocument()
    expect(container).toHaveTextContent('2 guests · no table · +40722000000')
    expect(screen.getByText('Requested area: Terrace')).toBeInTheDocument()
    expect(screen.getByText('“Window seat”')).toBeInTheDocument()
    expect(container).toHaveTextContent('BILL REQUESTED · tip from guest 5.00 lei')
    expect(screen.getByRole('button', { name: 'On it' })).toBeInTheDocument()
    expect(screen.getByText('Waiter calls')).toBeInTheDocument()
    expect(screen.getByText('All open orders')).toBeInTheDocument()
    expect(screen.getByText('2 orders')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Table status' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Choose a table…' })).toBeInTheDocument()
    expect(romanianLeftovers(container.textContent ?? '', waiterEn)).toEqual([])
  })

  it('LW10: în germană — plata parțială și fidelizarea (rezultat compus la randare)', async () => {
    const user = userEvent.setup()
    setup([
      makeOrder({ id: 'S', status: 'served', table_id: 't7', table: makeTable({ id: 't7', name: '7' }), total: 30 }),
    ])
    h.useReservations.mockReturnValue({ reservations: [], updateStatus: vi.fn(), seat: vi.fn() })
    h.redeem
      .mockResolvedValueOnce({ ok: false, reason: 'not_enough_points', points: 3, threshold: 10 })
      .mockResolvedValueOnce({ ok: true, reward_description: 'Espresso', points_left: 2 })
    inLang('de', <WaiterPage />)

    await user.click(await screen.findByRole('button', { name: 'Teilzahlung' }))
    expect(await screen.findByText('Offen:')).toBeInTheDocument()
    expect(screen.getByText('Tisch: 7')).toBeInTheDocument()
    expect(screen.getAllByText('30.00 lei').length).toBeGreaterThan(0)
    for (const m of ['Bar', 'Karte', 'Gutscheine', 'Andere']) {
      expect(screen.getByRole('button', { name: m })).toBeInTheDocument()
    }
    expect(screen.getByText('Betrag (lei)')).toBeInTheDocument()
    // Plățile se încarcă (spinner pe buton) — eticheta apare după.
    expect(await screen.findByRole('button', { name: 'Zahlung hinzufügen' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Schließen' }))
    expect(screen.queryByText('Offen:')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Treueprogramm — Gastcode' }))
    const input = screen.getByRole('textbox', { name: 'Treuecode des Gastes' })
    expect(input).toHaveAttribute('placeholder', 'Z. B. A1B2C3')
    await user.type(input, 'abcd12')
    await user.click(screen.getByRole('button', { name: 'Einlösen' }))
    expect(await screen.findByText('Nicht genug Punkte: 3 von 10 benötigt.')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Einlösen' }))
    expect(await screen.findByText('Belohnung: Espresso. Verbleibende Punkte: 2.')).toBeInTheDocument()
  })

  it('LW11: în germană — refuzurile de business au textul lor, nu „erneut versuchen”', async () => {
    const user = userEvent.setup()
    setup([
      makeOrder({
        id: 'S',
        status: 'served',
        table_id: 't7',
        table: makeTable({ id: 't7', name: '7' }),
        total: 30,
        session_id: 'sess1',
      }),
    ])
    h.useReservations.mockReturnValue({ reservations: [], updateStatus: vi.fn(), seat: vi.fn() })
    const rejection = (hint: string) =>
      Object.assign(new Error('Mesaj românesc al serverului'), { hint, code: 'P0001' })
    h.closeSessionOrders
      .mockRejectedValueOnce(rejection('fiscal_plan_requires_payment'))
      .mockRejectedValueOnce(rejection('cancel_over_payments'))
    h.addPartialPayment.mockRejectedValueOnce({
      message: 'Nu ai dreptul să încasezi plăți pentru acest restaurant.',
      hint: 'insufficient_role',
      code: 'P0001',
    })
    // „Tisch abschließen” există DOAR pe Planurile 1/2 (închiderea nefiscală,
    // `canCloseNonFiscal`), iar „Teilzahlung” DOAR pe Planul 3 — deci două
    // randări: întâi pe growth, apoi pe pro.
    h.useFeatures.mockReturnValue({ features: featuresFor('growth'), loading: false, reload: vi.fn() })
    const growth = inLang('de', <WaiterPage />)

    const closeTable = async () =>
      user.click((await screen.findAllByRole('button', { name: 'Tisch abschließen' }))[0])
    await closeTable()
    await vi.waitFor(() =>
      expect(h.toast.error).toHaveBeenLastCalledWith(
        'Im Tarif mit Fiskalisierung wird jede Bestellung mit einer Zahlung (Fiskalbeleg) abgeschlossen, bevor der Tisch abgeschlossen wird.',
      ),
    )
    await closeTable()
    await vi.waitFor(() =>
      expect(h.toast.error).toHaveBeenLastCalledWith(
        'Am Tisch gibt es eine nicht servierte Bestellung mit erfassten Zahlungen: Zahlung stornieren oder Bestellung abschließen, bevor der Tisch abgeschlossen wird.',
      ),
    )

    growth.unmount()

    h.useFeatures.mockReturnValue({ features: featuresFor('pro'), loading: false, reload: vi.fn() })
    inLang('de', <WaiterPage />)
    await user.click(await screen.findByRole('button', { name: 'Teilzahlung' }))
    await user.type(await screen.findByPlaceholderText('0.00'), '10')
    await user.click(await screen.findByRole('button', { name: 'Zahlung hinzufügen' }))
    await vi.waitFor(() =>
      expect(h.toast.error).toHaveBeenLastCalledWith('Ihre Rolle erlaubt das Erfassen von Zahlungen nicht.'),
    )
    expect(h.toast.error).not.toHaveBeenCalledWith(expect.stringContaining('erneut versuchen'))
  })
})
