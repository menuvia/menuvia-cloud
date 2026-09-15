// src/lib/__tests__/vat.test.ts
import { describe, it, expect } from 'vitest'
import {
  getVatLabel,
  getVatRate,
  aggregateVatReport,
  type VatRate,
  type VatReportRow,
} from '../vat'

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

  it('returnează null pentru grupa inexistentă (gap de config, NU 0% real)', () => {
    expect(getVatRate(mockRates, 99)).toBeNull()
    expect(getVatRate(mockRates, 0)).toBeNull()
    expect(getVatRate(mockRates, -1)).toBeNull()
  })

  it('distinge grupa 4 (0% real) de grupa lipsă (null)', () => {
    // Regresie fiscală: grupa 4 există cu rata 0 → 0, nu null
    expect(getVatRate(mockRates, 4)).toBe(0)
    expect(getVatRate(mockRates, 99)).toBeNull()
  })

  it('gestionează array gol (fără config = null, nu 0)', () => {
    expect(getVatRate([], 1)).toBeNull()
  })

  it('returnează corect chiar și pentru grupele inactive', () => {
    // grupa 3 e is_active: false dar getVatRate nu filtrează după asta
    expect(getVatRate(mockRates, 3)).toBe(5)
  })
})

// ── aggregateVatReport (raportul TVA, reziduul cosmetic din mig 272) ─────────
// VR1 e clichetul: pe cheia veche (doar grupa) cele două cote ale grupei 1 se
// însumau într-un singur card cu eticheta primului rând — VR1 pică pe acel cod.
describe('aggregateVatReport()', () => {
  const row = (o: Partial<VatReportRow>): VatReportRow => ({
    vat_group: 1,
    vat_rate_percent: 9,
    vat_label: 'Mâncare',
    gross_total: 0,
    vat_amount: 0,
    net_total: 0,
    ...o,
  })

  it('VR1: aceeași grupă cu două cote (schimbare de cotă în interval) dă DOUĂ agregate, nu unul', () => {
    const { byRate } = aggregateVatReport([
      row({
        vat_rate_percent: 11,
        gross_total: '111.00',
        vat_amount: '11.00',
        net_total: '100.00',
      }),
      row({ vat_rate_percent: 9, gross_total: '109.00', vat_amount: '9.00', net_total: '100.00' }),
      row({
        vat_rate_percent: 11,
        gross_total: '222.00',
        vat_amount: '22.00',
        net_total: '200.00',
      }),
    ])
    expect(byRate).toHaveLength(2)
    expect(byRate.map((a) => [a.vat_group, a.rate, a.gross])).toEqual([
      [1, 9, 109],
      [1, 11, 333],
    ])
    // cardul de 9% NU cuprinde vânzările la 11%
    expect(byRate[0].vat).toBe(9)
    expect(byRate[1].vat).toBe(33)
  })

  it('VR2: totalurile generale sunt suma tuturor rândurilor, indiferent de cheie', () => {
    const s = aggregateVatReport([
      row({ vat_group: 1, vat_rate_percent: 9, gross_total: 109, vat_amount: 9, net_total: 100 }),
      row({ vat_group: 2, vat_rate_percent: 19, gross_total: 119, vat_amount: 19, net_total: 100 }),
      row({ vat_group: 1, vat_rate_percent: 11, gross_total: 111, vat_amount: 11, net_total: 100 }),
    ])
    expect(s.totalGross).toBe(339)
    expect(s.totalVat).toBe(39)
    expect(s.totalNet).toBe(300)
    expect(s.byRate.reduce((acc, a) => acc + a.gross, 0)).toBe(s.totalGross)
  })

  it('VR3: ordinea e cotă ASC, apoi grupă ASC (două grupe cu aceeași cotă rămân separate)', () => {
    const { byRate } = aggregateVatReport([
      row({ vat_group: 3, vat_rate_percent: 5, vat_label: 'Cărți', gross_total: 1 }),
      row({ vat_group: 2, vat_rate_percent: 19, vat_label: 'Alcool', gross_total: 1 }),
      row({ vat_group: 4, vat_rate_percent: 5, vat_label: 'Altele', gross_total: 1 }),
      row({ vat_group: 1, vat_rate_percent: 9, gross_total: 1 }),
    ])
    expect(byRate.map((a) => `${a.rate}:${a.vat_group}`)).toEqual(['5:3', '5:4', '9:1', '19:2'])
    expect(byRate.map((a) => a.label)).toEqual(['Cărți', 'Altele', 'Mâncare', 'Alcool'])
  })

  it('VR4: fără rânduri → zero agregate și totaluri 0 (nu NaN)', () => {
    const s = aggregateVatReport([])
    expect(s.byRate).toEqual([])
    expect(s.totalGross).toBe(0)
    expect(s.totalVat).toBe(0)
    expect(s.totalNet).toBe(0)
  })
})
