// PayTableSheet — „Plătit” DOAR după confirmarea SERVERULUI (lotul E, mig 312).
//
// Rezultatul din browser al lui `stripe.confirmPayment` (aici: `succeeded`) doar
// PORNEȘTE confirmarea; „Plătit” îl spune `get_table_payment_public_status`
// (`fetchTablePaymentStatus`, mock-uit), adică DB-ul după decontare. Polling-ul
// e cel REAL (lib/tablePaymentConfirm), condus cu fake timers.
//
//   T1  cu serverul pe `processing`, „Plătit” NU apare și `onPaid` nu e chemat,
//       deși Stripe a zis `succeeded`; se vede „Confirmăm plata…”
//       Mutația care pică: `setPhase('paid'); onPaid()` imediat după
//       confirmPayment (comportamentul de dinainte de lotul E).
//   T2  când serverul trece pe `succeeded`, „Plătit” apare și `onPaid` e chemat
//       O DATĂ; interogarea poartă token-ul, sesiunea și id-ul plății; return_url
//       poartă plata/sesiunea/felul (reluarea după redirect)
//       Mutația care pică: ramura `succeeded` fără `onPaid` / cu alt id de plată.
//   T3  serverul nu confirmă până la termen → `pending_confirmation`: mesajul
//       „în curs de confirmare”, „Verifică din nou”, FĂRĂ „Plătit” și FĂRĂ
//       „plătesc la ospătar” (banii pot fi în drum); reverificarea reia
//       polling-ul și ajunge la „Plătit” când serverul confirmă
//       Mutația care pică: termenul scos (polling la nesfârșit) sau
//       `timeout` tratat ca plătit.
//   T4  `failed` persistent în DB → mesaj de eroare (după grația pentru un
//       retry de card pe același intent), fără „Plătit”; în grație nu se
//       declară eșecul
//       Mutația care pică: `failed` tratat ca ne-terminal (ajunge la
//       pending_confirmation) sau terminal imediat (grația scoasă).
//   T5  unmount-ul oprește polling-ul: nicio interogare după demontare
//       Mutația care pică: efectul de cleanup cu `stopPollRef` scos.
//   W2  reluarea din return_url (`resume`): nu se creează nicio plată nouă,
//       se interoghează serverul pe sesiunea/referința din URL → „Plătit”;
//       cu `redirectFailed` → eroare imediată, fără interogări
//       Mutația care pică: ramura `resume` scoasă din efectul de init.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { T } from '../../lib/publicMenuStrings'
import type { TablePaymentPublicStatus } from '../../lib/payments'

const mocks = vi.hoisted(() => ({
  status: [] as TablePaymentPublicStatus[],
  fetchStatus: vi.fn(),
  createTablePayment: vi.fn(),
  cancelTablePayment: vi.fn(),
  confirmPayment: vi.fn(),
}))

vi.mock('../../lib/payments', () => ({
  createTablePayment: mocks.createTablePayment,
  cancelTablePayment: mocks.cancelTablePayment,
  fetchTablePaymentStatus: mocks.fetchStatus,
  loadStripeJs: () =>
    Promise.resolve(() => ({
      elements: () => ({ create: () => ({ mount: vi.fn(), unmount: vi.fn() }) }),
      confirmPayment: mocks.confirmPayment,
    })),
}))

import PayTableSheet from '../PayTableSheet'

const PUB = {
  bg: '#ffffff',
  surface: '#f5f5f5',
  text: '#111111',
  text2: '#444444',
  text3: '#777777',
  border: '#dddddd',
  borderStrong: '#bbbbbb',
}
const TOKEN = 'tok_test'
const SESSION = '11111111-1111-4111-8111-111111111111'
const PAYMENT = '22222222-2222-4222-8222-222222222222'

const PAID = T('ro', 'pt_done')

/** Statusurile serverului, în ordine; ultimul se repetă. */
function serverSays(...seq: TablePaymentPublicStatus[]): void {
  mocks.status = seq
  mocks.fetchStatus.mockImplementation(() => {
    const s = mocks.status.length > 1 ? mocks.status.shift() : mocks.status[0]
    return Promise.resolve(s ?? 'unknown')
  })
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function renderSheet(extra: Partial<Parameters<typeof PayTableSheet>[0]> = {}) {
  const onPaid = vi.fn()
  const onPayOtherwise = vi.fn()
  const view = render(
    <PayTableSheet
      token={TOKEN}
      sessionId={SESSION}
      PUB={PUB}
      accent="#c0392b"
      onClose={() => {}}
      onPaid={onPaid}
      onPayOtherwise={onPayOtherwise}
      {...extra}
    />,
  )
  return { onPaid, onPayOtherwise, ...view }
}

/** Deschide sheet-ul, așteaptă formularul și apasă „Plătește” (Stripe: succeeded). */
async function payWithStripeSucceeded() {
  const r = renderSheet()
  await flush()
  fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + T('ro', 'pt_pay')) }))
  await flush()
  return r
}

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  mocks.fetchStatus.mockReset()
  mocks.createTablePayment.mockReset().mockResolvedValue({
    payment_id: PAYMENT,
    client_secret: 'pi_x_secret_y',
    publishable_key: 'pk_test',
    stripe_account_id: 'acct_x',
    amount: 50,
    currency: 'RON',
  })
  mocks.cancelTablePayment.mockReset().mockResolvedValue('canceled')
  mocks.confirmPayment.mockReset().mockResolvedValue({
    paymentIntent: { id: 'pi_x', status: 'succeeded' },
  })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('PayTableSheet — „Plătit” doar după server', () => {
  it('T1 Stripe a zis succeeded, serverul încă processing → fără „Plătit”', async () => {
    serverSays('processing')
    const { onPaid } = await payWithStripeSucceeded()
    expect(screen.getByText(T('ro', 'pt_confirming_server'))).toBeInTheDocument()
    await flush(20_000)
    expect(screen.queryByText(PAID)).toBeNull()
    expect(onPaid).not.toHaveBeenCalled()
    expect(mocks.fetchStatus.mock.calls.length).toBeGreaterThan(1)
  })

  it('T2 serverul confirmă → „Plătit” + onPaid o dată; return_url poartă plata', async () => {
    serverSays('processing', 'processing', 'succeeded')
    const { onPaid } = await payWithStripeSucceeded()
    await flush(10_000)
    expect(screen.getByText(PAID)).toBeInTheDocument()
    expect(onPaid).toHaveBeenCalledTimes(1)
    expect(mocks.fetchStatus).toHaveBeenCalledWith(TOKEN, SESSION, PAYMENT)
    const returnUrl = new URL(mocks.confirmPayment.mock.calls[0][0].confirmParams.return_url)
    expect(returnUrl.searchParams.get('tp')).toBe(PAYMENT)
    expect(returnUrl.searchParams.get('tps')).toBe(SESSION)
    expect(returnUrl.searchParams.get('tpk')).toBe('table')
    // Oprit după rezultat: nicio interogare în plus.
    const n = mocks.fetchStatus.mock.calls.length
    await flush(30_000)
    expect(mocks.fetchStatus.mock.calls.length).toBe(n)
  })

  it('T3 fără confirmare până la termen → pending_confirmation; „Verifică din nou” reia', async () => {
    serverSays('processing')
    const { onPaid } = await payWithStripeSucceeded()
    await flush(45_000)
    expect(screen.getByText(T('ro', 'pt_pending_title'))).toBeInTheDocument()
    expect(screen.queryByText(PAID)).toBeNull()
    expect(screen.queryByRole('button', { name: T('ro', 'pt_pay_waiter') })).toBeNull()
    expect(onPaid).not.toHaveBeenCalled()

    serverSays('succeeded')
    fireEvent.click(screen.getByRole('button', { name: T('ro', 'pt_recheck') }))
    await flush()
    expect(screen.getByText(PAID)).toBeInTheDocument()
    expect(onPaid).toHaveBeenCalledTimes(1)
  })

  it('T4 failed persistent → eroare, fără „Plătit”; în grație nu se declară eșecul', async () => {
    serverSays('failed')
    const { onPaid } = await payWithStripeSucceeded()
    await flush(3_000)
    expect(screen.queryByText(T('ro', 'pt_server_failed'))).toBeNull()
    expect(screen.getByText(T('ro', 'pt_confirming_server'))).toBeInTheDocument()
    await flush(15_000)
    expect(screen.getByRole('alert')).toHaveTextContent(T('ro', 'pt_server_failed'))
    expect(screen.queryByText(PAID)).toBeNull()
    expect(onPaid).not.toHaveBeenCalled()
  })

  it('T5 unmount oprește polling-ul', async () => {
    serverSays('processing')
    const { unmount, onPaid } = await payWithStripeSucceeded()
    await flush(2_000)
    const n = mocks.fetchStatus.mock.calls.length
    expect(n).toBeGreaterThan(0)
    unmount()
    await flush(60_000)
    expect(mocks.fetchStatus.mock.calls.length).toBe(n)
    expect(onPaid).not.toHaveBeenCalled()
  })
})

describe('PayTableSheet — reluarea după return_url', () => {
  it('W2 resume: fără plată nouă, serverul e întrebat pe referința din URL → „Plătit”', async () => {
    serverSays('processing', 'succeeded')
    const { onPaid } = renderSheet({
      resume: { paymentRef: PAYMENT, redirectFailed: false, split: false },
    })
    await flush()
    expect(screen.getByText(T('ro', 'pt_confirming_server'))).toBeInTheDocument()
    await flush(5_000)
    expect(screen.getByText(PAID)).toBeInTheDocument()
    expect(onPaid).toHaveBeenCalledTimes(1)
    expect(mocks.createTablePayment).not.toHaveBeenCalled()
    expect(mocks.fetchStatus).toHaveBeenCalledWith(TOKEN, SESSION, PAYMENT)
  })

  it('W2 resume cu redirect eșuat: eroare imediată, fără interogări, fără „Plătit”', async () => {
    serverSays('succeeded')
    const { onPaid } = renderSheet({
      resume: { paymentRef: PAYMENT, redirectFailed: true, split: false },
    })
    await flush(5_000)
    expect(screen.getByRole('alert')).toHaveTextContent(T('ro', 'pt_declined'))
    expect(mocks.fetchStatus).not.toHaveBeenCalled()
    expect(mocks.createTablePayment).not.toHaveBeenCalled()
    expect(onPaid).not.toHaveBeenCalled()
  })
})
