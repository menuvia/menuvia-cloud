// SplitBillModal — „Plată parțială” de pe ecranul ospătarului (lotul C2a).
// Transportul (`getOrderPayments` / `addPartialPayment`) și toast-urile sunt
// mock-uite; modalul real rulează neschimbat, în română (fără provider).
//
//   SPB1  registrul e TRISTATE: cât se citește → „Se citesc…” și „Adaugă
//         plata” dezactivat; citirea EȘUATĂ → alertă + „Reîncearcă” (butonul
//         rămâne dezactivat chiar cu o sumă tastată); reîncercarea reușită
//         arată plățile și „Rămas”. Mutația care pică: `.catch` care lasă
//         lista goală (= „Rămas = total”, ca și cum nu s-ar fi plătit nimic).
//   SPB2  „Restul: X lei” completează suma exactă; suma care acoperă restul
//         spune că comanda devine Plătită; `fully_paid` → toast de succes și
//         modalul se închide. Mutația care pică: `fully_paid` care închide
//         fără toast (închiderea tăcută de dinainte).
//   SPB3  virgula trece („12,5” → 12.5); „0”, „-5”, „abc” au motivul afișat și
//         butonul dezactivat (înainte: no-op tăcut). Control pozitiv: o sumă
//         validă activează butonul. Mutația care pică: `parseFloat(amount)`
//         (12,5 → 12) sau garda `> 0` scoasă.
//   SPB4  comparația e în CENȚI: total 100,10 − plată 50,05 = rest 50,05 (în
//         virgulă mobilă 50,0499…), iar „50,05” acoperă restul. Peste rest →
//         avertisment că serverul respinge, butonul rămâne activ (serverul e
//         gate-ul, ca la PayModal). Mutația care pică: comparația în lei
//         (`amt === total − sum`).
//   SPB5  cât plata e în zbor, un tap pe fundal NU închide modalul; după
//         răspuns, da (control pozitiv). Mutația care pică: `onClick={onClose}`
//         necondiționat pe fundal.
//   SPB6  o plată parțială reușită: toast cu suma, câmpul golit, registrul
//         re-citit; dacă RE-CITIREA pică, NU apare „Plata nu a fost
//         înregistrată” (plata A FOST înregistrată — o retrimitere ar fi
//         încasare dublă), ci alerta registrului. Mutația care pică: re-citirea
//         înapoi în același `try` cu plata.
//   SPB9  cât plata e în zbor, „Închide” e dezactivat și un tap nu închide;
//         după răspuns, închide (control pozitiv). Închiderea demonta modalul
//         (și `submittingRef`), iar unul redeschis înainte de răspuns putea
//         trimite aceeași plată a doua oară (recenzie CodeRabbit pe #392).
//         Mutația care pică: `disabled={submitting}` scos de pe „Închide”.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import type { OrderPaymentRow } from '../../lib/orders'

const h = vi.hoisted(() => ({
  getOrderPayments: vi.fn<(id: string) => Promise<OrderPaymentRow[]>>(),
  addPartialPayment: vi.fn<
    (
      id: string,
      amount: number,
      method: string,
    ) => Promise<{ ok: boolean; total_paid: number; remaining: number; fully_paid: boolean }>
  >(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('../../lib/orders', () => ({
  getOrderPayments: (id: string) => h.getOrderPayments(id),
  addPartialPayment: (id: string, amount: number, method: string) =>
    h.addPartialPayment(id, amount, method),
}))
vi.mock('../ui/useToast', () => ({ useToast: () => h.toast }))

import { SplitBillModal } from '../SplitBillModal'
import { makeOrder, makeTable } from './fixtures'

const pay = (id: string, amount: number, method = 'cash'): OrderPaymentRow => ({
  id,
  amount,
  method,
  created_at: '2026-07-20T09:00:00Z',
})

const addButton = () => screen.getByRole('button', { name: 'Adaugă plata' })
const amountInput = () => screen.getByRole('textbox', { name: 'Suma (lei)' })

function renderModal(total: number, onClose = vi.fn()) {
  const order = makeOrder({
    id: 'o1',
    status: 'served',
    total,
    table_id: 't7',
    table: makeTable({ id: 't7', name: '7' }),
  })
  render(<SplitBillModal order={order} onClose={onClose} />)
  return { onClose }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getOrderPayments.mockReset()
  h.addPartialPayment.mockReset()
})

describe('SplitBillModal — registrul de plăți e tristate', () => {
  it('SPB1: în curs → dezactivat; eșec → „Reîncearcă”, nu „Rămas = total”; reîncercare → plățile', async () => {
    const first = deferred<OrderPaymentRow[]>()
    h.getOrderPayments.mockReturnValueOnce(first.promise)
    renderModal(100)
    expect(screen.getByRole('status')).toHaveTextContent('Se citesc plățile înregistrate…')
    fireEvent.change(amountInput(), { target: { value: '20' } })
    expect(addButton()).toBeDisabled()

    await act(async () => {
      first.reject(new Error('network'))
    })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Nu am putut citi plățile deja înregistrate/)
    expect(screen.queryByText('Rămas:')).toBeNull()
    expect(addButton()).toBeDisabled()

    h.getOrderPayments.mockResolvedValueOnce([pay('p1', 40, 'card_pos')])
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    expect(await screen.findByText('Rămas:')).toBeInTheDocument()
    expect(screen.getByText('Plăți înregistrate:')).toBeInTheDocument()
    expect(screen.getByText('40.00 lei')).toBeInTheDocument()
    expect(screen.getAllByText('60.00 lei').length).toBeGreaterThan(0)
    expect(screen.queryByRole('alert')).toBeNull()
    // Control pozitiv: cu registrul cunoscut, suma tastată activează butonul.
    expect(addButton()).toBeEnabled()
    expect(h.getOrderPayments).toHaveBeenCalledTimes(2)
  })
})

describe('SplitBillModal — suma în cenți și achitarea restului', () => {
  it('SPB2: „Restul” completează suma; acoperirea restului → toast și închidere', async () => {
    h.getOrderPayments.mockResolvedValue([pay('p1', 40)])
    h.addPartialPayment.mockResolvedValue({ ok: true, total_paid: 100, remaining: 0, fully_paid: true })
    const { onClose } = renderModal(100)
    fireEvent.click(await screen.findByRole('button', { name: 'Restul: 60.00 lei' }))
    expect(amountInput()).toHaveValue('60.00')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Suma acoperă restul: comanda devine Plătită și se emite bonul fiscal.',
    )
    fireEvent.click(addButton())
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(h.addPartialPayment).toHaveBeenCalledWith('o1', 60, 'cash')
    expect(h.toast.success).toHaveBeenCalledWith(
      'Restul a fost achitat: comanda e acum Plătită și bonul fiscal se emite la casa de marcat.',
    )
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it('SPB3: virgula trece; „0”, „-5”, „abc” au motivul afișat și butonul dezactivat', async () => {
    h.getOrderPayments.mockResolvedValue([])
    h.addPartialPayment.mockResolvedValue({ ok: true, total_paid: 12.5, remaining: 87.5, fully_paid: false })
    renderModal(100)
    await screen.findByText('Rămas:')
    for (const bad of ['0', '-5', 'abc']) {
      fireEvent.change(amountInput(), { target: { value: bad } })
      expect(screen.getByRole('alert'), bad).toHaveTextContent('Suma nu e validă')
      expect(amountInput()).toHaveAttribute('aria-invalid', 'true')
      expect(addButton()).toBeDisabled()
    }
    fireEvent.change(amountInput(), { target: { value: '' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(addButton()).toBeDisabled()

    fireEvent.change(amountInput(), { target: { value: '12,5' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(addButton()).toBeEnabled()
    fireEvent.click(addButton())
    await waitFor(() => expect(h.addPartialPayment).toHaveBeenCalledTimes(1))
    expect(h.addPartialPayment).toHaveBeenCalledWith('o1', 12.5, 'cash')
  })

  it('SPB4: 100,10 − 50,05 = rest 50,05 exact (cenți); peste rest → avertisment, butonul activ', async () => {
    h.getOrderPayments.mockResolvedValue([pay('p1', 50.05)])
    renderModal(100.1)
    expect(await screen.findByRole('button', { name: 'Restul: 50.05 lei' })).toBeInTheDocument()
    fireEvent.change(amountInput(), { target: { value: '50,05' } })
    expect(screen.getByRole('status')).toHaveTextContent('Suma acoperă restul')

    fireEvent.change(amountInput(), { target: { value: '50,06' } })
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Suma depășește restul de plată (50.05 lei) — serverul va respinge plata.')
    expect(status).not.toHaveTextContent('acoperă')
    expect(addButton()).toBeEnabled()

    // Sub rest: nici avertisment, nici „acoperă”.
    fireEvent.change(amountInput(), { target: { value: '20' } })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('SPB5: fundalul nu închide modalul cât plata e în zbor', async () => {
    h.getOrderPayments.mockResolvedValue([])
    const inFlight = deferred<{ ok: boolean; total_paid: number; remaining: number; fully_paid: boolean }>()
    h.addPartialPayment.mockReturnValueOnce(inFlight.promise)
    const { onClose } = renderModal(100)
    await screen.findByText('Rămas:')
    fireEvent.change(amountInput(), { target: { value: '30' } })
    fireEvent.click(addButton())
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      inFlight.resolve({ ok: true, total_paid: 30, remaining: 70, fully_paid: false })
    })
    // Control pozitiv: după răspuns, fundalul închide.
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('SPB9: „Închide” e blocat cât plata e în zbor', async () => {
    h.getOrderPayments.mockResolvedValue([])
    const inFlight = deferred<{ ok: boolean; total_paid: number; remaining: number; fully_paid: boolean }>()
    h.addPartialPayment.mockReturnValueOnce(inFlight.promise)
    const { onClose } = renderModal(100)
    await screen.findByText('Rămas:')
    const closeButton = () => screen.getByRole('button', { name: 'Închide' })
    expect(closeButton()).toBeEnabled()
    fireEvent.change(amountInput(), { target: { value: '30' } })
    fireEvent.click(addButton())
    expect(closeButton()).toBeDisabled()
    fireEvent.click(closeButton())
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      inFlight.resolve({ ok: true, total_paid: 30, remaining: 70, fully_paid: false })
    })
    // Control pozitiv: după răspuns, „Închide” închide.
    expect(closeButton()).toBeEnabled()
    fireEvent.click(closeButton())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(h.addPartialPayment).toHaveBeenCalledTimes(1)
  })

  it('SPB6: plată parțială reușită + re-citire eșuată → fără „nu a fost înregistrată”', async () => {
    h.getOrderPayments.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('network'))
    h.addPartialPayment.mockResolvedValue({ ok: true, total_paid: 20, remaining: 80, fully_paid: false })
    const { onClose } = renderModal(100)
    await screen.findByText('Rămas:')
    fireEvent.change(amountInput(), { target: { value: '20' } })
    fireEvent.click(addButton())
    await waitFor(() =>
      expect(h.toast.success).toHaveBeenCalledWith('Plata de 20.00 lei a fost înregistrată.'),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nu am putut citi plățile/)
    expect(h.toast.error).not.toHaveBeenCalled()
    expect(amountInput()).toHaveValue('')
    expect(h.getOrderPayments).toHaveBeenCalledTimes(2)
    expect(onClose).not.toHaveBeenCalled()
  })
})
