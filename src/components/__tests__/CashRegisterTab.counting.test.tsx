// CashRegisterTab — numărătoarea de la deschiderea și închiderea turei
// (lotul C2a). Cu câmpul GOL, `Number('')` dădea 0: „Închide tura” era activ,
// „Trimite Raport Z” bifat implicit, iar un tap închidea tura DEFINITIV
// (close_shift, mig 032, fără redeschidere) cu 0 lei numărați și Raport Z.
//
//   CSC1  câmp gol → „Închide tura” dezactivat, fără linia „Diferență”, iar un
//         click nu trimite nimic. Control pozitiv: o sumă tastată activează
//         butonul și arată diferența. Mutația care pică: validarea veche
//         (`Number(counted.replace(',', '.'))`, gol = 0 = valid).
//   CSC2  „12,5” pleacă la server ca 12.5 (virgula trece; fără Z și fără
//         diferență nu se cere confirmare). Mutația care pică: `parseFloat` /
//         `Number` fără înlocuirea virgulei, sau inputul înapoi pe `type=number`
//         (rolul textbox dispare).
//   CSC3  cu Raport Z bifat se cere confirmare cu suma numărată; refuzul nu
//         trimite nimic, acceptarea închide tura. Mutația care pică:
//         `confirmDialog` scos (tura se închide la primul tap, cu Z).
//   CSC4  fără Z: o diferență de peste 1 leu cere confirmare, una de exact 1 leu
//         nu. Mutația care pică: pragul ignorat (`closeShiftNeedsConfirm` doar pe Z).
//   CSC5  text ne-valid („12,5,3”) → motivul sub câmp + buton dezactivat.
//         Control pozitiv: corectat, butonul se activează.
//   CSC6  deschiderea turei: fondul golit → „Deschide tură” dezactivat; „250,5”
//         pleacă drept 250.5. Mutația care pică: `Number('')` = fond 0 acceptat.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import type { CurrentShift } from '../../lib/cashShifts'
import type { ConfirmOptions } from '../ui/confirm'

interface RpcCall {
  name: string
  args: Record<string, unknown>
}

const { calls, shifts, confirmMock } = vi.hoisted(() => ({
  calls: [] as RpcCall[],
  shifts: {} as Record<string, unknown>,
  confirmMock: vi.fn<(opts: ConfirmOptions) => Promise<boolean>>(),
}))

// Doar transportul e fals: wrapper-ele reale din lib/cashShifts rulează
// neschimbate peste el (ca în CashRegisterTab.restaurantSwitch).
vi.mock('../../lib/supabase', () => {
  function rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args })
    const rid = typeof args.p_restaurant_id === 'string' ? args.p_restaurant_id : null
    let data: unknown = []
    if (name === 'get_current_shift' && rid && shifts[rid]) data = [shifts[rid]]
    if (name === 'open_shift') data = 'new-shift'
    if (name === 'close_shift') {
      data = {
        shift_id: args.p_shift_id,
        expected_cash: 0,
        counted_cash: args.p_counted_cash,
        cash_diff: 0,
        z_sent: args.p_send_z,
        z_receipt_id: null,
        summary: null,
      }
    }
    return Promise.resolve({ data, error: null })
  }
  function chain(): Record<string, unknown> {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not', 'gte', 'order', 'limit']) b[m] = vi.fn(() => b)
    b.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected)
    return b
  }
  return { supabase: { rpc: vi.fn(rpc), from: vi.fn(() => chain()) } }
})
vi.mock('../../lib/analytics', () => ({ track: vi.fn() }))
vi.mock('../ui/confirm', () => ({ confirm: (opts: ConfirmOptions) => confirmMock(opts) }))

import CashRegisterTab from '../CashRegisterTab'

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

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const closeCalls = () => calls.filter((c) => c.name === 'close_shift')
const countedInput = () => screen.getByRole('textbox', { name: /Numerar numărat/ })
// În dialog: pe ecranul turei există și „Închide tură” (cel care îl deschide).
const closeShiftButton = () =>
  within(screen.getByRole('dialog', { name: 'Închidere tură' })).getByRole('button', { name: 'Închide tura' })

async function openCloseDialog(over: Partial<CurrentShift> = {}): Promise<void> {
  shifts.r1 = shift(over)
  render(<CashRegisterTab restaurantId="r1" />)
  fireEvent.click(await screen.findByRole('button', { name: /Închide tură/ }))
  expect(screen.getByRole('dialog', { name: 'Închidere tură' })).toBeInTheDocument()
}

function uncheckZ(): void {
  const z = screen.getByRole('checkbox')
  expect(z).toBeChecked()
  fireEvent.click(z)
  expect(z).not.toBeChecked()
}

beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(shifts)) delete shifts[k]
  confirmMock.mockReset()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CashRegisterTab — câmpul gol nu e 0 lei', () => {
  it('CSC1: câmp gol → „Închide tura” dezactivat, fără „Diferență”, nimic trimis', async () => {
    await openCloseDialog()
    expect(countedInput()).toHaveValue('')
    expect(closeShiftButton()).toBeDisabled()
    expect(screen.queryByText(/Diferență/)).toBeNull()
    fireEvent.click(closeShiftButton())
    await flush()
    expect(closeCalls()).toHaveLength(0)
    expect(confirmMock).not.toHaveBeenCalled()

    // Control pozitiv: suma tastată activează butonul și arată diferența.
    fireEvent.change(countedInput(), { target: { value: '100' } })
    expect(closeShiftButton()).toBeEnabled()
    expect(screen.getByText(/Diferență/)).toHaveTextContent('exact')
  })

  it('CSC2: „12,5” pleacă drept 12.5 (fără Z, fără diferență → fără confirmare)', async () => {
    await openCloseDialog({ cash_expected: 12.5 })
    uncheckZ()
    fireEvent.change(countedInput(), { target: { value: '12,5' } })
    fireEvent.click(closeShiftButton())
    await flush()
    expect(confirmMock).not.toHaveBeenCalled()
    expect(closeCalls()).toHaveLength(1)
    expect(closeCalls()[0].args).toMatchObject({ p_shift_id: 's1', p_counted_cash: 12.5, p_send_z: false })
  })

  it('CSC3: cu Raport Z → confirmare cu suma; refuz = nimic, acceptare = tura închisă', async () => {
    await openCloseDialog({ cash_expected: 150 })
    fireEvent.change(countedInput(), { target: { value: '150' } })

    confirmMock.mockResolvedValueOnce(false)
    fireEvent.click(closeShiftButton())
    await flush()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    const opts = confirmMock.mock.calls[0][0]
    expect(opts.title).toBe('Închizi tura cu 150,00 lei numărați?')
    expect(opts.description).toContain('Raportul Z se tipărește la casa de marcat și nu se poate anula.')
    // Ecranul e fiscal: dialogul rămâne în română (lib/fiscalScreens.ts).
    expect(opts.lang).toBe('ro')
    expect(closeCalls()).toHaveLength(0)

    confirmMock.mockResolvedValueOnce(true)
    fireEvent.click(closeShiftButton())
    await flush()
    expect(confirmMock).toHaveBeenCalledTimes(2)
    expect(closeCalls()).toHaveLength(1)
    expect(closeCalls()[0].args).toMatchObject({ p_counted_cash: 150, p_send_z: true })
    expect(await screen.findByRole('dialog', { name: '✓ Tură închisă' })).toBeInTheDocument()
  })

  it('CSC4: fără Z — peste 1 leu diferență cere confirmare, exact 1 leu nu', async () => {
    await openCloseDialog({ cash_expected: 100 })
    uncheckZ()
    fireEvent.change(countedInput(), { target: { value: '98,50' } })
    confirmMock.mockResolvedValueOnce(false)
    fireEvent.click(closeShiftButton())
    await flush()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(confirmMock.mock.calls[0][0].description).toContain('lipsă 1,50 lei')
    expect(closeCalls()).toHaveLength(0)

    fireEvent.change(countedInput(), { target: { value: '99' } })
    fireEvent.click(closeShiftButton())
    await flush()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(closeCalls()).toHaveLength(1)
    expect(closeCalls()[0].args).toMatchObject({ p_counted_cash: 99, p_send_z: false })
  })

  it('CSC5: text ne-valid → motivul sub câmp și butonul dezactivat', async () => {
    await openCloseDialog()
    fireEvent.change(countedInput(), { target: { value: '12,5,3' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/Sumă invalidă/)
    expect(countedInput()).toHaveAttribute('aria-invalid', 'true')
    expect(closeShiftButton()).toBeDisabled()
    expect(screen.queryByText(/Diferență/)).toBeNull()
    // Control pozitiv: corectat, motivul dispare și butonul se activează.
    fireEvent.change(countedInput(), { target: { value: '12,5' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(closeShiftButton()).toBeEnabled()
  })
})

describe('CashRegisterTab — deschiderea turei', () => {
  it('CSC6: fond golit → „Deschide tură” dezactivat; „250,5” pleacă drept 250.5', async () => {
    render(<CashRegisterTab restaurantId="r1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Deschide tură/ }))
    const dialog = screen.getByRole('dialog', { name: 'Deschidere tură' })
    const amount = screen.getByRole('textbox', { name: /Fond inițial/ })
    // În dialog: butonul de pe ecran care îl deschide are același nume.
    const submit = () => within(dialog).getByRole('button', { name: 'Deschide tură' })
    expect(dialog).toBeInTheDocument()
    // Control: fondul implicit e valid.
    expect(amount).toHaveValue('100')
    expect(submit()).toBeEnabled()

    fireEvent.change(amount, { target: { value: '' } })
    expect(submit()).toBeDisabled()
    fireEvent.click(submit())
    await flush()
    expect(calls.filter((c) => c.name === 'open_shift')).toHaveLength(0)

    fireEvent.change(amount, { target: { value: '250,5' } })
    expect(submit()).toBeEnabled()
    fireEvent.click(submit())
    await flush()
    const open = calls.filter((c) => c.name === 'open_shift')
    expect(open).toHaveLength(1)
    expect(open[0].args).toMatchObject({ p_restaurant_id: 'r1', p_initial_float: 250.5 })
  })
})
