// useCancelPayments — plățile din dialogul de anulare sunt legate de SESIUNEA
// dialogului (o deschidere pentru o comandă), pe Ospătar și pe Bucătărie.
// Recenzia pe #395: recitirea de după un storno eșuat nu avea garda pe care o
// avea citirea de la deschidere — un răspuns întârziat pentru comanda închisă
// ajungea în dialogul deschis apoi pe ALTĂ comandă (banii ei blocau anularea
// directă sau impuneau storno-ul).
// Prefixul CPR (Cancel Payments Read) — verificat cu grep, nefolosit înainte.
//   CPR1  recitirea pornită pe A, terminată după ce dialogul s-a mutat pe B, NU
//         scrie peste plățile lui B. Mutația care pică: `reload` cu
//         `.then(setPayments)` fără garda de sesiune (codul de dinainte).
//   CPR2  la fel pe EȘEC: recitirea lui A care pică nu golește plățile lui B
//         (nu le face „necunoscute”). Mutația care pică: `.catch(() =>
//         setPayments(null))` fără gardă.
//   CPR3  control pozitiv: în ACEEAȘI sesiune recitirea se aplică. Mutația care
//         pică: `reload` care aruncă orice rezultat (gardă inversată / no-op).
//   CPR4  pe dialog închis `reload` nu citește nimic. Mutația care pică:
//         `reload` care citește cu id-ul ultimei comenzi, oricare ar fi sesiunea.
//   CPR5  citirea de la DESCHIDERE pe A, terminată după înlocuirea cu B, nu
//         scrie peste B (garda mutată din pagini în hook). Mutația care pică:
//         efectul fără garda de sesiune.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { OrderPaymentRow } from '../../lib/orders'

const h = vi.hoisted(() => ({
  getOrderPayments: vi.fn<(id: string) => Promise<OrderPaymentRow[]>>(),
}))
vi.mock('../../lib/orders', () => ({
  getOrderPayments: (id: string) => h.getOrderPayments(id),
}))

import { useCancelPayments } from '../useCancelPayments'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = () => undefined
  let reject: (e: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function pay(id: string, amount: number): OrderPaymentRow {
  return { id, amount, method: 'cash', created_at: '2026-11-20T10:00:00Z' }
}

/** Rulează `action` sub act și lasă lanțurile de promisiuni să se încheie (un macrotask). */
async function settle(action: () => void): Promise<void> {
  await act(async () => {
    action()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

type Props = { order: { id: string } | null }
const A = { id: 'A' }
const B = { id: 'B' }

function mount(order: { id: string } | null) {
  return renderHook(({ order: o }: Props) => useCancelPayments(o), {
    initialProps: { order } as Props,
  })
}

beforeEach(() => {
  h.getOrderPayments.mockReset()
})

describe('useCancelPayments — rezultatele rămân în sesiunea lor', () => {
  it('CPR1 recitirea lui A, terminată după mutarea pe B, nu scrie peste B', async () => {
    const late = deferred<OrderPaymentRow[]>()
    h.getOrderPayments
      .mockResolvedValueOnce([]) // deschiderea pe A
      .mockReturnValueOnce(late.promise) // recitirea după storno eșuat, pe A
      .mockResolvedValueOnce([pay('pB', 40)]) // deschiderea pe B
    const { result, rerender } = mount(A)
    await waitFor(() => expect(result.current.payments).toEqual([]))
    act(() => {
      result.current.reload()
    })
    expect(h.getOrderPayments).toHaveBeenLastCalledWith('A')
    rerender({ order: null })
    rerender({ order: B })
    await waitFor(() => expect(result.current.payments).toEqual([pay('pB', 40)]))
    await settle(() => late.resolve([pay('pA', 60)]))
    expect(result.current.payments).toEqual([pay('pB', 40)])
  })

  it('CPR2 recitirea lui A care pică nu face „necunoscute” plățile lui B', async () => {
    const late = deferred<OrderPaymentRow[]>()
    h.getOrderPayments
      .mockResolvedValueOnce([pay('pA', 60)])
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce([pay('pB', 40)])
    const { result, rerender } = mount(A)
    await waitFor(() => expect(result.current.payments).toEqual([pay('pA', 60)]))
    act(() => {
      result.current.reload()
    })
    rerender({ order: null })
    rerender({ order: B })
    await waitFor(() => expect(result.current.payments).toEqual([pay('pB', 40)]))
    await settle(() => late.reject(new Error('rețea')))
    expect(result.current.payments).toEqual([pay('pB', 40)])
  })

  it('CPR3 în aceeași sesiune recitirea se aplică', async () => {
    h.getOrderPayments.mockResolvedValueOnce([]).mockResolvedValueOnce([pay('pA', 60)])
    const { result } = mount(A)
    await waitFor(() => expect(result.current.payments).toEqual([]))
    act(() => {
      result.current.reload()
    })
    await waitFor(() => expect(result.current.payments).toEqual([pay('pA', 60)]))
    expect(h.getOrderPayments).toHaveBeenCalledTimes(2)
    expect(h.getOrderPayments).toHaveBeenNthCalledWith(2, 'A')
  })

  it('CPR4 pe dialog închis recitirea nu citește nimic', async () => {
    h.getOrderPayments.mockResolvedValue([pay('pA', 60)])
    const { result, rerender } = mount(A)
    await waitFor(() => expect(result.current.payments).toEqual([pay('pA', 60)]))
    rerender({ order: null })
    expect(result.current.payments).toBeNull()
    await settle(() => result.current.reload())
    expect(h.getOrderPayments).toHaveBeenCalledTimes(1)
    expect(result.current.payments).toBeNull()
  })

  it('CPR5 citirea de la deschiderea pe A, sosită după B, nu scrie peste B', async () => {
    const slowA = deferred<OrderPaymentRow[]>()
    h.getOrderPayments.mockReturnValueOnce(slowA.promise).mockResolvedValueOnce([pay('pB', 40)])
    const { result, rerender } = mount(A)
    rerender({ order: B })
    await waitFor(() => expect(result.current.payments).toEqual([pay('pB', 40)]))
    await settle(() => slowA.resolve([pay('pA', 60)]))
    expect(result.current.payments).toEqual([pay('pB', 40)])
    expect(h.getOrderPayments).toHaveBeenCalledTimes(2)
    expect(h.getOrderPayments).toHaveBeenNthCalledWith(1, 'A')
    expect(h.getOrderPayments).toHaveBeenNthCalledWith(2, 'B')
  })
})
