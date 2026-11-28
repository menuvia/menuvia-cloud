// Bucătăria, lotul C3a: „Anulează” pentru owner/manager, prin ACELAȘI dialog
// ca ospătarul (CancelOrderDialog, leneș). Fără migrație: `advance_order` nu
// se recreează, iar anularea peste bani încasați rămâne respinsă în DATE
// (mig 270) — clientul doar arată refuzul serverului.
// Prefixul KC (Kitchen, Cancel) — verificat cu grep, nefolosit înainte.
//   KC1  owner: „Anulează” pe comenzile încă nepregătite (new / confirmed /
//        preparing), NU pe cele gata (le ridică ospătarul). Mutația care
//        pică: butonul randat pe orice status (sau pe `ready`).
//   KC2  bucătarul NU are „Anulează” (`advance_order` îl respinge, iar un RPC
//        îngust pentru el e decizie de fondator); controlul pozitiv e KC1 pe
//        ACELAȘI set de comenzi. Mutația care pică: `onCancel` dat oricărui rol.
//   KC3  managerul: dialogul se deschide, plățile se cer pentru comanda
//        apăsată, iar confirmarea cheamă `advance` cu `throwOnError` și
//        motivul; la succes dialogul se închide. Mutația care pică: `advance`
//        fără `{ throwOnError: true }` (refuzul n-ar mai ajunge în dialog).
//   KC4  plățile NECUNOSCUTE (citirea a eșuat) nu blochează: serverul decide,
//        iar refuzul lui (`cancel_over_payments`, cu suma) apare ÎN dialog,
//        care rămâne deschis. Mutația care pică: mesaj generic în loc de
//        `describeCancelRejection`, sau dialogul închis la refuz.
//   KC5  bani încasați CUNOSCUȚI: anularea directă e blocată, iar „Stornează
//        plățile și anulează” (motiv obligatoriu) cheamă UN singur RPC,
//        `voidPaymentsAndCancel`; `advance` NU se cheamă. Mutația care pică:
//        `onVoidAndCancel` nelegat (butonul rămâne dezactivat).
//   KC6  storno respins → plățile se RECITESC pentru comanda din dialog, dar
//        un răspuns întârziat nu ajunge în dialogul deschis apoi pe ALTĂ
//        comandă (recenzia pe #395): banii vechii comenzi nu blochează
//        anularea directă a celei noi. Mutația care pică: recitirea de după
//        refuz fără garda de sesiune (`getOrderPayments(...).then(set…)` în
//        pagină, sau în useCancelPayments).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'

const h = vi.hoisted(() => ({
  useOrders: vi.fn(),
  useCtx: vi.fn(),
  usePush: vi.fn(),
  useAudio: vi.fn(),
  getOrderPayments: vi.fn(),
  voidPaymentsAndCancel: vi.fn(),
}))
vi.mock('../../contexts/RestaurantContext', () => ({ useRestaurantCtx: h.useCtx }))
vi.mock('../../hooks/useOrders', () => ({ useOrders: h.useOrders }))
vi.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: h.usePush }))
vi.mock('../../hooks/useAudioUnlock', () => ({ useAudioUnlock: h.useAudio }))
vi.mock('../../lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/utils')>()
  return { ...actual, playSound: vi.fn() }
})
vi.mock('../../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orders')>()
  return {
    ...actual,
    getOrderPayments: h.getOrderPayments,
    voidPaymentsAndCancel: h.voidPaymentsAndCancel,
  }
})

import KitchenPage from '../../pages/KitchenPage'
import type { Order, OrderPaymentRow, OrderStatus } from '../../lib/orders'
import { makeOrder, makeTable } from './fixtures'

const LAZY = { timeout: 5000 }

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
}
function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = () => undefined
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function board(): Order[] {
  return [
    makeOrder({ id: 'A', status: 'new', table: makeTable({ name: 'TA' }) }),
    makeOrder({ id: 'B', status: 'confirmed', table: makeTable({ name: 'TB' }) }),
    makeOrder({ id: 'C', status: 'preparing', table: makeTable({ name: 'TC' }) }),
    makeOrder({ id: 'D', status: 'ready', table: makeTable({ name: 'TD' }) }),
  ]
}

function setup(role: 'owner' | 'manager' | 'kitchen', advance = vi.fn().mockResolvedValue(true)) {
  const orders = board()
  h.useCtx.mockReturnValue({
    activeId: 'r1',
    activeName: 'Bistro',
    activeRole: role,
    memberships: [],
    setActive: vi.fn(),
    loading: false,
  })
  h.useOrders.mockReturnValue({
    orders,
    loading: false,
    error: null,
    snapshotFor: 'r1',
    truncated: false,
    connectionStatus: 'connected',
    advance,
    byStatus: (statuses: OrderStatus[]) => orders.filter((o) => statuses.includes(o.status)),
    pendingIds: new Set<string>(),
    actionErrors: {},
    dismissActionError: vi.fn(),
  })
  render(<KitchenPage />)
  return { advance }
}

/** Cardul mesei `name` (după numele mesei, primul text al cardului). */
function card(name: string): HTMLElement {
  const c = screen.getByText(name).closest('[data-testid="kitchen-card"]')
  if (!(c instanceof HTMLElement)) throw new Error(`card ${name} lipsă`)
  return c
}

beforeEach(() => {
  h.getOrderPayments.mockReset()
  h.voidPaymentsAndCancel.mockReset()
  h.usePush.mockReturnValue({
    supported: false,
    permission: 'unsupported',
    subscribed: false,
    loading: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  })
  h.useAudio.mockReturnValue({ locked: false, unlock: vi.fn() })
})

describe('Bucătăria — „Anulează” doar pentru owner/manager', () => {
  it('KC1 owner: pe new / confirmed / preparing, nu pe ready', () => {
    setup('owner')
    expect(screen.getAllByRole('button', { name: 'Anulează' })).toHaveLength(3)
    for (const t of ['TA', 'TB', 'TC']) {
      expect(within(card(t)).getByRole('button', { name: 'Anulează' })).toBeInTheDocument()
    }
    expect(within(card('TD')).queryByRole('button', { name: 'Anulează' })).toBeNull()
  })

  it('KC2 bucătarul nu are „Anulează” pe niciun card', () => {
    setup('kitchen')
    // Aceleași comenzi ca în KC1: pașii de lucru sunt la locul lor.
    expect(screen.getAllByRole('button', { name: 'Începe' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Anulează' })).toBeNull()
  })

  it('KC3 manager: dialogul cere plățile, confirmarea trece prin advance cu throwOnError', async () => {
    h.getOrderPayments.mockResolvedValue([])
    const { advance } = setup('manager')
    fireEvent.click(within(card('TA')).getByRole('button', { name: 'Anulează' }))
    const dialog = await screen.findByRole('dialog', { name: 'Anulează comanda' }, LAZY)
    expect(h.getOrderPayments).toHaveBeenCalledWith('A')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'lipsă ingredient' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anulează comanda' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(advance).toHaveBeenCalledTimes(1)
    expect(advance).toHaveBeenCalledWith(
      'A',
      'new',
      { status: 'cancelled', cancel_reason: 'lipsă ingredient' },
      { throwOnError: true },
    )
    expect(h.voidPaymentsAndCancel).not.toHaveBeenCalled()
  })

  it('KC4 plăți necunoscute → serverul decide; refuzul lui apare în dialog', async () => {
    h.getOrderPayments.mockRejectedValue(new Error('rețea'))
    const server = 'Comanda are 40.00 lei plăți încasate și nu poate fi anulată.'
    const advance = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error(server), { hint: 'cancel_over_payments' }))
    setup('owner', advance)
    fireEvent.click(within(card('TC')).getByRole('button', { name: 'Anulează' }))
    const dialog = await screen.findByRole('dialog', { name: 'Anulează comanda' }, LAZY)
    const submit = within(dialog).getByRole('button', { name: 'Anulează comanda' })
    // Necunoscut ≠ blocat: butonul de anulare directă e activ.
    await waitFor(() => expect(h.getOrderPayments).toHaveBeenCalledWith('C'))
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(server)
    expect(screen.getByRole('dialog', { name: 'Anulează comanda' })).toBeInTheDocument()
    expect(advance).toHaveBeenCalledWith(
      'C',
      'preparing',
      { status: 'cancelled', cancel_reason: undefined },
      { throwOnError: true },
    )
  })

  it('KC5 bani încasați: storno + anulare printr-un singur RPC, fără advance', async () => {
    h.getOrderPayments.mockResolvedValue([
      { id: 'p1', amount: 40, method: 'card_online', created_at: '2026-07-20T09:00:00Z' },
    ])
    h.voidPaymentsAndCancel.mockResolvedValue({ order_id: 'C', voided_count: 1, voided_amount: 40 })
    const { advance } = setup('owner')
    fireEvent.click(within(card('TC')).getByRole('button', { name: 'Anulează' }))
    const dialog = await screen.findByRole('dialog', { name: 'Anulează comanda' }, LAZY)
    const voidBtn = await within(dialog).findByRole('button', { name: 'Stornează plățile și anulează' })
    // Motivul e obligatoriu la storno: fără el butonul stă dezactivat.
    expect(voidBtn).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'bucătăria nu o poate face' },
    })
    expect(voidBtn).toBeEnabled()
    fireEvent.click(voidBtn)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.voidPaymentsAndCancel).toHaveBeenCalledWith('C', 'bucătăria nu o poate face')
    expect(advance).not.toHaveBeenCalled()
  })

  it('KC6 storno respins: recitirea întârziată nu ajunge în dialogul altei comenzi', async () => {
    const recovery = deferred<OrderPaymentRow[]>()
    const openA = deferred<OrderPaymentRow[]>()
    h.getOrderPayments
      .mockResolvedValueOnce([
        { id: 'p1', amount: 40, method: 'card_online', created_at: '2026-07-20T09:00:00Z' },
      ])
      .mockReturnValueOnce(recovery.promise)
      .mockReturnValueOnce(openA.promise)
    const refusal = 'Storno respins de server.'
    h.voidPaymentsAndCancel.mockRejectedValue(new Error(refusal))
    const { advance } = setup('owner')

    // Comanda C, cu bani încasați: storno-ul e respins, dialogul rămâne deschis.
    fireEvent.click(within(card('TC')).getByRole('button', { name: 'Anulează' }))
    const dialogC = await screen.findByRole('dialog', { name: 'Anulează comanda' }, LAZY)
    const voidBtn = await within(dialogC).findByRole('button', {
      name: 'Stornează plățile și anulează',
    })
    fireEvent.change(within(dialogC).getByRole('textbox'), { target: { value: 'returnați' } })
    fireEvent.click(voidBtn)
    expect(await within(dialogC).findByText(refusal)).toBeInTheDocument()
    // Recitirea de după refuz e pentru comanda din dialog — și rămâne în zbor.
    expect(h.getOrderPayments).toHaveBeenNthCalledWith(2, 'C')

    // Dialogul se închide și se deschide pe A, fără bani încasați.
    fireEvent.click(within(dialogC).getByRole('button', { name: 'Renunță' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(within(card('TA')).getByRole('button', { name: 'Anulează' }))
    const dialogA = await screen.findByRole('dialog', { name: 'Anulează comanda' }, LAZY)
    await waitFor(() => expect(h.getOrderPayments).toHaveBeenNthCalledWith(3, 'A'))
    await act(async () => {
      openA.resolve([])
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    // Abia acum sosește recitirea lui C (40 lei → 60 lei între timp).
    await act(async () => {
      recovery.resolve([
        { id: 'p1', amount: 40, method: 'card_online', created_at: '2026-07-20T09:00:00Z' },
        { id: 'p2', amount: 20, method: 'cash', created_at: '2026-07-20T09:05:00Z' },
      ])
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(
      within(dialogA).queryByRole('button', { name: 'Stornează plățile și anulează' }),
    ).toBeNull()
    expect(within(dialogA).queryByRole('alert')).toBeNull()
    expect(within(dialogA).getByRole('button', { name: 'Anulează comanda' })).toBeEnabled()
    expect(advance).not.toHaveBeenCalled()
  })
})
