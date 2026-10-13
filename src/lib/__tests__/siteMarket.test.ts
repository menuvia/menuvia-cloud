// Ce se vinde pe fiecare site — lib/siteMarket.ts.
//   SM1  pe .ro lista de planuri și tabelul comparativ sunt IDENTICE cu sursa
//        (clichet „.ro nu se schimbă": aceleași obiecte, aceeași ordine)
//   SM2  pe .com: doar starter/growth, fără rândurile care sunt `false` pe
//        ambele (fiscal, plăți, facturi, hartă) — dar CU rândurile comune
//   SM3  checkout deschis doar pe .ro; motivul de pe .com e explicit și duce
//        la contact
//   SM4  FAQ: pe .ro lista INTACTĂ (aceleași obiecte); pe .com fără nicio
//        întrebare care pomenește Planul 3 / fiscalizarea / casa de marcat,
//        dar CU întrebările neutre (facturare, schimbarea planului, preț)
//   SM5  extra-uri cu plată: pe .ro intacte; pe .com nimic cu preț în lei/RON
import { describe, it, expect } from 'vitest'
import { PLANS, PLAN_COMPARISON } from '../plans'
import { PLAN_LABELS } from '../constants'
import {
  BILLING_SCOPE_FAQ,
  EXTRA_FEATURES,
  PLAN_CHANGE_FAQ,
  PRICE_GUARANTEE_FAQ,
  TRIAL_FAQ,
} from '../pricingCopy'
import {
  SITE_PLAN_IDS,
  checkoutOpenOnSite,
  comparisonRowsForSite,
  extrasForSite,
  faqForSite,
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

// Reprezentative pentru FAQ-ul și extra-urile scrise inline în PricingPage
// (constantele exportate + intrări cu forma celor din pagină).
const FAQ_SAMPLE = [
  TRIAL_FAQ,
  {
    q: 'Care plan e potrivit pentru mine?',
    a: 'Meniu Digital dacă vrei doar un meniu. Fiscalizare dacă vrei plăți și bon fiscal.',
  },
  PLAN_CHANGE_FAQ,
  BILLING_SCOPE_FAQ,
  {
    q: 'E nevoie de hardware special sau de casă de marcat?',
    a: 'Integrarea cu casa de marcat e inclusă în planul Fiscalizare.',
  },
  PRICE_GUARANTEE_FAQ,
  { q: 'Sunteți pe piață de mult?', a: 'Suntem o echipă mică din România.' },
]
const ONETIME_SAMPLE = [
  { title: 'Setup Concierge', price: '300 lei' },
  { title: 'Import meniu profesional', price: '150 lei' },
  { title: 'Design personalizat', price: '300 lei' },
  { title: 'QR-uri printate premium', price: '100 lei' },
  { title: 'Ceva în RON', price: '99 RON' },
]

describe('siteMarket — copy de prețuri pe .com', () => {
  it('SM4: FAQ — .ro intact, .com fără Plan 3', () => {
    const ro = faqForSite('ro', FAQ_SAMPLE)
    expect(ro).toEqual(FAQ_SAMPLE)
    ro.forEach((f, i) => expect(f).toBe(FAQ_SAMPLE[i]))

    const com = faqForSite('com', FAQ_SAMPLE)
    const text = com.map((f) => `${f.q} ${f.a}`).join('\n')
    expect(text).not.toMatch(new RegExp(PLAN_LABELS.pro, 'i'))
    expect(text).not.toMatch(/fiscal|cas[ăa] de marcat/i)
    expect(text).not.toMatch(/\blei\b|\bRON\b/)
    // Întrebările neutre rămân (anti-vacuitate: un filtru care scoate tot ar trece altfel).
    expect(com).toContain(PLAN_CHANGE_FAQ)
    expect(com).toContain(PRICE_GUARANTEE_FAQ)
    // BILLING_SCOPE_FAQ numește Fiscalizarea (locațiile Planului 3) → cade pe .com.
    expect(com).not.toContain(BILLING_SCOPE_FAQ)
    // „abonament" conține subșirul „bon" — nu are voie să declanșeze filtrul.
    const neutral = { q: 'Cum anulez abonamentul?', a: 'Din Portalul de facturare.' }
    expect(faqForSite('com', [neutral])).toEqual([neutral])
  })

  it('SM5: extra-uri — .ro intacte, .com fără prețuri în lei/RON', () => {
    const ro = extrasForSite('ro', ONETIME_SAMPLE)
    expect(ro).toEqual(ONETIME_SAMPLE)
    expect(extrasForSite('ro', EXTRA_FEATURES)).toEqual([...EXTRA_FEATURES])

    const com = extrasForSite('com', ONETIME_SAMPLE)
    expect(com.map((e) => e.price).join(' ')).not.toMatch(/\blei\b|\bRON\b/i)
    expect(com).toEqual([])
    // Un preț ne-RON trece (filtrul e pe monedă, nu „scoate tot").
    expect(extrasForSite('com', [{ price: 'Included' }])).toEqual([{ price: 'Included' }])
  })
})
