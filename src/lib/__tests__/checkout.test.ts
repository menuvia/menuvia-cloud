// Teste pe traducerea răspunsurilor lui `stripe-checkout` (audit v3).
//
// Ce păzesc, în ordinea în care contează:
//   CH1  fiecare dintre cele ZECE forme de răspuns non-200 produce un mesaj —
//        clichetul central: înainte, șapte dintre ele lăsau butonul MUT;
//   CH2  niciun mesaj intern în engleză nu ajunge la client;
//   CH3  mesajele ROMÂNEȘTI scrise de server se păstrează (nu le rescriem);
//   CH4  codurile de business (409/503 cu `code`) au acțiunea corectă;
//   CH5  rețeaua căzută are mesajul ei, nu „eroare necunoscută";
//   CH6  URL-ul de redirect e validat — ajunge direct în window.location.
import { describe, it, expect } from 'vitest'
import { describeCheckoutFailure, readCheckoutUrl, CheckoutError } from '../checkout'

// Exact răspunsurile pe care le poate întoarce netlify/functions/stripe-checkout.js.
const RESPONSES: Array<{ name: string; status: number; body: unknown }> = [
  { name: '405 metodă greșită (text simplu, nu JSON)', status: 405, body: null },
  { name: '500 Stripe neconfigurat', status: 500, body: { error: 'Stripe not configured' } },
  { name: '400 corp invalid', status: 400, body: { error: 'Invalid JSON body' } },
  {
    name: '400 plan fără price ID',
    status: 400,
    body: { error: 'Plan "growth" indisponibil sau neconfigurat în Stripe' },
  },
  { name: '401 fără antet', status: 401, body: { error: 'Missing Authorization header' } },
  { name: '401 token invalid', status: 401, body: { error: 'Invalid token' } },
  {
    name: '503 rate limit indisponibil',
    status: 503,
    body: { error: 'Rate limit service unavailable' },
  },
  {
    name: '429 prea multe încercări',
    status: 429,
    body: { error: 'Prea multe încercări. Reîncearcă în câteva minute.' },
  },
  {
    name: '503 verificarea abonamentelor a picat',
    status: 503,
    body: {
      error: 'Nu am putut verifica abonamentele existente. Reîncearcă în câteva momente.',
      code: 'subscription_lookup_failed',
    },
  },
  {
    name: '409 are deja abonament',
    status: 409,
    body: {
      error: 'Ai deja un abonament. Schimbă planul din Portalul de facturare.',
      code: 'subscription_exists',
    },
  },
  {
    name: '502 Stripe a respins crearea sesiunii (RES-11)',
    status: 502,
    body: {
      error: 'Nu am putut porni plata. Reîncearcă în câteva momente.',
      code: 'checkout_create_failed',
    },
  },
]

const ENGLISH_INTERNALS = [
  'Stripe not configured',
  'Invalid JSON body',
  'Missing Authorization header',
  'Invalid token',
  'Rate limit service unavailable',
  'Method not allowed',
]

describe('describeCheckoutFailure()', () => {
  it('CH1: fiecare răspuns non-200 produce un mesaj și o acțiune', () => {
    for (const r of RESPONSES) {
      const f = describeCheckoutFailure(r.status, r.body)
      expect(f.message.length, r.name).toBeGreaterThan(10)
      expect(['retry', 'login', 'billing', 'contact'], r.name).toContain(f.action)
      expect(f.code, r.name).toBeTruthy()
    }
  })

  it('CH2: niciun mesaj intern în engleză nu ajunge la client', () => {
    for (const r of RESPONSES) {
      const { message } = describeCheckoutFailure(r.status, r.body)
      for (const internal of ENGLISH_INTERNALS) {
        expect(message, `${r.name} scurge „${internal}"`).not.toContain(internal)
      }
    }
  })

  it('CH3: mesajul românesc al serverului se păstrează', () => {
    const f = describeCheckoutFailure(429, {
      error: 'Prea multe încercări. Reîncearcă în câteva minute.',
    })
    expect(f.message).toBe('Prea multe încercări. Reîncearcă în câteva minute.')
    expect(f.code).toBe('rate_limited')

    const plan = describeCheckoutFailure(400, {
      error: 'Plan "growth" indisponibil sau neconfigurat în Stripe',
    })
    expect(plan.message).toContain('growth')
  })

  it('CH4: codurile de business duc la acțiunea potrivită', () => {
    const exists = describeCheckoutFailure(409, {
      error: 'Ai deja un abonament. Schimbă planul din Portalul de facturare.',
      code: 'subscription_exists',
    })
    expect(exists.action).toBe('billing')
    expect(exists.code).toBe('subscription_exists')

    const lookup = describeCheckoutFailure(503, {
      error: 'Nu am putut verifica abonamentele existente. Reîncearcă în câteva momente.',
      code: 'subscription_lookup_failed',
    })
    expect(lookup.action).toBe('retry')

    // 401 = sesiune expirată → îl trimitem la autentificare, nu la „reîncearcă".
    expect(describeCheckoutFailure(401, { error: 'Invalid token' }).action).toBe('login')
    // 500 „not configured" nu e reparabil de client → contact.
    expect(describeCheckoutFailure(500, { error: 'Stripe not configured' }).action).toBe('contact')
  })

  it('CH8: sesiunea respinsă de Stripe (502 `checkout_create_failed`) → mesajul serverului + retry', () => {
    const f = describeCheckoutFailure(502, {
      error: 'Nu am putut porni plata. Reîncearcă în câteva momente.',
      code: 'checkout_create_failed',
    })
    expect(f.code).toBe('checkout_create_failed')
    expect(f.action).toBe('retry')
    expect(f.message).toBe('Nu am putut porni plata. Reîncearcă în câteva momente.')
  })

  it('CH5: rețeaua căzută (status 0) are mesajul ei', () => {
    const f = describeCheckoutFailure(0, null)
    expect(f.code).toBe('network')
    expect(f.message).toMatch(/internet/i)
  })

  it('CH6: un 200 fără URL nu trece drept succes', () => {
    const f = describeCheckoutFailure(200, {})
    expect(f.code).toBe('unknown')
    expect(f.message.length).toBeGreaterThan(10)
  })

  it('CheckoutError poartă codul și acțiunea', () => {
    const err = new CheckoutError(describeCheckoutFailure(401, { error: 'Invalid token' }))
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('auth')
    expect(err.action).toBe('login')
    expect(err.message).not.toContain('Invalid token')
  })
})

describe('readCheckoutUrl()', () => {
  it('CH7: acceptă doar https absolut (valoarea ajunge în window.location)', () => {
    expect(readCheckoutUrl({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' })).toBe(
      'https://checkout.stripe.com/c/pay/cs_test_1',
    )
    expect(readCheckoutUrl({ url: 'http://evil.example/x' })).toBeNull()
    expect(readCheckoutUrl({ url: 'javascript:alert(1)' })).toBeNull()
    // `https://` gol trecea de o verificare pe prefix și putea arunca la
    // atribuirea în window.location; parsarea reală îl respinge.
    expect(readCheckoutUrl({ url: 'https://' })).toBeNull()
    expect(readCheckoutUrl({ url: 'https://?x=1' })).toBeNull()
    expect(readCheckoutUrl({ url: '/dashboard' })).toBeNull()
    expect(readCheckoutUrl({ url: '' })).toBeNull()
    expect(readCheckoutUrl({})).toBeNull()
    expect(readCheckoutUrl(null)).toBeNull()
  })
})
