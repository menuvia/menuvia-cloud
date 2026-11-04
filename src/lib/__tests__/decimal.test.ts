// Prețul tastat de om (lotul O5a, audit nov 2026 MENU-07).
//   DC1  „12,50”, „12.5”, „12.”, „7” și „ 3 ” sunt prețuri; gol = null.
//   DC2  „12.5.3”, „abc”, „-3”, „1e3” nu sunt (NaN, nu 0 tăcut).
//   DC3  câmpul pornește gol pentru 0 (produs nou), altfel cu prețul.
import { describe, it, expect } from 'vitest'
import { parseDecimalInput, priceInputText } from '../decimal'

describe('parseDecimalInput', () => {
  it('DC1 forme valide', () => {
    expect(parseDecimalInput('12,50')).toBe(12.5)
    expect(parseDecimalInput('12.5')).toBe(12.5)
    expect(parseDecimalInput('12.')).toBe(12)
    expect(parseDecimalInput('7')).toBe(7)
    expect(parseDecimalInput(' 3 ')).toBe(3)
    expect(parseDecimalInput('')).toBeNull()
  })

  it('DC2 forme invalide → NaN', () => {
    for (const t of ['12.5.3', 'abc', '-3', '1e3', '12,5,0']) {
      expect(Number.isNaN(parseDecimalInput(t)), t).toBe(true)
    }
  })

  it('DC3 textul de pornire', () => {
    expect(priceInputText(0)).toBe('')
    expect(priceInputText(null)).toBe('')
    expect(priceInputText(32.5)).toBe('32.5')
  })
})
