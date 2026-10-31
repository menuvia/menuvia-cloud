// Bifele ecranului final al onboarding-ului (ux-owner-final-screen). Înainte
// erau HARD-CODATE: un restaurant cu meniul și mesele sărite primea patru bife
// verzi („Meniu configurat”, „Mese și QR-uri”). Mutația care pică OS1: orice
// bifă forțată pe `done: true`.
//
//   OS1  totul sărit → doar „Restaurant creat” e bifat; meniul, mesele și QR-ul
//        oaspetelui sunt „de făcut”
//   OS2  produse + mese cu QR + plan cu comenzi → totul bifat, cu numerele reale
//   OS3  mese create fără token (inserarea QR a picat) → mesele „de făcut”, nu
//        se tipărește nimic, iar „Gata de comenzi” nu e bifat
//   OS4  „Gata de comenzi” cere un QR prin care se poate comanda: ridicarea da,
//        QR-ul general (Planul 1, fără mese) nu; și cere un meniu cu produse
//   OS5  plan fără comenzi prin QR (sau necunoscut) → „Meniu public cu QR”,
//        niciodată „Gata de comenzi”
import { describe, it, expect } from 'vitest'
import { onboardingSummary, printableTables, type TablesOutcome } from '../onboardingSummary'

const tablesWithQr: TablesOutcome = {
  kind: 'tables',
  qrOk: true,
  tables: [
    { name: 'Masa 1', token: 'tok1' },
    { name: 'Masa 2', token: 'tok2' },
  ],
}

const byKey = (items: ReturnType<typeof onboardingSummary>) =>
  Object.fromEntries(items.map((i) => [i.key, i]))

describe('onboardingSummary', () => {
  it('OS1 totul sărit: doar restaurantul e bifat', () => {
    const items = onboardingSummary({ kind: 'skipped' }, { kind: 'skipped' }, false)
    expect(items.map((i) => [i.key, i.done])).toEqual([
      ['restaurant', true],
      ['menu-empty', false],
      ['tables-skipped', false],
      ['menu-qr-ready', false],
    ])
  })

  it('OS2 produse + mese cu QR + comenzi → totul bifat, cu numerele reale', () => {
    const items = onboardingSummary({ kind: 'products', count: 12 }, tablesWithQr, true)
    expect(items.every((i) => i.done)).toBe(true)
    const k = byKey(items)
    expect(k['menu-products']?.count).toBe(12)
    expect(k['tables-qr']?.count).toBe(2)
    expect(k['orders-ready']?.done).toBe(true)
  })

  it('OS3 mese fără token: „de făcut”, nimic de tipărit, fără „Gata de comenzi”', () => {
    const noQr: TablesOutcome = {
      kind: 'tables',
      qrOk: false,
      tables: [
        { name: 'Masa 1', token: null },
        { name: 'Masa 2', token: null },
      ],
    }
    expect(printableTables(noQr)).toEqual([])
    const k = byKey(onboardingSummary({ kind: 'products', count: 1 }, noQr, true))
    expect(k['tables-no-qr']).toEqual({ key: 'tables-no-qr', done: false, count: 2 })
    expect(k['orders-ready']?.done).toBe(false)

    const partial: TablesOutcome = {
      kind: 'tables',
      qrOk: true,
      tables: [
        { name: 'Masa 1', token: 'a' },
        { name: 'Masa 2', token: null },
      ],
    }
    expect(printableTables(partial)).toEqual([{ name: 'Masa 1', token: 'a' }])
    expect(printableTables({ kind: 'pickup' })).toEqual([])
  })

  it('OS4 „Gata de comenzi” cere QR prin care se comandă și meniu cu produse', () => {
    const pickup = byKey(
      onboardingSummary({ kind: 'products', count: 3 }, { kind: 'pickup' }, true),
    )
    expect(pickup.pickup?.done).toBe(true)
    expect(pickup['orders-ready']?.done).toBe(true)

    const general = byKey(
      onboardingSummary({ kind: 'products', count: 3 }, { kind: 'general-qr' }, true),
    )
    expect(general['general-qr']?.done).toBe(true)
    expect(general['orders-ready']?.done).toBe(false)

    const emptyMenu = byKey(onboardingSummary({ kind: 'skipped' }, tablesWithQr, true))
    expect(emptyMenu['orders-ready']?.done).toBe(false)
  })

  it('OS5 fără comenzi prin QR → „Meniu public cu QR”, niciodată „Gata de comenzi”', () => {
    const items = onboardingSummary({ kind: 'products', count: 3 }, tablesWithQr, false)
    const keys = items.map((i) => i.key)
    expect(keys).toContain('menu-qr-ready')
    expect(keys).not.toContain('orders-ready')
    expect(byKey(items)['menu-qr-ready']?.done).toBe(true)
  })
})
