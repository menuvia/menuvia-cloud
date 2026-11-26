// Fila Stocuri (lotul C4a): stocul editat nu se mai pierde tăcut, iar
// numerele tastate cu virgulă (ingredient, ajustare, NIR) pleacă exact.
// Partea din lib e în src/lib/__tests__/stocksUpdate.test.ts (STK1–STK2).
//   STK3 fișa unui ingredient EXISTENT nu mai are câmp de stoc: valoarea se
//        vede („10 buc”), iar „Ajustează stoc” închide fișa și deschide
//        ajustarea pentru același ingredient; „Salvează” trimite fără
//        `current_stock`. Control pozitiv: fișa unui ingredient NOU are câmpul.
//        Mutația care pică: câmpul editabil readus în modul de editare (stocul
//        tastat ar fi aruncat de `updateIngredient`, iar fișa s-ar închide ca la
//        succes).
//   STK4 cu modificări nesalvate, „Ajustează stoc” întreabă întâi (EXPLICIT
//        „Anulează”): refuzul lasă fișa deschisă cu ce s-a tastat, acceptul
//        deschide ajustarea. Mutația care pică: confirmarea scoasă (modificările
//        s-ar pierde tăcut).
//   STK5 ingredient nou cu virgulă: stoc „2,5”, alertă „1,5”, cost „4,50” →
//        2.5 / 1.5 / 4.5; un cost „abc” e o eroare LÂNGĂ câmp (aria-invalid),
//        nimic trimis. Mutația care pică: `parseFloat(cost) || 0` readus (0
//        tăcut) sau `type="number"`.
//   STK6 ajustarea acceptă „4,5” (cu `parseFloat` devenea 4, tăcut).
//   STK7 NIR: cantitatea „2,5” și prețul „4,50” pleacă 2.5 / 4.5, iar totalul
//        liniei îi folosește („11.25 lei”); un rând cu ingredient și preț GOL nu
//        mai pleacă cu 0 (intra în costul mediu ponderat, mig 251) — eroare pe
//        rând; o cantitate „2,5,1” e „Cantitate invalidă”, nu un rând aruncat
//        tăcut. Mutația care pică: `parseFloat(it.unit_price) || 0` readus sau
//        filtrul care arunca tăcut rândurile cu cantitate invalidă.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Ingredient } from '../../lib/stocks'
import type { ConfirmOptions } from '../ui/confirm'

type PoInput = { items: { ingredient_id: string; quantity: number; unit_price: number; vat_rate: number }[] }

const h = vi.hoisted(() => ({
  ingredients: [] as Ingredient[],
  created: [] as Partial<Ingredient>[],
  updated: [] as [string, Partial<Ingredient>][],
  adjusted: [] as [string, number, string | undefined][],
  pos: [] as PoInput[],
  confirm: [] as ConfirmOptions[],
  answer: false,
}))

vi.mock('../ui/confirm', () => ({
  confirm: async (o: ConfirmOptions) => {
    h.confirm.push(o)
    return h.answer
  },
}))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/stocks', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/stocks')>()
  return {
    ...real,
    fetchIngredients: async () => h.ingredients,
    fetchSuppliers: async () => [],
    fetchPurchaseOrders: async () => [],
    fetchProductProfitability: async () => [],
    createIngredient: async (_rid: string, f: Partial<Ingredient>) => {
      h.created.push(f)
      return h.ingredients[0]
    },
    updateIngredient: async (id: string, f: Partial<Ingredient>) => {
      h.updated.push([id, f])
    },
    deleteIngredient: vi.fn(),
    adjustStockManual: async (id: string, n: number, notes?: string) => {
      h.adjusted.push([id, n, notes])
    },
    createSupplier: vi.fn(),
    receivePurchaseOrder: vi.fn(),
    createPurchaseOrder: async (po: PoInput) => {
      h.pos.push(po)
      return 'po-new'
    },
  }
})
vi.mock('../../lib/vat', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/vat')>()
  return { ...real, fetchVatRates: async () => [] }
})

import StocksTab from '../StocksTab'

function ingredient(over: Partial<Ingredient>): Ingredient {
  return {
    id: 'i1',
    restaurant_id: 'r1',
    name: 'Făină',
    unit: 'buc',
    current_stock: 10,
    min_stock_alert: null,
    cost_per_unit: 4,
    vat_group: 1,
    emoji: null,
    category: null,
    is_active: true,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...over,
  }
}

beforeEach(() => {
  h.ingredients = [ingredient({}), ingredient({ id: 'i2', name: 'Zahăr', cost_per_unit: 0 })]
  h.created = []
  h.updated = []
  h.adjusted = []
  h.pos = []
  h.confirm = []
  h.answer = false
})

async function setup() {
  const user = userEvent.setup()
  render(<StocksTab restaurantId="r1" showVat={false} />)
  await screen.findByText('Zahăr')
  return user
}

async function openEdit(user: ReturnType<typeof userEvent.setup>) {
  // `find…`: după o salvare lista se reîncarcă (spinner), apoi revine.
  const edit = await screen.findAllByRole('button', { name: 'Editează' })
  await user.click(edit[0]!)
  return screen.findByRole('dialog', { name: 'Editează ingredient' })
}

describe('fișa ingredientului (lotul C4a)', () => {
  it('STK3 stocul existent se schimbă doar prin ajustare', async () => {
    const user = await setup()
    let dlg = await openEdit(user)
    expect(within(dlg).getByText('Stoc curent (buc)')).toBeInTheDocument()
    expect(within(dlg).getByText('10 buc')).toBeInTheDocument()
    // Niciun câmp de stoc (nici text, nici `type=number`) în modul de editare.
    expect(within(dlg).queryByRole('textbox', { name: 'Stoc curent (buc)' })).toBeNull()
    expect(within(dlg).queryByRole('spinbutton', { name: 'Stoc curent (buc)' })).toBeNull()
    await user.click(within(dlg).getByRole('button', { name: 'Salvează' }))
    await waitFor(() => expect(h.updated).toHaveLength(1))
    expect(h.updated[0]![1]).not.toHaveProperty('current_stock')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    dlg = await openEdit(user)
    await user.click(within(dlg).getByRole('button', { name: 'Ajustează stoc' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editează ingredient' })).toBeNull())
    const adj = screen.getByRole('dialog', { name: 'Ajustează stoc' })
    expect(within(adj).getByText('Făină')).toBeInTheDocument()
    expect(h.confirm).toHaveLength(0)

    // Control: fișa unui ingredient NOU are câmpul de stoc.
    await user.click(within(adj).getByRole('button', { name: 'Anulează' }))
    await user.click(screen.getByRole('button', { name: 'Adaugă ingredient' }))
    const neu = screen.getByRole('dialog', { name: 'Ingredient nou' })
    expect(within(neu).getByLabelText('Stoc curent (kg)')).toHaveAttribute('inputmode', 'decimal')
  })

  it('STK4 cu modificări, „Ajustează stoc” întreabă întâi', async () => {
    const user = await setup()
    const dlg = await openEdit(user)
    const cost = within(dlg).getByLabelText('Cost per buc (lei)')
    await user.clear(cost)
    await user.type(cost, '5')
    await user.click(within(dlg).getByRole('button', { name: 'Ajustează stoc' }))
    await waitFor(() => expect(h.confirm).toHaveLength(1))
    expect(h.confirm[0]).toMatchObject({
      title: 'Renunți la modificările din fișă?',
      confirmLabel: 'Renunță și ajustează',
      cancelLabel: 'Anulează',
    })
    expect(screen.getByRole('dialog', { name: 'Editează ingredient' })).toBeInTheDocument()
    expect(cost).toHaveValue('5')

    h.answer = true
    await user.click(within(dlg).getByRole('button', { name: 'Ajustează stoc' }))
    expect(await screen.findByRole('dialog', { name: 'Ajustează stoc' })).toBeInTheDocument()
    expect(h.updated).toEqual([])
  })

  it('STK5 ingredient nou cu virgulă; un cost fără formă de număr e o eroare', async () => {
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'Adaugă ingredient' }))
    const dlg = screen.getByRole('dialog', { name: 'Ingredient nou' })
    await user.type(within(dlg).getByLabelText('Nume *'), 'Unt')
    const stock = within(dlg).getByLabelText('Stoc curent (kg)')
    await user.clear(stock)
    await user.type(stock, '2,5')
    await user.type(within(dlg).getByLabelText('Alertă sub (kg)'), '1,5')
    const cost = within(dlg).getByLabelText('Cost per kg (lei)')
    await user.clear(cost)
    await user.type(cost, 'abc')
    await user.click(within(dlg).getByRole('button', { name: 'Salvează' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Nu e un număr valid (ex. 4,50)')
    expect(cost).toHaveAttribute('aria-invalid', 'true')
    expect(h.created).toEqual([])

    await user.clear(cost)
    await user.type(cost, '4,50')
    await user.click(within(dlg).getByRole('button', { name: 'Salvează' }))
    await waitFor(() => expect(h.created).toHaveLength(1))
    expect(h.created[0]).toMatchObject({ name: 'Unt', current_stock: 2.5, min_stock_alert: 1.5, cost_per_unit: 4.5 })
  })

  it('STK6 ajustarea acceptă virgula', async () => {
    const user = await setup()
    await user.click(screen.getAllByRole('button', { name: 'Ajustează stoc' })[0]!)
    const adj = screen.getByRole('dialog', { name: 'Ajustează stoc' })
    const amount = within(adj).getByLabelText('Stoc curent: 10 buc')
    await user.clear(amount)
    await user.type(amount, '4,5')
    await user.click(within(adj).getByRole('button', { name: 'Salvează' }))
    await waitFor(() => expect(h.adjusted).toHaveLength(1))
    expect(h.adjusted[0]).toEqual(['i1', 4.5, 'Ajustare manuală'])
  })
})

describe('NIR (lotul C4a)', () => {
  async function openNir(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'NIR' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'NIR nou' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'NIR nou' }))
    return screen.getByRole('dialog', { name: 'NIR nou' })
  }

  it('STK7 cantitatea și prețul cu virgulă; prețul gol și cantitatea invalidă sunt erori', async () => {
    const user = await setup()
    const dlg = await openNir(user)
    // Zahăr are costul 0, deci prețul NU se precompletează.
    await user.selectOptions(within(dlg).getAllByRole('combobox')[0]!, 'i2')
    const qty = within(dlg).getByRole('textbox', { name: 'Cantitate' })
    const price = within(dlg).getByRole('textbox', { name: 'Preț/unitate' })
    expect(price).toHaveValue('')
    await user.type(qty, '2,5')
    await user.click(within(dlg).getByRole('button', { name: 'Salvează & recepționează' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Completează prețul unitar')
    expect(price).toHaveAttribute('aria-invalid', 'true')
    expect(h.pos).toEqual([])

    await user.clear(qty)
    await user.type(qty, '2,5,1')
    await user.type(price, '4,50')
    await user.click(within(dlg).getByRole('button', { name: 'Salvează & recepționează' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Cantitate invalidă')
    expect(h.pos).toEqual([])

    await user.clear(qty)
    await user.type(qty, '2,5')
    expect(within(dlg).getAllByText('11.25 lei').length).toBeGreaterThan(0)
    await user.click(within(dlg).getByRole('button', { name: 'Salvează & recepționează' }))
    await waitFor(() => expect(h.pos).toHaveLength(1))
    expect(h.pos[0]!.items).toEqual([{ ingredient_id: 'i2', quantity: 2.5, unit_price: 4.5, vat_rate: 0 }])
  })
})
