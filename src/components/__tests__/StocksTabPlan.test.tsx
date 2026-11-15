// Stocuri pe planul restaurantului (lotul P, nov 2026). Fila e de la Planul 2
// (NAV_GROUPS minTier 2), dar cotele TVA sunt ale planului cu bon: pe Planul 2
// ingredientul n-are câmp de cotă, iar NIR-ul e SIMPLIFICAT (fără coloana TVA
// și fără defalcarea subtotal/TVA; liniile se salvează cu cota 0).
//
//   SK1  Planul 2 (`showVat` false): cardul de ingredient fără „TVA …", fișa
//        de ingredient fără „Cota TVA", NIR-ul fără coloana „TVA", fără
//        „Subtotal (fără TVA)", cu „Total linie" (nu „cu TVA"); cotele nici nu
//        se cer. Mutația care pică: oricare dintre gate-urile `showVat` scos.
//   SK2  control pozitiv pe Planul 3: badge-ul, câmpul de cotă, coloana TVA și
//        defalcarea apar, iar cotele se cer.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Ingredient } from '../../lib/stocks'

// Hoisted: fabricile `vi.mock` de mai jos rulează înaintea corpului modulului.
const { vat, INGREDIENT } = vi.hoisted(() => {
  const ingredient: Ingredient = {
    id: 'i1',
    restaurant_id: 'r1',
    name: 'Făină',
    unit: 'kg',
    current_stock: 10,
    min_stock_alert: null,
    cost_per_unit: 4,
    vat_group: 1,
    emoji: null,
    category: null,
    is_active: true,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  }
  return { vat: { calls: 0 }, INGREDIENT: ingredient }
})

vi.mock('../../lib/stocks', () => ({
  fetchIngredients: async () => [INGREDIENT],
  createIngredient: vi.fn(),
  updateIngredient: vi.fn(),
  deleteIngredient: vi.fn(),
  adjustStockManual: vi.fn(),
  fetchSuppliers: async () => [],
  createSupplier: vi.fn(),
  fetchPurchaseOrders: async () => [],
  receivePurchaseOrder: vi.fn(),
  createPurchaseOrder: vi.fn(),
  fetchProductProfitability: async () => [],
  formatStock: (n: number, u: string) => `${n} ${u}`,
  // Variantele traduse (lotul L5b) — StocksTab le folosește pe ele.
  formatStockT: (n: number, u: string) => `${n} ${u}`,
  unitSymbolT: (u: string) => u,
  MANUAL_ADJUST_NOTE: 'Ajustare manuală',
}))
vi.mock('../../lib/vat', () => ({
  fetchVatRates: async () => {
    vat.calls += 1
    return [
      {
        restaurant_id: 'r1',
        vat_group: 1,
        rate_percent: 11,
        label: 'Mâncare',
        description: null,
        is_active: true,
        updated_at: '2026-10-01T10:00:00Z',
      },
    ]
  },
  getVatLabel: () => '11% (Mâncare)',
  getVatRate: () => 11,
}))

import StocksTab from '../StocksTab'

beforeEach(() => {
  vat.calls = 0
})

async function walk(showVat: boolean) {
  const user = userEvent.setup()
  render(<StocksTab restaurantId="r1" showVat={showVat} />)
  // Ingrediente: cardul + fișa.
  expect(await screen.findByText('Făină')).toBeInTheDocument()
  const cardText = document.body.textContent ?? ''
  await user.click(screen.getByRole('button', { name: /Editează/ }))
  const modalText = document.body.textContent ?? ''
  await user.keyboard('{Escape}')
  // NIR: fișa de creare.
  await user.click(screen.getByRole('button', { name: 'NIR' }))
  // „NIR nou" e activ abia după ce ingredientele s-au citit (canCreate).
  await waitFor(() => expect(screen.getByRole('button', { name: 'NIR nou' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'NIR nou' }))
  expect(await screen.findByText('TOTAL')).toBeInTheDocument()
  const nirText = document.body.textContent ?? ''
  return { cardText, modalText, nirText }
}

describe('StocksTab — TVA doar pe planul cu bon', () => {
  it('SK1: Planul 2 — fără cote pe ingredient, NIR simplificat', async () => {
    const { cardText, modalText, nirText } = await walk(false)
    expect(cardText).not.toMatch(/\bTVA\b/)
    expect(modalText).not.toMatch(/Cota TVA/)
    expect(nirText).not.toMatch(/\bTVA\b/)
    expect(nirText).toMatch(/Total linie/)
    expect(vat.calls).toBe(0)
  })

  it('SK2: control pozitiv — pe Planul 3 badge, câmp, coloană și defalcare', async () => {
    const { cardText, modalText, nirText } = await walk(true)
    expect(cardText).toMatch(/TVA 11% \(Mâncare\)/)
    expect(modalText).toMatch(/Cota TVA/)
    expect(nirText).toMatch(/Subtotal \(fără TVA\)/)
    expect(nirText).toMatch(/Total linie \(cu TVA\)/)
    expect(vat.calls).toBeGreaterThanOrEqual(1)
  })
})
