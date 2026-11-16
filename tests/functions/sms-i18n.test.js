// tests/functions/sms-i18n.test.js
// SMS-urile către oaspete în limba lui, cu ora localului (lotul L8b).
//
//   SM1  textul final are DOAR caractere din tabela GSM-7 de BAZĂ (GSM 03.38,
//        un septet fiecare) în toate cele 7 limbi × 3 șabloane, pe nume ȘI
//        telefoane „ostile” (ê ă ș œ ł đ, ghilimele, liniuțe, NBSP, €,
//        caracterele EXTINSE [ ] { } | ~ ^ \ — 2 septete fiecare —, backtick,
//        emoji, chirilică, caractere INVIZIBILE de formatare) și pe lunile
//        fiecărei limbi. Plus transliterările exacte: literele din tabela de
//        bază RĂMÂN (é ü ä ß ñ à Å…), restul se reduc (ê → e, ł → l, € → EUR,
//        [ → (), caracterele invizibile (ZWSP, soft hyphen, BOM, LRM) DISPAR,
//        nu devin „?”; tabela are exact 125 de caractere.
//        [PICĂ: plasa finală '?' scoasă (emoji/chirilică trec); `[`/`€` scoase
//         din tabelă (rămân 2 septete); o literă de bază transliterată (é → e);
//         caracterele de formatare lăsate pe plasa '?']
//   SM9  FIECARE câmp din template_data trece prin transliterare, nu doar
//        numele: telefonul localului (text liber, scris de owner, fără CHECK),
//        numărul de persoane, codul și short_id-ul — exact
//        „0722 000 111 - rezervari (L-V)” în toate cele 7 limbi.
//        [PICĂ: `toGsm7` scos de pe oricare dintre cele patru câmpuri]
//   SM10 registrul = cel al fluxului oaspetelui (src/lib/guestStrings.ts) și al
//        emailului de reminder trimis odată cu SMS-ul: „du” (de), „te” (hu),
//        „tu” (it, es), „vous” (fr) — niciun marcaj al registrului celălalt;
//        plus cele două fraze pe care transliterarea completă la ASCII le
//        strica: italiana „è pronto” (nu „e pronto” = „și gata”), franceza fără
//        „a” („are”) în loc de „à”.
//        [PICĂ: „Ihre Reservierung”, „Nem tud jonni?”, „Varjuk!”; „e pronto”;
//         „prete a retirer”]
//   SM2  plafonul de 160: pe fiecare limbă, cazul cel mai lung (nume tăiat la
//        30/40, luna cea mai lungă din an, 999 de persoane, cod de 8) încape
//        ÎNTREG — codul nu se taie niciodată; cu telefonul localului scurt
//        încape și telefonul; cu un telefon lung se ia ramura de rezervă (fără
//        telefon, cu cod). Control: ramura de rezervă chiar se declanșează.
//        [PICĂ: un text prea lung într-o limbă; ramura de rezervă scoasă]
//   SM3  limba și ora: fiecare limbă își folosește textul (nu româna), ora e pe
//        fusul DAT (Londra 18:30, București 20:30, New York 13:30 pentru
//        17:30Z), indiferent de limbă; o limbă necunoscută / ctx lipsă = româna
//        pe București.
//        [PICĂ: ora fixată pe București; textul românesc pe orice limbă]
//   SM4  paritatea tabelei: exact cele 7 limbi ale oaspetelui (GUEST_LANGS),
//        aceleași chei peste tot, aceleași placeholdere în fiecare cheie, iar
//        textele scrise sunt deja GSM-7 de bază (lungimea calculată = cea
//        trimisă).
//        [PICĂ: o limbă lipsă; un placeholder pierdut într-o traducere]
//   SM5  `resolveGuestLang`: stocată → a localului → română; o limbă stocată
//        necunoscută cade pe a localului, nu pe română.
//   SM6  prin HANDLER: o singură interogare pe `restaurants` (id-uri unice) per
//        lot; rezervarea cu `guest_language = 'de'` la un local englez de la
//        Londra pleacă în germană cu ora Londrei; pickup-ul de la același local
//        pleacă în engleză (limba localului); un local necunoscut → română pe
//        București.
//        [PICĂ: limba citită din altă sursă; pickup-ul pe guest_language;
//         interogare per rând]
//   SM7  toleranță: eroare pe `restaurants` (și pe a doua încercare fără
//        `country`) → fusul cade pe București, iar limba STOCATĂ a oaspetelui
//        rămâne (germana pleacă tot în germană); doar rândurile fără limbă
//        stocată (pickup-ul aici) ies byte-identice cu worker-ul vechi;
//        `template_data` null nu aruncă.
//   SM8  o singură listă de limbi ale oaspetelui, în PATRU locuri: CHECK-ul
//        `reservations_guest_language_check` și tabloul de normalizare din
//        `create_reservation_public` (ultima migrație care le definește),
//        `GUEST_LANGS` (emailLang.js) și `RESERVATION_GUEST_LANGS`
//        (src/lib/reservations.ts). O limbă adăugată într-un singur loc ar
//        face ca rezervarea să salveze NULL (RPC) sau să fie respinsă (CHECK).
//        [PICĂ: o limbă în plus / în minus în oricare dintre cele patru]
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { state, resetMocks, loadFunction } = require('./helpers/mocks')
const { SMS_STRINGS, TEMPLATES, GSM7_BASIC, toGsm7, isGsm7, formatWhen, MAX_LEN } = require('../../netlify/functions/lib/smsText')
const { GUEST_LANGS, resolveGuestLang } = require('../../netlify/functions/lib/emailLang')

const REL = 'netlify/functions/process-sms-queue.js'
const KINDS = ['reservation_confirmed', 'reservation_reminder', 'pickup_ready']
const HOSTILE_NAMES = [
  'Café Müller – Straße 5',
  'Smørrebrød Æble Œuvre',
  'Łódź Đurđevac Þing',
  '„Mama’s” «Grill» ‹x›',
  'Pizza [Napoli] {veg} | 50% ~ ^ \\ `x`',
  'Bistro € 10',
  'Ресторан Москва',
  'Sushi 🍣 Bar',
  'Tab\tNou\nRand',
  'Casa\u200bVeche\u00ad\ufeff\u200e\u200f\u2060',
  'Crêpe façade őrség Ăla Ştefan',
]
const HOSTILE_PHONES = ['+40 722 000 111', '0722\u00a0000 111 – rezervări [L-V] ~ ^ {x} | \\ `y` € „z”']
const ISO = '2026-07-15T17:30:00Z'

describe('SM1: GSM-7 de bază în toate limbile', () => {
  it('7 limbi × 3 șabloane × nume și telefoane ostile × 12 luni → doar caractere GSM-7 de un septet', () => {
    let n = 0
    for (const lang of GUEST_LANGS) {
      for (const kind of KINDS) {
        for (const name of HOSTILE_NAMES) {
          for (const phone of HOSTILE_PHONES) for (let m = 0; m < 12; m++) {
            const text = TEMPLATES[kind](
              {
                restaurant_name: name,
                restaurant_phone: phone,
                starts_at: new Date(Date.UTC(2026, m, 28, 21, 45)).toISOString(),
                party_size: 4,
                confirmation_code: 'AB12CD34',
                short_id: 'ABC123',
              },
              { lang, timeZone: 'Europe/Bucharest' },
            )
            assert.ok(isGsm7(text), `${lang}/${kind}/${name}/${phone}/luna ${m + 1}: ${JSON.stringify(text)}`)
            n++
          }
        }
      }
    }
    assert.equal(n, 7 * 3 * HOSTILE_NAMES.length * HOSTILE_PHONES.length * 12)
  })

  it('tabela de bază: 125 de caractere, fără tabela extinsă și fără backtick', () => {
    assert.equal(GSM7_BASIC.length, 125)
    assert.equal(new Set(GSM7_BASIC).size, 125)
    for (const c of '`[]{}|~^\\€\n\r\t') assert.ok(!GSM7_BASIC.includes(c), JSON.stringify(c))
    for (const c of 'éèàùìòäöüÄÖÜñÑßæÆøØåÅÉÇ£¥§¿¡@$_') assert.ok(GSM7_BASIC.includes(c), c)
    for (const c of 'êâîôûçëïáíóúőűășțÁÊ') assert.ok(!GSM7_BASIC.includes(c), c)
  })

  it('transliterările exacte', () => {
    // Literele din tabela de bază RĂMÂN (un septet, fără cost): ß, Æ, ø, é, ü, ä, ñ, à, Å…
    assert.equal(toGsm7('Café Müller März Ñandú àèìòù ÄÖÜ ß £¥§¿¡ Ångström'), 'Café Müller März Ñandu àèìòù ÄÖÜ ß £¥§¿¡ Ångström')
    assert.equal(toGsm7('Straße Łódź Đurđevac'), 'Straße Lodz Durdevac')
    assert.equal(toGsm7('Æble Œuvre smørrebrød'), 'Æble OEuvre smørrebrød')
    assert.equal(toGsm7('Crêpe façade őrség'), 'Crepe facade orség')
    assert.equal(toGsm7('Bistro € 10 [a]{b}|c~d^e\\f`g'), "Bistro EUR 10 (a)(b)/c-d'e/f'g")
    assert.equal(toGsm7('„Mama’s” – «x»…'), '"Mama\'s" - "x"...')
    assert.equal(toGsm7('Șoseaua Ştefan cel Mare, Țară, Ţară, ă î â'), 'Soseaua Stefan cel Mare, Tara, Tara, a i a')
    assert.equal(toGsm7('Ресторан 🍣'), '???????? ?')
    // Caracterele INVIZIBILE de formatare (nume lipite din web / hărți) dispar.
    assert.equal(toGsm7('Casa\u200bVeche'), 'CasaVeche')
    assert.equal(toGsm7('Bis\u00adtro'), 'Bistro')
    assert.equal(toGsm7('\ufeffBistro\u200e\u200f\u2060'), 'Bistro')
    assert.equal(toGsm7('x\u0301'), 'x', 'semnul diacritic fără literă de bază dispare')
    assert.equal(toGsm7('❤\ufe0f'), '?', 'selectorul de variantă nu adaugă un al doilea „?”')
    assert.equal(toGsm7(null), '')
  })
})

describe('SM2: plafonul de 160 pe fiecare limbă', () => {
  // Luna cea mai lungă din an, pe limba dată (cu ziua 28, ora 23:59 locală).
  function longestWhenIso(lang) {
    let best = null
    for (let m = 0; m < 12; m++) {
      const iso = new Date(Date.UTC(2026, m, 28, 20, 59)).toISOString()
      const w = formatWhen(iso, { lang, timeZone: 'Europe/Bucharest' })
      if (!best || w.length > best.w.length) best = { iso, w }
    }
    return best.iso
  }
  const NAME = 'N'.repeat(45)

  for (const lang of GUEST_LANGS) {
    it(`${lang}: cazul cel mai lung încape întreg; telefonul scurt intră; cel lung cade pe ramura de rezervă`, () => {
      const ctx = { lang, timeZone: 'Europe/Bucharest' }
      const starts = longestWhenIso(lang)
      for (const kind of ['reservation_confirmed', 'reservation_reminder']) {
        const base = { restaurant_name: NAME, starts_at: starts, party_size: 999, confirmation_code: 'ABCDEFGH' }
        const noPhone = TEMPLATES[kind](base, ctx)
        assert.ok(noPhone.length <= MAX_LEN, `${lang}/${kind}: ${noPhone.length} > 160`)
        assert.ok(noPhone.endsWith('ABCDEFGH.'), `${lang}/${kind}: codul tăiat: ${noPhone}`)
        assert.ok(noPhone.startsWith(`${'N'.repeat(30)}:`), `${lang}/${kind}: numele nu e tăiat la 30`)

        const withShort = TEMPLATES[kind]({ ...base, restaurant_phone: '+40 722 000 111' }, ctx)
        assert.ok(withShort.length <= MAX_LEN && withShort.endsWith('+40 722 000 111'), `${lang}/${kind}: telefonul scurt n-a intrat: ${withShort}`)

        const longPhone = '+40 ' + '7'.repeat(140)
        const withLong = TEMPLATES[kind]({ ...base, restaurant_phone: longPhone }, ctx)
        assert.equal(withLong, noPhone, `${lang}/${kind}: telefonul lung n-a declanșat ramura de rezervă`)
      }
      const pickup = TEMPLATES.pickup_ready({ restaurant_name: NAME, short_id: 'ABC123' }, ctx)
      assert.ok(pickup.length <= MAX_LEN && pickup.includes('#ABC123'), `${lang}/pickup: ${pickup}`)
      assert.ok(pickup.startsWith(`${'N'.repeat(40)}:`), `${lang}/pickup: numele nu e tăiat la 40`)
    })
  }
})

describe('SM3: limba și ora localului', () => {
  const KEY = {
    ro: 'Rezervare confirmata', en: 'Booking confirmed', de: 'Reservierung bestätigt',
    fr: 'Réservation confirmée', it: 'Prenotazione confermata', hu: 'Foglalas visszaigazolva',
    es: 'Reserva confirmada',
  }
  const d = { restaurant_name: 'Bistro', starts_at: ISO, party_size: 2, confirmation_code: 'AB12CD34' }

  it('fiecare limbă își folosește textul; ora urmează fusul dat, nu limba', () => {
    for (const lang of GUEST_LANGS) {
      for (const [tz, hhmm] of [['Europe/London', '18:30'], ['Europe/Bucharest', '20:30'], ['America/New_York', '13:30']]) {
        const text = TEMPLATES.reservation_confirmed(d, { lang, timeZone: tz })
        assert.ok(text.includes(KEY[lang]), `${lang}@${tz}: ${text}`)
        assert.ok(text.includes(hhmm), `${lang}@${tz}: ora ${hhmm} lipsește: ${text}`)
        assert.ok(text.includes('AB12CD34'))
      }
    }
  })

  it('limbă necunoscută / ctx lipsă / fus invalid → româna pe București', () => {
    const ro = TEMPLATES.reservation_confirmed(d, { lang: 'ro', timeZone: 'Europe/Bucharest' })
    assert.equal(TEMPLATES.reservation_confirmed(d), ro)
    assert.equal(TEMPLATES.reservation_confirmed(d, { lang: 'pt', timeZone: 'Europe/Bucharest' }), ro)
    assert.equal(TEMPLATES.reservation_confirmed(d, { lang: 'ro', timeZone: 'Mars/Olympus' }), ro)
  })
})

describe('SM4: paritatea tabelei de texte', () => {
  it('exact cele 7 limbi, aceleași chei și aceleași placeholdere, texte deja GSM-7 de bază', () => {
    assert.deepEqual(Object.keys(SMS_STRINGS).sort(), [...GUEST_LANGS].sort())
    const keys = Object.keys(SMS_STRINGS.ro).sort()
    const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
    for (const lang of GUEST_LANGS) {
      assert.deepEqual(Object.keys(SMS_STRINGS[lang]).sort(), keys, lang)
      for (const k of keys) {
        assert.equal(ph(SMS_STRINGS[lang][k]), ph(SMS_STRINGS.ro[k]), `${lang}.${k}: placeholdere diferite`)
        // Placeholderele `{x}` se înlocuiesc la randare; restul textului e ce pleacă.
        assert.ok(isGsm7(SMS_STRINGS[lang][k].replace(/\{\w+\}/g, '')), `${lang}.${k} nu e GSM-7 de bază`)
      }
    }
  })
})

describe('SM5: resolveGuestLang', () => {
  it('stocată → a localului → română', () => {
    assert.equal(resolveGuestLang('de', 'en'), 'de')
    assert.equal(resolveGuestLang(null, 'en'), 'en')
    assert.equal(resolveGuestLang('pt', 'it'), 'it')
    assert.equal(resolveGuestLang('EN-gb', null), 'en')
    assert.equal(resolveGuestLang(undefined, 'xx'), 'ro')
    assert.equal(resolveGuestLang('ro', 'en'), 'ro', 'o alegere explicită „ro” bate limba localului')
  })
})

// ── Prin handler ────────────────────────────────────────────────
const R_LON = '32800000-0000-4000-8000-00000000f001'
const R_BUC = '32800000-0000-4000-8000-00000000f002'
const R_GONE = '32800000-0000-4000-8000-00000000f003'
const ENV = ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SMSO_API_KEY', 'SMSO_SENDER', 'SLACK_WEBHOOK_URL']
let saved
let savedFetch
let sent

beforeEach(() => {
  resetMocks()
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
  Object.assign(process.env, { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SMSO_API_KEY: 'k' })
  savedFetch = global.fetch
  sent = []
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    sent.push(body)
    return { ok: true, status: 200, json: async () => ({ id: `m${sent.length}` }), text: async () => '' }
  }
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  global.fetch = savedFetch
})

const future = new Date(Date.now() + 3 * 24 * 60 * 60_000)
future.setUTCHours(17, 30, 0, 0)
const FUTURE_ISO = future.toISOString()

function row(id, restaurantId, kind, data) {
  return {
    id, restaurant_id: restaurantId, template_kind: kind, template_data: data,
    recipient_phone: '+40722000111', failed_attempts: 0,
    created_at: new Date(Date.now() - 60_000).toISOString(),
  }
}
const ROWS = [
  row('s1', R_LON, 'reservation_confirmed', { restaurant_name: 'Ye Olde', starts_at: FUTURE_ISO, party_size: 2, confirmation_code: 'DE000001', guest_language: 'de' }),
  row('s2', R_LON, 'pickup_ready', { restaurant_name: 'Ye Olde', short_id: 'ABC123', guest_language: 'de' }),
  row('s3', R_BUC, 'reservation_reminder', { restaurant_name: 'Bistro', starts_at: FUTURE_ISO, party_size: 3, confirmation_code: 'RO000001', guest_language: null }),
  row('s4', R_GONE, 'reservation_confirmed', { restaurant_name: 'Gone', starts_at: FUTURE_ISO, party_size: 2, confirmation_code: 'GO000001' }),
  row('s5', R_LON, 'reservation_reminder', { restaurant_name: 'Ye Olde', starts_at: FUTURE_ISO, party_size: 2, confirmation_code: 'EN000001' }),
]
const REST = {
  [R_LON]: { timezone: 'Europe/London', language: 'en', country: 'GB' },
  [R_BUC]: { timezone: 'Europe/Bucharest', language: 'ro', country: 'RO' },
}

function script({ restaurantsError = null, countryError = null } = {}) {
  state.rpcHandlers.claim_sms_batch = () => ({ data: ROWS, error: null })
  state.fromHandlers.sms_queue = () => ({ data: null, error: null })
  state.fromHandlers.restaurants = (ops) => {
    const sel = String((ops.find((o) => o.m === 'select') || { args: [''] }).args[0])
    if (restaurantsError) return { data: null, error: restaurantsError }
    if (countryError && sel.includes('country')) return { data: null, error: countryError }
    const ids = (ops.find((o) => o.m === 'in') || { args: [null, []] }).args[1]
    return { data: ids.filter((id) => id in REST).map((id) => ({ id, ...REST[id] })), error: null }
  }
}
const bodyFor = (code) => {
  const m = sent.find((b) => b.body.includes(code))
  assert.ok(m, `niciun SMS cu ${code}`)
  return m.body
}
const hhmm = (iso, tz) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz })

describe('SM6: limba și fusul se rezolvă pe lot, prin handler', () => {
  it('o interogare pe restaurants; germana + Londra pe rezervare, engleza pe pickup, româna pe local necunoscut', async () => {
    script()
    const res = await loadFunction(REL).handler({})
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(JSON.parse(res.body).sent, 5)

    const calls = state.fromCalls.filter((c) => c.table === 'restaurants')
    assert.equal(calls.length, 1, 'o interogare per rând')
    const ids = calls[0].ops.find((o) => o.m === 'in').args[1]
    assert.deepEqual([...ids].sort(), [R_LON, R_BUC, R_GONE].sort(), 'id-urile nu sunt unice')

    const de = bodyFor('DE000001')
    assert.ok(de.includes('Reservierung bestätigt'), de)
    assert.ok(de.includes(hhmm(FUTURE_ISO, 'Europe/London')), `ora Londrei lipsește: ${de}`)
    assert.ok(bodyFor('#ABC123').includes('is ready for pickup'), 'pickup-ul nu e pe limba localului')
    assert.ok(bodyFor('EN000001').includes('Reminder - booking'), 'fără limbă stocată → limba localului')
    const ro = bodyFor('RO000001')
    assert.ok(ro.includes('Reminder rezervare') && ro.includes(hhmm(FUTURE_ISO, 'Europe/Bucharest')), ro)
    const gone = bodyFor('GO000001')
    assert.ok(gone.includes('Rezervare confirmata') && gone.includes(hhmm(FUTURE_ISO, 'Europe/Bucharest')), gone)
    for (const b of sent) assert.ok(isGsm7(b.body), b.body)
  })
})

describe('SM7: toleranță — orice eșec dă română pe București', () => {
  for (const [label, opts, expectedCalls] of [
    ['42703 pe country, apoi succes', { countryError: { code: '42703', message: 'column restaurants.country does not exist' } }, 2],
    ['eroare pe ambele încercări', { restaurantsError: { code: '42501', message: 'permission denied' } }, 2],
  ]) {
    it(label, async () => {
      script(opts)
      const warns = []
      const savedWarn = console.warn
      console.warn = (...a) => warns.push(a.join(' '))
      try {
        const res = await loadFunction(REL).handler({})
        assert.equal(JSON.parse(res.body).sent, 5)
      } finally {
        console.warn = savedWarn
      }
      assert.equal(state.fromCalls.filter((c) => c.table === 'restaurants').length, expectedCalls)
      const de = bodyFor('DE000001')
      if (opts.countryError) {
        assert.ok(de.includes('Reservierung bestätigt'), 'a doua încercare (fără country) n-a fost folosită')
      } else {
        // Fără restaurante, limba stocată a oaspetelui rămâne: germana pe București.
        assert.ok(de.includes('Reservierung bestätigt') && de.includes(hhmm(FUTURE_ISO, 'Europe/Bucharest')), de)
        const pickup = bodyFor('#ABC123')
        assert.equal(pickup, TEMPLATES.pickup_ready(ROWS[1].template_data), 'pickup-ul nu a ieșit byte-identic cu româna de dinainte')
        assert.ok(warns.some((w) => w.includes('[emailLang]')), 'eșecul nu e logat')
      }
    })
  }

  it('template_data null și limbă stocată gunoi nu aruncă', () => {
    assert.doesNotThrow(() => TEMPLATES.reservation_confirmed(null, { lang: 'de', timeZone: 'Europe/Berlin' }))
    assert.doesNotThrow(() => TEMPLATES.pickup_ready(undefined))
    assert.equal(resolveGuestLang({ x: 1 }, 42), 'ro')
  })
})

describe('SM8: lista limbilor oaspetelui e aceeași în SQL, în worker și în client', () => {
  it('CHECK-ul, normalizarea din RPC, GUEST_LANGS și RESERVATION_GUEST_LANGS coincid', () => {
    const root = path.join(__dirname, '..', '..')
    const dir = path.join(root, 'supabase', 'migrations')
    let check = null
    let rpc = null
    for (const f of fs.readdirSync(dir).sort()) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8')
      const c = /add constraint reservations_guest_language_check[\s\S]*?in \(([^)]*)\)\)/.exec(sql)
      if (c) check = [...c[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1])
      if (/function public\.create_reservation_public\(/.test(sql)) {
        const a = /v_guest_lang = any \(array\[([^\]]*)\]\)/.exec(sql)
        rpc = a ? [...a[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]) : null
      }
    }
    const client = /RESERVATION_GUEST_LANGS: readonly string\[\] = \[([^\]]*)\]/.exec(
      fs.readFileSync(path.join(root, 'src', 'lib', 'reservations.ts'), 'utf8'),
    )
    assert.ok(check && check.includes('ro'), 'CHECK-ul pe guest_language nu e găsit')
    assert.ok(rpc && rpc.includes('ro'), 'normalizarea din ultima definiție a create_reservation_public nu e găsită')
    assert.ok(client, 'RESERVATION_GUEST_LANGS nu e găsit')
    const sorted = (l) => [...l].sort()
    assert.deepEqual(sorted(check), sorted(GUEST_LANGS))
    assert.deepEqual(sorted(rpc), sorted(GUEST_LANGS))
    assert.deepEqual(sorted([...client[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1])), sorted(GUEST_LANGS))
  })
})

describe('SM9: fiecare câmp trece prin transliterare, nu doar numele', () => {
  it('telefonul localului, persoanele, codul și short_id-ul ostile → transliterarea exactă, în toate limbile', () => {
    const d = {
      restaurant_name: 'Bistro',
      restaurant_phone: '0722 000 111 – rezervări [L-V]',
      starts_at: ISO,
      party_size: '4–5',
      confirmation_code: 'AB‑12„x”',
      short_id: 'A–1€',
    }
    for (const lang of GUEST_LANGS) {
      const ctx = { lang, timeZone: 'Europe/Bucharest' }
      for (const kind of ['reservation_confirmed', 'reservation_reminder']) {
        const text = TEMPLATES[kind](d, ctx)
        assert.ok(isGsm7(text), `${lang}/${kind}: ${JSON.stringify(text)}`)
        assert.ok(text.endsWith(' 0722 000 111 - rezervari (L-V)'), `${lang}/${kind}: telefonul: ${text}`)
        assert.ok(text.includes('4-5'), `${lang}/${kind}: persoanele: ${text}`)
        assert.ok(text.includes('AB-12"x"'), `${lang}/${kind}: codul: ${text}`)
      }
      const pickup = TEMPLATES.pickup_ready(d, ctx)
      assert.ok(isGsm7(pickup) && pickup.includes('#A-1EUR'), `${lang}/pickup: ${pickup}`)
    }
  })
})

describe('SM10: registrul fluxului oaspetelui și frazele corecte', () => {
  // Marcajele registrului CELĂLALT, pe cuvinte întregi. `\b` din JS e doar
  // ASCII („Ön” n-ar fi prins niciodată), deci granița e pe literele Unicode.
  const words = (...w) => new RegExp(`(?<!\\p{L})(${w.join('|')})(?!\\p{L})`, 'iu')
  const FORBIDDEN = {
    de: words('Sie', 'Ihr', 'Ihre', 'Ihren', 'Ihrem', 'Ihrer', 'Ihres', 'Ihnen'),
    hu: words('Ön', 'Önt', 'Önnek', 'tud', 'Varjuk', 'Várjuk'),
    it: words('Lei', 'Suo', 'Sua', 'riesce', 'può'),
    es: words('usted', 'puede', 'Lo esperamos', 'Le esperamos'),
    fr: words('tu', 'ton', 'ta', 'tes', 'te'),
  }
  it('controlul: marcajele chiar se potrivesc pe textele în registrul celălalt', () => {
    assert.ok(FORBIDDEN.de.test('Erinnerung an Ihre Reservierung'))
    assert.ok(FORBIDDEN.hu.test(' Nem tud jonni?') && FORBIDDEN.hu.test('Kérjük, Ön'))
    assert.ok(!FORBIDDEN.hu.test(' Nem tudsz jonni?'))
    assert.ok(FORBIDDEN.fr.test('Ta commande'))
  })
  it('niciun marcaj al registrului celălalt în textele SMS', () => {
    for (const [lang, re] of Object.entries(FORBIDDEN)) {
      for (const [k, v] of Object.entries(SMS_STRINGS[lang])) assert.ok(!re.test(v), `${lang}.${k}: ${v}`)
    }
    assert.ok(/\bdeine\b/.test(SMS_STRINGS.de.reminder), SMS_STRINGS.de.reminder)
    assert.ok(/\btudsz\b/.test(SMS_STRINGS.hu.reminder_phone), SMS_STRINGS.hu.reminder_phone)
  })

  it('italiana „è pronto”, franceza fără „a” în loc de „à”', () => {
    const it_ = TEMPLATES.pickup_ready({ restaurant_name: 'Trattoria', short_id: 'A1' }, { lang: 'it', timeZone: 'Europe/Rome' })
    assert.equal(it_, "Trattoria: L'ordine #A1 è pronto per il ritiro. A presto!")
    const fr = TEMPLATES.pickup_ready({ restaurant_name: 'Bistro', short_id: 'A1' }, { lang: 'fr', timeZone: 'Europe/Paris' })
    assert.equal(fr, 'Bistro: Votre commande #A1 vous attend, à tout de suite !')
    for (const v of Object.values(SMS_STRINGS.fr)) assert.ok(!/ a (retirer|tout)\b/.test(v), v)
  })
})
