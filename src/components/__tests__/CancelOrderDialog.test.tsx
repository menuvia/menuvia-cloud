// Teste pe dialogul de anulare (audit v3 RES-25, mig 270). Regulile păzite:
//  - cu bani deja încasați CUNOSCUȚI, butonul e dezactivat și suma e afișată;
//  - cu suma NECUNOSCUTĂ (null) butonul rămâne activ — serverul e gate-ul
//    (un fals „blocat" pe un blip de rețea ar opri anulări legitime);
//  - refuzul serverului se afișează CU TEXTUL LUI, nu ca eroare generică;
//  - pe o comandă servită eticheta spune că motivul e obligatoriu (mig 118).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CancelOrderDialog from '../CancelOrderDialog'
import { makeOrder } from './fixtures'
import { describeCancelRejection } from '../../lib/orders'

describe('CancelOrderDialog', () => {
  it('plăți încasate cunoscute → buton dezactivat + suma afișată', () => {
    const onConfirm = vi.fn()
    render(
      <CancelOrderDialog
        order={makeOrder({ status: 'served', total: 100 })}
        paidSoFar={60}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /anulează comanda/i })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/60\.00 lei/)
    expect(screen.getByRole('alert')).toHaveTextContent(/plăți încasate/i)
  })

  it('fără bani (0) → click cheamă onConfirm cu motivul trim-uit', async () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: true })
    render(
      <CancelOrderDialog
        order={makeOrder({ status: 'new' })}
        paidSoFar={0}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )
    await userEvent.type(screen.getByPlaceholderText(/clientul a anulat/i), '  produs lipsă  ')
    await userEvent.click(screen.getByRole('button', { name: /anulează comanda/i }))
    expect(onConfirm).toHaveBeenCalledWith('produs lipsă')
  })

  it('suma NECUNOSCUTĂ (null) → butonul rămâne activ, serverul decide', async () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: true })
    render(
      <CancelOrderDialog
        order={makeOrder({ status: 'preparing' })}
        paidSoFar={null}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )
    const btn = screen.getByRole('button', { name: /anulează comanda/i })
    expect(btn).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
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
        paidSoFar={null}
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
        paidSoFar={0}
        onConfirm={vi.fn()}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/motiv \(obligatoriu/i)).toBeInTheDocument()
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
    expect(describeCancelRejection(Object.assign(new Error('x'), { hint: 'order_terminal' }))).toMatch(
      /deja finalizată/i,
    )
    expect(describeCancelRejection(new Error('boom'))).toMatch(/verifică rolul tău/i)
    expect(describeCancelRejection(null)).toMatch(/verifică rolul tău/i)
  })
})
