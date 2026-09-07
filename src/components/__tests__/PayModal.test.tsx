// Teste pe PayModal (audit v3 RES-16): refuzul serverului (underpayment /
// overpayment / metodă / rol) trebuie să ajungă ÎN modal, cu textul lui, nu ca
// „Verifică și reîncearcă"; iar pre-flight-ul (informativ, NU blocant — serverul
// e gate-ul) previne exact typo-ul de sumă pe care plafoanele din mig 264 îl
// resping.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PayModal } from '../WaiterOrderCard'
import { makeOrder } from './fixtures'

function renderModal(onConfirm: (...args: unknown[]) => unknown, alreadyPaid = 0) {
  render(
    <PayModal
      order={makeOrder({ status: 'served', total: 100 })}
      alreadyPaid={alreadyPaid}
      onConfirm={onConfirm as never}
      onClose={() => {}}
    />,
  )
}

describe('PayModal — hint-urile serverului și pre-flight-ul de sumă', () => {
  it('refuzul serverului se afișează ÎN modal, cu textul lui; butonul se redeblochează', async () => {
    const onConfirm = vi
      .fn()
      .mockResolvedValue({ ok: false, message: 'Suma încasată (50 fără bacșiș) e sub restul de plată (100)' })
    renderModal(onConfirm)
    await userEvent.click(screen.getByRole('button', { name: /confirmă plata/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/50 fără bacșiș/)
    expect(screen.getByRole('button', { name: /confirmă plata/i })).toBeEnabled()
    // Contractul: suma înmânată (cu bacșiș), metoda, bacșișul.
    expect(onConfirm).toHaveBeenCalledWith('cash', 100, 0)
  })

  it('un rethrow din onConfirm NU devine unhandled rejection — ajunge în modal', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('Role waiter cannot mark orders paid'))
    renderModal(onConfirm)
    await userEvent.click(screen.getByRole('button', { name: /confirmă plata/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/waiter/)
  })

  it('pre-flight: sumă SUB rest → avertisment informativ, butonul rămâne activ', async () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: true })
    renderModal(onConfirm)
    const input = screen.getByRole('spinbutton')
    await userEvent.clear(input)
    await userEvent.type(input, '50')
    expect(screen.getByRole('status')).toHaveTextContent(/sub restul de plată/i)
    expect(screen.getByRole('status')).not.toHaveTextContent(/depășește/i)
    expect(screen.getByRole('button', { name: /confirmă plata/i })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /confirmă plata/i }))
    expect(onConfirm).toHaveBeenCalledWith('cash', 50, 0)
  })

  it('pre-flight: sumă PESTE rest → spune că serverul va respinge (NU promite bacșiș automat); informativ, suma pleacă așa; la sumă exactă nu apare nimic', async () => {
    // Fragment UNIC al ramurii over — `/bacșiș/i` se potrivea și pe „fără
    // bacșiș" din ramura under, deci testul trecea cu ramurile inversate.
    const onConfirm = vi.fn().mockResolvedValue({ ok: true })
    renderModal(onConfirm)
    const input = screen.getByRole('spinbutton')
    await userEvent.clear(input)
    await userEvent.type(input, '120')
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/depășește restul/i)
    expect(status).toHaveTextContent(/va respinge/i)
    expect(status).not.toHaveTextContent(/sub restul/i)
    expect(status).not.toHaveTextContent(/se înregistrează ca bacșiș/i)
    await userEvent.click(screen.getByRole('button', { name: /confirmă plata/i }))
    expect(onConfirm).toHaveBeenCalledWith('cash', 120, 0)
    await userEvent.clear(input)
    await userEvent.type(input, '100')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('pre-flight PESTE rest: „Trece … la bacșiș" mută diferența în bacșiș — suma înmânată rămâne, nota ajunge la rest', async () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: true })
    renderModal(onConfirm)
    const input = screen.getByRole('spinbutton')
    await userEvent.clear(input)
    await userEvent.type(input, '105')
    await userEvent.click(screen.getByRole('button', { name: /trece 5\.00 lei la bacșiș/i }))
    expect(screen.queryByRole('status')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /confirmă plata/i }))
    // Contractul: suma înmânată (cu bacșiș) = 105, bacșiș = 5 → nota = 100.
    expect(onConfirm).toHaveBeenCalledWith('cash', 105, 5)
  })

  it('sumă ne-validă (negativă) → preflight + butonul dezactivat; câmp gol → pleacă suma totală', async () => {
    // Înainte, `-5` trecea de preflight (cădea pe total) dar pleca la server
    // ca `-5` (truthy pentru `parseFloat(amount) || grandTotal`) → refuz fără
    // preaviz. Acum suma trimisă e EXACT cea evaluată de preflight.
    const onConfirm = vi.fn().mockResolvedValue({ ok: true })
    renderModal(onConfirm)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '-5' } })
    expect(screen.getByRole('status')).toHaveTextContent(/nu e un număr valid/i)
    expect(screen.getByRole('button', { name: /confirmă plata/i })).toBeDisabled()
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: /confirmă plata/i })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /confirmă plata/i }))
    expect(onConfirm).toHaveBeenCalledWith('cash', 100, 0)
  })

  it('succes → fără alertă (părintele demontează modalul)', async () => {
    renderModal(vi.fn().mockResolvedValue({ ok: true }))
    await userEvent.click(screen.getByRole('button', { name: /confirmă plata/i }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
