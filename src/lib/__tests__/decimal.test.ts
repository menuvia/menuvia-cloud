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
// Recenzia lotului C4a:
//   DC7  `unitCostInputText` (prețul precompletat pe NIR) păstrează precizia
//        coloanei (numeric 10,4): 0,0035 → „0.0035”, 0,006 → „0.006”, iar textul
//        trece EXACT prin `parseDecimalInput`; un cost care la 4 zecimale ar ieși
//        0 (sau 0, null, NaN, negativ) lasă câmpul GOL, ca prețul să fie cerut.
//        Mutația care pică: `toFixed(2)` (dădea „0.00” — un 0 explicit care
//        trecea de „Completează prețul unitar” — și „0.01” pentru 0,006) sau
//        `String(cost)` fără plafon (1e-7 → „1e-7”, respins de parser). Control:
//        costurile obișnuite (4, 4.5, 12.3456) ies neschimbate.
import { describe, it, expect } from 'vitest'
import {
  decimalOrZero,
  parseDecimalInput,
  parseSignedDecimalInput,
  priceInputText,
  unitCostInputText,
} from '../decimal'

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

describe('unitCostInputText', () => {
  it('DC7 precizia coloanei, fără 0 explicit precompletat', () => {
    expect(unitCostInputText(0.0035)).toBe('0.0035')
    expect(unitCostInputText(0.006)).toBe('0.006')
    expect(unitCostInputText(0.0001)).toBe('0.0001')
    for (const c of [0.0035, 0.006, 0.0001, 4, 4.5, 12.3456]) {
      expect(parseDecimalInput(unitCostInputText(c)), String(c)).toBe(c)
    }
    // Control: costurile obișnuite ies neschimbate.
    expect(unitCostInputText(4)).toBe('4')
    expect(unitCostInputText(4.5)).toBe('4.5')
    expect(unitCostInputText(12.3456)).toBe('12.3456')
    // Zgomot de virgulă mobilă: tot 4 zecimale.
    expect(unitCostInputText(0.1 + 0.2)).toBe('0.3')
    for (const c of [0, 0.00004, 1e-7, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      expect(unitCostInputText(c), String(c)).toBe('')
    }
  })
})
