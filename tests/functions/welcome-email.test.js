// tests/functions/welcome-email.test.js
// Emailul de bun venit în limba funnel-ului (lotul L8a).
//
//   WE1  fără `lang`, cu 'ro' sau cu o valoare necunoscută → subiectul și
//        HTML-ul sunt BYTE-identice cu șablonul de dinainte (copiat literal),
//        cu și fără nume, cu un nume care cere escapare.
//        [PICĂ: o literă schimbată în `signup_welcome.ro`]
//   WE2  `lang: 'en'` → subiect și corp în engleză, fără ă/ș/ț și fără
//        frazele românești.
//   WE3  din activarea limbilor (FUNNEL_LANGS are toate patru, EL5 leagă
//        lista de src/i18n/langs.ts): 'fr'/'de' → subiectul și salutul lor,
//        fără resturi românești; o limbă din afara celor patru ('it') →
//        BYTE-ul românesc de dinainte.
//        [PICĂ: franceza/germana căzute pe română; gate-ul scos pe 'it']
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { resetMocks, loadFunction } = require('./helpers/mocks')
const { LEGACY_NETLIFY_URL } = require('../../netlify/functions/lib/appUrl')

const REL = 'netlify/functions/welcome-email.js'
const ENV = ['RESEND_API_KEY', 'WEBHOOK_SECRET', 'VITE_APP_URL']

// Șablonul de DINAINTE (git show 30a6400:netlify/functions/welcome-email.js),
// copiat literal; `name` e deja escapat (esc-ul local al funcției).
function legacyWelcome(name, dashboardUrl) {
  return {
    subject: 'Bun venit la Menuvia',
    html: `
        <div style="font-family:'DM Sans',sans-serif;max-width:520px;margin:0 auto;background:#0F0F0F;border-radius:16px;padding:40px;color:#F0EAE0;">
          <div style="font-family:Georgia,serif;font-size:24px;color:#C8963C;margin-bottom:24px;">Menuvia</div>
          <h2 style="font-family:Georgia,serif;font-size:20px;color:#F0EAE0;margin-bottom:12px;">Bun venit${name ? `, ${name}` : ''}!</h2>
          <p style="color:#9A9590;line-height:1.6;margin-bottom:16px;">Contul tău Menuvia a fost creat cu succes.</p>
          <p style="color:#9A9590;line-height:1.6;margin-bottom:24px;">Acum poți să-ți digitalizezi meniul, să primești comenzi de pe telefoanele clienților și să urmărești tot ce se întâmplă în restaurant în timp real.</p>
          <a href="${dashboardUrl}" style="display:inline-block;background:#C8963C;color:#000;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;margin-bottom:24px;">Mergi la dashboard</a>
          <p style="color:#4A4844;font-size:12px;">Ai întrebări? Răspunde la acest email.</p>
        </div>
      `,
  }
}

let saved
let savedFetch
let sent
beforeEach(() => {
  resetMocks()
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
  Object.assign(process.env, { RESEND_API_KEY: 're_test', WEBHOOK_SECRET: 'whsec_test' })
  savedFetch = global.fetch
  sent = []
  global.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body))
    return { ok: true, status: 200, text: async () => '' }
  }
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  global.fetch = savedFetch
})

async function send(body) {
  const { handler } = loadFunction(REL)
  const res = await handler({ httpMethod: 'POST', headers: { 'x-webhook-secret': 'whsec_test' }, body: JSON.stringify(body) })
  assert.equal(res.statusCode, 200, res.body)
  return sent[sent.length - 1]
}

describe('welcome-email: limba funnel-ului', () => {
  const DASH = `${LEGACY_NETLIFY_URL}/dashboard`

  for (const lang of [undefined, 'ro', 'xx', 'RO-ro', 42]) {
    it(`WE1: lang=${JSON.stringify(lang)} → româna de dinainte, byte cu byte`, async () => {
      const withName = await send({ email: 'n@x.test', name: "  Ion & <Pop>\"  ", ...(lang === undefined ? {} : { lang }) })
      const want = legacyWelcome('Ion &amp; &lt;Pop&gt;&quot;', DASH)
      assert.equal(withName.subject, want.subject)
      assert.equal(withName.html, want.html)
      const anon = await send({ email: 'n@x.test', ...(lang === undefined ? {} : { lang }) })
      assert.equal(anon.html, legacyWelcome('', DASH).html)
    })
  }

  it('WE2: lang=en → engleza, fără resturi românești', async () => {
    const r = await send({ email: 'n@x.test', name: 'Anna', lang: 'en' })
    assert.equal(r.subject, 'Welcome to Menuvia')
    assert.ok(r.html.includes('Welcome, Anna!'))
    assert.ok(r.html.includes('Go to the dashboard'))
    assert.ok(r.html.includes(`href="${DASH}"`))
    assert.ok(!/[ăâîșțĂÂÎȘȚ]/.test(r.html + r.subject))
    for (const ro of ['Bun venit', 'Contul tău', 'Mergi la', 'Ai întrebări']) assert.ok(!r.html.includes(ro), ro)
  })

  for (const [lang, subject, hello] of [
    ['fr', 'Bienvenue sur Menuvia', 'Bienvenue, Anna !'],
    ['de', 'Willkommen bei Menuvia', 'Willkommen, Anna!'],
  ]) {
    it(`WE3: lang=${lang} → limba funnel-ului, fără resturi românești`, async () => {
      const r = await send({ email: 'n@x.test', name: 'Anna', lang })
      assert.equal(r.subject, subject)
      assert.ok(r.html.includes(hello), r.html)
      assert.ok(r.html.includes(`href="${DASH}"`))
      for (const ro of ['Bun venit', 'Contul tău', 'Mergi la', 'Ai întrebări']) assert.ok(!r.html.includes(ro), ro)
    })
  }

  it('WE3: lang=it (în afara celor patru) → româna de dinainte', async () => {
    const r = await send({ email: 'n@x.test', name: 'Anna', lang: 'it' })
    assert.equal(r.subject, 'Bun venit la Menuvia')
    assert.equal(r.html, legacyWelcome('Anna', DASH).html)
  })
})
