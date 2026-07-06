// Teste pe QrCartSheet — coșul QR „Masa ta" (flux de bani):
//   - CTA-ul poartă totalul; blocat pe coș gol / în timpul trimiterii
//   - stepper-ele și eliminarea emit exact delta/cheia corecte
//   - recomandările la checkout: respectă enabled/max, exclud produsele din
//     coș + sold-out/draft; quick-add interzis pe produse cu grup obligatoriu
//     (paritate mig 191 — se deschide ProductSheet în loc)
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import QrCartSheet, { type QrCartSheetProps } from '../QrCartSheet'
import { lineTotal } from '../../lib/orders'
import type { CartItem } from '../../lib/orders'
import { makeCartItem, makeCategory, makeProduct, makeGroup, makeOption } from './fixtures'

const PUB = {
  bg: '#fff',
  surface: '#f5f5f5',
  text: '#111',
  text2: '#444',
  text3: '#777',
  border: '#ddd',
  borderStrong: '#bbb',
}

function renderSheet(overrides: Partial<QrCartSheetProps> = {}) {
  const cart = overrides.cart ?? [makeCartItem({ product_name_snapshot: 'Cafea', unit_price_snapshot: 10 })]
  const props: QrCartSheetProps = {
    cart,
    cartTotal: cart.reduce((s, i) => s + lineTotal(i), 0),
    notes: '',
    submitting: false,
    submitError: null,
    categories: [],
    checkoutSuggestionSettings: null,
    PUB,
    accent: '#C8963C',
    accentGradient: 'linear-gradient(#C8963C,#C8963C)',
    onClose: vi.fn(),
    onNotesChange: vi.fn(),
    onUpdateQty: vi.fn(),
    onRemove: vi.fn(),
    onLineTotal: lineTotal,
    onSubmit: vi.fn(),
    onOpenProduct: vi.fn(),
    onAddToCart: vi.fn(),
    ...overrides,
  }
  render(<QrCartSheet {...props} />)
  return props
}

describe('QrCartSheet — coșul QR (bani + gating)', () => {
  it('CTA-ul afișează totalul și e activ cu produse în coș', () => {
    renderSheet({
      cart: [
        makeCartItem({ unit_price_snapshot: 10, quantity: 2 }),
        makeCartItem({
          unit_price_snapshot: 5,
          selected_modifiers: [
            { group_id: 'g', group_name: 'X', option_id: 'o', option_name: 'Y', price_delta: 1.5 },
          ],
        }),
      ],
      cartTotal: 26.5,
    })
    const cta = screen.getByRole('button', { name: /trimite comanda · 26\.50 lei/i })
    expect(cta).toBeEnabled()
  })

  it('în timpul trimiterii CTA-ul e blocat (anti dublu-tap = anti comandă dublă)', () => {
    const props = renderSheet({ submitting: true })
    const cta = screen.getByRole('button', { name: /se trimite/i })
    expect(cta).toBeDisabled()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('stepper-ele emit delta corect pe cheia liniei; eliminarea emite cheia', async () => {
    const user = userEvent.setup()
    const item = makeCartItem({ _key: 'linia-1', product_name_snapshot: 'Cafea' })
    const props = renderSheet({ cart: [item] })

    await user.click(screen.getByRole('button', { name: 'Crește cantitatea' }))
    expect(props.onUpdateQty).toHaveBeenCalledWith('linia-1', 1)
    await user.click(screen.getByRole('button', { name: 'Scade cantitatea' }))
    expect(props.onUpdateQty).toHaveBeenCalledWith('linia-1', -1)
    await user.click(screen.getByRole('button', { name: 'Elimină Cafea' }))
    expect(props.onRemove).toHaveBeenCalledWith('linia-1')
  })

  it('recomandările lipsesc când setarea e dezactivată', () => {
    const other = makeProduct({ id: 'sug-1', name: 'Limonadă' })
    renderSheet({
      categories: [makeCategory({ id: 'c2', products: [other] })],
      checkoutSuggestionSettings: { enabled: false },
    })
    expect(screen.queryByRole('button', { name: 'Adaugă Limonadă' })).not.toBeInTheDocument()
  })

  it('recomandările exclud produsele din coș + sold-out/draft și respectă max_suggestions', () => {
    const inCart = makeProduct({ id: 'p-cart', name: 'Cafea', category_id: 'c1' })
    const soldOut = makeProduct({ id: 'p-so', name: 'Fresh', is_sold_out: true, category_id: 'c2' })
    const draft = makeProduct({ id: 'p-dr', name: 'Smoothie', is_draft: true, category_id: 'c2' })
    const ok1 = makeProduct({ id: 'p-ok1', name: 'Limonadă', category_id: 'c2' })
    const ok2 = makeProduct({ id: 'p-ok2', name: 'Ceai', category_id: 'c2' })
    const ok3 = makeProduct({ id: 'p-ok3', name: 'Apă plată', category_id: 'c2' })

    renderSheet({
      cart: [makeCartItem({ product_id: 'p-cart' })],
      categories: [
        makeCategory({ id: 'c1', products: [inCart] }),
        makeCategory({ id: 'c2', products: [soldOut, draft, ok1, ok2, ok3] }),
      ],
      checkoutSuggestionSettings: { enabled: true, max_suggestions: 2 },
    })

    // Doar primele 2 candidate valide; sold-out/draft/în-coș nu apar.
    expect(screen.getByRole('button', { name: 'Adaugă Limonadă' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adaugă Ceai' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Adaugă Apă plată' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Adaugă Fresh' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Adaugă Smoothie' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Adaugă Cafea' })).not.toBeInTheDocument()
  })

  it('quick-add pe recomandare simplă intră în coș cu upsell_source + preț de catalog', async () => {
    const user = userEvent.setup()
    const sugg = makeProduct({ id: 'p-sug', name: 'Limonadă', price: 12, category_id: 'c2' })
    const props = renderSheet({
      cart: [makeCartItem({ product_id: 'p-alt' })],
      categories: [makeCategory({ id: 'c2', products: [sugg] })],
      checkoutSuggestionSettings: { enabled: true },
    })

    await user.click(screen.getByRole('button', { name: 'Adaugă Limonadă' }))
    expect(props.onAddToCart).toHaveBeenCalledTimes(1)
    const item = (props.onAddToCart as ReturnType<typeof vi.fn>).mock.calls[0][0] as CartItem
    expect(item).toMatchObject({
      product_id: 'p-sug',
      unit_price_snapshot: 12,
      quantity: 1,
      selected_modifiers: [],
      upsell_source: 'checkout_suggestion',
    })
  })

  it('recomandare cu grup OBLIGATORIU: nu intră direct în coș — se deschide ProductSheet', async () => {
    const user = userEvent.setup()
    const withRequired = makeProduct({
      id: 'p-req',
      name: 'Burger',
      category_id: 'c2',
      modifier_groups: [
        makeGroup({ is_required: true, modifier_options: [makeOption({ name: 'Mediu' })] }),
      ],
    })
    const props = renderSheet({
      cart: [makeCartItem({ product_id: 'p-alt' })],
      categories: [makeCategory({ id: 'c2', products: [withRequired] })],
      checkoutSuggestionSettings: { enabled: true },
    })

    await user.click(screen.getByRole('button', { name: 'Adaugă Burger' }))
    // Paritate mig 191: fără opțiunile obligatorii serverul respinge comanda —
    // deci quick-add-ul e interzis; se închide coșul și se deschide produsul.
    expect(props.onAddToCart).not.toHaveBeenCalled()
    expect(props.onOpenProduct).toHaveBeenCalledWith(withRequired)
    expect(props.onClose).toHaveBeenCalled()
  })
})
