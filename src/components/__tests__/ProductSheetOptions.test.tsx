// Fișa oaspetelui pe motorul comun de opțiuni (lotul O4b, audit nov 2026).
//
//   PO1  grup OPȚIONAL single: a doua atingere deselectează, prețul revine.
//        [PICĂ: toggleSingle vechi — opțiunea nu se mai putea scoate]
//   PO2  grup obligatoriu: butonul spune CE grup lipsește („Alege: Blat”),
//        apoi „Adaugă în coș”.
//   PO3  grup obligatoriu fără opțiuni disponibile → „Indisponibil acum”,
//        blocat (nu o fișă care nu se poate trimite niciodată).
//   PO4  opțiunea care scade prețul își arată prețul, cu minus.
//   PO5  meniul se reîmprospătează cu fișa deschisă și opțiunea aleasă
//        dispare: grupul obligatoriu nu mai e „satisfăcut” de id-ul vechi.
//        [PICĂ: numărarea brută — „Adaugă” rămânea activ, serverul respingea]
//   PO6  cantitatea se oprește la 20, mențiunile la 300 de caractere.
//   PO7  fișa ospătarului (ModifierSheet) urmează aceleași reguli: spune ce grup
//        lipsește, iar pe un grup opțional single a doua atingere deselectează.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProductSheet from '../ProductSheet'
import ModifierSheet from '../ModifierSheet'
import { resolveTheme } from '../../lib/themes'
import type { CartItem } from '../../lib/orders'
import { MAX_ITEM_NOTE, MAX_LINE_QTY } from '../../lib/orders'
import type { Product } from '../../lib/qr'
import { makeGroup, makeOption, makeProduct } from './fixtures'

const theme = resolveTheme(null)

function sheet(product: Product) {
  return (
    <ProductSheet product={product} accent="#C8963C" theme={theme} onAdd={vi.fn<(i: CartItem) => void>()} onClose={vi.fn()} />
  )
}

const addButton = () => screen.getByRole('button', { name: /adaugă în coș|alege:|indisponibil acum/i })

describe('ProductSheet — opțiunile pe motorul comun', () => {
  it('PO1 grup opțional single: a doua atingere deselectează', async () => {
    const user = userEvent.setup()
    const sos = makeGroup({ name: 'Sos', modifier_options: [makeOption({ name: 'Picant', price_delta: 3 })] })
    render(sheet(makeProduct({ price: 20, modifier_groups: [sos] })))
    const picant = screen.getByRole('radio', { name: /Picant/ })
    await user.click(picant)
    expect(picant).toHaveAttribute('aria-checked', 'true')
    expect(addButton()).toHaveTextContent('23.00 lei')
    await user.click(picant)
    expect(picant).toHaveAttribute('aria-checked', 'false')
    expect(addButton()).toHaveTextContent('20.00 lei')
  })

  it('PO2 butonul numește grupul care lipsește', async () => {
    const user = userEvent.setup()
    const blat = makeGroup({ name: 'Blat', is_required: true, modifier_options: [makeOption({ name: 'Subțire' })] })
    render(sheet(makeProduct({ modifier_groups: [blat] })))
    expect(addButton()).toBeDisabled()
    expect(addButton()).toHaveTextContent('Alege: Blat')
    await user.click(screen.getByRole('radio', { name: /Subțire/ }))
    expect(addButton()).toBeEnabled()
    expect(addButton()).toHaveTextContent(/Adaugă în coș/)
  })

  it('PO3 grup obligatoriu fără opțiuni disponibile → indisponibil', () => {
    const blat = makeGroup({ name: 'Blat', is_required: true, modifier_options: [] })
    render(sheet(makeProduct({ modifier_groups: [blat] })))
    expect(addButton()).toBeDisabled()
    expect(addButton()).toHaveTextContent('Indisponibil acum')
  })

  it('PO4 opțiunea care scade prețul își arată prețul', () => {
    const carne = makeGroup({ name: 'Carne', modifier_options: [makeOption({ name: 'Fără carne', price_delta: -5 })] })
    render(sheet(makeProduct({ modifier_groups: [carne] })))
    expect(screen.getByRole('radio', { name: /Fără carne/ })).toHaveTextContent('−5.00 lei')
  })

  it('PO5 opțiunea aleasă dispare la reîmprospătare → grupul cere din nou o alegere', async () => {
    const user = userEvent.setup()
    const sub = makeOption({ id: 'o-sub', name: 'Subțire' })
    const puf = makeOption({ id: 'o-puf', name: 'Pufos' })
    const blat = makeGroup({ id: 'g-blat', name: 'Blat', is_required: true, modifier_options: [sub, puf] })
    const product = makeProduct({ id: 'p-pizza', modifier_groups: [blat] })
    const { rerender } = render(sheet(product))
    await user.click(screen.getByRole('radio', { name: /Pufos/ }))
    expect(addButton()).toBeEnabled()
    // Meniul nou: „Pufos” nu mai e disponibil (payload-ul oaspetelui îl scoate).
    rerender(sheet({ ...product, modifier_groups: [{ ...blat, modifier_options: [sub] }] }))
    expect(addButton()).toBeDisabled()
    expect(addButton()).toHaveTextContent('Alege: Blat')
  })

  it('PO6 cantitatea se oprește la 20, mențiunile la 300', async () => {
    const user = userEvent.setup()
    render(sheet(makeProduct({ price: 1 })))
    const plus = screen.getByRole('button', { name: 'Crește cantitatea' })
    for (let i = 0; i < MAX_LINE_QTY + 2; i++) await user.click(plus)
    expect(plus).toBeDisabled()
    expect(addButton()).toHaveTextContent(`${MAX_LINE_QTY.toFixed(2)} lei`)
    expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', String(MAX_ITEM_NOTE))
  })
})

describe('ModifierSheet — aceleași reguli la ospătar', () => {
  it('PO7 grupul care lipsește e numit; grupul opțional se poate deselecta', async () => {
    const user = userEvent.setup()
    const blat = makeGroup({ name: 'Blat', is_required: true, modifier_options: [makeOption({ name: 'Subțire' })] })
    const sos = makeGroup({ name: 'Sos', modifier_options: [makeOption({ name: 'Picant', price_delta: 3 })] })
    render(<ModifierSheet product={makeProduct({ price: 20, modifier_groups: [blat, sos] })} onAdd={vi.fn()} onClose={vi.fn()} />)
    const cta = screen.getByRole('button', { name: /adaugă în comandă/i })
    expect(cta).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Alege: Blat')
    await user.click(screen.getByRole('radio', { name: /Subțire/ }))
    expect(cta).toBeEnabled()
    expect(screen.queryByText('Alege: Blat')).toBeNull()
    const picant = screen.getByRole('radio', { name: /Picant/ })
    await user.click(picant)
    expect(cta).toHaveTextContent('23.00 lei')
    await user.click(picant)
    expect(picant).toHaveAttribute('aria-checked', 'false')
    expect(cta).toHaveTextContent('20.00 lei')
  })
})
