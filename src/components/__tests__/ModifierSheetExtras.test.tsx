// Ospătarul poate adăuga extra-urile plătite (lotul O2b, audit nov 2026
// STAFF-OPT-8) și nu mai poate trimite peste plafoanele serverului (STAFF-OPT-9).
//
//   MX1  cu `allowExtras`, extra-urile disponibile apar; cel indisponibil nu.
//        Prețul din CTA include extra-ul, iar onAdd trimite `selected_extras`
//        (createOrder îl transformă în extra_ids). [PICĂ: secțiunea Extra
//        scoasă / extra-ul neadăugat în payload — „burger cu bacon" ajungea doar
//        ca notă, gătit dar neîncasat]
//   MX2  fără `allowExtras` (editarea comenzii, până la lotul O3) nu apare
//        nimic: acolo extra-urile nu ar ajunge la server, deci un preț afișat cu
//        extra ar minți. Control pentru MX1.
//   MX3  cantitatea se oprește la 20 (create_order respinge peste), iar nota
//        liniei are maxLength 300.
//   MX4  hint-ul `invalid_extras` (mig 317) → mesaj clar, nu cel generic.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModifierSheet from '../ModifierSheet'
import type { CartItem } from '../../lib/orders'
import { MAX_LINE_QTY, MAX_ITEM_NOTE } from '../../lib/orders'
import { describeGuestError } from '../../lib/guestErrors'
import { T } from '../../lib/publicMenuStrings'
import { makeProduct } from './fixtures'

const extras = [
  { id: 'e1', name: 'Bacon', price: 5, emoji: null, display_order: 0, is_available: true },
  { id: 'e2', name: 'Ou', price: 3, emoji: null, display_order: 1, is_available: false },
]

describe('ModifierSheet — extra-urile ospătarului', () => {
  it('MX1 extra disponibil: apare, intră în preț și în payload', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn<(item: CartItem) => void>()
    render(
      <ModifierSheet
        product={makeProduct({ name: 'Burger', price: 25, extras })}
        onAdd={onAdd}
        onClose={vi.fn()}
        allowExtras
      />,
    )
    expect(screen.queryByRole('button', { name: /Ou/ })).toBeNull()
    const bacon = screen.getByRole('button', { name: /Bacon/ })
    await user.click(bacon)
    expect(bacon).toHaveAttribute('aria-pressed', 'true')
    const add = screen.getByRole('button', { name: /adaugă în comandă/i })
    expect(add).toHaveTextContent('30.00 lei')
    await user.click(add)
    expect(onAdd.mock.calls[0][0].selected_extras).toEqual([{ id: 'e1', name: 'Bacon', price: 5 }])
  })

  it('MX2 fără allowExtras: nicio secțiune Extra, nimic în payload', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn<(item: CartItem) => void>()
    render(<ModifierSheet product={makeProduct({ price: 25, extras })} onAdd={onAdd} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Bacon/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: /adaugă în comandă/i }))
    expect(onAdd.mock.calls[0][0].selected_extras).toBeUndefined()
  })

  it('MX3 cantitatea se oprește la 20, nota la 300 de caractere', async () => {
    const user = userEvent.setup()
    render(<ModifierSheet product={makeProduct({ price: 1 })} onAdd={vi.fn()} onClose={vi.fn()} />)
    const plus = screen.getByRole('button', { name: '+' })
    for (let i = 0; i < MAX_LINE_QTY + 3; i++) await user.click(plus)
    expect(screen.getByRole('button', { name: /adaugă în comandă/i })).toHaveTextContent(
      `${MAX_LINE_QTY.toFixed(2)} lei`,
    )
    expect(plus).toBeDisabled()
    expect(screen.getByPlaceholderText('Mențiuni (opțional)')).toHaveAttribute(
      'maxLength',
      String(MAX_ITEM_NOTE),
    )
  })

  it('MX4 hint-ul invalid_extras are mesajul lui', () => {
    const err = Object.assign(new Error('Extra indisponibil pentru produsul "Burger"'), {
      hint: 'invalid_extras',
    })
    expect(describeGuestError('ro', err)).toBe(T('ro', 'err_invalid_extras'))
    expect(describeGuestError('en', err)).toBe(T('en', 'err_invalid_extras'))
    // Fără hint (server mai vechi): tiparul mesajului.
    expect(describeGuestError('ro', new Error('Extra indisponibil pentru produsul "X"'))).toBe(
      T('ro', 'err_invalid_extras'),
    )
  })
})
