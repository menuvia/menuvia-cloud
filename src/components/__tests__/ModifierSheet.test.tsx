// Teste pe ModifierSheet — poarta prin care intră BANII în coș (QR quick-sheet,
// WaiterEntry, EditOrderSheet). Verifică:
//   - matematica prețului din CTA: (preț + Σ delta) × qty
//   - gating-ul de grup obligatoriu (paritate cu serverul, mig 191)
//   - plafonul max_select pe grupuri multiple (paritate mig 145)
//   - opțiunile indisponibile: nerandate, neprețuite, nu ocupă slot min/max
//   - payload-ul onAdd: unit_price_snapshot = preț CATALOG (delta stă în
//     selected_modifiers), quantity, notes
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModifierSheet from '../ModifierSheet'
import type { CartItem } from '../../lib/orders'
import { makeProduct, makeGroup, makeOption } from './fixtures'

function addButton(): HTMLElement {
  return screen.getByRole('button', { name: /adaugă în comandă/i })
}

describe('ModifierSheet — matematica banilor + gating server-parity', () => {
  it('produs fără grupuri: CTA arată prețul de catalog și onAdd trimite payload curat', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn<(item: CartItem) => void>()
    const onClose = vi.fn()
    const product = makeProduct({ price: 24.5, name: 'Burger' })

    render(<ModifierSheet product={product} onAdd={onAdd} onClose={onClose} />)

    expect(addButton()).toBeEnabled()
    expect(addButton()).toHaveTextContent('Adaugă în comandă — 24.50 lei')

    await user.click(addButton())
    expect(onAdd).toHaveBeenCalledTimes(1)
    const item = onAdd.mock.calls[0][0]
    expect(item.product_id).toBe(product.id)
    expect(item.unit_price_snapshot).toBe(24.5)
    expect(item.quantity).toBe(1)
    expect(item.selected_modifiers).toEqual([])
    expect(item.notes).toBeNull()
    expect(onClose).toHaveBeenCalled()
  })

  it('delta de modificator intră în CTA per-unitate și se multiplică cu cantitatea', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn<(item: CartItem) => void>()
    const group = makeGroup({
      name: 'Lapte',
      selection_type: 'single',
      modifier_options: [makeOption({ name: 'Ovăz', price_delta: 3 })],
    })
    const product = makeProduct({ price: 10, modifier_groups: [group] })

    render(<ModifierSheet product={product} onAdd={onAdd} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /ovăz/i }))
    expect(addButton()).toHaveTextContent('13.00 lei')

    // qty 1 → 2: (10 + 3) × 2 = 26, NU 10×2 + 3
    await user.click(screen.getByRole('button', { name: '+' }))
    expect(addButton()).toHaveTextContent('26.00 lei')

    await user.click(addButton())
    const item = onAdd.mock.calls[0][0]
    // Prețul unitar rămâne cel de CATALOG — delta stă în selected_modifiers
    // (serverul recompune totalul din ele, mig 088).
    expect(item.unit_price_snapshot).toBe(10)
    expect(item.quantity).toBe(2)
    expect(item.selected_modifiers).toHaveLength(1)
    expect(item.selected_modifiers[0]).toMatchObject({
      group_id: group.id,
      option_id: group.modifier_options[0].id,
      price_delta: 3,
    })
  })

  it('cantitatea nu coboară sub 1 (minus la qty=1 e no-op)', async () => {
    const user = userEvent.setup()
    const product = makeProduct({ price: 8 })
    render(<ModifierSheet product={product} onAdd={vi.fn()} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '−' }))
    expect(addButton()).toHaveTextContent('8.00 lei')
  })

  it('grup single obligatoriu: butonul e blocat până se alege o opțiune', async () => {
    const user = userEvent.setup()
    const group = makeGroup({
      selection_type: 'single',
      is_required: true,
      modifier_options: [makeOption({ name: 'Mică' }), makeOption({ name: 'Mare', price_delta: 4 })],
    })
    const product = makeProduct({ price: 12, modifier_groups: [group] })

    render(<ModifierSheet product={product} onAdd={vi.fn()} onClose={vi.fn()} />)

    // Paritate cu mig 191: sub minim → serverul respinge; UI-ul blochează CTA.
    expect(addButton()).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /mare/i }))
    expect(addButton()).toBeEnabled()
    expect(addButton()).toHaveTextContent('16.00 lei')
  })

  it('grup multiplu cu min_select=2: blocat sub 2 selecții, deblocat la 2', async () => {
    const user = userEvent.setup()
    const group = makeGroup({
      selection_type: 'multiple',
      min_select: 2,
      modifier_options: [
        makeOption({ name: 'Bacon', price_delta: 2 }),
        makeOption({ name: 'Ou', price_delta: 1.5 }),
        makeOption({ name: 'Brânză', price_delta: 1 }),
      ],
    })
    const product = makeProduct({ price: 10, modifier_groups: [group] })

    render(<ModifierSheet product={product} onAdd={vi.fn()} onClose={vi.fn()} />)

    expect(addButton()).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /bacon/i }))
    expect(addButton()).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /^ou/i }))
    expect(addButton()).toBeEnabled()
    // (10 + 2 + 1.5) × 1 = 13.50
    expect(addButton()).toHaveTextContent('13.50 lei')
  })

  it('max_select pe grup multiplu: a treia opțiune e dezactivată la plafon', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn<(item: CartItem) => void>()
    const group = makeGroup({
      selection_type: 'multiple',
      max_select: 2,
      modifier_options: [
        makeOption({ name: 'Bacon', price_delta: 2 }),
        makeOption({ name: 'Ou', price_delta: 2 }),
        makeOption({ name: 'Brânză', price_delta: 2 }),
      ],
    })
    const product = makeProduct({ price: 10, modifier_groups: [group] })

    render(<ModifierSheet product={product} onAdd={onAdd} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /bacon/i }))
    await user.click(screen.getByRole('button', { name: /^ou/i }))
    // La plafon, opțiunea neselectată e disabled (paritate cu respingerea mig 145).
    expect(screen.getByRole('button', { name: /brânză/i })).toBeDisabled()

    await user.click(addButton())
    expect(onAdd.mock.calls[0][0].selected_modifiers).toHaveLength(2)
  })

  it('opțiunile indisponibile nu apar, nu se prețuiesc și nu satisfac minimul', () => {
    const unavailable = makeOption({ name: 'Trufe', price_delta: 9, is_available: false })
    const group = makeGroup({
      selection_type: 'single',
      is_required: true,
      modifier_options: [unavailable, makeOption({ name: 'Ciuperci', price_delta: 2 })],
    })
    const product = makeProduct({ price: 10, modifier_groups: [group] })

    render(
      <ModifierSheet
        product={product}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        // Selecție inițială pe o opțiune devenită indisponibilă (ex. EditOrder
        // redeschide un item vechi): nu trebuie să conteze la min și nici la preț.
        initialSelections={[{ group_id: group.id, option_id: unavailable.id }]}
      />,
    )

    expect(screen.queryByRole('button', { name: /trufe/i })).not.toBeInTheDocument()
    // Minimul NU e satisfăcut de opțiunea indisponibilă → CTA blocat.
    expect(addButton()).toBeDisabled()
    // Și prețul nu include delta ei.
    expect(addButton()).toHaveTextContent('10.00 lei')
  })

  it('initialSelections valide pre-populează selecția și prețul (flux EditOrder)', () => {
    const opt = makeOption({ name: 'Picant', price_delta: 1.5 })
    const group = makeGroup({ selection_type: 'single', modifier_options: [opt] })
    const product = makeProduct({ price: 20, modifier_groups: [group] })

    render(
      <ModifierSheet
        product={product}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        initialQty={3}
        initialSelections={[{ group_id: group.id, option_id: opt.id }]}
      />,
    )

    // (20 + 1.5) × 3 = 64.50
    expect(addButton()).toHaveTextContent('64.50 lei')
  })
})
