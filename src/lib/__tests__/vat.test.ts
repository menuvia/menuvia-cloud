// src/lib/__tests__/vat.test.ts
import { describe, it, expect } from 'vitest'
import { getVatLabel, getVatRate, type VatRate } from '../vat'

const mockRates: VatRate[] = [
  {
    restaurant_id: 'r1',
    vat_group: 1,
    rate_percent: 9,
    label: 'Mâncare',
    description: 'TVA redusă pentru produse alimentare',
    is_active: true,
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    restaurant_id: 'r1',
    vat_group: 2,
    rate_percent: 19,
    label: 'Alcool',
    description: null,
    is_active: true,
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    restaurant_id: 'r1',
    vat_group: 3,
    rate_percent: 5,
    label: 'Cărți',
    description: null,
    is_active: false,
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    restaurant_id: 'r1',
    vat_group: 4,
    rate_percent: 0,
    label: 'Neimpozabil',
    description: null,
    is_active: true,
    updated_at: '2026-01-01T00:00:00Z',
  },
]

describe('getVatLabel()', () => {
  it('returnează formatul "X% (Label)" pentru grupa găsită', () => {
    expect(getVatLabel(mockRates, 1)).toBe('9% (Mâncare)')
    expect(getVatLabel(mockRates, 2)).toBe('19% (Alcool)')
  })

  it('returnează 0% pentru grupa neimpozabilă', () => {
    expect(getVatLabel(mockRates, 4)).toBe('0% (Neimpozabil)')
  })

  it('returnează fallback pentru grupa inexistentă', () => {
    expect(getVatLabel(mockRates, 99)).toBe('Grupa 99')
  })

  it('gestionează array gol', () => {
    expect(getVatLabel([], 1)).toBe('Grupa 1')
  })

  it('returnează prima coincidență dacă există duplicate (edge case)', () => {
    const withDup: VatRate[] = [
      ...mockRates,
      { ...mockRates[0]!, rate_percent: 11, label: 'Duplicat' },
    ]
    expect(getVatLabel(withDup, 1)).toBe('9% (Mâncare)')
  })
})

describe('getVatRate()', () => {
  it('returnează rate_percent pentru grupa găsită', () => {
    expect(getVatRate(mockRates, 1)).toBe(9)
    expect(getVatRate(mockRates, 2)).toBe(19)
    expect(getVatRate(mockRates, 3)).toBe(5)
  })

  it('returnează 0 pentru grupa neimpozabilă', () => {
    expect(getVatRate(mockRates, 4)).toBe(0)
  })

  it('returnează 0 pentru grupa inexistentă', () => {
    expect(getVatRate(mockRates, 99)).toBe(0)
    expect(getVatRate(mockRates, 0)).toBe(0)
    expect(getVatRate(mockRates, -1)).toBe(0)
  })

  it('gestionează array gol', () => {
    expect(getVatRate([], 1)).toBe(0)
  })

  it('returnează corect chiar și pentru grupele inactive', () => {
    // grupa 3 e is_active: false dar getVatRate nu filtrează după asta
    expect(getVatRate(mockRates, 3)).toBe(5)
  })
})
