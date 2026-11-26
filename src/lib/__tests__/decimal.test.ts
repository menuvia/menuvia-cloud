// Prețul tastat de om (lotul O5a, audit nov 2026 MENU-07).
//   DC1  „12,50”, „12.5”, „12.”, „7” și „ 3 ” sunt prețuri; gol = null.
//   DC2  „12.5.3”, „abc”, „-3”, „1e3” nu sunt (NaN, nu 0 tăcut).
//   DC3  câmpul pornește gol pentru 0 (produs nou), altfel cu prețul.
// Lotul C4a (aceeași regulă în opțiuni, extra-uri, stocuri, NIR, Happy Hour):
//   DC4  `parseSignedDecimalInput`: diferența de preț a unei opțiuni poate fi
//        negativă („-1,5”, „−1,5” cu semnul afișat de listă); un minus singur,
//        „--3”, „+3” sunt NaN, nu 0; „-0” e 0, nu -0. Mutația care pică: minusul
//        tratat ca NaN (o reducere legitimă n-ar mai putea fi tastată) sau
//        `parseFloat(t) || 0` readus (NaN → 0 tăcut).
//   DC5  control: fără minus, exact `parseDecimalInput` (aceleași forme valide
//        și invalide).
//   DC6  `decimalOrZero` (doar previzualizare): „2,5” → 2.5 (nu 2, ca
//        parseFloat), gol și invalid → 0. Mutația care pică: `parseFloat(t) || 0`.
import { describe, it, expect } from 'vitest'
import { decimalOrZero, parseDecimalInput, parseSignedDecimalInput, priceInputText } from '../decimal'

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

describe('parseSignedDecimalInput', () => {
  it('DC4 minusul e acceptat, restul formelor rămân stricte', () => {
    expect(parseSignedDecimalInput('-1,5')).toBe(-1.5)
    expect(parseSignedDecimalInput('−1,5')).toBe(-1.5)
    expect(parseSignedDecimalInput(' - 2 ')).toBe(-2)
    expect(parseSignedDecimalInput('4,50')).toBe(4.5)
    expect(parseSignedDecimalInput('')).toBeNull()
    expect(Object.is(parseSignedDecimalInput('-0'), 0)).toBe(true)
    for (const t of ['-', '--3', '+3', '-abc', '4,5,0', '1e3']) {
      expect(Number.isNaN(parseSignedDecimalInput(t)), t).toBe(true)
    }
  })

  it('DC5 control: fără minus, exact parseDecimalInput', () => {
    for (const t of ['12,50', '12.5', '12.', '7', ' 3 ', '', '12.5.3', 'abc', '1e3']) {
      expect(Object.is(parseSignedDecimalInput(t), parseDecimalInput(t)), t).toBe(true)
    }
  })
})

describe('decimalOrZero', () => {
  it('DC6 previzualizarea: virgula contează, gol/invalid = 0', () => {
    expect(decimalOrZero('2,5')).toBe(2.5)
    expect(decimalOrZero('4.00')).toBe(4)
    expect(decimalOrZero('')).toBe(0)
    expect(decimalOrZero('abc')).toBe(0)
    expect(decimalOrZero('-3')).toBe(0)
  })
})
