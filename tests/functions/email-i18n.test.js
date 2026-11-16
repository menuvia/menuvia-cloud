// tests/functions/email-i18n.test.js
// Emailurile în limba destinatarului (lotul L8a): textele, rezolvarea limbii,
// orele pe fusul localului. Oracolul pe română e în email-legacy-oracle.test.js.
//
//   EL1  completitudine: pentru fiecare tabel și fiecare limbă a audienței lui
//        (personal 4, oaspete 7, invitație 4, bun-venit 4, COMMON 7): EXACT
//        cheile românei, același set de placeholdere `{x}` per cheie, aceleași
//        etichete HTML per cheie, șiruri nevide.
//        [PICĂ: o cheie ștearsă din `de`; un placeholder redenumit în `fr`; un
//         `</b>` pierdut într-o limbă]
//   EL2  fără resturi românești: fiecare kind tradus, randat în fiecare limbă
//        ≠ ro (fixturi ASCII, inclusiv ramurile FĂRĂ nume și raportul zilnic
//        fără comparație — ASCII_CASES_ANON), nu conține ă/ș/ț și niciun cuvânt (≥ 4 litere)
//        din randarea ROMÂNĂ a aceloași date — în afara valorilor din fixturi și
//        a unei liste scurte de cuvinte identice, fiecare cu motiv; fiecare
//        intrare din listă e chiar folosită (registru onest); control sintetic:
//        „Persoane” injectat într-o copie a tabelei `en` e semnalat.
//        Anti-vacuitate pe ramuri: fiecare cheie engleză (cel mai lung segment
//        literal) apare în cel puțin o randare.
//        [PICĂ: o etichetă lăsată în română în codul șablonului, de ex.
//         „Persoane” scris direct în reservation_reminder; `intro_anon` din
//         milestone_100_orders, salutul fără nume din payment_failed sau
//         `no_data` din daily_report luate din tabela 'ro'; o cheie nouă pe
//         care nicio fixtură nu o randează]
//   EL3  ore pe fusul localului (instante fixe, fusul prin ctx): 22:30Z →
//        „marți, 17 noiembrie · 00:30” pe București, „Monday 16 November ·
//        17:30” pe New York, „Montag, 16. November · 23:30” pe Berlin;
//        „mâine”/„today” în reminder față de același `now`; ziua raportului
//        zilnic e aceeași pe orice fus; perioada săptămânii începe pe 9.
//        Reminderul și cu ceasul la 22:30Z (00:30 în București): „ACUM” se
//        judecă tot pe ziua localului → „astăzi”. Procentul de evoluție are
//        separatorul zecimal al limbii („23,5 %” în de/fr; „23.5” în ro/en).
//        [PICĂ: ctx.timeZone ignorat (București fix) → cazul New York; ziua
//         rezervării comparată pe UTC → „astăzi”; ziua lui „ACUM” pe UTC
//         (`toISOString().slice(0, 10)` sau `zonedYmd(now, 'UTC')`) → „mâine”
//         la 22:30Z; procentul inserat brut → „23.5 %” în de/fr]
//   EL4  rezolvarea limbii: personal doar pe limbile ACTIVE, oaspete pe cele 7,
//        funnel pe ro/en, invitație invitat > invitator > ro.
//        [PICĂ: gate-ul scos; ordinea invitației inversată]
//   EL5  oglinzi: STAFF/ENABLED/FUNNEL == src/i18n/langs.ts; GUEST_LANGS ==
//        CHECK-ul din mig 298 == MENU_LANGS; LOCALES (4) == DEFAULT_LOCALE din
//        src/i18n/format.ts. Anti-vacuitate: fiecare parser vede 'ro'.
//        [PICĂ: 'en' activat în langs.ts fără oglindă]
//   EL6  registrul de audiență: chei == TEMPLATES; fiecare 'ro' cu motiv; fiecare
//        kind tradus are texte în toate limbile audienței; un kind 'ro' NU are
//        texte (fără traduceri moarte); fus operațional EXACT pe rezervări.
//        [PICĂ: un kind mutat pe 'staff' fără texte; texte pentru welcome]
//   EL7  rezervele coapte în SQL („Stimate patron”/„Stimate utilizator”) nu
//        ajung în en/fr/de — salutul generic; în română rămân.
//        [PICĂ: tratarea scoasă din ownerName]
//   EL8  escaparea în toate limbile: `<script>&'` din date apare escapat,
//        niciodată brut (control: markerul escapat e prezent).
//        [PICĂ: o valoare dată lui `fill` neescapată]
//   EL9  o limbă incompletă cade ÎNTREG pe engleză (niciun șir din limba
//        incompletă), fără throw.
//        [PICĂ: fallback cheie cu cheie]
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadFunction } = require('./helpers/mocks')
const F = require('./fixtures/email-fixtures')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const lang = require('../../netlify/functions/lib/emailLang')
const fmt = require('../../netlify/functions/lib/emailFormat')
const strings = require('../../netlify/functions/lib/emailStrings')

let Q // process-email-queue
let INVITE
let WELCOME
before(() => {
  process.env.APP_URL = F.APP
  delete require.cache[require.resolve('../../netlify/functions/process-email-queue.js')]
  Q = loadFunction('netlify/functions/process-email-queue.js')
  delete process.env.APP_URL
  INVITE = loadFunction('netlify/functions/send-invite.js')
  WELCOME = loadFunction('netlify/functions/welcome-email.js')
})

const NOW = Date.parse(F.NOW)
const ctxFor = (l, timeZone = 'Europe/Bucharest') =>
  fmt.makeCtx({ lang: l, locale: lang.emailLocale(l, null), timeZone, now: NOW })

const STAFF_KINDS = () => Object.keys(Q.EMAIL_AUDIENCE).filter((k) => Q.EMAIL_AUDIENCE[k].audience === 'staff')
const TRANSLATED = () => Object.keys(Q.EMAIL_AUDIENCE).filter((k) => Q.EMAIL_AUDIENCE[k].audience !== 'ro')
const audienceLangs = (k) => (Q.EMAIL_AUDIENCE[k].audience === 'guest' ? lang.GUEST_LANGS : lang.STAFF_LANGS)

const placeholders = (s) => [...s.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).sort()
const tags = (s) => [...s.matchAll(/<\/?([a-z0-9]+)\b/gi)].map((m) => m[0].toLowerCase()).sort()

// ── EL1 ──────────────────────────────────────────────────────────────────────
describe('EL1: fiecare limbă a fiecărui tabel e completă și paralelă cu româna', () => {
  const tables = () => {
    const t = []
    for (const k of TRANSLATED()) t.push([k, strings.EMAIL_STRINGS[k], audienceLangs(k)])
    t.push(['team_invite', strings.EMAIL_STRINGS.team_invite, lang.STAFF_LANGS])
    t.push(['signup_welcome', strings.EMAIL_STRINGS.signup_welcome, lang.STAFF_LANGS])
    t.push(['COMMON', strings.COMMON, lang.GUEST_LANGS])
    return t
  }

  it('anti-vacuitate: 14 kind-uri traduse + 2 trimiteri directe + COMMON', () => {
    assert.equal(TRANSLATED().length, 14)
    assert.equal(tables().length, 17)
  })

  it('chei, placeholdere, etichete HTML identice; șiruri nevide', () => {
    for (const [name, table, langs] of tables()) {
      assert.ok(table && table.ro, `${name}: fără română`)
      const roKeys = Object.keys(table.ro).sort()
      assert.ok(roKeys.length > 0)
      // Doar limbile audienței (un tabel de personal nu are it/hu/es).
      assert.deepEqual(Object.keys(table).sort(), [...langs].sort(), `${name}: limbi`)
      for (const l of langs) {
        const t = table[l]
        assert.deepEqual(Object.keys(t).sort(), roKeys, `${name}.${l}: chei diferite de română`)
        for (const k of roKeys) {
          assert.equal(typeof t[k], 'string', `${name}.${l}.${k}`)
          assert.ok(t[k].trim().length > 0, `${name}.${l}.${k}: gol`)
          assert.deepEqual(placeholders(t[k]), placeholders(table.ro[k]), `${name}.${l}.${k}: placeholdere`)
          assert.deepEqual(tags(t[k]), tags(table.ro[k]), `${name}.${l}.${k}: etichete HTML`)
        }
      }
    }
  })
})

// ── EL2 ──────────────────────────────────────────────────────────────────────
// Cuvinte identice în română și în altă limbă — nu sunt resturi netraduse.
const SAME_WORDS = {
  menuvia: 'numele produsului',
  radu: 'semnătura fondatorului (aceeași în toate limbile)',
  whatsapp: 'numele serviciului',
  dashboard: 'termenul panoului în engleză; româna îl folosește la fel',
  restaurant: 'cuvânt identic în en/fr/de',
  reminder: 'subiectul românesc folosește cuvântul englezesc',
  card: 'româna folosește cuvântul englezesc',
  online: 'româna folosește cuvântul englezesc',
  feature: 'româna folosește cuvântul englezesc („o feature”)',
  roadmap: 'româna folosește cuvântul englezesc („în roadmap”)',
  confirm: 'româna „confirm-o” are aceeași rădăcină cu verbul englezesc',
  email: 'româna folosește cuvântul englezesc',
  total: 'cuvânt identic în en/fr',
  client: 'cuvânt identic în franceză',
  manager: 'numele rolului, identic în toate limbile panoului (ns/invite)',
  stop: 'comanda literală „stop daily” la care răspunde fondatorul',
  daily: 'comanda literală „stop daily” la care răspunde fondatorul',
  data: 'italiană: „Data e ora” = cuvântul românesc',
}

function textOf(r) {
  const html = r.html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39);/g, ' ')
  return `${r.subject} ${html}`
}
const words = (s) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter((w) => w.length >= 4),
  )
const EXCLUDED = new Set([...words(Object.values(F.ASCII).join(' ')), 'burger', 'window', 'seat'])

function renderAll(l) {
  const out = []
  for (const [kind, data] of Object.entries(F.ASCII_CASES)) out.push([kind, Q.renderEmail(kind, data, ctxFor(l))])
  for (const [kind, data] of Object.entries(F.ASCII_CASES_ALT)) out.push([`${kind}#alt`, Q.renderEmail(kind, data, ctxFor(l))])
  for (const [kind, data] of Object.entries(F.ASCII_CASES_ANON)) out.push([`${kind}#anon`, Q.renderEmail(kind, data, ctxFor(l))])
  const inv = { restaurantName: F.ASCII.rest, invitedByName: F.ASCII.owner, acceptUrl: `${F.APP}/invite/t` }
  for (const role of ['manager', 'waiter', 'kitchen']) {
    out.push([`team_invite#${role}`, INVITE.renderInviteEmail(lang.STAFF_LANGS.includes(l) ? l : 'ro', { ...inv, roleKey: role })])
  }
  out.push(['signup_welcome', WELCOME.renderWelcomeEmail(lang.STAFF_LANGS.includes(l) ? l : 'ro', { name: F.ASCII.owner, dashboardUrl: `${F.APP}/dashboard` })])
  out.push(['signup_welcome#anon', WELCOME.renderWelcomeEmail(lang.STAFF_LANGS.includes(l) ? l : 'ro', { name: '', dashboardUrl: `${F.APP}/dashboard` })])
  return out
}

function leftovers(roOut, otherOut) {
  const found = []
  for (let i = 0; i < roOut.length; i++) {
    const [kind] = roOut[i]
    const roWords = words(textOf(roOut[i][1]))
    const text = textOf(otherOut[i][1])
    if (/[ăĂșȘțȚşŞţŢ]/.test(text)) found.push(`${kind}: diacritice românești`)
    for (const w of words(text)) {
      if (roWords.has(w) && !EXCLUDED.has(w) && !SAME_WORDS[w]) found.push(`${kind}: „${w}”`)
    }
  }
  return found
}

describe('EL2: nicio limbă ≠ ro nu conține resturi românești', () => {
  it('anti-vacuitate: fiecare kind tradus are o fixtură ASCII', () => {
    assert.deepEqual(Object.keys(F.ASCII_CASES).sort(), TRANSLATED().sort())
  })

  const usedSame = new Set()
  for (const l of ['en', 'fr', 'de', 'it', 'hu', 'es']) {
    it(`${l}: fără diacritice și fără cuvinte românești`, () => {
      const roOut = renderAll('ro')
      const out = renderAll(l)
      // Kind-urile personalului există doar în 4 limbi: în it/hu/es comparăm
      // doar reminderul (singurul email către oaspete).
      const keep = (i) => lang.STAFF_LANGS.includes(l) || roOut[i][0].startsWith('reservation_reminder')
      const roK = roOut.filter((_, i) => keep(i))
      const outK = out.filter((_, i) => keep(i))
      assert.ok(roK.length >= (lang.STAFF_LANGS.includes(l) ? 20 : 2))
      assert.deepEqual(leftovers(roK, outK), [])
      for (let i = 0; i < roK.length; i++) {
        const roWords = words(textOf(roK[i][1]))
        for (const w of words(textOf(outK[i][1]))) if (roWords.has(w) && SAME_WORDS[w]) usedSame.add(w)
      }
    })
  }

  it('registru onest: fiecare cuvânt identic e chiar întâlnit', () => {
    for (const w of Object.keys(SAME_WORDS)) {
      assert.ok(usedSame.has(w), `„${w}” nu mai apare nicăieri — scoate-l din SAME_WORDS`)
      assert.ok(SAME_WORDS[w].length >= 10, `„${w}” fără motiv`)
    }
  })

  // Anti-vacuitate pe RAMURI: fiecare cheie a fiecărui tabel (cel mai lung
  // segment literal al ei, între placeholdere și etichete) apare în cel puțin
  // o randare engleză. O ramură pe care nicio fixtură nu o atinge (salutul
  // fără nume, „fără comparație”, rezervele invitației) ar lăsa un șir
  // românesc scris direct acolo să treacă de EL2.
  it('fiecare cheie engleză e chiar randată de o fixtură (ramurile fără nume incluse)', () => {
    const out = renderAll('en')
    // Linkurile mailto (NPS) poartă textul URL-codat; se decodează pe secvențe,
    // ca un „%” izolat în restul HTML-ului să nu anuleze decodarea.
    const decode = (s) =>
      s.replace(/(%[0-9A-F]{2})+/gi, (m) => {
        try {
          return decodeURIComponent(m)
        } catch {
          return m
        }
      })
    const hay = out.map(([, r]) => `${r.subject}\n${r.html}\n${decode(r.html)}`).join('\n')
    // Rezervele invitației cer nume goale (EL2 randează invitația cu nume ASCII).
    const anonInvite = INVITE.renderInviteEmail('en', { restaurantName: '', invitedByName: '', roleKey: 'waiter', acceptUrl: `${F.APP}/invite/t` })
    const all = `${hay}\n${anonInvite.subject}\n${anonInvite.html}`
    const missing = []
    const tables = [...TRANSLATED().map((k) => [k, strings.EMAIL_STRINGS[k]]), ['team_invite', strings.EMAIL_STRINGS.team_invite], ['signup_welcome', strings.EMAIL_STRINGS.signup_welcome]]
    for (const [name, table] of tables) {
      for (const [key, val] of Object.entries(table.en)) {
        const seg = val
          .split(/\{[a-z_]+\}|<[^>]*>/)
          .map((x) => x.trim())
          .sort((a, b) => b.length - a.length)[0]
        if (seg && !all.includes(seg)) missing.push(`${name}.${key}: „${seg}”`)
      }
    }
    assert.deepEqual(missing, [])
  })

  it('control sintetic: „Persoane” lăsat într-o copie a tabelei en e semnalat', () => {
    const roOut = [['reservation_reminder', Q.renderEmail('reservation_reminder', F.ASCII_CASES.reservation_reminder, ctxFor('ro'))]]
    const good = [['reservation_reminder', Q.renderEmail('reservation_reminder', F.ASCII_CASES.reservation_reminder, ctxFor('en'))]]
    assert.deepEqual(leftovers(roOut, good), [])
    const bad = [['reservation_reminder', { subject: good[0][1].subject, html: good[0][1].html.replace('Guests', 'Persoane') }]]
    assert.ok(good[0][1].html.includes('Guests'), 'controlul nu găsește eticheta engleză')
    assert.deepEqual(leftovers(roOut, bad), ['reservation_reminder: „persoane”'])
  })
})

// ── EL3 ──────────────────────────────────────────────────────────────────────
describe('EL3: orele și zilele pe fusul localului', () => {
  const created = (l, tz) => Q.renderEmail('reservation_created', F.ASCII_CASES.reservation_created, ctxFor(l, tz))

  it('rezervarea de 22:30Z: ziua românească e ziua URMĂTOARE; New York și Berlin pe fusul lor', () => {
    assert.ok(created('ro', 'Europe/Bucharest').html.includes('marți, 17 noiembrie · 00:30'))
    const ny = created('en', 'America/New_York').html
    assert.ok(ny.includes('Monday 16 November · 17:30'), ny)
    assert.ok(!ny.includes('00:30'))
    assert.ok(created('de', 'Europe/Berlin').html.includes('Montag, 16. November · 23:30'))
    // Același fus, altă limbă: ora rămâne a localului.
    assert.ok(created('en', 'Europe/Bucharest').html.includes('Tuesday 17 November · 00:30'))
  })

  it('anularea: ora din subiect și din card e pe fusul localului', () => {
    const r = Q.renderEmail('reservation_cancelled', F.ASCII_CASES.reservation_cancelled, ctxFor('en', 'America/New_York'))
    assert.ok(r.subject.endsWith('Monday 16 November · 17:30'), r.subject)
    assert.ok(r.html.includes('Monday 16 November · 17:30 · party of 3'))
  })

  it('reminderul: „mâine” pe București, „today” pe Londra, față de același moment', () => {
    const d = F.ASCII_CASES.reservation_reminder
    assert.match(Q.renderEmail('reservation_reminder', d, ctxFor('ro', 'Europe/Bucharest')).subject, / mâine$/)
    assert.match(Q.renderEmail('reservation_reminder', d, ctxFor('en', 'Europe/London')).subject, / today$/)
    assert.match(Q.renderEmail('reservation_reminder', d, ctxFor('de', 'Europe/Berlin')).subject, / heute$/)
    const far = Q.renderEmail('reservation_reminder', F.ASCII_CASES_ALT.reservation_reminder, ctxFor('fr', 'Europe/Paris'))
    assert.match(far.subject, / le 20 novembre$/)
  })

  it('reminderul rulat la 22:30Z (00:30 în București): „ACUM” e tot pe ziua localului', () => {
    // Cu NOW = 20:00Z calendarul UTC și cel din București dau aceeași zi, deci
    // „azi” calculat pe UTC n-ar schimba nimic; la 22:30Z în București e deja
    // 17, pe UTC încă 16 — rezervarea de pe 17 la 20:00 e „astăzi”, nu „mâine”.
    const late = (l, tz) => fmt.makeCtx({ lang: l, locale: lang.emailLocale(l, null), timeZone: tz, now: Date.parse(F.NOW_LATE) })
    const d = { restaurant_name: F.ASCII.rest, starts_at: F.STARTS_LATE }
    assert.match(Q.renderEmail('reservation_reminder', d, late('ro', 'Europe/Bucharest')).subject, / astăzi$/)
    assert.match(Q.renderEmail('reservation_reminder', d, late('en', 'Europe/Athens')).subject, / today$/)
    // Control: unde e încă 16 (Berlin 23:30, Londra 22:30) aceeași rezervare e „mâine”.
    assert.match(Q.renderEmail('reservation_reminder', d, late('de', 'Europe/Berlin')).subject, / morgen$/)
    assert.match(Q.renderEmail('reservation_reminder', d, late('en', 'Europe/London')).subject, / tomorrow$/)
  })

  it('procentul de evoluție: separatorul zecimal al limbii; româna rămâne „23.5”', () => {
    const w = F.ASCII_CASES.weekly_report
    assert.ok(Q.renderEmail('weekly_report', w, ctxFor('ro')).html.includes('23.5% vs'))
    assert.ok(Q.renderEmail('weekly_report', w, ctxFor('de')).html.includes('23,5 % ggü. Vorwoche'))
    assert.ok(Q.renderEmail('weekly_report', w, ctxFor('fr')).html.includes('23,5 % par rapport'))
    assert.ok(Q.renderEmail('weekly_report', w, ctxFor('en')).html.includes('23.5% vs'))
    const dd = F.ASCII_CASES.daily_report
    assert.ok(Q.renderEmail('daily_report', dd, ctxFor('de')).html.includes('17,3 % ggü. Vortag'))
    assert.ok(Q.renderEmail('daily_report', dd, ctxFor('fr')).html.includes('17,3 % par rapport'))
  })

  it('raportul zilnic: `day` e o DATĂ — aceeași zi pe orice fus', () => {
    for (const tz of ['Europe/Bucharest', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      const r = Q.renderEmail('daily_report', { day: '2026-11-15', orders: 1 }, ctxFor('ro', tz))
      assert.ok(r.html.includes('duminică, 15 noiembrie'), tz)
    }
  })

  it('raportul săptămânal: perioada începe pe 9 (miezul nopții București), banii în limba patronului', () => {
    const d = F.ASCII_CASES.weekly_report
    assert.ok(Q.renderEmail('weekly_report', d, ctxFor('ro')).html.includes('9 nov. – 15 nov.'))
    const en = Q.renderEmail('weekly_report', d, ctxFor('en'))
    assert.ok(en.html.includes('9 Nov – 15 Nov'))
    // Intl pune un spațiu NEdespărțitor între cod și sumă (`\s` îl prinde).
    assert.match(en.subject, /RON\s12,345\.50/)
    assert.match(en.html, /RON\s1,260\.00/)
    assert.ok(!en.html.includes(' lei'), 'în engleză suma nu mai e „lei”')
  })
})

// ── EL4 ──────────────────────────────────────────────────────────────────────
describe('EL4: rezolvarea limbii', () => {
  it('personalul: doar limbile ACTIVE', () => {
    assert.equal(lang.staffEmailLang('en'), 'ro', 'engleza nu e încă activă pentru personal')
    assert.equal(lang.staffEmailLang('en', ['ro', 'en']), 'en')
    for (const v of [null, undefined, '', 'xx', 42, {}]) assert.equal(lang.staffEmailLang(v, ['ro', 'en']), 'ro')
    assert.equal(lang.staffEmailLang('EN', ['ro', 'en']), 'en')
    assert.equal(lang.staffEmailLang('en-GB', ['ro', 'en']), 'en')
    assert.equal(lang.staffEmailLang('fr', ['ro', 'en']), 'ro')
  })

  it('oaspetele: cele 7 limbi ale meniului', () => {
    assert.equal(lang.guestEmailLang('hu'), 'hu')
    assert.equal(lang.guestEmailLang('es'), 'es')
    assert.equal(lang.guestEmailLang('pt'), 'ro')
    assert.equal(lang.guestEmailLang(null), 'ro')
  })

  it('funnel-ul (welcome-email): ro + en azi', () => {
    assert.equal(lang.funnelEmailLang('en'), 'en')
    assert.equal(lang.funnelEmailLang('fr'), 'ro')
    assert.equal(lang.funnelEmailLang('de'), 'ro')
    assert.equal(lang.funnelEmailLang(undefined), 'ro')
  })

  it('invitația: invitatul > invitatorul > română, doar pe limbile active', () => {
    const en = ['ro', 'en', 'fr']
    assert.equal(lang.resolveInviteLang({ invitee: 'fr', inviter: 'en' }, en), 'fr')
    assert.equal(lang.resolveInviteLang({ invitee: 'ro', inviter: 'en' }, en), 'ro', 'alegerea explicită „ro” a invitatului câștigă')
    assert.equal(lang.resolveInviteLang({ invitee: null, inviter: 'en' }, en), 'en')
    assert.equal(lang.resolveInviteLang({ invitee: 'de', inviter: 'xx' }, en), 'ro')
    assert.equal(lang.resolveInviteLang({ invitee: 'en', inviter: 'en' }), 'ro', 'implicit: doar româna e activă')
  })

  it('locale: română mereu ro-RO; altfel limbă-ȚARĂ doar pe potrivire exactă', () => {
    assert.equal(lang.emailLocale('ro', 'MD'), 'ro-RO')
    assert.equal(lang.emailLocale('en', 'US'), 'en-US')
    assert.equal(lang.emailLocale('en', null), 'en-GB')
    assert.equal(lang.emailLocale('de', 'zz-bad'), 'de-DE')
  })

  it('fusul: lipsă/invalid → București', () => {
    assert.equal(lang.safeTimeZone(null), 'Europe/Bucharest')
    assert.equal(lang.safeTimeZone('Mars/Olympus'), 'Europe/Bucharest')
    assert.equal(lang.safeTimeZone('America/New_York'), 'America/New_York')
  })
})

// ── EL5 ──────────────────────────────────────────────────────────────────────
describe('EL5: oglinzile din server = sursele din client și din SQL', () => {
  const arr = (src, name) => {
    const m = new RegExp(`export const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(src)
    assert.ok(m, `${name} nu e găsit`)
    return [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1])
  }

  it('langs.ts: STAFF / ENABLED / FUNNEL', () => {
    const src = read('src/i18n/langs.ts')
    const staff = arr(src, 'STAFF_LANGS')
    const enabled = arr(src, 'ENABLED_STAFF_LANGS')
    assert.ok(staff.includes('ro') && enabled.includes('ro'))
    assert.deepEqual([...lang.STAFF_LANGS], staff)
    assert.deepEqual([...lang.ENABLED_STAFF_LANGS], enabled)
    // Regula funnel-ului e aceeași expresie în ambele fișiere.
    assert.ok(src.includes("(l) => l === 'ro' || l === 'en' || ENABLED_STAFF_LANGS.includes(l)"), 'regula FUNNEL din langs.ts s-a schimbat')
    assert.deepEqual([...lang.FUNNEL_LANGS], staff.filter((l) => l === 'ro' || l === 'en' || enabled.includes(l)))
  })

  it('GUEST_LANGS == CHECK-ul mig 298 == MENU_LANGS', () => {
    const dir = path.join(ROOT, 'supabase', 'migrations')
    let check = null
    for (const f of fs.readdirSync(dir).sort()) {
      const m = /add constraint restaurants_language_check\s+check \(language in \(([^)]*)\)\)/.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
      if (m) check = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1])
    }
    assert.ok(check && check.includes('ro'), 'CHECK-ul restaurants.language nu e găsit')
    const menu = [...read('src/lib/i18nMenu.ts').matchAll(/\{ code: '([a-z]+)'/g)].map((x) => x[1])
    assert.ok(menu.includes('ro'))
    assert.deepEqual([...lang.GUEST_LANGS], check)
    assert.deepEqual([...lang.GUEST_LANGS], menu)
  })

  it('LOCALES pe limbile personalului == DEFAULT_LOCALE din format.ts', () => {
    const src = read('src/i18n/format.ts')
    const block = /const DEFAULT_LOCALE[^{]*\{([^}]*)\}/.exec(src)
    assert.ok(block, 'DEFAULT_LOCALE nu e găsit')
    const parsed = Object.fromEntries([...block[1].matchAll(/([a-z]+):\s*'([^']+)'/g)].map((x) => [x[1], x[2]]))
    assert.equal(parsed.ro, 'ro-RO')
    for (const l of lang.STAFF_LANGS) assert.equal(lang.LOCALES[l], parsed[l], l)
  })
})

// ── EL6 ──────────────────────────────────────────────────────────────────────
describe('EL6: registrul de audiență', () => {
  it('cheile == TEMPLATES (== enumul, prin EK1)', () => {
    assert.deepEqual(Object.keys(Q.EMAIL_AUDIENCE).sort(), Object.keys(Q.TEMPLATES).sort())
  })

  it('română cu motiv; traducerile există pentru tot și doar pentru kind-urile traduse', () => {
    const counts = { staff: 0, guest: 0, ro: 0 }
    for (const [k, a] of Object.entries(Q.EMAIL_AUDIENCE)) {
      assert.ok(['staff', 'guest', 'ro'].includes(a.audience), k)
      assert.ok(['operational', 'bucharest'].includes(a.tz), k)
      counts[a.audience]++
      if (a.audience === 'ro') {
        assert.ok(typeof a.reason === 'string' && a.reason.length >= 10, `${k}: română fără motiv`)
        assert.equal(strings.EMAIL_STRINGS[k], undefined, `${k}: traducere moartă pentru un kind care rămâne în română`)
      } else {
        const t = strings.EMAIL_STRINGS[k]
        assert.ok(t, `${k}: fără texte`)
        for (const l of audienceLangs(k)) assert.ok(strings.isComplete(t, l), `${k}.${l} incomplet`)
      }
    }
    assert.deepEqual(counts, { staff: 13, guest: 1, ro: 17 })
    assert.equal(STAFF_KINDS().length, 13)
  })

  it('fusul operațional EXACT pe cele trei kind-uri de rezervare', () => {
    const op = Object.keys(Q.EMAIL_AUDIENCE).filter((k) => Q.EMAIL_AUDIENCE[k].tz === 'operational').sort()
    assert.deepEqual(op, ['reservation_cancelled', 'reservation_created', 'reservation_reminder'])
  })
})

// ── EL7 ──────────────────────────────────────────────────────────────────────
describe('EL7: rezervele românești din SQL nu ajung în alte limbi', () => {
  const cases = [
    ['win_back_7d', 'Stimate patron'],
    ['win_back_30d', 'Stimate patron'],
    ['nps_survey', 'Stimate utilizator'],
  ]
  for (const [kind, placeholder] of cases) {
    it(`${kind}: „${placeholder}”`, () => {
      const data = { owner_name: placeholder, restaurant_name: 'Zorba Grill', days_since_last_order: 9 }
      for (const l of ['en', 'fr', 'de']) {
        const r = Q.renderEmail(kind, data, ctxFor(l))
        assert.ok(!r.html.includes('Stimate'), `${kind}.${l}`)
        assert.ok(r.html.includes(strings.EMAIL_STRINGS[kind][l].greet_anon), `${kind}.${l}: salutul generic`)
      }
      assert.ok(Q.renderEmail(kind, data, ctxFor('ro')).html.includes(`Bună ${placeholder},`), 'în română rămâne')
      // Control: un nume real trece în toate limbile.
      assert.ok(Q.renderEmail(kind, { ...data, owner_name: 'Anna' }, ctxFor('en')).html.includes('Hello Anna,'))
    })
  }
})

// ── EL8 ──────────────────────────────────────────────────────────────────────
describe('EL8: escaparea în toate limbile', () => {
  const X = "<script>&'"
  const XE = '&lt;script&gt;&amp;&#39;'
  const evil = {
    owner_name: X, restaurant_name: X, customer_name: X, customer_phone: X, special_requests: X,
    agent_display_name: X, confirmation_code: X, restaurant_phone: X, party_size: X,
    days_since_last_order: X, starts_at: '2026-11-16T22:30:00Z', status: 'confirmed',
    top_products: [{ name: X, units_sold: 1, revenue: 1 }], day: '2026-11-15', orders: 1,
  }
  for (const kind of ['payment_failed', 'reservation_created', 'reservation_cancelled', 'reservation_reminder', 'win_back_7d', 'win_back_30d', 'nps_survey', 'partner_access_requested', 'weekly_report', 'daily_report', 'milestone_100_orders', 'milestone_first_month']) {
    it(kind, () => {
      for (const l of audienceLangs(kind)) {
        const r = Q.renderEmail(kind, evil, ctxFor(l))
        assert.ok(!r.html.includes('<script>'), `${kind}.${l}: <script> brut`)
        assert.ok(r.html.includes(XE), `${kind}.${l}: valoarea escapată lipsește (control)`)
      }
    })
  }
  it('invitația și bun-venitul', () => {
    for (const l of lang.STAFF_LANGS) {
      const inv = INVITE.renderInviteEmail(l, { restaurantName: X, invitedByName: X, roleKey: 'waiter', acceptUrl: 'https://x/invite/t' })
      assert.ok(!inv.html.includes('<script>') && inv.html.includes(XE), `invite.${l}`)
      assert.ok(inv.subject.includes(X), `invite.${l}: subiectul e text simplu`)
    }
  })
})

// ── EL9 ──────────────────────────────────────────────────────────────────────
describe('EL9: o limbă incompletă cade întreagă pe engleză', () => {
  it('cheie lipsă în fr → obiectul englez, întreg', () => {
    const copy = JSON.parse(JSON.stringify(strings.EMAIL_STRINGS))
    delete copy.reservation_created.fr.label_notes
    const got = strings.kindStrings('reservation_created', 'fr', copy)
    assert.deepEqual(got, copy.reservation_created.en)
    const frValues = new Set(Object.values(strings.EMAIL_STRINGS.reservation_created.fr))
    for (const v of Object.values(got)) assert.ok(!frValues.has(v) || Object.values(copy.reservation_created.en).includes(v))
    assert.ok(!Object.values(got).includes(strings.EMAIL_STRINGS.reservation_created.fr.title))
  })

  it('și engleza incompletă → româna întreagă; limba completă → ea însăși', () => {
    const copy = JSON.parse(JSON.stringify(strings.EMAIL_STRINGS))
    copy.payment_failed.fr.title = ''
    copy.payment_failed.en.title = ''
    assert.deepEqual(strings.kindStrings('payment_failed', 'fr', copy), copy.payment_failed.ro)
    assert.deepEqual(strings.kindStrings('payment_failed', 'de', copy), copy.payment_failed.de)
  })

  it('fill: o singură trecere, placeholder lipsă → gol', () => {
    assert.equal(strings.fill('{a}-{b}', { a: '{b}', b: 'x' }), '{b}-x')
    assert.equal(strings.fill('{a}!', {}), '!')
    assert.equal(strings.fill('{a}', { a: '$&' }), '$&')
  })
})
