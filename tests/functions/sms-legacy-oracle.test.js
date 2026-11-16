// tests/functions/sms-legacy-oracle.test.js
// ORACOLUL pe română (lotul L8b): SMS-urile în limba oaspetelui NU au voie să
// schimbe nimic pentru un oaspete român la un local pe București.
//
//   SO0  hash-ul copiei vechi (fixtures/legacy/process-sms-queue.40d3033.js)
//        e cel înghețat aici: oracolul NU se „repară” ca să egaleze codul nou.
//        [PICĂ: orice octet schimbat în copia veche]
//   SO1  pentru TOATE cele 3 șabloane (fiecare caz + `{}`), textul codului NOU pe
//        contextul românesc (ro, Europe/Bucharest) e EGAL byte cu byte cu codul
//        VECHI; ambele randate într-un proces copil cu TZ=Europe/Bucharest.
//        Anti-vacuitate: fiecare valoare din `must` apare în ieșirea VECHE (deci
//        cazul exersează ramura pe care pretinde că o exersează — telefonul,
//        ramura de rezervă de 160, numele de peste 30/40 de caractere, ora de
//        după miezul nopții, ziua schimbării de oră, numele cu litere ne-ASCII
//        care SUNT în tabela GSM-7 de bază — „Café Müller”, „Bäckerei Größe”,
//        „Øresund Kro” —, telefonul cu „@”/„£”), fiecare `mustNot` lipsește,
//        iar fiecare kind din TEMPLATES are cazuri.
//        [PICĂ: un caracter schimbat într-un șir `ro` din lib/smsText.js;
//         `slice(0, 30)` scos; luna cu punct; ramura de rezervă scoasă; o literă
//         din tabela de bază transliterată (Café → Cafe)]
//   SO2  independența de GAZDĂ: codul nou (context românesc) dă EXACT ieșirea din
//        SO1 și în copii cu TZ=UTC, America/Los_Angeles și Pacific/Kiritimati.
//        Controlul care împiedică SO2 să fie vacuu: offset-ul gazdei raportat de
//        copil chiar diferă între cele patru rulări.
//        [PICĂ: `timeZone` scos din formatul orei]
//   SO3  SINGURELE diferențe față de codul vechi: textele pe care codul vechi le
//        lăsa în afara tabelei GSM-7 de BAZĂ — ê, ghilimele și liniuțe
//        tipografice, NBSP, ă în telefonul localului (codul vechi transliterea
//        doar ă/â/î/ș/ț și doar în nume, deci mesajul pleca pe UCS-2), tabela
//        EXTINSĂ (`[`, `€` — 2 septete) și caracterele invizibile (ZWSP). Pe ele
//        codul nou dă EXACT `toGsm7(<textul vechi>)`, iar textul vechi chiar NU
//        era GSM-7 de bază (controlul: `!isGsm7`, nu „ne-ASCII” — „Café” e
//        GSM-7 și e în SO1, byte-identic); al doilea control cere ca textul
//        nou chiar să difere de cel vechi.
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const LEGACY = path.join(__dirname, 'fixtures', 'legacy', 'process-sms-queue.40d3033.js')
const RENDER = path.join(__dirname, 'helpers', 'render-sms.js')
// sha256 al `git show 40d3033:netlify/functions/process-sms-queue.js`.
const LEGACY_SHA256 = 'c73d95ea1389d85badea149f2c998d24b0e8e52f9b528c690ca27184e1a3dbf1'
const RO_CTX = { lang: 'ro', timeZone: 'Europe/Bucharest' }

const LONG_PHONE = '+40 722 000 111 / +40 744 000 222 / +40 755 000 333 / +40 766 000 444 (rezervari doar dupa ora 12)'

// Fiecare caz: datele așa cum le pun triggerele (228) / send-reservation-reminders.js
// în template_data, plus ce TREBUIE (și ce NU trebuie) să apară în ieșirea veche.
const CASES = {
  reservation_confirmed: [
    { label: 'complet', data: { customer_name: 'Ana', restaurant_name: 'Bistro Ștefan', restaurant_phone: '+40 722 000 111', starts_at: '2026-07-15T17:30:00Z', party_size: 4, confirmation_code: 'AB12CD34' },
      must: ['Bistro Stefan:', '15 iul 20:30', '4 pers', 'AB12CD34', 'Modificari? +40 722 000 111'] },
    { label: 'fără telefon', data: { restaurant_name: 'Bistro', starts_at: '2026-01-10T18:00:00Z', party_size: 2, confirmation_code: 'ZZ99YY88' },
      must: ['10 ian 20:00', 'ZZ99YY88'], mustNot: ['Modificari'] },
    { label: 'telefon lung → ramura de rezervă', data: { restaurant_name: 'Bistro', restaurant_phone: LONG_PHONE, starts_at: '2026-09-20T16:00:00Z', party_size: 12, confirmation_code: 'LONG0001' },
      must: ['20 sept 19:00', 'LONG0001'], mustNot: ['Modificari', '+40 744'] },
    { label: 'nume peste 30 cu diacritice', data: { restaurant_name: 'Restaurantul Țărănesc din Câmpulung Muscel', starts_at: '2026-05-01T09:00:00Z', party_size: 3, confirmation_code: 'NAME3000' },
      must: ['Restaurantul Taranesc din Camp:'], mustNot: ['Campulung'] },
    { label: 'după miezul nopții (ziua următoare la București)', data: { restaurant_name: 'Noapte', starts_at: '2026-03-14T22:30:00Z', party_size: 2, confirmation_code: 'NIGHT001' },
      must: ['15 mar 00:30'] },
    { label: 'ziua schimbării de oră', data: { restaurant_name: 'Ora', starts_at: '2026-03-29T01:30:00Z', party_size: 2, confirmation_code: 'DST00001' },
      must: ['29 mar 04:30'] },
    { label: 'forma jsonb a timestamptz-ului', data: { restaurant_name: 'Jsonb', starts_at: '2026-12-24T18:15:00+00:00', party_size: '6', confirmation_code: 'XMAS2026' },
      must: ['24 dec 20:15', '6 pers'] },
    { label: 'dată ne-parsabilă', data: { restaurant_name: 'Strict', starts_at: 'nu-e-o-data', party_size: 2, confirmation_code: 'BAD00001' },
      must: ['BAD00001'] },
    { label: 'nume GSM-7 de bază, ne-ASCII', data: { restaurant_name: 'Café Müller', restaurant_phone: '0722 000 111 @ £', starts_at: '2026-07-15T17:30:00Z', party_size: 2, confirmation_code: 'CAFE0001' },
      must: ['Café Müller:', 'Modificari? 0722 000 111 @ £'] },
  ],
  reservation_reminder: [
    { label: 'complet', data: { restaurant_name: 'Casa Veche', restaurant_phone: '0264 000 111', starts_at: '2026-11-17T18:00:00Z', party_size: 5, confirmation_code: 'REM00001' },
      must: ['Casa Veche: Reminder rezervare 17 nov 20:00', '5 pers', 'REM00001', 'Nu ajungi? 0264 000 111'] },
    { label: 'fără telefon', data: { restaurant_name: 'Casa Veche', starts_at: '2026-06-01T07:00:00Z', party_size: 1, confirmation_code: 'REM00002' },
      must: ['1 iun 10:00'], mustNot: ['Nu ajungi'] },
    { label: 'telefon lung → ramura de rezervă', data: { restaurant_name: 'Casa Veche', restaurant_phone: LONG_PHONE, starts_at: '2026-08-08T12:00:00Z', party_size: 20, confirmation_code: 'REM00003' },
      must: ['8 aug 15:00', 'REM00003'], mustNot: ['Nu ajungi'] },
    { label: 'nume GSM-7 de bază, ne-ASCII', data: { restaurant_name: 'Øresund Kro & Ñoño', starts_at: '2026-08-08T12:00:00Z', party_size: 2, confirmation_code: 'REM00004' },
      must: ['Øresund Kro & Ñoño:'] },
  ],
  pickup_ready: [
    { label: 'complet', data: { customer_name: 'Ion', short_id: 'ABC123', restaurant_name: 'Pizzeria Ăla Bun', pickup_time: '2026-11-16T12:00:00Z' },
      must: ['Pizzeria Ala Bun: Comanda #ABC123 este gata de ridicare. Te asteptam!'] },
    { label: 'nume peste 40', data: { short_id: 'DEF456', restaurant_name: 'Brutăria și Patiseria Tradițională a Bunicii din Sibiu' },
      must: ['Brutaria si Patiseria Traditionala a Bun:', '#DEF456'], mustNot: ['Bunicii'] },
    { label: 'nume GSM-7 de bază, ne-ASCII', data: { short_id: 'GHI789', restaurant_name: 'Bäckerei Größe' },
      must: ['Bäckerei Größe:'] },
  ],
}

// Textele pe care codul vechi le lăsa în afara tabelei GSM-7 de BAZĂ (SO3).
const NON_GSM = [
  { kind: 'reservation_confirmed', data: { restaurant_name: 'Crêperie Façade', starts_at: '2026-07-15T17:30:00Z', party_size: 2, confirmation_code: 'CREP0002' } },
  { kind: 'reservation_reminder', data: { restaurant_name: 'Crêperie “La Mare”', starts_at: '2026-07-15T17:30:00Z', party_size: 2, confirmation_code: 'CREP0001', restaurant_phone: '0722 000 111' } },
  { kind: 'pickup_ready', data: { restaurant_name: 'Mama’s – Grill', short_id: 'MAM001' } },
  { kind: 'reservation_confirmed', data: { restaurant_name: 'Bistro', restaurant_phone: '0722\u00a0000 111 – rezervări [L-V]', starts_at: '2026-07-15T17:30:00Z', party_size: 2, confirmation_code: 'PHON0001' } },
  { kind: 'reservation_reminder', data: { restaurant_name: 'Pizza [Napoli] €5', starts_at: '2026-07-15T17:30:00Z', party_size: 2, confirmation_code: 'EXT00001' } },
  { kind: 'pickup_ready', data: { restaurant_name: 'Casa\u200bVeche', short_id: 'ZWS001' } },
]

function render(mode, tz, cases) {
  const r = spawnSync(process.execPath, [RENDER, JSON.stringify({ mode, cases })], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (r.status !== 0) throw new Error(`render ${mode}/${tz} a eșuat: ${r.stderr}`)
  return JSON.parse(r.stdout)
}

const ALL = []
for (const [kind, list] of Object.entries(CASES)) {
  for (const c of list) ALL.push({ kind, ...c })
  ALL.push({ kind, label: '{}', data: {}, must: [], mustNot: [] })
}
const withCtx = (cases) => cases.map(({ kind, data }) => ({ kind, data, ctx: RO_CTX }))

let OLD
let NEW
before(() => {
  OLD = render('old', 'Europe/Bucharest', ALL.map(({ kind, data }) => ({ kind, data })))
  NEW = render('new', 'Europe/Bucharest', withCtx(ALL))
})

describe('SO0: oracolul e copia exactă a worker-ului vechi', () => {
  it('sha256 neschimbat', () => {
    const h = crypto.createHash('sha256').update(fs.readFileSync(LEGACY)).digest('hex')
    assert.equal(h, LEGACY_SHA256, 'copia veche a fost modificată — oracolul nu se „repară”')
  })
})

describe('SO1: româna pe București e BYTE-identică pe toate cele 3 șabloane', () => {
  it('anti-vacuitate: fiecare kind are cazuri, iar fiecare caz exersează ce pretinde', () => {
    const { TEMPLATES } = require('./helpers/mocks').loadFunction('netlify/functions/process-sms-queue.js')
    assert.deepEqual(Object.keys(TEMPLATES).sort(), Object.keys(CASES).sort())
    for (let i = 0; i < ALL.length; i++) {
      const { kind, label, must = [], mustNot = [] } = ALL[i]
      const out = OLD.out[i]
      assert.ok(!out.error, `${kind}/${label}: codul vechi a aruncat: ${out.error}`)
      for (const v of must) assert.ok(out.text.includes(v), `${kind}/${label}: „${v}” lipsește din ieșirea veche: ${out.text}`)
      for (const v of mustNot) assert.ok(!out.text.includes(v), `${kind}/${label}: „${v}” apare în ieșirea veche: ${out.text}`)
    }
  })

  it('fiecare caz: textul nou = textul vechi', () => {
    assert.equal(NEW.out.length, ALL.length)
    for (let i = 0; i < ALL.length; i++) {
      const { kind, label } = ALL[i]
      assert.ok(!NEW.out[i].error, `${kind}/${label}: codul nou a aruncat: ${NEW.out[i].error}`)
      assert.equal(NEW.out[i].text, OLD.out[i].text, `${kind}/${label}`)
    }
  })
})

describe('SO2: codul nou nu depinde de fusul gazdei', () => {
  it('UTC, Los Angeles și Kiritimati → aceeași ieșire ca pe București (iar fusul copilului chiar diferă)', () => {
    const offsets = new Set([NEW.hostOffset])
    for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      const r = render('new', tz, withCtx(ALL))
      offsets.add(r.hostOffset)
      for (let i = 0; i < ALL.length; i++) {
        assert.equal(r.out[i].text, NEW.out[i].text, `${ALL[i].kind}/${ALL[i].label}@${tz}`)
      }
    }
    assert.equal(offsets.size, 4, `TZ-ul copilului n-a avut efect: offset-uri ${[...offsets]}`)
  })
})

describe('SO3: singurele diferențe — textele pe care codul vechi le lăsa în afara GSM-7', () => {
  it('codul nou = toGsm7(textul vechi), iar textul vechi chiar nu era GSM-7 de bază', () => {
    const { toGsm7, isGsm7 } = require('../../netlify/functions/lib/smsText')
    const old = render('old', 'Europe/Bucharest', NON_GSM)
    const neu = render('new', 'Europe/Bucharest', NON_GSM.map((c) => ({ ...c, ctx: RO_CTX })))
    for (let i = 0; i < NON_GSM.length; i++) {
      const o = old.out[i].text
      const n = neu.out[i].text
      assert.ok(!isGsm7(o), `controlul: textul vechi era deja GSM-7 de bază — cazul ține de SO1, nu de SO3: ${o}`)
      assert.notEqual(n, o, `controlul: textul nou e identic cu cel vechi — cazul nu arată nimic: ${o}`)
      assert.ok(isGsm7(n), `textul nou nu e GSM-7 de bază: ${n}`)
      assert.equal(n, toGsm7(o), 'diferența nu e DOAR transliterarea')
    }
  })
})
