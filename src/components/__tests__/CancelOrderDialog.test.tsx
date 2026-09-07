// Teste pe dialogul de anulare (audit v3 RES-25, mig 270). Regulile păzite:
//  - cu bani deja încasați CUNOSCUȚI, anularea directă dispare; apare storno-ul,
//    care cere motiv și cheamă onVoidAndCancel (banii returnați → audit);
//  - cu lista NECUNOSCUTĂ (null) butonul de anulare rămâne activ — serverul e
//    gate-ul (un fals „blocat" pe un blip de rețea ar opri anulări legitime);
//  - refuzul serverului se afișează CU TEXTUL LUI, nu ca eroare generică;
//  - pe o comandă servită eticheta spune că motivul e obligatoriu (mig 118).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CancelOrderDialog from '../CancelOrderDialog'
import { makeOrder } from './fixtures'
import { describeCancelRejection } from '../../lib/orders'

const PAYMENTS = [
  { id: 'pay-1', amount: 60, method: 'cash', created_at: '2026-09-07T10:00:00Z' },
  { id: 'pay-2', amount: 15, method: 'card_online', created_at: '2026-09-07T10:05:00Z' },
]

describe('CancelOrderDialog', () => {
  it('plăți încasate cunoscute → fără anulare directă; storno cere motiv', async () => {
    const onConfirm = vi.fn()
    const onVoidAndCancel = vi.fn().mockResolvedValue({ ok: true })
    render(
      <CancelOrderDialog
        order={makeOrder({ status: 'served', total: 100 })}
        payments={PAYMENTS}
        onConfirm={onConfirm}
        onVoidAndCancel={onVoidAndCancel}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /^anulează comanda$/i })).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/75\.00 lei/)
    expect(screen.getByRole('alert')).toHaveTextContent(/card online/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/rambursează manual din stripe/i)
    const storno = screen.getByRole('button', { name: /stornează plățile și anulează/i })
    expect(storno).toBeDisabled()
    await userEvent.type(screen.getByPlaceholderText(/clientul a anulat/i), '  banii returnați  ')
    expect(storno).toBeEnabled()
    await userEvent.click(storno)
    expect(onVoidAndCancel).toHaveBeenCalledWith('banii returnați')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('fără bani ([]) → click cheamă onConfirm cu motivul trim-uit', async () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: true })
    render(
      <CancelOrderDialog
        order={makeOrder({ status: 'new' })}
        payments={[]}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )
    await userEvent.type(screen.getByPlaceholderText(/clientul a anulat/i), '  produs lipsă  ')
    await userEvent.click(screen.getByRole('button', { name: /anulează comanda/i }))
    expect(onConfirm).toHaveBeenCalledWith('produs lipsă')
  })

  it('lista NECUNOSCUTĂ (null) → anularea rămâne activă, serverul decide', async () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: true })
    render(
      <CancelOrderDialog
        order={makeOrder({ status: 'preparing' })}
        payments={null}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )
    const btn = screen.getByRole('button', { name: /anulează comanda/i })
    expect(btn).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: /stornează/i })).toBeNull()
    await userEvent.click(btn)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('refuzul serverului se afișează cu TEXTUL lui, nu generic', async () => {
    const onConfirm = vi
      .fn()
      .mockResolvedValue({ ok: false, message: 'Comanda are plăți înregistrate (40 lei)' })
    render(
      <CancelOrderDialog
        order={makeOrder({ status: 'preparing' })}
        payments={null}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /anulează comanda/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Comanda are plăți înregistrate (40 lei)')
    expect(screen.queryByText(/verifică rolul tău/i)).toBeNull()
    // Butonul se deblochează pentru o nouă încercare.
    expect(screen.getByRole('button', { name: /anulează comanda/i })).toBeEnabled()
  })

  it('comandă servită → eticheta spune că motivul e obligatoriu', () => {
    render(
      <CancelOrderDialog
        order={makeOrder({ status: 'served' })}
        payments={[]}
        onConfirm={vi.fn()}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/motiv \(obligatoriu — comanda a fost servită\)/i)).toBeInTheDocument()
  })
})

describe('describeCancelRejection', () => {
  it('mapează hint-urile serverului pe texte RO; păstrează mesajul cu suma pe cancel_over_payments', () => {
    const over = Object.assign(new Error('Comanda are plăți înregistrate (60 lei) și nu poate fi anulată'), {
      hint: 'cancel_over_payments',
    })
    expect(describeCancelRejection(over)).toMatch(/60 lei/)
    expect(describeCancelRejection(Object.assign(new Error('x'), { hint: 'cancel_reason_required' }))).toMatch(
      /motivul e obligatoriu/i,
    )
    expect(describeCancelRejection(Object.assign(new Error('x'), { hint: 'void_reason_required' }))).toMatch(
      /stornarea/i,
    )
    expect(describeCancelRejection(Object.assign(new Error('x'), { hint: 'role_insufficient' }))).toMatch(
      /owner\/manager/i,
    )
    expect(describeCancelRejection(Object.assign(new Error('x'), { hint: 'order_terminal' }))).toMatch(
      /deja finalizată/i,
    )
    // Hint necunoscut → mesajul serverului primează; fără mesaj → textul generic.
    expect(describeCancelRejection(new Error('boom'))).toBe('boom')
    expect(describeCancelRejection(new Error(''))).toMatch(/verifică rolul tău/i)
    expect(describeCancelRejection(null)).toMatch(/verifică rolul tău/i)
  })
})
