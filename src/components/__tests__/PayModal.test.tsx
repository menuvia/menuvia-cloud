// Teste pe PayModal (audit v3 RES-16): refuzul serverului (underpayment /
// overpayment / metodă / rol) trebuie să ajungă ÎN modal, cu textul lui, nu ca
// „Verifică și reîncearcă"; iar pre-flight-ul (informativ, NU blocant — serverul
// e gate-ul) previne exact typo-ul de sumă pe care plafoanele din mig 264 îl
// resping.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    expect(screen.getByRole('button', { name: /confirmă plata/i })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /confirmă plata/i }))
    expect(onConfirm).toHaveBeenCalledWith('cash', 50, 0)
  })

  it('pre-flight: sumă PESTE rest → menționează bacșișul; la sumă exactă nu apare nimic', async () => {
    renderModal(vi.fn().mockResolvedValue({ ok: true }))
    const input = screen.getByRole('spinbutton')
    await userEvent.clear(input)
    await userEvent.type(input, '120')
    expect(screen.getByRole('status')).toHaveTextContent(/bacșiș/i)
    await userEvent.clear(input)
    await userEvent.type(input, '100')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('succes → fără alertă (părintele demontează modalul)', async () => {
    renderModal(vi.fn().mockResolvedValue({ ok: true }))
    await userEvent.click(screen.getByRole('button', { name: /confirmă plata/i }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
