// Prețul tastat de om (lotul O5a, audit nov 2026 MENU-07).
//   DC1  „12,50”, „12.5”, „12.”, „7” și „ 3 ” sunt prețuri; gol = null.
//   DC2  „12.5.3”, „abc”, „-3”, „1e3” nu sunt (NaN, nu 0 tăcut).
//   DC3  câmpul pornește gol pentru 0 (produs nou), altfel cu prețul.
//   DC4  spațiul din INTERIOR trece doar ca separator de mii, în grupe de trei
//        („1 250,50”, și cu spațiu neîntrerupt); „12 50” și „1 2” NU sunt sume
//        (recenzie CodeRabbit pe #392). Mutația care pică: `replace(/\s+/g, '')`
//        înainte de validare (le făcea 1250 și 12, tăcut).
//   DC5  `parseDecimalCents` rotunjește ZECIMAL, cu jumătatea în sus, ca
//        `numeric(…, 2)`: „1.005” → 101 (`Math.round(1.005 * 100)` dă 100),
//        „0,995” → 100; o sumă care nu încape într-un întreg sigur de cenți e
//        NaN, nu Infinity. Mutațiile care pică: `Math.round(n * 100)` readus;
//        garda `Number.isSafeInteger` scoasă.
import { describe, it, expect } from 'vitest'
import { parseDecimalInput, parseDecimalCents, priceInputText } from '../decimal'

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

  it('DC4 spațiul din interior: doar separator de mii', () => {
    expect(parseDecimalInput('1 250,50')).toBe(1250.5)
    expect(parseDecimalInput('1\u00a0250')).toBe(1250)
    expect(parseDecimalInput('12 345 678.9')).toBe(12345678.9)
    for (const t of ['12 50', '1 2', '12, 50', '1 2345', '1  250']) {
      expect(Number.isNaN(parseDecimalInput(t)), t).toBe(true)
      expect(Number.isNaN(parseDecimalCents(t)), t).toBe(true)
    }
  })

  it('DC5 cenți rotunjiți zecimal, în întreg sigur', () => {
    expect(parseDecimalCents('1.005')).toBe(101)
    expect(parseDecimalCents('1,004999')).toBe(100)
    expect(parseDecimalCents('0,995')).toBe(100)
    expect(parseDecimalCents('12,5')).toBe(1250)
    expect(parseDecimalCents('12.')).toBe(1200)
    expect(parseDecimalCents('.5')).toBe(50)
    expect(parseDecimalCents('1 250,50')).toBe(125050)
    expect(parseDecimalCents('0')).toBe(0)
    expect(parseDecimalCents('  ')).toBeNull()
    for (const t of [
      '1' + '0'.repeat(307),
      '9'.repeat(400),
      '90071992547409.92',
      '-3',
      '1e3',
      'abc',
    ]) {
      expect(Number.isNaN(parseDecimalCents(t)), t.slice(0, 20)).toBe(true)
    }
    // Control pozitiv: cel mai mare întreg sigur de cenți trece.
    expect(parseDecimalCents('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('DC3 textul de pornire', () => {
    expect(priceInputText(0)).toBe('')
    expect(priceInputText(null)).toBe('')
    expect(priceInputText(32.5)).toBe('32.5')
  })
})
