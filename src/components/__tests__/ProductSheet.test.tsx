// Fișa produsului în cele trei moduri (ux-guest-2, audit oct 2026).
//
// Pe QR fără comenzi (Planul 1 sau comenzile oprite) fișa NU se deschidea
// deloc, deci alergenii și descrierea completă nu se vedeau nicăieri. Acum
// pagina o deschide pe orice plan, în modul 'view'.
//
//   VW1  'view': alergenii vizibili din prima, fără cantitate / mențiuni /
//        „Adaugă în coș"; singura acțiune e „Închide".
//   VW2  'list' („Lista mea"): „Adaugă în listă", fără mențiuni pentru
//        bucătărie (lista nu ajunge la bucătărie); onAdd fără notă.
//   VW3  'order' (implicit, control): „Adaugă în coș" + câmpul de mențiuni.
//   VW4  câmpul de mențiuni are 16px (sub 16 iOS face zoom la focus, ux-guest-5).
//   VW5  nota Happy Hour „la trimiterea comenzii" doar pe 'order'.
//
// Mutații care pică: prop-ul `mode` ignorat → VW1, VW2, VW5; `fontSize: 14`
// înapoi → VW4; `moreInfoOpen` pornit mereu pe false → VW1.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProductSheet from '../ProductSheet'
import { resolveTheme } from '../../lib/themes'
import type { CartItem } from '../../lib/orders'
import { makeProduct } from './fixtures'

const theme = resolveTheme(null)

function renderSheet(mode: 'order' | 'list' | 'view' | undefined, happyHourPct = 0) {
  const onAdd = vi.fn<(item: CartItem) => void>()
  const onClose = vi.fn()
  const product = makeProduct({
    name: 'Omletă',
    description: 'Trei ouă, ierburi',
    price: 20,
    allergens: ['oua'],
  })
  render(
    <ProductSheet
      product={product}
      accent="#C8963C"
      theme={theme}
      onAdd={onAdd}
      onClose={onClose}
      happyHourPct={happyHourPct}
      {...(mode ? { mode } : {})}
    />,
  )
  return { onAdd, onClose }
}

describe('ProductSheet — modurile order / list / view', () => {
  it('VW1 view: alergenii din prima, fără comandă; doar „Închide"', async () => {
    const user = userEvent.setup()
    const { onClose, onAdd } = renderSheet('view')

    // Alergenul e afișat fără să mai apeși „Mai multe info".
    expect(screen.getByText(/Ouă/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /adaugă în coș/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /crește cantitatea/i })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()

    // X-ul din colț + butonul din subsol — ambele „Închide".
    const closes = screen.getAllByRole('button', { name: 'Închide' })
    expect(closes).toHaveLength(2)
    await user.click(closes[1])
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('VW2 list: „Adaugă în listă", fără mențiuni pentru bucătărie', async () => {
    const user = userEvent.setup()
    const { onAdd, onClose } = renderSheet('list')

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /adaugă în coș/i })).toBeNull()

    await user.click(screen.getByRole('button', { name: /adaugă în listă/i }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0][0].notes).toBeNull()
    expect(onAdd.mock.calls[0][0].quantity).toBe(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('VW3 order (implicit, control): „Adaugă în coș" și câmpul de mențiuni', () => {
    renderSheet(undefined)
    expect(screen.getByRole('button', { name: /adaugă în coș/i })).toBeEnabled()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    // Pe 'order' alergenii rămân în secțiunea pliabilă (comportamentul istoric).
    expect(screen.queryByText(/Ouă/)).toBeNull()
  })

  it('VW4 câmpul de mențiuni are 16px (fără zoom pe iPhone)', () => {
    renderSheet('order')
    expect(screen.getByRole('textbox')).toHaveStyle({ fontSize: '16px' })
  })

  it('VW5 nota Happy Hour „la trimiterea comenzii" apare doar pe order', () => {
    renderSheet('list', 10)
    expect(screen.queryByText(/la trimiterea comenzii/i)).toBeNull()
    // Prețul redus rămâne afișat (paritate cu cardul).
    expect(screen.getByText(/-10% Happy Hour/)).toBeInTheDocument()
  })

  it('VW5b control: pe order nota Happy Hour apare', () => {
    renderSheet('order', 10)
    expect(screen.getByText(/la trimiterea comenzii/i)).toBeInTheDocument()
  })
})
