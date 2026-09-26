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
import { describe, it, expect } from 'vitest'
import {
  EXTRA_FEATURES,
  INCLUDED_EVERYWHERE,
  PILOT_BANNER,
  PILOT_DAYS,
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
]

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

  it('PC7: trialul fără card nu promite că abonamentul „continuă” singur (RES-11)', () => {
    // stripe-checkout.js trimite `missing_payment_method: 'cancel'`: fără card la
    // final, abonamentul se ANULEAZĂ. Textul vechi spunea exact contrariul.
    expect(TRIAL_HEADLINE + ' ' + TRIAL_FAQ.a).toMatch(/fără card|nu îți cerem cardul/i)
    expect(TRIAL_FAQ.a).not.toContain('abonamentul continuă la prețul planului ales, abia atunci')
    expect(TRIAL_FAQ.a).toMatch(/se oprește singur/)
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
})
