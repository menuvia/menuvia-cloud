// Ce se vinde pe fiecare site — lib/siteMarket.ts.
//   SM1  pe .ro lista de planuri și tabelul comparativ sunt IDENTICE cu sursa
//        (clichet „.ro nu se schimbă": aceleași obiecte, aceeași ordine)
//   SM2  pe .com: doar starter/growth, fără rândurile care sunt `false` pe
//        ambele (fiscal, plăți, facturi, hartă) — dar CU rândurile comune
//   SM3  checkout deschis doar pe .ro; motivul de pe .com e explicit și duce
//        la contact
import { describe, it, expect } from 'vitest'
import { PLANS, PLAN_COMPARISON } from '../plans'
import {
  SITE_PLAN_IDS,
  checkoutOpenOnSite,
  comparisonRowsForSite,
  plansForSite,
  siteCheckoutClosedFailure,
} from '../siteMarket'

describe('siteMarket', () => {
  it('SM1: pe .ro pagina de prețuri vede exact lista de azi', () => {
    const ro = plansForSite('ro', PLANS)
    expect(ro).toEqual(PLANS)
    expect(ro.map((p) => p.id)).toEqual(['starter', 'growth', 'pro'])
    ro.forEach((p, i) => expect(p).toBe(PLANS[i]))
    const rows = comparisonRowsForSite('ro', PLAN_COMPARISON)
    expect(rows).toEqual(PLAN_COMPARISON)
    expect(rows.length).toBe(PLAN_COMPARISON.length)
    expect([...SITE_PLAN_IDS.ro]).toEqual(['starter', 'growth', 'pro'])
  })

  it('SM2: pe .com doar Planurile 1–2, fără rândurile exclusiv fiscale', () => {
    expect(plansForSite('com', PLANS).map((p) => p.id)).toEqual(['starter', 'growth'])
    const rows = comparisonRowsForSite('com', PLAN_COMPARISON)
    const labels = rows.map((r) => r.label)
    expect(labels).not.toContain('Bon fiscal + casă de marcat')
    expect(labels).not.toContain('Plăți în aplicație')
    expect(labels).not.toContain('Facturi Oblio')
    expect(labels).toContain('Comenzi prin QR')
    expect(labels).toContain('Produse în meniu')
    for (const r of rows) {
      expect(r.starter !== false || r.growth !== false).toBe(true)
    }
    // Fiecare rând scos e într-adevăr `false` pe ambele planuri vândute.
    for (const r of PLAN_COMPARISON.filter((x) => !labels.includes(x.label))) {
      expect(r.starter).toBe(false)
      expect(r.growth).toBe(false)
    }
  })

  it('SM3: checkout doar pe .ro; pe .com motiv explicit cu acțiune de contact', () => {
    expect(checkoutOpenOnSite('ro')).toBe(true)
    expect(checkoutOpenOnSite('com')).toBe(false)
    const f = siteCheckoutClosedFailure()
    expect(f.code).toBe('site_checkout_unavailable')
    expect(f.action).toBe('contact')
    expect(f.message).toMatch(/coming soon/i)
  })
})
