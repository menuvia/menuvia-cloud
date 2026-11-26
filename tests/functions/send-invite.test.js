// tests/functions/send-invite.test.js
// O invitație nouă NU mai șterge alte invitații.
//
// De ce există: send-invite ștergea invitațiile în așteptare cu
// `.ilike('email', dbEmail)` — adresa NEESCAPATĂ într-un pattern LIKE, unde `_`
// și `%` sunt wildcard-uri (iar PostgREST tratează și `*` ca `%`). Și le ștergea
// ÎNAINTE de a crea și trimite invitația nouă: un insert sau un email eșuat
// lăsa omul fără niciun link valid.
//
//   INV1  `_` din adresă e escapat în AMBELE filtre ilike (profil + curățare).
//         Mutația care pică: `.ilike('email', dbEmail)` neescapat.
//   INV2  `%`, `*`, `\` în adresă → 400 invalid_email, nicio scriere. `%@%.%`
//         trecea de regex și ștergea toate invitațiile restaurantului.
//   INV3  ordinea: insert → email → abia apoi curățarea celorlalte invitații,
//         cu `neq token` (invitația nouă nu se șterge singură), pe restaurant
//         și doar `accepted_at is null`. Mutația care pică: ștergerea înainte
//         de insert (ordinea veche).
//   INV4  Resend refuză (4xx) → 502 email_send_failed; se șterge DOAR invitația
//         nouă (după token), cele vechi rămân.
//   INV5  Resend nu răspunde (timeout/rețea) → 504 email_send_uncertain, nicio
//         ștergere (emailul poate să fi plecat).
//   INV6  insert eșuat → 500 invite_create_failed, nicio ștergere.
//   INV7  fără RESEND_API_KEY → 503 înaintea oricărei scrieri.
//   INV8  fiecare eroare e `{ error: <română>, code }`.
//   INV9  (lotul L8a) româna e BYTE-identică: subiectul și HTML-ul trimise la
//         Resend == șablonul de dinainte, copiat literal mai jos, cu un nume de
//         restaurant care cere escapare; și când invitatul are deja
//         `ui_language = 'ro'` ales explicit, peste un invitator german.
//         Mutația care pică: o literă schimbată în `team_invite.ro`.
//   INV10 limba: invitatul (cont existent) > invitatorul > română, doar pe
//         limbile active; handler-ul cere limbile pentru AMBII.
//         Mutația care pică: ordinea inversată în resolveInviteLang.
//   INV11 toleranță: o bază fără mig 323 (select cu `ui_language` → 42703)
//         NU strică numele: emailul pleacă cu „Ana” și „Bistro”, iar
//         interogarea de limbă chiar a fost făcută (control).
//         Mutația care pică: `ui_language` în același select cu `full_name, email`.
//   INV12 linkul de acceptare NU primește `?lang=` (pe pagină ar deveni
//         preferința DISPOZITIVULUI invitatului); în afara românei primește
//         `?hl=<limba emailului>`, indiciul NEPERSISTENT al paginii.
//   INV14 (activarea limbilor) cap-coadă prin handler: invitatul 'en' primește
//         emailul în engleză cu `?hl=en`; fără cont, limba invitatorului 'de'
//         dă germana cu `?hl=de`. Mutația care pică: `?hl=` scos din link sau
//         limba ignorată în handler.
//   INV13 numele lipsesc din DB (restaurant/profil null) → rezerva e în limba
//         emailului: pe română EXACT „restaurantul tău” / „Un coleg” (byte-
//         identic cu șablonul vechi), în en/fr/de fără niciun rest românesc.
//         Mutația care pică: rezerva literală românească în renderInviteEmail
//         (`s.restaurant_anon` → 'restaurantul tău').
//   INV15 (lotul C7b) echipa completă: membri (owner inclus) + invitațiile în
//         așteptare ale ALTOR adrese ating limita din `get_restaurant_features`
//         → 409 `team_member_limit`, în română, fără nume de plan (mig 290),
//         ÎNAINTEA oricărei scrieri și a emailului. Control POZITIV: cu un loc
//         liber invitația pleacă (200). Mutația care pică: verificarea scoasă
//         sau `>` în loc de `>=`.
//   INV16 invitația în așteptare a ACELEIAȘI adrese (orice majuscule) nu ocupă
//         un loc în plus — se înlocuiește; două rânduri pentru altă adresă
//         ocupă UN loc. Mutația care pică: rândurile numărate fără deduplicare
//         sau fără excluderea adresei invitate acum.
//   INV17 forma numărătorii: membrii cu `count: 'exact', head: true` pe
//         restaurant, invitațiile pe restaurant + `accepted_at is null` +
//         `gt expires_at` (neexpirate) — o invitație expirată nu ține un loc.
//         Mutația care pică: filtrul de expirare scos.
//   INV18 limita necunoscută NU blochează (trigger-ul din DATE rămâne
//         autoritatea): nelimitat (`limit: null`) → 200 fără nicio numărătoare;
//         RPC-ul picat sau numărătoarea eșuată → 200, invitația pleacă; iar un
//         membru existent primește tot `already_member`, nu `team_member_limit`.
//         Mutația care pică: fail-closed pe eroarea RPC-ului.
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).

'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { state, resetMocks, loadFunction, parseBody, rpcCallsFor } = require('./helpers/mocks')

const REL = 'netlify/functions/send-invite.js'
const RID = 'rest-1'
const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'VITE_APP_URL']

let saved
let savedFetch
let resend
let resendImpl

beforeEach(() => {
  resetMocks()
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://sb.example',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    RESEND_API_KEY: 're_test',
  })
  savedFetch = global.fetch
  resend = []
  resendImpl = async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ id: 'em_1' }) })
  global.fetch = async (url, init) => {
    resend.push({ url: String(url), body: JSON.parse(init.body) })
    return resendImpl()
  }
  state.authUser = { id: 'owner-1' }
  state.rpcHandlers['check_rate_limit'] = () => ({ data: true, error: null })
  state.fromHandlers['restaurant_memberships'] = (ops) =>
    ops.some((o) => o.m === 'select' && o.args[0] === 'role')
      ? { data: { role: 'owner' }, error: null }
      : { data: null, error: null }
  state.fromHandlers['restaurants'] = () => ({ data: { name: 'Bistro' }, error: null })
  state.fromHandlers['profiles'] = (ops) =>
    ops.some((o) => o.m === 'ilike')
      ? { data: null, error: null }
      : { data: { full_name: 'Ana', email: 'ana@x.test' }, error: null }
  state.fromHandlers['invite_tokens'] = (ops) =>
    ops.some((o) => o.m === 'insert')
      ? { data: { token: 'tok-new' }, error: null }
      : { data: null, error: null }
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  global.fetch = savedFetch
})

async function invite(email, extra) {
  const { handler } = loadFunction(REL)
  const savedErr = console.error
  console.error = () => {}
  try {
    return await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer jwt' },
      body: JSON.stringify({ email, role: 'waiter', restaurant_id: RID, ...extra }),
    })
  } finally {
    console.error = savedErr
  }
}

// Operațiile pe invite_tokens, în ordinea execuției.
const inviteOps = () => state.fromCalls.filter((c) => c.table === 'invite_tokens').map((c) => c.ops)
const isDelete = (ops) => ops.some((o) => o.m === 'delete')
const isInsert = (ops) => ops.some((o) => o.m === 'insert')
const argOf = (ops, m) => {
  const op = ops.find((o) => o.m === m)
  return op ? op.args : undefined
}

function expectError(res, status, code) {
  assert.equal(res.statusCode, status, res.body)
  const b = parseBody(res)
  assert.equal(b.code, code, res.body)
  assert.match(b.error, /[ăâîșțĂÂÎȘȚ]/, `mesaj ne-românesc: ${b.error}`)
}

describe('send-invite: o invitație nouă nu mai șterge alte invitații', () => {
  it('INV1: `_` din adresă e escapat în ambele filtre ilike', async () => {
    const res = await invite('ana_pop@x.ro')
    assert.equal(res.statusCode, 200, res.body)
    const profileLookup = state.fromCalls.find(
      (c) => c.table === 'profiles' && c.ops.some((o) => o.m === 'ilike'),
    )
    assert.deepEqual(argOf(profileLookup.ops, 'ilike'), ['email', 'ana\\_pop@x.ro'])
    const cleanup = inviteOps().find(isDelete)
    assert.deepEqual(argOf(cleanup, 'ilike'), ['email', 'ana\\_pop@x.ro'])
  })

  for (const email of ['%@%.%', 'a*b@x.ro', 'a\\b@x.ro', 'x%y@x.ro']) {
    it(`INV2: ${JSON.stringify(email)} → 400 invalid_email, nicio scriere`, async () => {
      const res = await invite(email)
      expectError(res, 400, 'invalid_email')
      assert.equal(inviteOps().length, 0, 'invitațiile au fost atinse')
      assert.equal(resend.length, 0)
    })
  }

  it('INV3: insert → email → curățarea CELORLALTE invitații, după token', async () => {
    const res = await invite('Ion@X.ro')
    assert.equal(res.statusCode, 200, res.body)
    const ops = inviteOps()
    const firstDelete = ops.findIndex(isDelete)
    const insertAt = ops.findIndex(isInsert)
    assert.ok(insertAt >= 0, 'invitația nouă nu s-a creat')
    assert.ok(firstDelete > insertAt, 'invitațiile vechi s-au șters ÎNAINTE de a crea invitația nouă')
    assert.equal(resend.length, 1)
    const cleanup = ops[firstDelete]
    assert.deepEqual(argOf(cleanup, 'neq'), ['token', 'tok-new'], 'curățarea ar șterge chiar invitația nouă')
    assert.deepEqual(argOf(cleanup, 'eq'), ['restaurant_id', RID])
    assert.deepEqual(argOf(cleanup, 'is'), ['accepted_at', null])
    assert.deepEqual(argOf(cleanup, 'ilike'), ['email', 'Ion@X.ro'])
    assert.equal(ops.filter(isDelete).length, 1)
  })

  it('INV4: Resend refuză → 502, se șterge DOAR invitația nouă', async () => {
    resendImpl = async () => ({ ok: false, status: 422, text: async () => '{"message":"invalid"}' })
    const res = await invite('ion@x.ro')
    expectError(res, 502, 'email_send_failed')
    const deletes = inviteOps().filter(isDelete)
    assert.equal(deletes.length, 1)
    assert.equal(argOf(deletes[0], 'ilike'), undefined, 'ștergere pe adresă = invitațiile vechi pierdute')
    const eqs = deletes[0].filter((o) => o.m === 'eq').map((o) => o.args)
    assert.deepEqual(eqs, [
      ['restaurant_id', RID],
      ['token', 'tok-new'],
    ])
  })

  it('INV5: Resend nu răspunde → 504, nicio ștergere', async () => {
    resendImpl = async () => {
      const e = new Error('The operation was aborted due to timeout')
      e.name = 'TimeoutError'
      throw e
    }
    const res = await invite('ion@x.ro')
    expectError(res, 504, 'email_send_uncertain')
    assert.equal(inviteOps().filter(isDelete).length, 0)
  })

  it('INV6: insert eșuat → 500, invitațiile vechi neatinse', async () => {
    state.fromHandlers['invite_tokens'] = (ops) =>
      isInsert(ops) ? { data: null, error: { message: 'boom' } } : { data: null, error: null }
    const res = await invite('ion@x.ro')
    expectError(res, 500, 'invite_create_failed')
    assert.equal(inviteOps().filter(isDelete).length, 0, 'invitațiile vechi s-au șters fără una nouă')
    assert.equal(resend.length, 0)
  })

  it('INV7: fără RESEND_API_KEY → 503 înaintea oricărei scrieri', async () => {
    delete process.env.RESEND_API_KEY
    const res = await invite('ion@x.ro')
    expectError(res, 503, 'email_not_configured')
    assert.equal(state.fromCalls.length, 0)
    assert.equal(rpcCallsFor('check_rate_limit').length, 0)
  })

  it('INV8: erorile de validare / drepturi sunt în română, cu cod', async () => {
    expectError(await invite('', {}), 400, 'missing_fields')
    expectError(await invite('ion@x.ro', { role: 'owner' }), 400, 'invalid_role')
    state.fromHandlers['restaurant_memberships'] = () => ({ data: { role: 'waiter' }, error: null })
    expectError(await invite('ion@x.ro'), 403, 'forbidden')
    state.authUser = null
    expectError(await invite('ion@x.ro'), 401, 'auth_invalid')
    const { handler } = loadFunction(REL)
    expectError(await handler({ httpMethod: 'GET', headers: {} }), 405, 'method_not_allowed')
  })
})

// ── Lotul L8a: limba invitației ─────────────────────────────────────────────
const { LEGACY_NETLIFY_URL } = require('../../netlify/functions/lib/appUrl')
const OWNER_UUID = '32700000-0000-4000-8000-0000000000e1'
const INVITEE_UUID = '32700000-0000-4000-8000-0000000000e2'

// Șablonul de DINAINTE (git show 30a6400:netlify/functions/send-invite.js),
// copiat literal — oracolul pentru română.
function legacyInvite({ subjectRestaurantName, safeRestaurantName, safeInvitedBy, roleLabel, acceptUrl }) {
  return {
    subject: `Ai fost invitat la ${subjectRestaurantName} pe Menuvia`,
    html: `
        <div style="font-family:'DM Sans',sans-serif;max-width:520px;margin:0 auto;background:#0F0F0F;border-radius:16px;padding:40px;color:#F0EAE0;">
          <div style="font-family:Georgia,serif;font-size:24px;color:#C8963C;margin-bottom:24px;">Menuvia</div>
          <h2 style="font-family:Georgia,serif;font-size:20px;color:#F0EAE0;margin-bottom:12px;">
            Ai fost invitat la <strong>${safeRestaurantName}</strong>
          </h2>
          <p style="color:#9A9590;line-height:1.6;margin-bottom:8px;">
            ${safeInvitedBy} te-a invitat ca <strong style="color:#E2B472">${roleLabel}</strong> pe Menuvia.
          </p>
          <p style="color:#9A9590;line-height:1.6;margin-bottom:28px;">
            Acceptă invitația pentru a accesa dashboardul restaurantului.
          </p>
          <a href="${acceptUrl}" style="display:inline-block;background:#C8963C;color:#000;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;margin-bottom:24px;">
            Acceptă invitația
          </a>
          <p style="color:#4A4844;font-size:12px;line-height:1.5;margin-top:24px;">
            Linkul expiră în 7 zile. Dacă nu ai solicitat această invitație, ignoră acest email.
          </p>
        </div>
      `,
  }
}

const selectOf = (ops) => String((ops.find((o) => o.m === 'select') || { args: [''] }).args[0])

describe('send-invite: limba emailului (lotul L8a)', () => {
  function scriptProfiles({ invitee = null, langs = {}, langError = null } = {}) {
    state.fromHandlers['profiles'] = (ops) => {
      const sel = selectOf(ops)
      if (sel.includes('ui_language')) {
        if (langError) return { data: null, error: langError }
        const ids = (ops.find((o) => o.m === 'in') || { args: [null, []] }).args[1]
        return { data: ids.filter((id) => id in langs).map((id) => ({ id, ui_language: langs[id] })), error: null }
      }
      if (ops.some((o) => o.m === 'ilike')) return { data: invitee ? { id: invitee } : null, error: null }
      return { data: { full_name: 'Ana', email: 'ana@x.test' }, error: null }
    }
    // Invitatul cu cont NU e deja membru (altfel 409).
    state.fromHandlers['restaurant_memberships'] = (ops) =>
      ops.some((o) => o.m === 'select' && o.args[0] === 'role')
        ? { data: { role: 'owner' }, error: null }
        : { data: null, error: null }
  }

  for (const [label, setup] of [
    ['invitat fără cont', () => scriptProfiles()],
    ['invitatul a ales explicit româna, invitatorul e pe germană', () => scriptProfiles({ invitee: INVITEE_UUID, langs: { [INVITEE_UUID]: 'ro', [OWNER_UUID]: 'de' } })],
  ]) {
    it(`INV9: româna byte-identică — ${label}`, async () => {
      state.authUser = { id: OWNER_UUID }
      setup()
      state.fromHandlers['restaurants'] = () => ({ data: { name: "Fish & <Chips>'" }, error: null })
      const res = await invite('ion@x.ro')
      assert.equal(res.statusCode, 200, res.body)
      const want = legacyInvite({
        subjectRestaurantName: "Fish & <Chips>'",
        safeRestaurantName: 'Fish &amp; &lt;Chips&gt;&#39;',
        safeInvitedBy: 'Ana',
        roleLabel: 'Ospătar',
        acceptUrl: `${LEGACY_NETLIFY_URL}/invite/tok-new`,
      })
      assert.equal(resend[0].body.subject, want.subject)
      assert.equal(resend[0].body.html, want.html)
    })
  }

  it('INV10: invitatul > invitatorul > română, pe limbile active; limbile se cer pentru amândoi', async () => {
    const { resolveInviteLang } = require('../../netlify/functions/lib/emailLang')
    const enabled = ['ro', 'en', 'fr']
    assert.equal(resolveInviteLang({ invitee: 'fr', inviter: 'en' }, enabled), 'fr')
    assert.equal(resolveInviteLang({ invitee: undefined, inviter: 'en' }, enabled), 'en')
    assert.equal(resolveInviteLang({ invitee: 'de', inviter: 'de' }, enabled), 'ro')
    // Randarea în limba aleasă (direct; cap-coadă prin handler în INV14).
    const { renderInviteEmail } = loadFunction(REL)
    const en = renderInviteEmail('en', { restaurantName: 'Bistro', invitedByName: 'Ana', roleKey: 'kitchen', acceptUrl: 'https://a/invite/t' })
    assert.equal(en.subject, 'You’ve been invited to Bistro on Menuvia')
    assert.ok(en.html.includes('Ana invited you as <strong style="color:#E2B472">Kitchen</strong> on Menuvia.'))
    // Handler-ul cere limbile pentru invitator ȘI invitatul existent.
    state.authUser = { id: OWNER_UUID }
    scriptProfiles({ invitee: INVITEE_UUID })
    const res = await invite('ion@x.ro')
    assert.equal(res.statusCode, 200, res.body)
    const q = state.fromCalls.filter((c) => c.table === 'profiles' && selectOf(c.ops).includes('ui_language'))
    assert.equal(q.length, 1)
    assert.equal(selectOf(q[0].ops), 'id, ui_language')
    assert.deepEqual([...q[0].ops.find((o) => o.m === 'in').args[1]].sort(), [OWNER_UUID, INVITEE_UUID].sort())
  })

  it('INV11: bază fără mig 323 → numele rămân, emailul pleacă', async () => {
    state.authUser = { id: OWNER_UUID }
    scriptProfiles({ langError: { code: '42703', message: 'column profiles.ui_language does not exist' } })
    const warn = console.warn
    console.warn = () => {}
    let res
    try {
      res = await invite('ion@x.ro')
    } finally {
      console.warn = warn
    }
    assert.equal(res.statusCode, 200, res.body)
    assert.ok(resend[0].body.html.includes('Ana te-a invitat'), 'numele invitatorului s-a pierdut')
    assert.ok(resend[0].body.html.includes('<strong>Bistro</strong>'))
    assert.ok(
      state.fromCalls.some((c) => c.table === 'profiles' && selectOf(c.ops).includes('ui_language')),
      'controlul: interogarea de limbă nici n-a fost făcută',
    )
    const inviterSel = state.fromCalls.find((c) => c.table === 'profiles' && selectOf(c.ops).includes('full_name'))
    assert.equal(selectOf(inviterSel.ops), 'full_name, email', 'numele și limba trebuie să rămână interogări separate')
  })

  it('INV12: linkul de acceptare nu primește `?lang=`', async () => {
    state.authUser = { id: OWNER_UUID }
    scriptProfiles({ invitee: INVITEE_UUID, langs: { [INVITEE_UUID]: 'en' } })
    const res = await invite('ion@x.ro')
    assert.equal(res.statusCode, 200, res.body)
    // Invitatul e pe engleză: linkul poartă indiciul `?hl=en`, niciodată `?lang=`.
    assert.ok(resend[0].body.html.includes(`href="${LEGACY_NETLIFY_URL}/invite/tok-new?hl=en"`), resend[0].body.html)
    assert.ok(!resend[0].body.html.includes('lang='))
    const { renderInviteEmail } = loadFunction(REL)
    for (const l of ['ro', 'en', 'fr', 'de']) {
      const html = renderInviteEmail(l, { restaurantName: 'B', invitedByName: 'A', roleKey: 'waiter', acceptUrl: 'https://a/invite/t' }).html
      assert.ok(html.includes('href="https://a/invite/t"') && !html.includes('lang='), l)
    }
  })

  it('INV14: prin handler, emailul și indiciul `?hl=` în limba invitatului, apoi a invitatorului', async () => {
    state.authUser = { id: OWNER_UUID }
    scriptProfiles({ invitee: INVITEE_UUID, langs: { [INVITEE_UUID]: 'en', [OWNER_UUID]: 'de' } })
    let res = await invite('ion@x.ro')
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(resend[0].body.subject, 'You’ve been invited to Bistro on Menuvia')
    assert.ok(resend[0].body.html.includes(`href="${LEGACY_NETLIFY_URL}/invite/tok-new?hl=en"`), resend[0].body.html)

    // Fără cont pentru invitat: limba invitatorului (germana).
    resend.length = 0
    scriptProfiles({ langs: { [OWNER_UUID]: 'de' } })
    res = await invite('nou@x.ro')
    assert.equal(res.statusCode, 200, res.body)
    assert.ok(resend[0].body.html.includes(`/invite/tok-new?hl=de"`), resend[0].body.html)
    assert.ok(!/te-a invitat|Ospătar/.test(resend[0].body.html), 'niciun rest românesc')
  })

  it('INV13: nume lipsă → rezerva în limba emailului; româna byte-identică', async () => {
    state.authUser = { id: OWNER_UUID }
    scriptProfiles()
    const base = state.fromHandlers['profiles']
    state.fromHandlers['profiles'] = (ops) =>
      selectOf(ops) === 'full_name, email' ? { data: null, error: null } : base(ops)
    state.fromHandlers['restaurants'] = () => ({ data: null, error: null })
    const res = await invite('ion@x.ro')
    assert.equal(res.statusCode, 200, res.body)
    const want = legacyInvite({
      subjectRestaurantName: 'restaurantul tău',
      safeRestaurantName: 'restaurantul tău',
      safeInvitedBy: 'Un coleg',
      roleLabel: 'Ospătar',
      acceptUrl: `${LEGACY_NETLIFY_URL}/invite/tok-new`,
    })
    assert.equal(resend[0].body.subject, want.subject)
    assert.equal(resend[0].body.html, want.html)

    const { renderInviteEmail } = loadFunction(REL)
    const expected = {
      en: ['your restaurant', 'A colleague'],
      fr: ['votre restaurant', 'Un collègue'],
      de: ['Ihrem Restaurant', 'Ein Kollege'],
    }
    for (const l of Object.keys(expected)) {
      const r = renderInviteEmail(l, { restaurantName: '', invitedByName: '', roleKey: 'waiter', acceptUrl: 'https://a/invite/t' })
      const text = `${r.subject}\n${r.html}`
      assert.ok(r.subject.includes(expected[l][0]) && r.html.includes(expected[l][1]), `${l}: ${text}`)
      assert.ok(!/restaurantul|coleg\b|tău/i.test(text), `${l}: rest românesc în ${text}`)
    }
  })
})

// ── Lotul C7b: locurile din echipă ──────────────────────────────────────────
describe('send-invite: locurile din echipă (lotul C7b)', () => {
  // Starea comună a unui handler fresh (după un resetMocks în mijlocul testului).
  function baseState() {
    resetMocks()
    resend.length = 0
    state.authUser = { id: 'owner-1' }
    state.rpcHandlers['check_rate_limit'] = () => ({ data: true, error: null })
    state.fromHandlers['restaurants'] = () => ({ data: { name: 'Bistro' }, error: null })
  }
  // `members` = câți membri (owner inclus), `pending` = adresele invitațiilor
  // în așteptare (rânduri), `limit` = max_team_members din RPC.
  function scriptSeats({
    limit = 10,
    members = 1,
    pending = [],
    featError = null,
    countError = null,
    existingMember = false,
  } = {}) {
    state.rpcHandlers['get_restaurant_features'] = () =>
      featError
        ? { data: null, error: featError }
        : { data: { plan: 'growth', features: { max_team_members: { enabled: true, limit } } }, error: null }
    state.fromHandlers['restaurant_memberships'] = (ops) => {
      const sel = ops.find((o) => o.m === 'select')
      if (sel && sel.args[0] === 'role') return { data: { role: 'owner' }, error: null }
      if (sel && sel.args[1] && sel.args[1].count === 'exact') {
        return countError
          ? { data: null, count: null, error: countError }
          : { data: null, count: members, error: null }
      }
      return { data: existingMember ? { id: 'm-x' } : null, error: null }
    }
    state.fromHandlers['invite_tokens'] = (ops) => {
      if (isInsert(ops)) return { data: { token: 'tok-new' }, error: null }
      if (selectOf(ops) === 'email') return { data: pending.map((email) => ({ email })), error: null }
      return { data: null, error: null }
    }
    state.fromHandlers['profiles'] = (ops) =>
      ops.some((o) => o.m === 'ilike')
        ? { data: existingMember ? { id: 'u-x' } : null, error: null }
        : { data: { full_name: 'Ana', email: 'ana@x.test' }, error: null }
  }
  const seatQueries = () =>
    state.fromCalls.filter(
      (c) =>
        (c.table === 'restaurant_memberships' &&
          c.ops.some((o) => o.m === 'select' && o.args[1] && o.args[1].count)) ||
        (c.table === 'invite_tokens' && selectOf(c.ops) === 'email'),
    )

  it('INV15: echipa completă → 409 team_member_limit înaintea oricărei scrieri; un loc liber trece', async () => {
    scriptSeats({ limit: 10, members: 8, pending: ['a@x.ro', 'b@x.ro'] })
    const res = await invite('ion@x.ro')
    expectError(res, 409, 'team_member_limit')
    assert.doesNotMatch(parseBody(res).error, /free|starter|growth|\bpro\b|enterprise|Meniu|Fiscalizare/i)
    assert.equal(inviteOps().filter(isInsert).length, 0, 'invitația s-a creat peste limită')
    assert.equal(inviteOps().filter(isDelete).length, 0)
    assert.equal(resend.length, 0, 'emailul a plecat peste limită')

    // Control pozitiv: 8 membri + 1 invitație = 9 din 10 → invitația pleacă.
    baseState()
    scriptSeats({ limit: 10, members: 8, pending: ['a@x.ro'] })
    const ok = await invite('ion@x.ro')
    assert.equal(ok.statusCode, 200, ok.body)
    assert.equal(resend.length, 1)
  })

  it('INV16: aceeași adresă nu ocupă un loc în plus; dublurile altei adrese ocupă unul', async () => {
    // 8 membri + Ion (în așteptare, se înlocuiește) + Ana de două ori = 9 din 10.
    scriptSeats({ limit: 10, members: 8, pending: [' ION@x.ro', 'ana@x.ro', 'Ana@X.ro'] })
    const res = await invite('ion@x.ro')
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(inviteOps().filter(isInsert).length, 1)

    // 9 membri + Ion + Ana (dublată) = 11 ≥ 10 pentru o adresă NOUĂ.
    baseState()
    scriptSeats({ limit: 10, members: 9, pending: ['ion@x.ro', 'ana@x.ro', 'ANA@x.ro'] })
    expectError(await invite('nou@x.ro'), 409, 'team_member_limit')
  })

  it('INV17: numărătoarea e pe restaurant, iar invitațiile expirate nu țin un loc', async () => {
    scriptSeats({ limit: 10, members: 3 })
    const before = Date.now()
    const res = await invite('ion@x.ro')
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(
      rpcCallsFor('get_restaurant_features').map((c) => c.args),
      [{ p_restaurant_id: RID }],
    )
    const [members, pending] = seatQueries()
    assert.equal(members.table, 'restaurant_memberships')
    assert.deepEqual(argOf(members.ops, 'select'), ['id', { count: 'exact', head: true }])
    assert.deepEqual(argOf(members.ops, 'eq'), ['restaurant_id', RID])
    assert.equal(pending.table, 'invite_tokens')
    assert.deepEqual(argOf(pending.ops, 'eq'), ['restaurant_id', RID])
    assert.deepEqual(argOf(pending.ops, 'is'), ['accepted_at', null])
    const gt = argOf(pending.ops, 'gt')
    assert.ok(gt && gt[0] === 'expires_at', 'invitațiile expirate ar ține locuri')
    assert.ok(Date.parse(gt[1]) >= before - 1000, `pragul de expirare nu e „acum”: ${gt[1]}`)
  })

  it('INV18: limita necunoscută sau nelimitată nu blochează; membrul existent rămâne already_member', async () => {
    scriptSeats({ limit: null, members: 500 })
    let res = await invite('ion@x.ro')
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(seatQueries().length, 0, 'pe nelimitat nu are ce număra')

    for (const opts of [
      { featError: { message: 'rpc down' } },
      { members: 50, countError: { message: 'count failed' } },
    ]) {
      baseState()
      scriptSeats({ limit: 10, ...opts })
      res = await invite('ion@x.ro')
      assert.equal(res.statusCode, 200, `${JSON.stringify(opts)}: ${res.body}`)
      assert.equal(resend.length, 1)
    }

    baseState()
    scriptSeats({ limit: 10, members: 10, existingMember: true })
    // („Acest utilizator este deja membru.” n-are diacritice → fără expectError.)
    res = await invite('ion@x.ro')
    assert.equal(res.statusCode, 409, res.body)
    assert.equal(parseBody(res).code, 'already_member', res.body)
  })
})
