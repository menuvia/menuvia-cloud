// Numerarul tastat la tură (lotul C2a): câmpul gol NU e 0 lei.
//   CSL1  „” și „   ” → empty (nicio sumă), nu 0 cenți. Mutația care pică:
//         `Number(text.replace(',', '.'))` readus (dă 0 → tura se închidea cu
//         0 lei numărați). Control pozitiv: „0” tastat explicit e 0 cenți, valid.
//   CSL2  virgula și punctul dau aceeași sumă, în cenți întregi (12,5 → 1250;
//         0,1 + 0,2 nu derivă). Mutația care pică: `parseFloat` fără înlocuirea
//         virgulei (12,5 → 12).
//   CSL3  „-5”, „12,5,3”, „abc”, „1e3” și un șir de sute de cifre sunt
//         ne-valide (nu 0, nu Infinity). Mutația care pică: garda `isFinite`
//         scoasă (Infinity trecea ca sumă).
//   CSL4  confirmarea: Z bifat → mereu; fără Z → doar peste 1 leu diferență
//         (100 de cenți la limită NU cere). Mutația care pică: `>=` în loc de
//         `>` sau Z ignorat.
//   CSL5  textul confirmării spune suma numărată, lipsa/surplusul față de
//         așteptat și că Z-ul nu se poate anula — doar când Z pleacă.
import { describe, it, expect } from 'vitest'
import {
  readCashInput,
  leiToCents,
  formatLeiCents,
  closeShiftNeedsConfirm,
  closeShiftConfirmCopy,
  CLOSE_DIFF_CONFIRM_CENTS,
} from '../cashCount'

describe('readCashInput', () => {
  it('CSL1 câmp gol = nicio sumă (nu 0); „0” explicit e valid', () => {
    expect(readCashInput('')).toEqual({ state: 'empty', cents: null })
    expect(readCashInput('   ')).toEqual({ state: 'empty', cents: null })
    // control pozitiv
    expect(readCashInput('0')).toEqual({ state: 'ok', cents: 0 })
  })

  it('CSL2 virgulă sau punct, în cenți întregi', () => {
    expect(readCashInput('12,5')).toEqual({ state: 'ok', cents: 1250 })
    expect(readCashInput('12.5')).toEqual({ state: 'ok', cents: 1250 })
    expect(readCashInput('1250,50')).toEqual({ state: 'ok', cents: 125050 })
    expect(readCashInput(' 100 ')).toEqual({ state: 'ok', cents: 10000 })
    expect(readCashInput('0,30')).toEqual({ state: 'ok', cents: 30 })
    expect(leiToCents(0.1 + 0.2)).toBe(30)
  })

  it('CSL3 forme ne-valide → invalid, fără sumă', () => {
    for (const t of ['-5', '12,5,3', 'abc', '1e3', '9'.repeat(400)]) {
      expect(readCashInput(t), t).toEqual({ state: 'invalid', cents: null })
    }
  })
})

describe('confirmarea închiderii de tură', () => {
  it('CSL4 Z bifat → confirmare; fără Z doar peste 1 leu', () => {
    expect(CLOSE_DIFF_CONFIRM_CENTS).toBe(100)
    expect(closeShiftNeedsConfirm(0, true)).toBe(true)
    expect(closeShiftNeedsConfirm(0, false)).toBe(false)
    expect(closeShiftNeedsConfirm(100, false)).toBe(false)
    expect(closeShiftNeedsConfirm(-100, false)).toBe(false)
    expect(closeShiftNeedsConfirm(101, false)).toBe(true)
    expect(closeShiftNeedsConfirm(-101, false)).toBe(true)
  })

  it('CSL5 textul: suma numărată, lipsa față de așteptat, Z-ul ireversibil', () => {
    const withZ = closeShiftConfirmCopy(0, 125050, true)
    expect(withZ.title).toBe('Închizi tura cu 0,00 lei numărați?')
    expect(withZ.description).toContain('Așteptat în sertar: 1250,50 lei — lipsă 1250,50 lei.')
    expect(withZ.description).toContain('Raportul Z se tipărește la casa de marcat și nu se poate anula.')
    expect(withZ.confirmLabel).toBe('Închide tura')

    const surplus = closeShiftConfirmCopy(15000, 12000, false)
    expect(surplus.description).toContain('surplus 30,00 lei')
    // fără Z, nu se promite (nici nu se amenință cu) un raport Z
    expect(surplus.description).not.toContain('Raportul Z')
    expect(surplus.description).toContain('nu se mai poate redeschide')

    expect(closeShiftConfirmCopy(500, 500, true).description).toContain('exact cât era așteptat')
    expect(formatLeiCents(125050)).toBe('1250,50 lei')
  })
})
