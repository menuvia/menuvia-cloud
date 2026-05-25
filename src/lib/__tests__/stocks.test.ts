// src/lib/__tests__/stocks.test.ts
import { describe, it, expect } from 'vitest'
import { formatStock, unitLabel } from '../stocks'

describe('formatStock()', () => {
  describe('grame → kg conversion', () => {
    it('păstrează grame sub 1000g', () => {
      expect(formatStock(500, 'g')).toBe('500 g')
      expect(formatStock(999, 'g')).toBe('999 g')
    })

    it('convertește la kg de la 1000g în sus', () => {
      expect(formatStock(1000, 'g')).toBe('1.00 kg')
      expect(formatStock(1500, 'g')).toBe('1.50 kg')
      expect(formatStock(2750, 'g')).toBe('2.75 kg')
      expect(formatStock(10000, 'g')).toBe('10.00 kg')
    })

    it('păstrează zecimale chiar și pentru valori întregi', () => {
      expect(formatStock(2000, 'g')).toBe('2.00 kg')
    })
  })

  describe('mililitri → litri conversion', () => {
    it('păstrează ml sub 1000ml', () => {
      expect(formatStock(250, 'ml')).toBe('250 ml')
      expect(formatStock(999, 'ml')).toBe('999 ml')
    })

    it('convertește la litri de la 1000ml în sus', () => {
      expect(formatStock(1000, 'ml')).toBe('1.00 L')
      expect(formatStock(1500, 'ml')).toBe('1.50 L')
      expect(formatStock(3333, 'ml')).toBe('3.33 L')
    })
  })

  describe('alte unități (nu se convertesc)', () => {
    it('afișează kg cu unitatea originală', () => {
      expect(formatStock(5, 'kg')).toBe('5 kg')
      expect(formatStock(2.5, 'kg')).toBe('2.50 kg')
    })

    it('afișează litri cu unitatea originală', () => {
      expect(formatStock(3, 'l')).toBe('3 l')
      expect(formatStock(1.75, 'l')).toBe('1.75 l')
    })

    it('afișează bucăți întregi fără zecimale', () => {
      expect(formatStock(10, 'buc')).toBe('10 buc')
      expect(formatStock(100, 'buc')).toBe('100 buc')
    })

    it('afișează bucăți fracționate cu 2 zecimale', () => {
      expect(formatStock(1.5, 'buc')).toBe('1.50 buc')
    })

    it('afișează pachete', () => {
      expect(formatStock(3, 'pachet')).toBe('3 pachet')
    })
  })

  describe('edge cases', () => {
    it('gestionează 0 corect', () => {
      expect(formatStock(0, 'g')).toBe('0 g')
      expect(formatStock(0, 'kg')).toBe('0 kg')
      expect(formatStock(0, 'ml')).toBe('0 ml')
    })

    it('gestionează valori foarte mari', () => {
      expect(formatStock(50000, 'g')).toBe('50.00 kg')
      expect(formatStock(100000, 'ml')).toBe('100.00 L')
    })
  })
})

describe('unitLabel()', () => {
  it('returnează label-uri în română pentru toate unitățile', () => {
    expect(unitLabel('g')).toBe('grame')
    expect(unitLabel('kg')).toBe('kilograme')
    expect(unitLabel('ml')).toBe('mililitri')
    expect(unitLabel('l')).toBe('litri')
    expect(unitLabel('buc')).toBe('bucăți')
    expect(unitLabel('pachet')).toBe('pachete')
  })
})
