// Planul 3 (Fiscalizare) NU se vinde self-serve (regula de aur, decizia D4).
//
// Defectul: `PricingPage` cădea pe `onCheckout('pro')` când WhatsApp era oprit
// (VITE_WHATSAPP_NUMBER lipsă), adică pe checkout-ul Stripe al Planului 3 — iar
// un abonament plătit fără casa de marcat conectată încasează fără bon.
//
//   PQ1  `isQuoteOnlyPlan`: pro și enterprise (orice casing/spații), nimic altceva
//   PQ2  planurile comerciale: EXACT cele quote-only au CTA „Cere ofertă"
//   PQ3  `quoteMailto`: mailto către adresa de contact, cu subiect și corp
//   PQ4  paritate cu serverul: lista din `stripe-checkout.js` == lista clientului
//   PQ5  sursa PricingPage: nicio cale `onCheckout('pro')`, nicio cădere pe checkout
//   PQ6  `describeCheckoutFailure(403, plan_requires_quote)` → mesaj RO + acțiunea
//        „quote" (un client vechi sau un POST direct nu rămâne mut)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  QUOTE_CTA_LABEL,
  QUOTE_ONLY_PLAN_IDS,
  isQuoteOnlyPlan,
  quoteMailto,
} from '../planCta'
import { CONTACT_EMAIL } from '../domain'
import { PLANS } from '../plans'
import { describeCheckoutFailure } from '../checkout'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')

describe('Planul 3 — fără checkout self-serve', () => {
  it('PQ1: doar pro și enterprise sunt „cu ofertă", indiferent de casing', () => {
    for (const id of ['pro', 'enterprise', 'PRO', ' Pro ', 'ENTERPRISE']) {
      expect(isQuoteOnlyPlan(id), id).toBe(true)
    }
    for (const id of ['starter', 'growth', 'free', '', 'business', 'prod']) {
      expect(isQuoteOnlyPlan(id), `„${id}"`).toBe(false)
    }
    expect([...QUOTE_ONLY_PLAN_IDS]).toEqual(['pro', 'enterprise'])
  })

  it('PQ2: planurile comerciale — exact cele quote-only au CTA „Cere ofertă"', () => {
    expect(QUOTE_CTA_LABEL).toBe('Cere ofertă')
    // Control pozitiv: Fiscalizarea chiar există între planurile afișate.
    expect(PLANS.some((p) => p.id === 'pro')).toBe(true)
    for (const p of PLANS) {
      if (isQuoteOnlyPlan(p.id)) {
        expect(p.ctaLabel, p.id).toBe(QUOTE_CTA_LABEL)
      } else {
        expect(p.ctaLabel, p.id).not.toBe(QUOTE_CTA_LABEL)
        expect(p.ctaLabel.toLowerCase(), p.id).toContain('activează')
      }
    }
  })

  it('PQ3: quoteMailto — mailto către contact, subiectul numește planul', () => {
    const href = quoteMailto('Fiscalizare')
    expect(href.startsWith(`mailto:${CONTACT_EMAIL}?`)).toBe(true)
    const q = new URLSearchParams(href.slice(href.indexOf('?') + 1))
    expect(q.get('subject')).toContain('Fiscalizare')
    expect(q.get('body')).toContain('Casa de marcat')
    // Domeniul .com nu ne aparține (D3): nicio adresă spre el.
    expect(href.toLowerCase()).not.toContain('menuvia.com')
  })

  it('PQ4: lista de pe server (stripe-checkout.js) e identică cu a clientului', () => {
    const src = read('netlify/functions/stripe-checkout.js')
    const m = /const QUOTE_ONLY_PLANS = \[([^\]]*)\]/.exec(src)
    expect(m, 'QUOTE_ONLY_PLANS lipsește din stripe-checkout.js').toBeTruthy()
    const server = (m?.[1] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
    expect(server).toEqual([...QUOTE_ONLY_PLAN_IDS])
    // Refuzul chiar e legat de listă, cu codul pe care îl mapează clientul.
    expect(src).toContain("QUOTE_ONLY_PLANS.includes(requestedPlan)")
    expect(src).toContain("code: 'plan_requires_quote'")
  })

  it('PQ5: PricingPage nu are nicio cale spre checkout pentru Fiscalizare', () => {
    const src = read('src/pages/PricingPage.tsx')
    // Fostul fallback: „Fiscalizarea e pilot — WhatsApp dacă e configurat, altfel checkout".
    expect(src).not.toMatch(/onCheckout\(\s*['"]pro['"]\s*\)/)
    expect(src).not.toMatch(/checkout\(\s*['"](pro|enterprise)['"]\s*\)/)
    expect(src).not.toContain('Fiscalizare (pilot)')
    // Poarta unică: toate drumurile spre onCheckout trec prin `checkout`, care
    // oprește planurile cu ofertă; singurul `onCheckout(` rămas e în wrapper.
    expect(src).toContain('isQuoteOnlyPlan(plan)')
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
      .join('\n')
    // În cod rămân doar apelul din hook-ul de intenție (care primește `checkout`)
    // și cel din poarta `checkout` — ambele după `isQuoteOnlyPlan`.
    const direct = code.match(/\bonCheckout\(/g) ?? []
    expect(direct.length, 'onCheckout( apelat direct în afara porții').toBe(2)
    // Linkul de ofertă e randat.
    expect(src).toContain('quoteMailto(')
  })

  it('PQ6: 403 plan_requires_quote → mesaj românesc, acțiunea „quote"', () => {
    const f = describeCheckoutFailure(403, {
      error: 'Planul Fiscalizare se activează pe bază de ofertă, împreună cu instalarea pe casa ta de marcat.',
      code: 'plan_requires_quote',
    })
    expect(f.code).toBe('plan_requires_quote')
    expect(f.action).toBe('quote')
    expect(f.message).toMatch(/ofert/i)
    // Fără mesaj de la server (corp ciudat) tot nu rămâne mut.
    const bare = describeCheckoutFailure(403, { code: 'plan_requires_quote' })
    expect(bare.action).toBe('quote')
    expect(bare.message.length).toBeGreaterThan(20)
  })
})
