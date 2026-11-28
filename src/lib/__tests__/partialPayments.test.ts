// Aritmetica plății parțiale, în cenți (lotul C2a; mig 291 cere egalitate exactă).
//   SPL1  suma registrului și restul sunt în cenți întregi: 100,10 − 50,05 =
//         5005 cenți (în lei, virgula mobilă dă 50,0499…); restul nu coboară
//         sub 0. Mutația care pică: `total − sum` în lei, sau fără `max(0, …)`.
//   SPL2  „”, „0”, „-5”, „abc” nu sunt sume de plată (gol ≠ ne-valid); „12,5”
//         e 1250. Mutația care pică: garda `cents <= 0` scoasă (0 ar pleca).
//   SPL3  față de rest: sub → ok fără acoperire, egal → acoperă restul, peste →
//         `over` cu diferența (semnalat, nu blocat); rest necunoscut → ok fără
//         acoperire. Control pozitiv: egalitatea pe cenți, nu pe lei.
//   SPL4  sumele care nu sunt ce a tastat omul nu pleacă (recenzie CodeRabbit
//         pe #392): „1 2” și „12 50” sunt ne-valide (nu 12 / 1250), „1” urmat
//         de 307 zerouri e ne-valid (nu `over` cu Infinity de cenți, deci
//         trimisibil), iar „1.005” e 101 cenți, ca `numeric(10,2)`. Mutațiile
//         care pică: spațiile șterse înainte de validare; `Math.round(n * 100)`
//         fără garda pe întregul sigur.
import { describe, it, expect } from 'vitest'
import { sumPaymentsCents, remainingCents, checkSplitAmount, centsText } from '../partialPayments'

describe('partialPayments', () => {
  it('SPL1 registrul și restul în cenți întregi', () => {
    expect(sumPaymentsCents([{ amount: 0.1 }, { amount: 0.2 }])).toBe(30)
    expect(remainingCents(100.1, [{ amount: 50.05 }])).toBe(5005)
    expect(remainingCents(50, [{ amount: 30 }, { amount: 30 }])).toBe(0)
    expect(remainingCents(80, [])).toBe(8000)
    expect(centsText(5005)).toBe('50.05')
  })

  it('SPL2 gol ≠ ne-valid; „12,5” e 1250 de cenți', () => {
    expect(checkSplitAmount('', 1000)).toEqual({ kind: 'empty' })
    expect(checkSplitAmount('  ', 1000)).toEqual({ kind: 'empty' })
    for (const bad of ['0', '0,00', '-5', 'abc', '12,5,3']) {
      expect(checkSplitAmount(bad, 1000), bad).toEqual({ kind: 'invalid' })
    }
    expect(checkSplitAmount('12,5', 10000)).toEqual({ kind: 'ok', cents: 1250, coversRest: false })
  })

  it('SPL3 față de rest: sub / egal / peste / necunoscut', () => {
    expect(checkSplitAmount('20', 5005)).toEqual({ kind: 'ok', cents: 2000, coversRest: false })
    expect(checkSplitAmount('50,05', 5005)).toEqual({ kind: 'ok', cents: 5005, coversRest: true })
    expect(checkSplitAmount('50.06', 5005)).toEqual({ kind: 'over', cents: 5006, overByCents: 1 })
    expect(checkSplitAmount('50', null)).toEqual({ kind: 'ok', cents: 5000, coversRest: false })
  })

  it('SPL4 nicio sumă pe care omul n-a tastat-o', () => {
    for (const bad of ['1 2', '12 50', '1' + '0'.repeat(307)]) {
      expect(checkSplitAmount(bad, 5000), bad.slice(0, 20)).toEqual({ kind: 'invalid' })
      expect(checkSplitAmount(bad, null), bad.slice(0, 20)).toEqual({ kind: 'invalid' })
    }
    expect(checkSplitAmount('1.005', 101)).toEqual({ kind: 'ok', cents: 101, coversRest: true })
    // Control pozitiv: separatorul de mii rămâne o sumă, iar peste rest e `over`.
    expect(checkSplitAmount('1 250', 5000)).toEqual({
      kind: 'over',
      cents: 125000,
      overByCents: 120000,
    })
  })
})
