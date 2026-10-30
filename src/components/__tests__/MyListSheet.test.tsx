// „Lista mea" (/m/:slug fără ridicare) nu se mai golește din reflex (ux-guest-3).
//
// Înainte foaia era inline în PublicMenuPage, cu UN SINGUR buton: „Golește
// lista" (cu produse) / „Închide" (goală). Reflexul „închid foaia" ștergea tot;
// foaia n-avea X, Escape, role="dialog" sau capcană de focus.
//
//   ML1  „Închide" (acțiunea principală) doar închide — lista rămâne.
//   ML2  X-ul și Escape închid, fără să golească.
//   ML3  „Golește lista" cere a doua atingere („Da, golește lista").
//   ML4  dialog modal real, cu nume; listă goală → fără butonul de golire.
//   ML5  capcana de focus: Tab de pe ultimul element revine la primul.
//
// Mutații care pică: butonul principal care cheamă onClear (comportamentul
// vechi) → ML1; golire la primul tap → ML3; fără listener de Escape → ML2;
// fără <FocusTrap /> → ML5; fără role/aria-modal → ML4.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MyListSheet from '../MyListSheet'
import type { CartItem } from '../../lib/orders'
import { makeCartItem } from './fixtures'

const PUB = {
  bg: '#FFFFFF',
  surface: '#F7F7F7',
  text: '#1A1A1A',
  text2: '#444444',
  text3: '#666666',
  border: '#DDDDDD',
  borderStrong: '#BBBBBB',
}

function renderList(items: CartItem[]) {
  const onClose = vi.fn()
  const onClear = vi.fn()
  const onRemove = vi.fn()
  render(
    <MyListSheet
      items={items}
      total={items.reduce((s, i) => s + i.unit_price_snapshot * i.quantity, 0)}
      currency="RON"
      lang="ro"
      accent="#C8963C"
      PUB={PUB}
      fonts={{ heading: 'serif', body: 'sans-serif' }}
      titleStyle={{}}
      errorColor="#B3261E"
      onRemove={onRemove}
      onClear={onClear}
      onClose={onClose}
    />,
  )
  return { onClose, onClear, onRemove }
}

const TWO = () => [
  makeCartItem({ product_name_snapshot: 'Espresso', unit_price_snapshot: 9 }),
  makeCartItem({ product_name_snapshot: 'Tiramisu', unit_price_snapshot: 22 }),
]

// Butonul din subsol (al doilea „Închide"; primul e X-ul din colț).
const footerClose = () => screen.getAllByRole('button', { name: 'Închide' })[1]

describe('MyListSheet', () => {
  it('ML1 „Închide" doar închide — lista NU se golește', async () => {
    const user = userEvent.setup()
    const { onClose, onClear } = renderList(TWO())
    await user.click(footerClose())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClear).not.toHaveBeenCalled()
  })

  it('ML2 X-ul și Escape închid, fără golire', async () => {
    const user = userEvent.setup()
    const { onClose, onClear } = renderList(TWO())
    await user.click(screen.getAllByRole('button', { name: 'Închide' })[0])
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onClear).not.toHaveBeenCalled()
  })

  it('ML3 „Golește lista" cere a doua atingere', async () => {
    const user = userEvent.setup()
    const { onClear } = renderList(TWO())
    await user.click(screen.getByRole('button', { name: 'Golește lista' }))
    expect(onClear).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Da, golește lista' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('ML4 dialog modal cu nume; lista goală n-are buton de golire', () => {
    renderList([])
    const dialog = screen.getByRole('dialog', { name: 'Lista mea' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText(/lista e goală/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /golește/i })).toBeNull()
  })

  it('ML5 Tab de pe ultimul element revine la primul (capcana de focus)', () => {
    renderList(TWO())
    const clear = screen.getByRole('button', { name: 'Golește lista' })
    const x = screen.getAllByRole('button', { name: 'Închide' })[0]
    clear.focus()
    expect(document.activeElement).toBe(clear)
    fireEvent.keyDown(clear, { key: 'Tab' })
    expect(document.activeElement).toBe(x)
  })
})
