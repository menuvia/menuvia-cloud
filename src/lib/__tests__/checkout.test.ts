// Teste pe traducerea răspunsurilor lui `stripe-checkout` (audit v3).
//
// Ce păzesc, în ordinea în care contează:
//   CH1  fiecare dintre cele NOUĂ forme de răspuns non-200 produce un mesaj —
//        clichetul central: înainte, șapte dintre ele lăsau butonul MUT;
//   CH2  niciun mesaj intern în engleză nu ajunge la client;
//   CH3  mesajele ROMÂNEȘTI scrise de server se păstrează (nu le rescriem);
//   CH4  codurile de business (409/503 cu `code`) au acțiunea corectă;
//   CH5  rețeaua căzută are mesajul ei, nu „eroare necunoscută";
//   CH6  URL-ul de redirect e validat — ajunge direct în window.location.
//
// Lotul L8d (erorile în limba personalului):
//   CH9  ROMÂNA E CEA DE DINAINTE, ramură cu ramură: fiecare (status, corp) dă
//        EXACT mesajul, codul și acțiunea de dinainte de L8d (tabelul de mai jos
//        e copiat din codul vechi), plus o `key` pe fiecare eșec.
//        [PICĂ: orice text schimbat în CHECKOUT_MESSAGES_RO; o ramură reordonată]
//   CH10 `CHECKOUT_MESSAGES_RO` == `ck_*` din ns/home/ro.ts, în ambele sensuri
//        (o singură sursă de adevăr, ca SE5 pentru `err_*`).
//        [PICĂ: un text schimbat doar într-unul din cele două locuri]
//   CH11 cu traducătorul ROMÂNESC ieșirea e identică cu cea fără traducător, pe
//        toate răspunsurile (inclusiv textul românesc al serverului).
//   CH12 cu traducător en/fr/de: mesajul e textul cheii ramurii, niciodată
//        textul românesc al serverului și niciun mesaj intern englezesc; codul
//        și acțiunea rămân aceleași. Control: textul diferă de cel românesc.
//        [PICĂ: `msg` păstrat și în altă limbă (ecran amestecat)]
//   CH13 502 `checkout_create_failed` (nou în L8d) → `retry`, cheia ei, iar în
//        română textul serverului.
//   CH14 cablajul limbii paginii Stripe: App.tsx trimite `ui_lang` în corpul
//        lui stripe-checkout, billing.ts în cel al portalului, AiSettingsTab în
//        cumpărarea de credite. [PICĂ: oricare `ui_lang` scos]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  CHECKOUT_MESSAGES_RO,
  describeCheckoutFailure,
  readCheckoutUrl,
  CheckoutError,
  type CheckoutMessageKey,
  type CheckoutTranslator,
} from '../checkout'
import { makeTranslator } from '../../i18n/core'
import homeRo from '../../i18n/ns/home/ro'
import homeEn from '../../i18n/ns/home/en'
import homeFr from '../../i18n/ns/home/fr'
import homeDe from '../../i18n/ns/home/de'

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

// ── Lotul L8d ────────────────────────────────────────────────────────────────
// Ieșirea de DINAINTE de L8d, copiată din codul vechi: (status, corp) →
// [cod, acțiune, mesaj]. Corpurile cu text românesc îl păstrează.
const LEGACY: Array<[number, unknown, string, string, string]> = [
  [409, { error: 'Ai deja un abonament. Schimbă planul din Portalul de facturare.', code: 'subscription_exists' },
    'subscription_exists', 'billing', 'Ai deja un abonament. Schimbă planul din Portalul de facturare.'],
  [409, { code: 'subscription_exists' }, 'subscription_exists', 'billing',
    'Ai deja un abonament activ. Schimbi planul din Portalul de facturare.'],
  [403, { code: 'plan_requires_quote' }, 'plan_requires_quote', 'quote',
    'Planul Fiscalizare se activează pe bază de ofertă, împreună cu instalarea pe casa ta de marcat. Cere o ofertă.'],
  [503, { code: 'subscription_lookup_failed' }, 'subscription_lookup_failed', 'retry',
    'Nu am putut verifica abonamentele existente. Reîncearcă în câteva momente.'],
  [0, null, 'network', 'retry', 'Nu am putut contacta serverul de plată. Verifică internetul și reîncearcă.'],
  [401, { error: 'Invalid token', code: 'auth_invalid' }, 'auth', 'login',
    'Sesiunea a expirat. Autentifică-te din nou și reia activarea.'],
  [429, { error: 'Prea multe încercări. Reîncearcă în câteva minute.', code: 'rate_limited' }, 'rate_limited', 'retry',
    'Prea multe încercări. Reîncearcă în câteva minute.'],
  [429, null, 'rate_limited', 'retry', 'Prea multe încercări. Reîncearcă în câteva minute.'],
  [503, { error: 'Rate limit service unavailable', code: 'rate_limit_unavailable' }, 'unavailable', 'retry',
    'Serviciu temporar indisponibil. Reîncearcă în câteva momente.'],
  [503, { error: 'Serviciu temporar indisponibil. Reîncearcă.', code: 'service_unavailable' }, 'unavailable', 'retry',
    'Serviciu temporar indisponibil. Reîncearcă.'],
  [500, { error: 'Stripe not configured', code: 'server_config' }, 'not_configured', 'contact',
    'Plata online nu e disponibilă momentan. Contactează-ne și îți activăm planul manual.'],
  [400, { error: 'Invalid JSON body', code: 'bad_json' }, 'plan_unavailable', 'contact',
    'Planul ales nu poate fi activat acum. Scrie-ne și îl activăm noi.'],
  [400, { error: 'Plan "growth" indisponibil sau neconfigurat în Stripe', code: 'plan_unavailable' }, 'plan_unavailable',
    'contact', 'Plan "growth" indisponibil sau neconfigurat în Stripe'],
  [405, null, 'unknown', 'retry', 'Nu am putut porni plata. Reîncearcă, iar dacă se repetă scrie-ne pe email.'],
  [200, {}, 'unknown', 'retry', 'Nu am putut porni plata. Reîncearcă, iar dacă se repetă scrie-ne pe email.'],
]

const KEYS = Object.keys(CHECKOUT_MESSAGES_RO) as CheckoutMessageKey[]
const roTr: CheckoutTranslator = makeTranslator(homeRo, 'ro')
const OTHER: Array<[string, CheckoutTranslator]> = [
  ['en', makeTranslator<typeof homeRo>(homeEn, 'en')],
  ['fr', makeTranslator<typeof homeRo>(homeFr, 'fr')],
  ['de', makeTranslator<typeof homeRo>(homeDe, 'de')],
]

describe('describeCheckoutFailure() — limba (lotul L8d)', () => {
  it('CH9: româna e cea de dinainte, ramură cu ramură, iar fiecare eșec are cheie', () => {
    for (const [status, body, code, action, message] of LEGACY) {
      const f = describeCheckoutFailure(status, body)
      expect({ code: f.code, action: f.action, message: f.message }, `${status} ${JSON.stringify(body)}`).toEqual({
        code,
        action,
        message,
      })
      expect(KEYS).toContain(f.key)
    }
  })

  it('CH10: CHECKOUT_MESSAGES_RO == ck_* din ns/home/ro.ts', () => {
    const fromNs = Object.fromEntries(Object.entries(homeRo).filter(([k]) => k.startsWith('ck_')))
    expect(fromNs).toEqual(CHECKOUT_MESSAGES_RO)
    expect(KEYS.length).toBeGreaterThanOrEqual(10)
  })

  it('CH11: traducătorul românesc nu schimbă nimic', () => {
    const all: Array<[number, unknown]> = [
      ...LEGACY.map(([st, b]): [number, unknown] => [st, b]),
      ...RESPONSES.map((r): [number, unknown] => [r.status, r.body]),
      [502, { error: 'Nu am putut porni plata. Reîncearcă în câteva momente.', code: 'checkout_create_failed' }],
    ]
    for (const [status, body] of all) {
      expect(describeCheckoutFailure(status, body, roTr), `${status} ${JSON.stringify(body)}`).toEqual(
        describeCheckoutFailure(status, body),
      )
    }
  })

  it('CH12: în en/fr/de textul cheii, niciodată româna serverului sau engleza internă', () => {
    for (const [lang, tr] of OTHER) {
      for (const [status, body] of LEGACY) {
        const ro = describeCheckoutFailure(status, body)
        const f = describeCheckoutFailure(status, body, tr)
        const where = `${lang} ${status} ${JSON.stringify(body)}`
        expect(f.code, where).toBe(ro.code)
        expect(f.action, where).toBe(ro.action)
        expect(f.key, where).toBe(ro.key)
        expect(f.message, where).toBe(tr.t(f.key as CheckoutMessageKey))
        // Control: textul chiar e altul decât cel românesc.
        expect(f.message, where).not.toBe(ro.message)
        expect(f.message, where).not.toMatch(/[ăâîșț]/i)
        for (const internal of ENGLISH_INTERNALS) expect(f.message, where).not.toContain(internal)
      }
    }
  })

  it('CH13: 502 checkout_create_failed → reîncercare, cheia ei, româna serverului', () => {
    const body = { error: 'Nu am putut porni plata. Reîncearcă în câteva momente.', code: 'checkout_create_failed' }
    const f = describeCheckoutFailure(502, body)
    expect(f).toEqual({
      code: 'checkout_create_failed',
      key: 'ck_createFailed',
      action: 'retry',
      message: 'Nu am putut porni plata. Reîncearcă în câteva momente.',
    })
    expect(describeCheckoutFailure(502, body, OTHER[0][1]).message).toBe(homeEn.ck_createFailed)
  })

  it('CH14: limba paginii Stripe pleacă din client', () => {
    const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')
    const app = read('src/App.tsx')
    const call = app.slice(app.indexOf("fnUrl('stripe-checkout')"), app.indexOf("fnUrl('stripe-checkout')") + 900)
    expect(call).toContain('ui_lang: uiLang')
    expect(app).toContain('const { lang: uiLang } = useUiLang()')
    expect(read('src/lib/billing.ts')).toContain('JSON.stringify(uiLang ? { ui_lang: uiLang } : {})')
    expect(read('src/components/_dashboard/SubscriptionCard.tsx')).toContain('openBillingPortal(uiLang)')
    expect(read('src/components/AiSettingsTab.tsx')).toContain('buyAiCredits({ restaurant_id: restaurantId, pack, ui_lang: uiLang })')
  })
})
