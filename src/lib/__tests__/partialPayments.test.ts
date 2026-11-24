// Aritmetica plății parțiale, în cenți (lotul C2a; mig 291 cere egalitate exactă).
//   SPL1  suma registrului și restul sunt în cenți întregi: 100,10 − 50,05 =
//         5005 cenți (în lei, virgula mobilă dă 50,0499…); restul nu coboară
//         sub 0. Mutația care pică: `total − sum` în lei, sau fără `max(0, …)`.
//   SPL2  „”, „0”, „-5”, „abc” nu sunt sume de plată (gol ≠ ne-valid); „12,5”
//         e 1250. Mutația care pică: garda `cents <= 0` scoasă (0 ar pleca).
//   SPL3  față de rest: sub → ok fără acoperire, egal → acoperă restul, peste →
//         `over` cu diferența (semnalat, nu blocat); rest necunoscut → ok fără
//         acoperire. Control pozitiv: egalitatea pe cenți, nu pe lei.
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
})
