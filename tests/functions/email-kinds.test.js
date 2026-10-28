// tests/functions/email-kinds.test.js
// Enumul email_template_kind ↔ șabloanele din process-email-queue.js (mig 299).
//
// De ce există: un tip de email adăugat în enum FĂRĂ șablon nu dă nicio eroare
// la scriere — rândul intră în coadă, worker-ul îl amână 24h („Unknown
// template") și apoi îl marchează `failed`, tăcut. Iar un șablon cu o cheie
// scrisă greșit (`affiliate_payout_send`) nu e folosit NICIODATĂ, tot tăcut.
//
//   EK1  fiecare valoare a enumului (create type din mig 039 + TOATE
//        `alter type … add value` din lanț) are șablon; anti-vacuitate: parserul
//        vede enumul creat o singură dată, ≥ 31 de valori, cele 8 din mig 299;
//        tipurile de cerere (affiliate_application_*) NU există — rețeaua e pe
//        invitație.
//   EK1b fiecare șablon corespunde unei valori din enum (cheie scrisă greșit =
//        șablon mort).
//   EK2  cele 8 șabloane noi se randează cu `{}` (fără throw, fără „undefined"/
//        „NaN"/„[object Object]", subiect fără caractere de control) și FIECARE
//        câmp de text din contract ajunge în HTML ESCAPAT — control pozitiv:
//        markerul escapat TREBUIE să apară, altfel câmpul nici nu e randat.
//   EK3  raportul de luni pune „Ce te așteaptă pe tine" PRIMUL, randează doar
//        secțiunile prezente și numără corect în subiect.
//   EK4  linkurile: doar căi relative pe APP_URL; URL absolut / „//" /
//        „javascript:" / backslash cad pe calea implicită.
//   EK5  formatarea: bani din subunități în ro-RO, luna, săptămâna ISO, ziua
//        în Europe/Bucharest (21:30Z pe 4 sept = 5 sept).
//   EK6  cablajul real: un rând `agent_client_at_risk` revendicat trece prin
//        handler, pleacă la Resend și e marcat `sent` (nu „Unknown template").
//   EK7  Resend 401/403 = CONFIGURAȚIE, nu destinatar: rândul revine în
//        'queued' fără încercare consumată și fără scheduled_for mutat (sonda
//        de coadă din /health îl vede îmbătrânind), restul lotului NU se mai
//        trimite; control: 422/400 (destinatar respins) marchează tot `failed`.
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).

'use strict'

const { describe, it, before, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { state, resetMocks, loadFunction } = require('./helpers/mocks')

const ROOT = path.join(__dirname, '..', '..')
const REL = 'netlify/functions/process-email-queue.js'
const ABS = path.join(ROOT, REL)
const APP = 'https://app.example'

const NEW_KINDS = [
  'agent_client_at_risk',
  'affiliate_new_client',
  'partner_access_requested',
  'affiliate_payout_statement',
  'affiliate_payout_sent',
  'affiliate_payout_blocked',
  'founder_weekly_digest',
  'founder_alert',
]
// Scoase DELIBERAT din 299 (rețea doar pe invitație; redenumire în decont).
const GONE_KINDS = ['affiliate_application_received', 'affiliate_application_decided', 'affiliate_invoice_requested']

// APP_URL e citit la ÎNCĂRCAREA modulului → setat înainte, cache golit.
let TEMPLATES
let savedAppUrl
before(() => {
  savedAppUrl = process.env.APP_URL
  process.env.APP_URL = APP
  delete require.cache[require.resolve(ABS)]
  TEMPLATES = loadFunction(REL).TEMPLATES
  if (savedAppUrl === undefined) delete process.env.APP_URL
  else process.env.APP_URL = savedAppUrl
})

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

function enumFromMigrations() {
  const dir = path.join(ROOT, 'supabase', 'migrations')
  const values = new Set()
  let creates = 0
  let files = 0
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    files++
    const sql = stripSqlComments(fs.readFileSync(path.join(dir, f), 'utf8'))
    for (const m of sql.matchAll(/create\s+type\s+(?:public\.)?email_template_kind\s+as\s+enum\s*\(([^)]*)\)/gi)) {
      creates++
      for (const v of m[1].matchAll(/'([^']+)'/g)) values.add(v[1])
    }
    for (const m of sql.matchAll(
      /alter\s+type\s+(?:public\.)?email_template_kind\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/gi,
    )) {
      values.add(m[1])
    }
    // Parserul nu știe rename/drop: o asemenea migrație trebuie să-l învețe,
    // nu să treacă pe lângă el.
    if (/alter\s+type\s+(?:public\.)?email_template_kind\s+(?:rename|drop)/i.test(sql)) {
      throw new Error(`${f}: rename/drop pe email_template_kind — actualizează parserul EK1`)
    }
  }
  return { values, creates, files }
}

// ── EK1 / EK1b ───────────────────────────────────────────────────────────────
describe('EK1: fiecare valoare din email_template_kind are șablon', () => {
  it('anti-vacuitate: parserul vede lanțul de migrații', () => {
    const { values, creates, files } = enumFromMigrations()
    assert.ok(files > 250, `doar ${files} migrații citite`)
    assert.equal(creates, 1, 'enumul trebuie creat exact o dată (mig 039)')
    assert.ok(values.size >= 31, `doar ${values.size} valori găsite`)
    for (const k of ['welcome', 'custom', 'reservation_cancelled', ...NEW_KINDS]) {
      assert.ok(values.has(k), `valoarea ${k} lipsește din parsare`)
    }
  })

  it('tipurile scoase din 299 (cereri de agent, factura cerută) NU există — nici în enum, nici ca șablon', () => {
    const { values } = enumFromMigrations()
    for (const k of GONE_KINDS) {
      assert.ok(!values.has(k), `${k} a reapărut în enum`)
      assert.equal(TEMPLATES[k], undefined, `${k} are încă șablon`)
    }
  })

  it('EK1: enum ⊆ TEMPLATES', () => {
    const { values } = enumFromMigrations()
    const missing = [...values].filter((v) => typeof TEMPLATES[v] !== 'function')
    assert.deepEqual(missing, [], `valori de enum FĂRĂ șablon (rândurile ar pica tăcut după 24h): ${missing}`)
  })

  it('EK1b: TEMPLATES ⊆ enum (o cheie scrisă greșit e un șablon mort)', () => {
    const { values } = enumFromMigrations()
    const orphans = Object.keys(TEMPLATES).filter((k) => !values.has(k))
    assert.deepEqual(orphans, [], `șabloane fără valoare de enum: ${orphans}`)
  })
})

// ── EK2 ──────────────────────────────────────────────────────────────────────
// Fiecare câmp de TEXT din contract, cu forma de date care îl face randat.
const XSS = (field) => `<script>alert('${field}')</script>`
const ESCAPED = (field) => `&lt;script&gt;alert(&#39;${field}&#39;)&lt;/script&gt;`

const FIELD_CASES = {
  agent_client_at_risk: [
    ['restaurant_name', (v) => ({ restaurant_name: v, score: 30 })],
    ['city', (v) => ({ restaurant_name: 'R', city: v })],
    ['agent_name', (v) => ({ agent_name: v })],
  ],
  affiliate_new_client: [
    ['restaurant_name', (v) => ({ restaurant_name: v, source: 'link' })],
    ['agent_name', (v) => ({ agent_name: v })],
  ],
  partner_access_requested: [
    ['agent_display_name', (v) => ({ agent_display_name: v })],
    ['restaurant_name', (v) => ({ restaurant_name: v })],
    ['owner_name', (v) => ({ owner_name: v })],
  ],
  affiliate_payout_statement: [
    ['company_name', (v) => ({ invoice_required: true, menuvia_billing: { company_name: v, cui: 'RO1', address: 'A' } })],
    ['cui', (v) => ({ invoice_required: true, menuvia_billing: { company_name: 'M', cui: v, address: 'A' } })],
    ['address', (v) => ({ invoice_required: true, menuvia_billing: { company_name: 'M', cui: 'RO1', address: v } })],
    ['due_hint', (v) => ({ invoice_required: true, due_hint: v })],
    ['affiliate_name', (v) => ({ affiliate_name: v })],
  ],
  affiliate_payout_sent: [
    ['transfer_reference', (v) => ({ amount_cents: 100, transfer_reference: v })],
    ['affiliate_name', (v) => ({ affiliate_name: v })],
  ],
  affiliate_payout_blocked: [
    ['reason_code', (v) => ({ reason_code: v })],
    ['affiliate_name', (v) => ({ affiliate_name: v })],
  ],
  founder_weekly_digest: [
    ['needs_you.label', (v) => ({ needs_you: [{ kind: 'k', label: v, count: 1 }] })],
    ['needs_you.kind', (v) => ({ needs_you: [{ kind: v, count: 1 }] })],
    ['needs_you[string]', (v) => ({ needs_you: [v] })],
    ['risks.label', (v) => ({ risks: [{ kind: 'k', label: v }] })],
    // Cheia unui obiect: doar șiruri (JSON) — exclusă din cazurile null/obiect.
    ['payouts_by_status.key', (v) => ({ money: { payouts_by_status: { [v]: 2 } } }), 'key'],
  ],
  founder_alert: [
    ['title', (v) => ({ title: v })],
    ['details', (v) => ({ title: 'T', details: v })],
    ['kind', (v) => ({ kind: v })],
  ],
}

function assertClean(kind, r, label) {
  assert.equal(typeof r.subject, 'string', `${kind}${label}: subiect lipsă`)
  assert.ok(r.subject.trim().length > 0, `${kind}${label}: subiect gol`)
  assert.ok(!/[\u0000-\u001f\u007f]/.test(r.subject), `${kind}${label}: caractere de control în subiect`)
  assert.equal(typeof r.html, 'string', `${kind}${label}: html lipsă`)
  assert.ok(r.html.length > 100, `${kind}${label}: html prea scurt`)
  for (const bad of ['undefined', 'NaN', '[object Object]']) {
    assert.ok(!r.subject.includes(bad), `${kind}${label}: „${bad}" în subiect: ${r.subject}`)
    assert.ok(!r.html.includes(bad), `${kind}${label}: „${bad}" în html`)
  }
}

describe('EK2: șabloanele noi — randare cu {} și escaparea fiecărui câmp', () => {
  it('fiecare tip nou are cazuri de câmp (testul nu poate rămâne în urmă)', () => {
    assert.deepEqual(Object.keys(FIELD_CASES).sort(), [...NEW_KINDS].sort())
  })

  for (const kind of NEW_KINDS) {
    it(`${kind}: se randează cu {} și cu null-uri, fără valori-gunoi`, () => {
      assertClean(kind, TEMPLATES[kind]({}), '({})')
      const valueCases = FIELD_CASES[kind].filter(([, , tag]) => tag !== 'key')
      const nulls = {}
      for (const [, mk] of valueCases) Object.assign(nulls, mk(null))
      assertClean(kind, TEMPLATES[kind](nulls), '(null)')
      // Tipuri greșite (număr/obiect/array) în câmpurile de text → text de rezervă.
      for (const junkValue of [{ x: 1 }, 42, ['a']]) {
        const junk = {}
        for (const [, mk] of valueCases) Object.assign(junk, mk(junkValue))
        assertClean(kind, TEMPLATES[kind](junk), `(${JSON.stringify(junkValue)})`)
      }
    })

    for (const [field, mk] of FIELD_CASES[kind]) {
      it(`${kind}.${field}: escapat în HTML (control pozitiv: e randat)`, () => {
        const r = TEMPLATES[kind](mk(XSS(field)))
        assert.ok(!r.html.includes('<script>'), `${kind}.${field}: <script> NEESCAPAT în html`)
        assert.ok(r.html.includes(ESCAPED(field)), `${kind}.${field}: câmpul nu apare (escapat) în html`)
        assert.ok(!/[\u0000-\u001f\u007f]/.test(r.subject))
      })
    }
  }

  it('subiectul e text simplu: „&" rămâne „&", CR/LF scoase', () => {
    const r = TEMPLATES.agent_client_at_risk({ restaurant_name: 'Ion & Maria\r\nBcc: x@y.z' })
    assert.ok(r.subject.includes('Ion & Maria'), r.subject)
    assert.ok(!r.subject.includes('&amp;'))
    assert.ok(!/[\r\n]/.test(r.subject))
    assert.ok(r.html.includes('Ion &amp; Maria'))
  })

  it('agent_client_at_risk nu are câmpuri de patron: owner_* din date NU ajung în email', () => {
    const r = TEMPLATES.agent_client_at_risk({
      restaurant_name: 'R',
      owner_name: 'PATRON_NUME',
      owner_email: 'patron@x.test',
      owner_phone: '0722000000',
    })
    for (const s of ['PATRON_NUME', 'patron@x.test', '0722000000']) {
      assert.ok(!r.html.includes(s) && !r.subject.includes(s), `${s} a ajuns în email`)
    }
  })

  it('affiliate_payout_statement: datele Menuvia doar COMPLETE; altfel trimitere la panou', () => {
    const billing = { company_name: 'MENUVIA SRL', cui: 'RO123', address: 'Str. X 1' }
    const full = TEMPLATES.affiliate_payout_statement({ invoice_required: true, menuvia_billing: billing }).html
    assert.ok(full.includes('MENUVIA SRL') && full.includes('RO123') && full.includes('Str. X 1'))
    const partial = TEMPLATES.affiliate_payout_statement({
      invoice_required: true,
      menuvia_billing: { company_name: 'MENUVIA SRL' },
    }).html
    assert.ok(!partial.includes('MENUVIA SRL'), 'date de facturare afișate PARȚIAL')
    assert.ok(partial.includes('le găsești în panou'))
  })

  it('affiliate_payout_statement: factură cerută / autofacturare / necunoscut — trei variante', () => {
    const billing = { company_name: 'MENUVIA SRL', cui: 'RO123', address: 'Str. X 1' }
    const base = { period: '2026-10', amount_cents: 24900, menuvia_billing: billing, due_hint: 'până pe 10' }
    const inv = TEMPLATES.affiliate_payout_statement({ ...base, invoice_required: true })
    assert.ok(inv.html.includes('Încarcă factura') && inv.html.includes('MENUVIA SRL'))
    assert.ok(!inv.html.includes('autofacturare'))
    assert.match(inv.subject, /Încarcă factura/)
    // Autofacturare: NU se cere nimic și NU se afișează datele Menuvia, chiar dacă vin.
    const self = TEMPLATES.affiliate_payout_statement({ ...base, invoice_required: false })
    assert.ok(self.html.includes('autofacturare') && self.html.includes('nu trebuie să încarci nimic'))
    assert.ok(!self.html.includes('Încarcă factura') && !self.html.includes('MENUVIA SRL'))
    assert.ok(!self.html.includes('până pe 10'))
    assert.match(self.subject, /Decontul comisionului din octombrie 2026: 249,00 lei/)
    // Necunoscut ('true' șir, lipsă): nici cerere de factură, nici promisiunea autofacturării.
    for (const v of ['true', undefined, 1]) {
      const unk = TEMPLATES.affiliate_payout_statement({ ...base, invoice_required: v }).html
      assert.ok(!unk.includes('Încarcă factura') && !unk.includes('autofacturare'), String(v))
      assert.ok(unk.includes('Detaliile despre factură le găsești în panou'))
    }
  })

  it('founder_alert: detaliile își păstrează rândurile; codul apare ca referință', () => {
    const r = TEMPLATES.founder_alert({
      kind: 'payout_on_hold',
      title: 'Plată blocată 3 zile',
      details: 'linia 1\nlinia 2',
      action_url: '/founder?tab=plati',
    })
    assert.match(r.subject, /^🚨 Plată blocată 3 zile$/)
    assert.ok(r.html.includes('white-space:pre-wrap') && r.html.includes('linia 1\nlinia 2'))
    assert.ok(r.html.includes('payout_on_hold'))
    assert.ok(r.html.includes(`href="${APP}/founder?tab=plati"`))
  })

  it('affiliate_payout_blocked: cod cunoscut → explicație; cod necunoscut → generic + cod', () => {
    const known = TEMPLATES.affiliate_payout_blocked({ reason_code: 'stripe_onboarding_incomplete' }).html
    assert.ok(known.includes('finalizează verificarea în Stripe'))
    const unknown = TEMPLATES.affiliate_payout_blocked({ reason_code: 'zzz_nou' }).html
    assert.ok(unknown.includes('zzz_nou') && unknown.includes('detaliile sunt în panou'))
    // Cheile de prototip nu sunt „coduri cunoscute".
    const proto = TEMPLATES.affiliate_payout_blocked({ reason_code: 'toString' }).html
    assert.ok(proto.includes('detaliile sunt în panou'))
  })
})

// ── EK3 ──────────────────────────────────────────────────────────────────────
describe('EK3: raportul de luni — „Ce te așteaptă pe tine" primul', () => {
  const full = {
    week: '2026-W43',
    network: { heads: 3, agents: 12, pending_old: 2 },
    sales: { new_attributions: 5, first_paid: 1, attributed_mrr_cents: 24900, organic_mrr_cents: 0 },
    money: {
      accrued_cents: 123456,
      clawback_cents: 2490,
      payable_cents: 100000,
      payouts_by_status: { paid: { count: 4, amount_cents: 50000 }, failed: 1 },
    },
    risks: [{ kind: 'critical_no_agent', label: 'Restaurante critice fără agent', count: 2, url: '/founder' }],
    system: { emails_failed: 0, stripe_events_failed: 3 },
    needs_you: [
      { kind: 'payout_on_hold', label: 'Plăți în așteptare manuală', count: 2, url: '/founder?tab=plati' },
      { kind: 'heads_pending', label: 'Șefi de aprobat', count: 3, url: '/founder' },
    ],
  }

  it('needs_you vine înaintea TUTUROR celorlalte secțiuni (indiferent de ordinea cheilor)', () => {
    const html = TEMPLATES.founder_weekly_digest(full).html
    const pos = (k) => html.indexOf(`data-digest="${k}"`)
    assert.ok(pos('needs_you') > 0, 'secțiunea needs_you lipsește')
    for (const k of ['network', 'sales', 'money', 'risks', 'system']) {
      assert.ok(pos(k) > 0, `secțiunea ${k} lipsește`)
      assert.ok(pos('needs_you') < pos(k), `needs_you NU e înaintea secțiunii ${k}`)
    }
    // Primul <h2> din email e chiar titlul secțiunii needs_you.
    assert.ok(html.indexOf('<h2') > pos('needs_you'))
    assert.match(html.slice(html.indexOf('<h2')), /^<h2[^>]*>Ce te așteaptă pe tine/)
  })

  it('subiectul numără elementele din needs_you (suma count-urilor)', () => {
    const r = TEMPLATES.founder_weekly_digest(full)
    assert.match(r.subject, /5 lucruri te așteaptă/)
    assert.match(r.subject, /săptămâna 43/)
    const one = TEMPLATES.founder_weekly_digest({ needs_you: [{ label: 'x', count: 1 }] })
    assert.match(one.subject, /1 lucru te așteaptă/)
  })

  it('needs_you gol → „Nimic nu te așteaptă"; needs_you absent → secțiunea lipsește', () => {
    const empty = TEMPLATES.founder_weekly_digest({ needs_you: [] })
    assert.match(empty.subject, /nimic nu te așteaptă/)
    assert.ok(empty.html.includes('Nimic nu te așteaptă săptămâna asta.'))
    const absent = TEMPLATES.founder_weekly_digest({ system: { emails_failed: 1 } })
    assert.ok(!absent.html.includes('data-digest="needs_you"'))
    assert.ok(absent.html.includes('data-digest="system"'))
    for (const k of ['network', 'sales', 'money', 'risks']) {
      assert.ok(!absent.html.includes(`data-digest="${k}"`), `secțiunea ${k} randată fără date`)
    }
  })

  it('banii, stările plăților și alarmele roșii', () => {
    const html = TEMPLATES.founder_weekly_digest(full).html
    assert.ok(html.includes('1.234,56 lei'), 'accrued_cents formatat greșit')
    assert.ok(html.includes('249,00 lei'), 'MRR formatat greșit')
    assert.ok(html.includes('Plăți: plătite') && html.includes('500,00 lei'))
    assert.ok(html.includes('Plăți: eșuate'))
    assert.ok(html.includes(`href="${APP}/founder?tab=plati"`), 'linkul din needs_you')
  })
})

// ── EK4 ──────────────────────────────────────────────────────────────────────
describe('EK4: linkurile pleacă DOAR pe APP_URL', () => {
  const LINKS = [
    ['agent_client_at_risk', 'panel_url', '/afiliat'],
    ['affiliate_new_client', 'panel_url', '/afiliat'],
    ['partner_access_requested', 'approve_url', '/dashboard?tab=settings'],
    ['affiliate_payout_statement', 'upload_url', '/afiliat', { invoice_required: true }],
    ['affiliate_payout_statement', 'panel_url', '/afiliat', { invoice_required: false }],
    ['founder_alert', 'action_url', '/founder'],
    ['affiliate_payout_sent', 'panel_url', '/afiliat'],
    ['affiliate_payout_blocked', 'action_url', '/afiliat'],
  ]
  const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])

  for (const [kind, key, dflt, base = {}] of LINKS) {
    it(`${kind}.${key}: implicit, cale relativă, valori străine respinse`, () => {
      const esc = (s) => s.replace(/&/g, '&amp;')
      assert.ok(hrefs(TEMPLATES[kind]({ ...base }).html).includes(esc(`${APP}${dflt}`)), 'calea implicită')
      const rel = TEMPLATES[kind]({ ...base, [key]: '/afiliat?tab=plati&x=1' }).html
      assert.ok(hrefs(rel).includes(`${APP}/afiliat?tab=plati&amp;x=1`), 'calea relativă trimisă de producător')
      for (const bad of [
        'https://evil.example/x',
        '//evil.example/x',
        'javascript:alert(1)',
        '/\\evil.example',
        ' /afiliat',
        'evil.example',
        42,
        { url: '/x' },
      ]) {
        const html = TEMPLATES[kind]({ ...base, [key]: bad }).html
        assert.ok(!html.includes('evil.example'), `${JSON.stringify(bad)} a ajuns în email`)
        assert.ok(!html.includes('javascript:'))
        for (const h of hrefs(html)) assert.ok(h.startsWith(`${APP}/`), `link în afara APP_URL: ${h}`)
      }
    })
  }

  it('digest: url-urile din needs_you/risks trec prin aceeași poartă', () => {
    const html = TEMPLATES.founder_weekly_digest({
      needs_you: [{ label: 'a', url: 'https://evil.example' }],
      risks: [{ label: 'b', url: '//evil.example' }],
    }).html
    assert.ok(!html.includes('evil.example'))
    for (const h of hrefs(html)) assert.ok(h.startsWith(`${APP}/`), h)
  })
})

// ── EK5 ──────────────────────────────────────────────────────────────────────
describe('EK5: formatarea (bani, lună, săptămână ISO, fus orar)', () => {
  it('bani în subunități, RON → lei, altă monedă → codul ei; gunoi → fără sumă', () => {
    assert.ok(TEMPLATES.affiliate_payout_sent({ amount_cents: 123456 }).html.includes('1.234,56 lei'))
    assert.ok(TEMPLATES.affiliate_payout_sent({ amount_cents: '5000', currency: 'eur' }).html.includes('50,00 EUR'))
    assert.ok(TEMPLATES.affiliate_payout_sent({ amount_cents: 100, currency: 'x<y' }).html.includes('1,00 lei'))
    const junk = TEMPLATES.affiliate_payout_sent({ amount_cents: 12.5 })
    assert.ok(!junk.subject.includes(':') || !/\d/.test(junk.subject.split(':').pop()))
    assert.ok(!junk.html.includes('0,13'), 'o sumă ne-întreagă de subunități a fost afișată')
  })

  it("period 'YYYY-MM' → luna în română; invalid → omis", () => {
    assert.ok(TEMPLATES.affiliate_payout_statement({ period: '2026-10' }).html.includes('octombrie 2026'))
    const bad = TEMPLATES.affiliate_payout_statement({ period: '2026-13' })
    assert.ok(!bad.html.includes('2026-13') && !bad.subject.includes('2026-13'))
  })

  it("week 'YYYY-Www' → intervalul luni–duminică (ISO 8601)", () => {
    assert.match(TEMPLATES.founder_weekly_digest({ week: '2026-W43' }).subject, /săptămâna 43 \(19–25 octombrie 2026\)/)
    assert.match(
      TEMPLATES.founder_weekly_digest({ week: '2026-W44' }).subject,
      /săptămâna 44 \(26 octombrie – 1 noiembrie 2026\)/,
    )
    // 2021-W01 începe pe 4 ianuarie 2021 (1 ian 2021 e vineri, în 2020-W53).
    assert.match(TEMPLATES.founder_weekly_digest({ week: '2021-W01' }).subject, /\(4–10 ianuarie 2021\)/)
  })

  it('occurred_at în Europe/Bucharest: 21:30Z pe 4 sept = 5 septembrie, 00:30', () => {
    const html = TEMPLATES.founder_alert({ title: 'T', occurred_at: '2026-09-04T21:30:00Z' }).html
    assert.ok(html.includes('5 septembrie'), html)
    assert.ok(html.includes('00:30'))
    assert.ok(!html.includes('4 septembrie'))
  })

  it('scorul: 0–100 afișat ca X/100; în afara intervalului → fără cifră', () => {
    assert.ok(TEMPLATES.agent_client_at_risk({ score: 32, trend: 'critical' }).html.includes('32/100'))
    assert.ok(TEMPLATES.agent_client_at_risk({ score: 32, trend: 'critical' }).html.includes('trend: critic'))
    const bad = TEMPLATES.agent_client_at_risk({ score: 900 }).html
    assert.ok(!bad.includes('900') && bad.includes('zona critică'))
  })
})

// ── EK6 ──────────────────────────────────────────────────────────────────────
describe('EK6: cablajul real prin handler', () => {
  const saved = {}
  let savedFetch
  let resend = []
  let resendStatus = 200
  beforeEach(() => {
    resetMocks()
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY']) saved[k] = process.env[k]
    Object.assign(process.env, {
      SUPABASE_URL: 'https://sb.example',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      RESEND_API_KEY: 're_test',
    })
    savedFetch = global.fetch
    resend = []
    resendStatus = 200
    global.fetch = async (url, init) => {
      resend.push({ url, body: JSON.parse(init.body) })
      const st = resendStatus
      return {
        ok: st >= 200 && st < 300,
        status: st,
        headers: { get: () => null },
        json: async () => ({ id: 'em_1' }),
        text: async () => (st === 200 ? '' : `{"statusCode":${st},"message":"x"}`),
      }
    }
  })
  afterEach(() => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    global.fetch = savedFetch
  })

  it('agent_client_at_risk revendicat → Resend + status sent', async () => {
    const { handler } = loadFunction(REL)
    state.rpcHandlers['claim_email_batch'] = () => ({
      data: [
        {
          id: 'e1',
          template_kind: 'agent_client_at_risk',
          template_data: { restaurant_name: 'Bistro Ana', city: 'Cluj', score: 31, trend: 'critical' },
          recipient_email: 'agent@x.test',
          failed_attempts: 0,
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    })
    const updates = []
    state.fromHandlers['email_queue'] = (ops) => {
      const u = ops.find((o) => o.m === 'update')
      if (u) updates.push(u.args[0])
      return { data: null, error: null }
    }
    const res = await handler({})
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(JSON.parse(res.body), { processed: 1, sent: 1, failed: 0, authFailures: 0, released: 0 })
    assert.equal(resend.length, 1)
    assert.deepEqual(resend[0].body.to, ['agent@x.test'])
    assert.match(resend[0].body.subject, /Bistro Ana/)
    assert.ok(resend[0].body.html.includes('31/100'))
    assert.ok(updates.some((u) => u.status === 'sent'))
    assert.ok(!updates.some((u) => String(u.last_error || '').includes('Unknown template')))
  })

  // ── EK7: 401/403 = configurație, nu destinatar ───────────────────────────
  function claimRows(n) {
    state.rpcHandlers['claim_email_batch'] = () => ({
      data: Array.from({ length: n }, (_, i) => ({
        id: `e${i + 1}`,
        template_kind: 'welcome',
        template_data: { owner_name: 'Ion' },
        recipient_email: `r${i + 1}@x.test`,
        failed_attempts: 1,
        created_at: new Date().toISOString(),
      })),
      error: null,
    })
    const updates = []
    state.fromHandlers['email_queue'] = (ops) => {
      const u = ops.find((o) => o.m === 'update')
      const id = ops.find((o) => o.m === 'eq')
      if (u) updates.push({ id: id && id.args[1], ...u.args[0] })
      return { data: null, error: null }
    }
    return updates
  }

  for (const st of [401, 403]) {
    it(`EK7: Resend ${st} → rândul revine 'queued' NEATINS, restul lotului nu se trimite`, async () => {
      const { handler } = loadFunction(REL)
      const updates = claimRows(3)
      resendStatus = st
      const errs = []
      const savedErr = console.error
      console.error = (...a) => errs.push(a.join(' '))
      let res
      try {
        res = await handler({})
      } finally {
        console.error = savedErr
      }
      assert.equal(res.statusCode, 200, res.body)
      assert.deepEqual(JSON.parse(res.body), { processed: 3, sent: 0, failed: 0, authFailures: 1, released: 3 })
      assert.equal(resend.length, 1, 'după primul 401/403 nu se mai cheamă Resend pentru restul lotului')
      assert.deepEqual(updates.map((u) => u.id).sort(), ['e1', 'e2', 'e3'])
      for (const u of updates) {
        assert.equal(u.status, 'queued', `${u.id}: ${u.status}`)
        assert.equal(u.claimed_at, null)
        assert.ok(!('failed_attempts' in u), `${u.id}: încercare consumată pe o eroare de configurare`)
        assert.ok(!('scheduled_for' in u), `${u.id}: scheduled_for mutat — sonda de coadă n-ar mai vedea vechimea`)
        assert.match(u.last_error, /^CONFIG Resend/)
      }
      assert.ok(errs.some((e) => e.includes('EROARE DE CONFIGURARE')), 'lipsește logul clar de configurare')
    })
  }

  for (const st of [422, 400]) {
    it(`EK7 control: Resend ${st} (destinatar/payload respins) → rândul e marcat failed`, async () => {
      const { handler } = loadFunction(REL)
      const updates = claimRows(2)
      resendStatus = st
      const res = await handler({})
      assert.deepEqual(JSON.parse(res.body), { processed: 2, sent: 0, failed: 2, authFailures: 0, released: 0 })
      assert.equal(resend.length, 2, 'o eroare de destinatar NU oprește lotul')
      for (const u of updates) {
        assert.equal(u.status, 'failed')
        assert.equal(u.failed_attempts, 2)
      }
    })
  }
})
