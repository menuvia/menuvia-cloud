// Teste pe MATEMATICA BANILOR din coș: lineTotal (Faza 2 / PLAN_10).
// Formula contractată cu serverul (mig 088):
//   (unit_price_snapshot + Σ modifiers.price_delta + Σ extras.price) * quantity
// Un drift aici = totalul afișat clientului diferă de ce facturează serverul.
import { describe, it, expect } from 'vitest'
import { lineTotal, type CartItem, type SelectedModifier, type SelectedExtra } from '../orders'

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    _key: 'k1',
    product_id: 'p1',
    product_name_snapshot: 'Cafea',
    unit_price_snapshot: 10,
    quantity: 1,
    selected_modifiers: [],
    notes: null,
    ...overrides,
  }
}

function mod(delta: number): SelectedModifier {
  return {
    group_id: 'g',
    group_name: 'Lapte',
    option_id: 'o',
    option_name: 'Ovăz',
    price_delta: delta,
  }
}

function extra(price: number): SelectedExtra {
  return { id: 'e', name: 'Sirop', price }
}

describe('lineTotal — matematica banilor din coș', () => {
  it('produs simplu: unit × qty', () => {
    expect(lineTotal(item())).toBe(10)
    expect(lineTotal(item({ quantity: 3 }))).toBe(30)
  })

  it('modificatorii se adună per-unitate, apoi se multiplică cu qty', () => {
    // (10 + 2) * 2 = 24 — NU 10*2 + 2
    expect(lineTotal(item({ selected_modifiers: [mod(2)], quantity: 2 }))).toBe(24)
  })

  it('mai mulți modificatori se cumulează', () => {
    expect(lineTotal(item({ selected_modifiers: [mod(2), mod(1.5)] }))).toBe(13.5)
  })

  it('modificator negativ (reducere) scade din unit', () => {
    expect(lineTotal(item({ selected_modifiers: [mod(-3)] }))).toBe(7)
  })

  it('extras se adună per-unitate, apoi se multiplică cu qty (paritate mig 088)', () => {
    // (10 + 4) * 3 = 42 — extras NU se adaugă o singură dată pe linie
    expect(lineTotal(item({ selected_extras: [extra(4)], quantity: 3 }))).toBe(42)
  })

  it('selected_extras lipsă (undefined) e tratat ca zero', () => {
    expect(lineTotal(item({ selected_extras: undefined }))).toBe(10)
  })

  it('combinat: unit + modifiers + extras, toate × qty', () => {
    // (10 + 2 + 4) * 2 = 32
    expect(
      lineTotal(item({ selected_modifiers: [mod(2)], selected_extras: [extra(4)], quantity: 2 })),
    ).toBe(32)
  })

  it('produs cu unit 0 dar modifier obligatoriu (cazul A2 din fiscal)', () => {
    // Combo cu preț de catalog 0, valoarea vine din modifier — legitim (mig 052 A2)
    expect(lineTotal(item({ unit_price_snapshot: 0, selected_modifiers: [mod(10)] }))).toBe(10)
  })

  it('prețuri ne-rotunde nu pierd bani la multiplicare', () => {
    // 4.99 * 3 = 14.97 (fără drift de virgulă flotantă vizibil la 2 zecimale)
    expect(lineTotal(item({ unit_price_snapshot: 4.99, quantity: 3 }))).toBeCloseTo(14.97, 2)
  })

  it('cantitate mare nu schimbă formula', () => {
    expect(lineTotal(item({ unit_price_snapshot: 1.5, quantity: 99 }))).toBeCloseTo(148.5, 2)
  })
})
