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
// Lotul C4a (aceeași regulă în opțiuni, extra-uri, stocuri, NIR, Happy Hour;
// ID-urile pornesc de la DC6 fiindcă DC4–DC5 sunt ale lotului C2a, #392):
//   DC6  `decimalOrZero` (doar previzualizare): „2,5” → 2.5 (nu 2, ca
//        parseFloat), gol și invalid → 0. Mutația care pică: `parseFloat(t) || 0`.
//   DC7  `unitCostInputText` (prețul precompletat pe NIR) păstrează precizia
//        coloanei (numeric 10,4): 0,0035 → „0.0035”, 0,006 → „0.006”, iar textul
//        trece EXACT prin `parseDecimalInput`; un cost care la 4 zecimale ar ieși
//        0 (sau 0, null, NaN, negativ) lasă câmpul GOL, ca prețul să fie cerut.
//        Mutația care pică: `toFixed(2)` (dădea „0.00” — un 0 explicit care
//        trecea de „Completează prețul unitar” — și „0.01” pentru 0,006) sau
//        `String(cost)` fără plafon (1e-7 → „1e-7”, respins de parser). Control:
//        costurile obișnuite (4, 4.5, 12.3456) ies neschimbate.
//   DC8  un număr prea MARE e NaN, nu `Infinity`: 309 cifre de 9 au formă de
//        preț, dar `parseFloat` le dă `Infinity`, care trecea de orice
//        `Number.isNaN` și pleca în JSON ca `null` (la plafonul Happy Hour,
//        „fără plafon”). Și cu minus, și cu zecimale; în previzualizare → 0.
//        Control: 308 cifre de 9 (încă finit) rămân număr. Mutația care pică:
//        garda `Number.isFinite` scoasă din `parseDecimalInput`.
//   DC9  `parseSignedDecimalInput`: diferența de preț a unei opțiuni poate fi
//        negativă („-1,5”, „−1,5” cu semnul afișat de listă); un minus singur,
//        „--3”, „+3” sunt NaN, nu 0; „-0” e 0, nu -0; spațiul din interior are
//        aceeași regulă ca fără minus („-1 250” = -1250, „-12 50” = NaN).
//        Mutațiile care pică: minusul tratat ca NaN (o reducere legitimă n-ar
//        mai putea fi tastată), `parseFloat(t) || 0` readus (NaN → 0 tăcut) și
//        `replace(/\s+/g, '')` readus înaintea minusului (dădea -1250 din
//        „-12 50”, ocolind regula DC4).
//   DC10 control: fără minus, exact `parseDecimalInput` (aceleași forme valide
//        și invalide, inclusiv grupele de mii din DC4).
import { describe, it, expect } from 'vitest'
import {
  decimalOrZero,
  parseDecimalCents,
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

describe('numerele prea mari (recenzia lotului C4a)', () => {
  it('DC8 Infinity e NaN, nu un număr', () => {
    const huge = '9'.repeat(309)
    expect(Number.parseFloat(huge)).toBe(Number.POSITIVE_INFINITY)
    for (const t of [huge, `${huge},5`, ` ${huge} `]) {
      expect(Number.isNaN(parseDecimalInput(t)), t.slice(0, 12)).toBe(true)
    }
    expect(Number.isNaN(parseSignedDecimalInput(`-${huge}`))).toBe(true)
    expect(Number.isNaN(parseSignedDecimalInput(huge))).toBe(true)
    expect(decimalOrZero(huge)).toBe(0)
    // Control: cel mai mare număr de aceeași formă care încă e finit.
    const big = parseDecimalInput('9'.repeat(308))
    expect(big != null && Number.isFinite(big)).toBe(true)
  })
})

describe('parseSignedDecimalInput', () => {
  it('DC9 minusul e acceptat, restul formelor rămân stricte', () => {
    expect(parseSignedDecimalInput('-1,5')).toBe(-1.5)
    expect(parseSignedDecimalInput('−1,5')).toBe(-1.5)
    expect(parseSignedDecimalInput(' - 2 ')).toBe(-2)
    expect(parseSignedDecimalInput('4,50')).toBe(4.5)
    expect(parseSignedDecimalInput('-1 250')).toBe(-1250)
    expect(parseSignedDecimalInput('− 1\u00a0250,5')).toBe(-1250.5)
    expect(parseSignedDecimalInput('')).toBeNull()
    expect(Object.is(parseSignedDecimalInput('-0'), 0)).toBe(true)
    for (const t of ['-', ' - ', '--3', '+3', '-abc', '4,5,0', '1e3', '-12 50', '-1 2', '- 4 50']) {
      expect(Number.isNaN(parseSignedDecimalInput(t)), t).toBe(true)
    }
  })

  it('DC10 control: fără minus, exact parseDecimalInput', () => {
    for (const t of [
      '12,50',
      '12.5',
      '12.',
      '7',
      ' 3 ',
      '',
      '12.5.3',
      'abc',
      '1e3',
      '1 250,50',
      '12 50',
      '1 2',
    ]) {
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
