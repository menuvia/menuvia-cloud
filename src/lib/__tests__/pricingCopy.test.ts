// Teste pe afirmațiile comerciale de pe pagina de prețuri (audit v3, RES-35).
//
// Cele patru contradicții găsite pe același ecran erau invizibile pentru orice
// test fiindcă erau text în JSX. Acum sunt DATE, iar fiecare invariant e
// încrucișat cu sursa de adevăr (PLANS / PLAN_COMPARISON):
//   PC1  nicio promisiune de backup — „Backup zilnic" a stat pe pagină luni
//        întregi, în timp ce workflow-ul de backup nu producea niciun artefact;
//   PC2  niciun preț fantomă: „+99 lei/lună" nu putea fi facturat, fiindcă
//        există exact patru price ID-uri, unul per plan, niciun addon;
//   PC3  promisiunea de trial numește planurile care chiar îl primesc, nu
//        „orice plan" (Fiscalizarea nici nu trece prin Stripe);
//   PC4  oferta pilot spune EXPLICIT că înlocuiește trialul, nu se adună;
//   PC5  un card nu poate spune „în curând" despre o funcție pe care tabelul
//        comparativ o listează ca livrată.
//   PC7  copy contractual fals interzis ca CLASĂ (oct 2026): „garanție",
//        schimbare de plan „instant", „per restaurant … nu per cont",
//        „modificările de preț … doar la noi clienți" — contrazise de
//        Termenii §4.4/§4.6/§15.2 sau de plan_limits.max_restaurants;
//   PC8  FAQ-ul de facturare spune „per cont" și numără locațiile din limite;
//   PC9  sursa PricingPage nu mai conține FAQ-urile contractuale ca literal
//        (altfel o copie în JSX ar ocoli PC7);
//   PC10 MarketingFooter nu mai trimite la SOL/ODR (desființat), ci la SAL.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  BILLING_SCOPE_FAQ,
  EXTRA_FEATURES,
  INCLUDED_EVERYWHERE,
  PILOT_BANNER,
  PILOT_DAYS,
  PLAN_CHANGE_FAQ,
  PRICE_GUARANTEE_FAQ,
  TRIAL_DAYS,
  TRIAL_FAQ,
  TRIAL_HEADLINE,
  TRIAL_PLAN_IDS,
  comparisonRowFor,
  includedPriceLabel,
} from '../pricingCopy'
import { PLANS, TRUST_SIGNALS, getPlan } from '../plans'

const ALL_COPY = [
  TRIAL_HEADLINE,
  TRIAL_FAQ.q,
  TRIAL_FAQ.a,
  PILOT_BANNER.title,
  PILOT_BANNER.body,
  ...INCLUDED_EVERYWHERE,
  ...EXTRA_FEATURES.flatMap((f) => [f.title, f.price, f.plans, f.desc]),
  // Semnalele de încredere sunt pe ACEEAȘI pagină, deci intră în aceleași
  // invariante — altfel promisiunea scoasă din headline supraviețuia acolo.
  ...TRUST_SIGNALS.flatMap((t) => [t.label, t.desc]),
  ...[PLAN_CHANGE_FAQ, BILLING_SCOPE_FAQ, PRICE_GUARANTEE_FAQ].flatMap((f) => [f.q, f.a]),
]

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const readSrc = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')

describe('copy-ul de pe pagina de prețuri', () => {
  it('PC1: nu promite backup — nu avem cum să-l dovedim', () => {
    for (const text of ALL_COPY) {
      expect(text.toLowerCase(), `promisiune de backup în „${text}"`).not.toContain('backup')
    }
  })

  it('PC2: niciun preț pe care Stripe nu-l poate factura', () => {
    const realPrices = PLANS.map((p) => String(p.priceMonthly))
    for (const f of EXTRA_FEATURES) {
      // Un addon facturabil ar cere price ID propriu în Stripe; azi nu există.
      expect(f.price, `„${f.price}" arată ca un addon lunar`).not.toMatch(/^\+/)
      const isIncluded = PLANS.some((p) => f.price === includedPriceLabel(p.id))
      const isRealPrice = realPrices.some((v) => f.price.includes(v))
      expect(isIncluded || isRealPrice, `preț fantomă: „${f.price}"`).toBe(true)
    }
  })

  it('PC3: trialul numește planurile care chiar îl primesc', () => {
    expect(TRIAL_HEADLINE).not.toMatch(/orice plan/i)
    expect(TRIAL_HEADLINE).toContain(String(TRIAL_DAYS))
    // Fiscalizarea are CTA de WhatsApp (pilot), deci nu primește trial Stripe.
    expect(TRIAL_PLAN_IDS).not.toContain('pro')
    expect(TRIAL_PLAN_IDS.length).toBeGreaterThan(0)
    for (const id of TRIAL_PLAN_IDS) {
      expect(TRIAL_HEADLINE, `planul ${id} lipsește din promisiune`).toContain(getPlan(id).name)
    }
  })

  it('PC4: oferta pilot spune că înlocuiește trialul', () => {
    expect(PILOT_BANNER.title).toContain(String(PILOT_DAYS))
    // Fără referința la cele 30 de zile, cele două oferte se contrazic.
    expect(PILOT_BANNER.title + PILOT_BANNER.body).toContain(String(TRIAL_DAYS))
  })

  it('PC6: orice număr de zile gratuite de pe pagină e unul real', () => {
    // `TRUST_SIGNALS` ține „30 zile gratuite" ca literal, în alt fișier decât
    // TRIAL_DAYS: fără asta, o schimbare a trialului ar lăsa badge-ul mințind.
    // Singurele valori legitime sunt trialul și oferta pilot.
    for (const text of ALL_COPY) {
      const m = /(\d+)\s*(?:de\s*)?zile\s+gratuit/i.exec(text)
      if (!m) continue
      expect([TRIAL_DAYS, PILOT_DAYS], `„${text}" promite un număr de zile inventat`).toContain(
        Number(m[1]),
      )
    }
  })

  it('PC5: niciun card nu contrazice tabelul comparativ', () => {
    for (const f of EXTRA_FEATURES) {
      const row = comparisonRowFor(f)
      expect(row, `„${f.comparisonLabel}" nu există în PLAN_COMPARISON`).toBeTruthy()
      // Livrat pe Fiscalizare în tabel → cardul nu are voie să-l amâne.
      if (row && row.pro !== false) {
        const text = `${f.title} ${f.price} ${f.desc}`.toLowerCase()
        expect(text, `„${f.title}" e livrat în tabel dar amânat pe card`).not.toContain('în curând')
        expect(text, `„${f.title}" e livrat în tabel dar amânat pe card`).not.toContain(
          'în dezvoltare',
        )
      }
    }
  })

  it('PC7: niciun text contractual fals (garanție, instant, per restaurant)', () => {
    const FALSE_CLAIMS: ReadonlyArray<{ re: RegExp; why: string }> = [
      { re: /garanți[ae]/i, why: 'Termenii §4.4: sumele achitate nu se rambursează' },
      { re: /instant/i, why: 'Termenii §4.6: downgrade de la următoarea perioadă' },
      { re: /per restaurant/i, why: 'planul e pe cont (profiles.plan, max_restaurants)' },
      { re: /nu per cont/i, why: 'planul e pe cont' },
      { re: /doar la noi clienți/i, why: 'Termenii §15.2: preaviz, se aplică și actualilor' },
    ]
    // Control pozitiv: copy-ul chiar conține FAQ-urile contractuale.
    expect(ALL_COPY).toContain(PLAN_CHANGE_FAQ.a)
    for (const text of ALL_COPY) {
      // Întrebarea „per restaurant sau per cont?" e legitimă; contează răspunsul.
      if (text === BILLING_SCOPE_FAQ.q) continue
      for (const { re, why } of FALSE_CLAIMS) {
        expect(text, `„${text}" — ${why}`).not.toMatch(re)
      }
    }
  })

  it('PC8: facturarea e per cont, cu locațiile din limitele reale', () => {
    expect(BILLING_SCOPE_FAQ.a).toMatch(/^Per cont/)
    expect(getPlan('pro').limits.maxRestaurants).toBe(2)
    expect(BILLING_SCOPE_FAQ.a).toContain(`${getPlan('pro').name} include două locații`)
    expect(PLAN_CHANGE_FAQ.a).toMatch(/următoarea perioadă de facturare/)
    expect(PRICE_GUARANTEE_FAQ.a).toMatch(/30 de zile înainte/)
  })

  it('PC9: PricingPage nu ține copy contractual ca literal în JSX', () => {
    const src = readSrc('src/pages/PricingPage.tsx')
    // Control pozitiv: pagina chiar folosește datele.
    for (const name of ['PLAN_CHANGE_FAQ', 'BILLING_SCOPE_FAQ', 'PRICE_GUARANTEE_FAQ']) {
      expect(src).toContain(name)
    }
    const LITERALS = [/downgrade instant/i, /'Per restaurant\./, /doar la noi clienți/i, /zile garanție/i]
    for (const re of LITERALS) {
      expect(src, `copy contractual fals în PricingPage: ${re}`).not.toMatch(re)
    }
  })

  it('PC10: MarketingFooter trimite la SAL, nu la SOL/ODR (desființat)', () => {
    const src = readSrc('src/components/marketing/MarketingFooter.tsx')
    expect(src).toContain("href: 'https://anpc.ro/ce-este-sal/'")
    expect(src).not.toMatch(/href:\s*['"][^'"]*consumers\/odr/)
    expect(src).not.toMatch(/label:\s*['"]SOL['"]/)
  })
})
