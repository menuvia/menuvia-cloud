// netlify/functions/stripe-checkout.js
// Creates a Stripe Checkout Session for Pro plan subscription.
// Auth: validates Supabase JWT.
//
// Contractul de eroare (lotul L8d): ORICE răspuns non-2xx JSON e
// `{ error, code }` — `error` rămâne textul de dinainte, EXACT (un client vechi
// îl afișează ca atare: româna se păstrează, engleza internă e înlocuită de
// `describeCheckoutFailure`), iar `code` e cheia stabilă pe care clientul o
// traduce în limba personalului. Clichet: tests/functions/fn-error-code-ratchet.test.js.
// Singura excepție e 405, text simplu (SC1 îl îngheață).

const { createClient } = require('@supabase/supabase-js')
const Stripe = require('stripe')
const crypto = require('crypto')
const { appUrl: resolveAppUrl, LEGACY_NETLIFY_URL, isComHost, MAIL_DOMAIN } = require('./lib/appUrl')
const { stripeLocale } = require('./lib/stripeLocale')
const { parseObjectBody } = require('./lib/jsonBody')
// Versiunea de API PINUITĂ (audit v3 OPS-8) pentru CERERILE noastre către Stripe:
// fără pin, un bump de SDK schimbă tăcut forma răspunsurilor pe care le citim
// (subscriptions.list, checkout sessions…). NU acoperă evenimentele de WEBHOOK:
// versiunea lor e setată per endpoint în Stripe Dashboard (act de fondator, A9)
// și trebuie ținută egală cu aceasta. Se schimbă DELIBERAT, cu
// tests/stripe-contract/ verzi (SDK-ul REAL; tests/functions/ îl înlocuiește cu
// totul). Implicitul SDK-ului se mută la fiecare versiune majoră (v22:
// '2026-08-26.dahlia', v23: '2026-09-30.endive'): fără pin, cererile ar trece
// TĂCUT pe implicitul SDK-ului instalat.
const STRIPE_API_VERSION = '2023-10-16'

// REGULA DE AUR: bani + bon fiscal = Plan 3 (`pro`/`enterprise`, „Fiscalizare").
// Planul 3 NU se vinde self-serve (decizia D4): cere o casă de marcat conectată,
// iar un abonament plătit fără ea ar încasa fără bon. Gate-ul stă AICI, pe
// server — ascunderea butonului din UI nu e o graniță de autorizare (un POST
// direct autentificat ar fi creat o sesiune Stripe pe prețul Planului 3).
// Price ID-urile `pro`/`enterprise` RĂMÂN obligatorii la boot (`.every(Boolean)`):
// webhook-ul le recunoaște pentru abonamentele create manual de fondator.
// Oglinda din client: `QUOTE_ONLY_PLAN_IDS` (src/lib/planCta.ts).
const QUOTE_ONLY_PLANS = ['pro', 'enterprise']

/** Etichetă scurtă și stabilă a originii, pentru cheia de idempotență. */
function originTag(origin) {
  return crypto.createHash('sha256').update(String(origin)).digest('hex').slice(0, 10)
}

// Stripe n-a putut porni plata (crearea clientului sau a sesiunii a aruncat):
// cel mai adesea tranzitoriu, deci „reîncearcă”; dacă se repetă, omul are nevoie
// de o adresă — aceeași rută de contact ca refuzul Planului 3 (`MAIL_DOMAIN`).
const CHECKOUT_CREATE_FAILED_MSG =
  `Nu am putut porni plata. Reîncearcă în câteva momente, iar dacă se repetă scrie-ne la contact@${MAIL_DOMAIN}.`

// O plată a acestui cont e deja în mișcare și nu putem garanta că pornim una
// singură: sesiunile n-au putut fi citite sau închise (vezi
// `settleOpenSessions`), Stripe a respins cheia de idempotență reutilizată
// cu alt corp, sau a reluat (replay) pe cheie o sesiune închisă între timp.
// Cheia se repetă doar cât nicio sesiune nouă n-a apărut între
// timp (`sessionsTagOf`), deci cazul obișnuit e o cerere CONCURENTĂ încă în
// zbor: la reîncercare lista vede sesiunea câștigătoare și o reia sau o
// închide — de aceea textul NU promite o fereastră de timp. Rar: dacă prima
// cerere cu cheia asta a primit de la Stripe o eroare SALVATĂ (Stripe păstrează
// și răspunsurile de eroare pe cheie), refuzul durează până la fereastra
// următoare a cheii.
const CHECKOUT_IN_PROGRESS_MSG = 'O plată pentru acest cont e deja în curs. Reîncearcă în câteva momente.'

// Lista Stripe se citește în pagini de câte 100 (`limit` maxim), cu sesiunile
// clientului din ORICE stare și mod (inclusiv creditele AI) din intervalul
// `SESSIONS_LOOKBACK_S` — TOATE paginile, înaintea oricărei închideri
// (recenzia pe #384, runda 3): o închidere făcută pe o listă incompletă lăsa
// deschisă o sesiune nevăzută, iar segmentul de stare al cheii se calcula pe o
// mulțime incompletă. Cu politica de mai jos un client are de regulă cel mult
// o sesiune de abonament deschisă; mai multe vin din codul de dinainte (o
// sesiune nouă la fiecare fereastră de 30 de minute, valabilă 24 h) sau din
// cursele de la `settleOpenSessions`. Peste `SESSIONS_MAX_PAGES` pagini (300
// de sesiuni în ~25 h: sute de schimbări de plan SAU de cumpărări de credite
// AI — ai-credits-checkout.js creează o sesiune `mode: 'payment'` pe același
// client la fiecare click, fără cheie de idempotență și fără plafon; ele intră
// în paginare, deși nu se închid) → 409 până ies din interval, FĂRĂ nicio
// închidere.
const SESSIONS_PAGE = 100
const SESSIONS_MAX_PAGES = 3

// Un abonament „viu” — același predicat pentru istoricul de abonamente și
// pentru o sesiune finalizată după citirea lui (`hasLiveSubscriptionSinceHistory`).
// 'unpaid' și 'incomplete' acoperă fereastra dintre eșecul repetat de plată
// și anularea efectivă a subscripției — fără ele, un checkout nou ar putea
// porni un al doilea abonament pe o subscripție încă "vie" la Stripe.
const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete']

// Fereastra cheii de idempotență (vezi cheia de la `sessions.create`).
const KEY_WINDOW_MS = 30 * 60 * 1000

// Lista cuprinde sesiunile create începând cu 25 h ÎNAINTEA începutului
// ferestrei curente a cheii. O sesiune Checkout expiră la cel mult 24 h după
// creare (`expires_at`, stripe@23: „anywhere from 30 minutes to 24 hours after
// Checkout Session creation”), iar ora în plus acoperă trecerea ei la
// `expired` — deci nicio sesiune deschisă nu rămâne în afara listei. Pragul e
// FIX pe fereastră (nu „acum − 25 h”): două cereri din aceeași fereastră citesc
// același interval, deci mulțimea din `sessionsTagOf` doar CREȘTE în fereastră.
const SESSIONS_LOOKBACK_S = 25 * 60 * 60

// O sesiune care expiră în mai puțin de atât NU se reia: omul ar ajunge pe
// pagina „sesiune expirată” în timp ce completează plata (pe main, o cerere
// dintr-o fereastră nouă primea mereu o sesiune nouă, valabilă 24 h). Se
// închide și se creează una nouă, ca orice sesiune nereutilizabilă. 30 de
// minute = valabilitatea MINIMĂ pe care Stripe o acceptă la creare.
const REUSE_MIN_LEFT_S = 30 * 60

function customerIdOf(s) {
  if (typeof s?.customer === 'string') return s.customer
  return s?.customer?.id ?? null
}

function subscriptionIdOf(s) {
  if (typeof s?.subscription === 'string') return s.subscription
  return s?.subscription?.id ?? null
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

/**
 * Sesiunea deschisă e EXACT plata pe care ar porni-o cererea curentă?
 * Planul, prețul și trialul se citesc din `metadata` SESIUNII (scrise la
 * `sessions.create`, mai jos): `subscription_data.metadata` ajunge pe
 * abonament, iar obiectul Session NU îl întoarce (stripe@23,
 * `Checkout.Session` n-are câmpul `subscription_data`). Originea se citește din
 * `success_url` — singurul câmp al sesiunii care o poartă (`originTag` din cheie
 * e un hash). O sesiune fără aceste metadate (creată de codul de dinainte) nu
 * se reia: se închide și se creează una nouă — sigur în ambele sensuri.
 * Prețul și trialul intră deliberat: o sesiune deschisă înaintea unei
 * schimbări de preț ar încasa prețul vechi, iar una cu trial pornită înainte ca
 * istoricul să conțină un trial ar ocoli regula „un singur trial” de mai sus.
 * Limba (`locale`) și `referral_code` NU intră: nu schimbă ce se cumpără
 * (limba nu are voie să deschidă a doua plată; atribuirea primară e
 * `capture_affiliate_attribution`, pe client, făcută deja).
 * Și să mai fie valabilă cel puțin `REUSE_MIN_LEFT_S` (`expires_at` lipsă sau
 * nenumeric → nu se reia: NaN pică comparația).
 */
function isReusableSession(s, want, nowS) {
  const md = s.metadata || {}
  return (
    md.plan === want.plan &&
    md.price_id === want.priceId &&
    md.trial_days === want.trialDays &&
    typeof s.success_url === 'string' &&
    s.success_url.startsWith(`${want.appUrl}/`) &&
    typeof s.url === 'string' &&
    /^https:\/\/[^/]/.test(s.url) &&
    Number(s.expires_at) - nowS > REUSE_MIN_LEFT_S
  )
}

/**
 * Segmentul de stare al cheii de idempotență: un rezumat al MULȚIMII
 * sesiunilor de abonament ale clientului create în interval, din ORICE stare
 * (`s0` = niciuna). Două proprietăți, ambele cerute de recenzia adversarială
 * pe #384, unde prima variantă (doar sesiunile închise de cererea CURENTĂ)
 * le încălca pe amândouă:
 *  (1) cheia nu se repetă după o sesiune creată cu ea. Sesiunea X, creată cu
 *      cheia K, intră în mulțime pentru orice cerere ulterioară din aceeași
 *      fereastră, deci aceasta are altă cheie și Stripe nu-i mai întoarce
 *      răspunsul salvat al lui K — URL-ul lui X, care între timp poate fi
 *      EXPIRAT (growth → starter cu creare eșuată → growth) sau FINALIZAT, cu
 *      abonamentul anulat. Prima variantă dădea `s0` celei de-a treia cereri,
 *      exact cheia lui X;
 *  (2) două cereri SIMULTANE identice din ACEEAȘI fereastră a cheii au aceeași
 *      cheie (la granița ferestrei, nu — vezi `settleOpenSessions`). Starea
 *      NU intră, deci închiderea unei sesiuni vechi de către una dintre ele nu schimbă
 *      mulțimea pe care o citește cealaltă; o schimbă doar o sesiune NOUĂ (una
 *      născută între cele două liste dă chei diferite — cazul (d) de la
 *      `settleOpenSessions`). Cu prima variantă, a doua cerere listată după
 *      `expire`-ul primei dădea `s0`, cealaltă `s<hash>` — două sesiuni
 *      completabile pentru același plan.
 * Mulțimea e filtrată și aici pe `sinceS` (nu ne bizuim doar pe filtrul
 * Stripe), ca segmentul să depindă doar de fereastră și de sesiunile născute.
 */
function sessionsTagOf(sessions, sinceS) {
  const ids = sessions
    .filter((s) => typeof s.id === 'string' && Number(s.created) >= sinceS)
    .map((s) => s.id)
  if (!ids.length) return 's0'
  const digest = crypto.createHash('sha256').update([...new Set(ids)].sort().join(',')).digest('hex')
  return `s${digest.slice(0, 10)}`
}

/**
 * O singură sesiune Checkout de abonament deschisă per client, la creare
 * (recenzia CodeRabbit pe #384): o sesiune deschisă pentru EXACT aceeași plată
 * se reia (îi întoarcem URL-ul, nu creăm alta); ORICE altă sesiune de abonament
 * deschisă a clientului (alt plan, altă origine, alt preț, creată de codul de
 * dinainte) se închide (`expire`) înaintea creării — ultimul click câștigă.
 * Fără asta, o sesiune `checkout_v4` pornită înainte de deploy și una `v7`
 * după, sau două sesiuni SUCCESIVE de o parte și de alta a graniței ferestrei
 * de 30 de minute, erau completabile AMBELE = două abonamente facturate.
 *
 * Aruncă (→ 409 `checkout_in_progress`, fail-closed, fără sesiune nouă) dacă
 * lista nu poate fi citită complet (o pagină eșuată, `has_more` fără cursor,
 * peste `SESSIONS_MAX_PAGES` pagini — în toate cazurile ÎNAINTEA oricărei
 * închideri) sau dacă o închidere eșuează. Cumpărările de credite AI
 * (ai-credits-checkout.js, `mode: 'payment'`, același client Stripe) nu se
 * ating. Garanția e la CREARE și NU acoperă cererile SIMULTANE ale căror CHEI
 * diferă: listează amândouă înainte ca vreuna să-și fi creat sesiunea și
 * fiecare creează câte o sesiune completabilă. Cheile diferă prin (a) plan;
 * (b) fereastră (ACELAȘI plan, de o parte și de alta a graniței de 30 de
 * minute: intervale și chei diferite, deși niciuna nu vede sesiunea
 * celeilalte); (c) `referral_code` (ACELAȘI plan și aceeași fereastră, un tab
 * care a rezolvat codul și unul care nu — codul e în cheie); (d) segmentul de
 * stare (ACELAȘI plan și aceeași fereastră, dar sesiunea unei a treia cereri
 * se naște între cele două liste). Tot neacoperită: o plată finalizată DUPĂ
 * listă. Închiderea clasei la FINALIZARE (webhook-ul anulează al doilea
 * abonament viu) e lotul următor (#61). Neacoperit nici de #61, fiindcă nu e
 * un al doilea abonament: sub cursa cu planuri diferite, o cerere poate primi
 * 200 cu URL-ul unei sesiuni pe care cealaltă tocmai a închis-o (`keep` vine
 * din aceeași listă pe care cealaltă o închide, iar reverificarea de mai jos
 * citește doar ceasul; la replay, vezi recitirea din handler) — omul ajunge
 * pe pagina Stripe „expirată” și reîncearcă cu un click nou.
 *
 * O SINGURĂ listă, fără filtru de stare, servește tuturor scopurilor:
 * sesiunile deschise (reluare / închidere), cele finalizate între timp
 * (`hasLiveSubscriptionSinceHistory`) și segmentul de stare al cheii
 * (`sessionsTagOf`, care cere și sesiunile expirate/finalizate din interval).
 *
 * `{ subscriptionExists: true }` = prima plată s-a finalizat între citirea
 * istoricului și listă: același 409 `subscription_exists`, nimic închis.
 */
async function settleOpenSessions(stripe, customerId, want, keyWindow, knownSubscriptionIds) {
  const sinceS = Math.floor((keyWindow * KEY_WINDOW_MS) / 1000) - SESSIONS_LOOKBACK_S
  const all = await listSessionsSince(stripe, customerId, sinceS)
  // Sesiunile de ABONAMENT ale clientului, din orice stare.
  const subs = all.filter((s) => s && s.mode === 'subscription' && customerIdOf(s) === customerId)
  if (await hasLiveSubscriptionSinceHistory(stripe, subs, knownSubscriptionIds)) {
    return { subscriptionExists: true }
  }
  const open = subs.filter((s) => s.status === 'open')
  // Mai multe reutilizabile (cursă, sau cod vechi + nou): cea mai NOUĂ rămâne.
  // Timpul se citește DUPĂ listă (paginile pot dura secunde).
  let keep = open
    .filter((s) => isReusableSession(s, want, nowSeconds()))
    .sort((a, b) => (Number(b.created) || 0) - (Number(a.created) || 0))[0] || null
  await expireAll(stripe, open.filter((s) => s !== keep))
  // Și din nou chiar înainte de a întoarce URL-ul (runda 3): închiderile pot
  // dura și ele (timeout 6 s per cerere), iar o sesiune aleasă la limită ar fi
  // ajuns la om cu mai puțin de `REUSE_MIN_LEFT_S`. Sub prag → se închide și
  // ea, ca orice sesiune nereutilizabilă, și se creează una nouă.
  if (keep && !isReusableSession(keep, want, nowSeconds())) {
    await expireAll(stripe, [keep])
    keep = null
  }
  return { reuseUrl: keep ? keep.url : null, sessionsTag: sessionsTagOf(subs, sinceS) }
}

/**
 * TOATE sesiunile clientului create de la `sinceS`, paginate cu
 * `starting_after` (cursorul = ultima sesiune a paginii; Stripe le întoarce de
 * la cea mai nouă). Aruncă la orice pagină eșuată sau fără `data`, la
 * `has_more` fără cursor și peste `SESSIONS_MAX_PAGES` pagini — apelantul nu
 * închide nimic pe o listă incompletă.
 */
async function listSessionsSince(stripe, customerId, sinceS) {
  const all = []
  let startingAfter = null
  for (let pageNo = 0; pageNo < SESSIONS_MAX_PAGES; pageNo++) {
    const page = await stripe.checkout.sessions.list({
      customer: customerId,
      created: { gte: sinceS },
      limit: SESSIONS_PAGE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    if (!page || !Array.isArray(page.data)) throw new Error('checkout.sessions.list: răspuns fără `data`')
    all.push(...page.data)
    if (page.has_more !== true) return all
    const last = page.data[page.data.length - 1]
    if (typeof last?.id !== 'string') throw new Error('checkout.sessions.list: `has_more` fără cursor')
    startingAfter = last.id
  }
  throw new Error(`peste ${SESSIONS_MAX_PAGES * SESSIONS_PAGE} sesiuni în interval`)
}

/**
 * Prima plată s-a finalizat ÎNTRE citirea istoricului de abonamente și listă
 * (runda 3 a recenziei pe #384): sesiunea e `complete`, dar abonamentul ei nu
 * era în istoric, deci verificarea „abonament viu” din handler nu l-a văzut.
 * Se recitește abonamentul: viu (`LIVE_SUBSCRIPTION_STATUSES`) → `true`;
 * sesiune fără abonament, recitire eșuată sau abonament fără stare → aruncă
 * (409 `checkout_in_progress`, nimic închis); altă stare (terminal) → `false`,
 * crearea continuă. Un abonament viu bate o recitire eșuată a altei sesiuni.
 */
async function hasLiveSubscriptionSinceHistory(stripe, subs, knownSubscriptionIds) {
  const unseen = subs.filter((s) => s.status === 'complete' && !knownSubscriptionIds.has(subscriptionIdOf(s)))
  const results = await Promise.allSettled(unseen.map(async (s) => {
    const id = subscriptionIdOf(s)
    if (!id) throw new Error(`sesiunea finalizată ${s.id} n-are abonament`)
    const sub = await stripe.subscriptions.retrieve(id)
    if (typeof sub?.status !== 'string') throw new Error(`abonamentul ${id} n-are stare`)
    return LIVE_SUBSCRIPTION_STATUSES.includes(sub.status)
  }))
  if (results.some((r) => r.status === 'fulfilled' && r.value === true)) return true
  const failed = results.find((r) => r.status === 'rejected')
  if (failed) {
    throw Object.assign(new Error(`abonament nerecitit: ${failed.reason?.message}`), {
      type: failed.reason?.type, code: failed.reason?.code,
    })
  }
  return false
}

/** Închide sesiunile date; aruncă dacă oricare închidere eșuează. */
async function expireAll(stripe, sessions) {
  const results = await Promise.allSettled(sessions.map((s) => stripe.checkout.sessions.expire(s.id)))
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length) {
    const reason = failed[0].reason
    throw Object.assign(new Error(`expire eșuat pe ${failed.length}/${sessions.length} sesiuni deschise`), {
      type: reason?.type, code: reason?.code,
    })
  }
}

/**
 * Răspunsul lui `sessions.create` e un REPLAY al cheii: Stripe a întors
 * răspunsul SALVAT la prima cerere cu cheia (antetul `Idempotent-Replayed:
 * true`, docs.stripe.com/error-low-level), deci și starea de ATUNCI. SDK-ul
 * atașează obiectului răspunsul HTTP brut ca `lastResponse` (RequestSender,
 * stripe@23; pe clientul Node e `IncomingMessage`, cu antetele cu litere
 * mici). Pe alt client HTTP antetul nu se vede → replay-ul trece ca înainte.
 */
function isIdempotentReplay(session) {
  return session?.lastResponse?.headers?.['idempotent-replayed'] === 'true'
}

function subscriptionExistsResponse() {
  return jsonResponse(409, {
    error: 'Ai deja un abonament. Schimbă planul din Portalul de facturare.',
    code: 'subscription_exists',
  })
}

/**
 * Stripe a respins cheia de idempotență fiindcă a mai văzut-o cu ALȚI parametri.
 * SDK-ul (`generateV1Error`, src/Error.ts) decide întâi după STATUS: doar pe
 * HTTP 400/404 face din `error.type === 'idempotency_error'` un
 * `StripeIdempotencyError` (`type` = numele clasei). Pe orice alt status
 * (în afară de 401/402/403/429, care au clasele lor) eroarea e `StripeAPIError`,
 * iar tipul brut al API-ului rămâne doar în `rawType`. De aceea le citim pe
 * AMBELE: `rawType` nu e redundant, prinde exact statusurile ≠ 400/404.
 *
 * DELIBERAT în afară: 409 `idempotency_key_in_use` (cerere CONCURENTĂ cu
 * aceeași cheie și același corp, adică un dublu-click) vine cu `type:
 * 'invalid_request_error'`, deci aici dă `false` și rămâne 502
 * `checkout_create_failed` — e tranzitoriu, iar reîncercarea primește sesiunea
 * din cache. NU lărgi verificarea după `statusCode === 409` sau după `code`:
 * un dublu-click ar primi „o plată e deja în curs” pentru propria lui plată.
 * Formele sunt ținute de SDK8b (tests/stripe-contract/handlers.test.js, pe
 * SDK-ul REAL) și de SCK4 (tests/functions/stripe-checkout.test.js).
 */
function isIdempotencyConflict(e) {
  return e?.type === 'StripeIdempotencyError' || e?.rawType === 'idempotency_error'
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  // Un host .com nu vinde (recenzie CodeRabbit pe #288): închiderea din UI
  // (siteMarket.checkoutOpenOnSite) nu e o graniță de autorizare — un POST
  // autentificat direct ar fi creat o sesiune Stripe în RON. Piața se decide din
  // `host`-ul rutat de platformă, nu din ce trimite apelantul. Pe .ro: neatins.
  if (isComHost(event.headers?.host)) {
    return jsonResponse(403, {
      error: 'Checkout is not available on this site yet.',
      code: 'site_checkout_unavailable',
    })
  }

  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
    STRIPE_STARTER_PRICE_ID, STRIPE_GROWTH_PRICE_ID,
    STRIPE_PRO_PRICE_ID, STRIPE_ENTERPRISE_PRICE_ID,
    STRIPE_TRIAL_DAYS,
  } = process.env

  // Price map per plan canonic. Lipsa unui price ID = planul respectiv
  // indisponibil (defensiv — vezi mai jos), NU silent fallback la pro.
  const PRICE_IDS = {
    starter:    STRIPE_STARTER_PRICE_ID,
    growth:     STRIPE_GROWTH_PRICE_ID,
    pro:        STRIPE_PRO_PRICE_ID,
    enterprise: STRIPE_ENTERPRISE_PRICE_ID,
  }

  // .every(Boolean): lipsa ORICĂRUI price ID trebuie să eșueze vizibil la boot
  // (aliniat cu validarea din stripe-webhook.js) — altfel un plan neconfigurat
  // ar trece nedetectat până la primul checkout eșuat în producție.
  if (!STRIPE_SECRET_KEY || !Object.values(PRICE_IDS).every(Boolean)) {
    return jsonResponse(500, { error: 'Stripe not configured', code: 'server_config' })
  }

  // Determine price strictly by requested plan — NO silent fallback to pro.
  // Parsare protejata: un corp non-JSON nu trebuie sa arunce SyntaxError neprins (crash).
  let body = {}
  try {
    // Un corp care nu e OBIECT JSON (`null`, un tablou…) → `bad_json`, nu o
    // excepție la `body.plan` (lib/jsonBody.js).
    body = parseObjectBody(event.body)
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body', code: 'bad_json' })
  }
  const requestedPlan = String(body.plan || '').toLowerCase()
  // Planul 3 se cere prin ofertă: refuz explicit, ÎNAINTEA oricărui apel Stripe
  // sau Supabase (nici customer, nici sesiune, nici atribuire de afiliat).
  if (QUOTE_ONLY_PLANS.includes(requestedPlan)) {
    return jsonResponse(403, {
      error: `Planul Fiscalizare se activează pe bază de ofertă, împreună cu instalarea pe casa ta de marcat. Scrie-ne la contact@${MAIL_DOMAIN}.`,
      code: 'plan_requires_quote',
    })
  }
  // Cod de referral din cookie-ul de afiliere (trimis de frontend). Normalizat
  // și mărginit defensiv; gol/invalid → ignorat fără efect.
  const referralCode = String(body.referral_code || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 32)
  // visitor_id corelează touch-ul (de la /r/:cod) cu această conversie pentru
  // gate-ul de incrementality fail-closed (vezi capture_affiliate_attribution).
  const visitorId = String(body.visitor_id || '').slice(0, 64)
  // Limba paginii Stripe = limba panoului (`ui_lang`, lotul L8d), validată pe
  // ro/en/fr/de; absentă sau invalidă → fără `locale` = „auto”, ca înainte.
  const locale = stripeLocale(body.ui_lang)
  const priceId = PRICE_IDS[requestedPlan]
  if (!priceId) {
    return jsonResponse(400, {
      error: `Plan "${requestedPlan}" indisponibil sau neconfigurat în Stripe`,
      code: 'plan_unavailable',
    })
  }

  // Auth
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return jsonResponse(401, { error: 'Missing Authorization header', code: 'auth_missing' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return jsonResponse(401, { error: 'Invalid token', code: 'auth_invalid' })
  }

  // Rate limit per user (endpoint autentificat dar abuzabil): max 10 checkout-uri / 5 min.
  // Fail-closed pe eroare de infra (aliniat cu send-invite.js): dacă limiterul nu
  // poate fi verificat, respingem cererea în loc s-o lăsăm să treacă nesupravegheat.
  try {
    const { data: rlOk, error: rlErr } = await supabase.rpc('check_rate_limit', {
      p_function_name:  'stripe_checkout',
      p_scope_key:      user.id,
      p_max_requests:   10,
      p_window_minutes: 5,
    })
    if (rlErr) {
      console.error('[stripe-checkout] rate limit RPC failed (fail-closed):', rlErr.message)
      return jsonResponse(503, { error: 'Rate limit service unavailable', code: 'rate_limit_unavailable' })
    }
    if (rlOk === false) {
      return jsonResponse(429, {
        error: 'Prea multe încercări. Reîncearcă în câteva minute.',
        code: 'rate_limited',
      })
    }
  } catch (e) {
    console.error('[stripe-checkout] rate limit check threw (fail-closed):', e?.message)
    return jsonResponse(503, { error: 'Rate limit service unavailable', code: 'rate_limit_unavailable' })
  }

  // Get or create Stripe customer
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION, timeout: 6000, maxNetworkRetries: 0 })

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('stripe_customer_id, email')
    .eq('id', user.id)
    .single()

  // Eroare de DB tranzitorie ≠ „profil inexistent" — fără verificare, un blip
  // ar crea un customer Stripe DUPLICAT (customerId rămâne undefined → ramura
  // de creare) pentru un user care are deja unul (audit săpt. 10).
  if (profileErr) {
    console.error('[stripe-checkout] profile lookup failed:', profileErr.message)
    return jsonResponse(503, {
      error: 'Serviciu temporar indisponibil. Reîncearcă.',
      code: 'service_unavailable',
    })
  }

  let customerId = profile?.stripe_customer_id

  // OPT-R2: true DOAR când această cerere a creat customer-ul ȘI a câștigat
  // UPDATE-ul atomic → istoricul de subscripții e garantat gol, sărim lookup-ul.
  let isFreshCustomer = false

  if (!customerId) {
    // Un apel Stripe care aruncă (cheie rotită, Stripe indisponibil, timeout)
    // ieșea din handler ca excepție — fără corp de contract, deci fără cod.
    // Același cod ca la crearea sesiunii: pentru om e același „n-a pornit plata”.
    let customer
    try {
      customer = await stripe.customers.create({
        email: profile?.email || user.email,
        metadata: { supabase_user_id: user.id },
      })
    } catch (e) {
      console.error('[stripe-checkout] customer create failed:', {
        type: e?.type, code: e?.code, message: e?.message,
      })
      return jsonResponse(502, { error: CHECKOUT_CREATE_FAILED_MSG, code: 'checkout_create_failed' })
    }
    customerId = customer.id

    // Anti race la creare concurentă (2 cereri simultane fără stripe_customer_id
    // ar crea 2 customeri Stripe pentru același user). UPDATE atomic condiționat
    // pe .is('stripe_customer_id', null): doar cererea care câștigă cursa scrie.
    const { data: updatedRows } = await supabase.from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id)
      .is('stripe_customer_id', null)
      .select('stripe_customer_id')

    if (updatedRows && updatedRows.length > 0) {
      // Am câștigat cursa cu un customer creat acum → fără subscripții posibile.
      isFreshCustomer = true
    }
    if (!updatedRows || updatedRows.length === 0) {
      // Altcineva a fost mai rapid — recitim customer_id-ul real și îl folosim
      // pe acela, ca să nu rămânem cu 2 customeri Stripe pentru același user.
      const { data: freshProfile } = await supabase
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', user.id)
        .single()

      if (freshProfile?.stripe_customer_id) {
        const orphanCustomerId = customerId
        customerId = freshProfile.stripe_customer_id
        // Best-effort cleanup al customer-ului orfan creat de noi — nu blocăm
        // fluxul de checkout dacă ștergerea eșuează.
        try {
          await stripe.customers.del(orphanCustomerId)
        } catch (e) {
          console.warn('[stripe-checkout] cleanup orphan Stripe customer failed:', e?.message)
        }
      }
    }
  }

  // ── Afiliere: creează atribuirea (best-effort, nu blochează checkout-ul) ────
  // Gate-urile (self-referral, incrementality, first-wins) sunt în RPC. Dacă
  // ceva eșuază, lăsăm checkout-ul să continue — afilierea nu trebuie să rupă
  // fluxul de plată.
  if (referralCode) {
    try {
      const { error: attrErr } = await supabase.rpc('capture_affiliate_attribution', {
        p_referral_code: referralCode,
        p_referred_profile_id: user.id,
        p_stripe_customer_id: customerId,
        p_visitor_id: visitorId || null,
      })
      if (attrErr) {
        // Best-effort — nu blocăm checkout-ul, dar logăm cu context structurat
        // ca eșecurile de atribuire să fie vizibile (nu doar un warn pierdut).
        console.error('[stripe-checkout] affiliate capture failed:', {
          referralCode, userId: user.id, customerId, error: attrErr.message,
        })
      }
    } catch (e) {
      console.error('[stripe-checkout] affiliate capture threw:', {
        referralCode, userId: user.id, customerId, error: e?.message || String(e),
      })
    }
  }

  // Cheia + fallback-ul de dinainte, EXACT (VITE_APP_URL → menuvia.netlify.app):
  // menuvia.ro nu e încă cumpărat, iar env-ul din netlify.toml nu ajunge la
  // funcții la runtime — un fallback pe .ro ar trimite clientul după plată pe
  // un domeniu neînregistrat.
  const appUrl = resolveAppUrl({ keys: ['VITE_APP_URL'], fallback: LEGACY_NETLIFY_URL })

  // Trial configurabil — default 30 zile (onorează promisiunea din landing).
  // Set STRIPE_TRIAL_DAYS=0 în Netlify Env pentru a dezactiva fără cod.
  // STRIPE_TRIAL_DAYS non-numeric (typo în env) ar da NaN → trial dezactivat silentios.
  // Fallback la 30 dacă valoarea nu e un întreg valid.
  const parsedTrial = parseInt(STRIPE_TRIAL_DAYS ?? '30', 10)
  const trialDays = Number.isFinite(parsedTrial) ? parsedTrial : 30

  // ── Anti dublu-abonament (#5) + trial-once (#15) ───────────────────────────
  // Self-contained în Stripe (fără coloană nouă în DB): citim istoricul de
  // subscripții al clientului.
  //   • dacă există deja una activă/în trial → 409 (schimbarea planului se face
  //     din Portalul de facturare, nu printr-un nou checkout — altfel dublă plată);
  //   • dacă a existat VREODATĂ un trial → nu mai acordăm altul (anti trial-farming).
  let allowTrial = trialDays > 0
  let subsAll = []
  // OPT-R2: pe un customer creat de NOI cu milisecunde în urmă (isFreshCustomer)
  // lista de subscripții e garantat goală — sărim RTT-ul Stripe. Pe orice altă
  // cale (customer existent sau adoptat după cursă) verificarea rămâne integrală.
  if (isFreshCustomer) {
    subsAll = []
  } else try {
    // Paginăm TOATE subscripțiile clientului (nu doar prima pagină de 100), altfel o
    // subscripție live/trial mai veche ar putea fi ratată → dublu abonament / trial repetat.
    subsAll = await stripe.subscriptions
      .list({ customer: customerId, status: 'all', limit: 100 })
      .autoPagingToArray({ limit: 10000 })
  } catch (e) {
    // Fail-closed: dacă nu putem verifica istoricul de subscripții, NU pornim un checkout nou
    // (altfel un eroare tranzitorie Stripe ar putea duce la al doilea abonament). 503 → retry.
    console.error('[stripe-checkout] subscription history lookup failed:', e?.message)
    return jsonResponse(503, {
      error: 'Nu am putut verifica abonamentele existente. Reîncearcă în câteva momente.',
      code: 'subscription_lookup_failed',
    })
  }

  // Predicatul „viu”: `LIVE_SUBSCRIPTION_STATUSES` (de ce 'unpaid'/'incomplete', acolo).
  const hasLive = subsAll.some((s) => LIVE_SUBSCRIPTION_STATUSES.includes(s.status))
  if (hasLive) return subscriptionExistsResponse()
  // trial-once: dacă a existat VREODATĂ un trial, nu mai acordăm altul (anti trial-farming).
  const hadTrial = subsAll.some((s) => s.trial_start != null || s.trial_end != null)
  if (hadTrial) allowTrial = false

  // Plata pe care o pornește cererea asta — scrisă în metadata SESIUNII și
  // comparată cu sesiunile deschise (`isReusableSession`).
  const want = {
    plan: requestedPlan,
    priceId,
    trialDays: String(allowTrial ? trialDays : 0),
    appUrl,
  }

  // Fereastra cheii, citită O SINGURĂ dată: aceeași pentru intervalul listei
  // (`settleOpenSessions`) și pentru sufixul cheii — altfel, la granița
  // ferestrei, lista ar fi citit intervalul unei ferestre și cheia ar fi purtat-o
  // pe următoarea.
  const keyWindow = Math.floor(Date.now() / KEY_WINDOW_MS)

  // ── O singură sesiune deschisă per client (vezi `settleOpenSessions`) ──────
  // Pe un client creat de NOI acum câteva milisecunde (`isFreshCustomer`) nu
  // poate exista nicio sesiune: sărim RTT-ul, ca la istoricul de abonamente, iar
  // segmentul de stare e cel al mulțimii goale, `s0` — același pe care l-ar
  // calcula o cerere concurentă care a ADOPTAT clientul și a citit lista goală.
  let sessionsTag = 's0'
  if (!isFreshCustomer) {
    let settled
    try {
      // Abonamentele din istoric: o sesiune finalizată al cărei abonament NU e
      // printre ele s-a plătit între cele două citiri.
      const knownSubscriptionIds = new Set(subsAll.map((s) => s?.id).filter((id) => typeof id === 'string'))
      settled = await settleOpenSessions(stripe, customerId, want, keyWindow, knownSubscriptionIds)
    } catch (e) {
      console.error('[stripe-checkout] open sessions not settled (fail-closed):', {
        type: e?.type, code: e?.code, message: e?.message,
      })
      return jsonResponse(409, { error: CHECKOUT_IN_PROGRESS_MSG, code: 'checkout_in_progress' })
    }
    // Prima plată s-a finalizat între citirea istoricului și listă: același
    // răspuns ca abonamentul viu din istoric.
    if (settled.subscriptionExists) return subscriptionExistsResponse()
    // Aceeași plată, deja deschisă → îi întoarcem URL-ul (aceeași formă ca la
    // creare). Limba paginii rămâne a sesiunii existente.
    if (settled.reuseUrl) return jsonResponse(200, { url: settled.reuseUrl })
    // Segmentul de stare al cheii (de ce, la `sessionsTagOf`).
    sessionsTag = settled.sessionsTag
  }

  let session
  try {
    session = await stripe.checkout.sessions.create(
      {
        customer: customerId,
        client_reference_id: user.id,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        // Metadata SESIUNII (≠ `subscription_data.metadata`, care ajunge pe
        // abonament și nu e citibilă de pe sesiune): ce plată e, pentru
        // `isReusableSession`. Fără cheia `type` (webhook-ul o citește pe
        // sesiunile `mode: 'payment'` ca `ai_credits`).
        metadata: { plan: want.plan, price_id: want.priceId, trial_days: want.trialDays },
        // Lotul L8d: pagina Stripe în limba panoului; fără cheie = „auto”.
        ...(locale ? { locale } : {}),
        // `checkout_plan`: clientul (useCheckoutReturn) anunță „planul e activ"
        // DOAR când profilul are EXACT planul cumpărat — un cont cu plan manual
        // are deja un plan ≠ free înainte să ajungă webhook-ul.
        success_url: `${appUrl}/dashboard?checkout=success&checkout_plan=${encodeURIComponent(requestedPlan)}`,
        cancel_url: `${appUrl}/pricing?checkout=cancelled`,
        subscription_data: {
          // plan în metadata → webhook citește planul REAL cumpărat, nu hardcodat.
          // referral_code persistă pe subscription → disponibil în invoice.paid
          // (sursă secundară; atribuirea primară e legată de stripe_customer_id).
          metadata: {
            supabase_user_id: user.id,
            plan: requestedPlan,
            ...(referralCode ? { referral_code: referralCode } : {}),
          },
          ...(allowTrial ? { trial_period_days: trialDays } : {}),
        },
      },
      {
        // Idempotență: cheia include intrările care schimbă corpul cererii și erau
        // deja în cheie pe main (plan, referral_code, trial), altfel Stripe respinge
        // cheia reutilizată cu params diferiți (idempotency_error). Click-uri repetate
        // cu EXACT aceeași cerere SECVENȚIALE se dedup-ează acum din listă (sesiunea
        // deschisă se reia, `settleOpenSessions`); cheia rămâne plasa pentru cererile
        // SIMULTANE (dublu-click, două taburi), care au același segment de stare
        // (`sessionsTagOf`: o închidere nu-l schimbă, doar o sesiune nouă). Planul și
        // trialul deosebesc două plăți; `referral_code` NU (schimbă doar metadata —
        // atribuirea primară e `capture_affiliate_attribution` de mai sus, pe
        // `stripe_customer_id`): e în cheie ca pe main, deci două cereri SIMULTANE
        // care diferă doar prin el au chei diferite — neacoperit la creare (cazul
        // (c) de la `settleOpenSessions`). Excepția deliberată e limba
        // paginii (`locale`, vezi `v7` mai jos).
        // Fereastră temporală de 30 min: fără ea, aceeași cerere repetată mult mai
        // târziu (ex. a doua zi) ar rămâne blocată pe cheia veche la Stripe.
        // Prefixul `v4` + hash-ul ORIGINII: success_url/cancel_url fac parte din
        // corp, deci o schimbare a originii (env modificat, alt domeniu) între
        // două cereri cu aceeași cheie ar primi idempotency_error de la Stripe.
        // Hash scurt și stabil (sha256, 10 hex) — originea nu ajunge în clar în cheie.
        // `v7` (lotul L8d): `locale` intră în CORP, dar DELIBERAT NU în cheie.
        // Prima variantă (`v6`, doar pe branch, nu se refolosește) punea limba în
        // cheie: un tab vechi (fără `ui_lang` = „auto”) și unul nou (`ro`) — sau
        // același om care schimbă limba panoului — primeau DOUĂ sesiuni
        // completabile pentru același plan (recenzie CodeRabbit pe #384). Acum a
        // doua cerere reia sesiunea deschisă din listă; dacă cele două sunt
        // SIMULTANE, Stripe vede aceeași cheie cu alt corp și o respinge
        // (`idempotency_error`) → 409 `checkout_in_progress` mai jos. Tot în `v7`
        // (înainte de orice deploy al lui `v7`, deci nicio cheie emisă nu se
        // ciocnește): `metadata` sesiunii în corp și segmentul de stare
        // `sessionsTag` în cheie (de ce, la `sessionsTagOf`). `v5` e REZERVAT
        // PR-ului DRAFT RES-11 (#273, cheile de trial fără card + datele de
        // facturare): la integrarea lui, prefixul urcă la `v8`.
        idempotencyKey: `checkout_v7_${originTag(appUrl)}_${user.id}_${requestedPlan}_${referralCode || 'none'}_${want.trialDays}_${sessionsTag}_${keyWindow}`,
      },
    )
  } catch (e) {
    // Fail-closed VIZIBIL: fără try/catch, o respingere Stripe ieșea din handler
    // ca excepție — 500/502 fără corp de contract și fără cauză în log. Același
    // cod ca PR-ul DRAFT RES-11 (#273), care avea aceeași reparație; textul
    // numește acum și adresa de contact.
    console.error('[stripe-checkout] session create failed:', {
      type: e?.type, code: e?.code, param: e?.param, message: e?.message,
    })
    // Cheie reutilizată cu alt corp = o cerere SIMULTANĂ pentru aceeași plată
    // (alt tab, altă limbă, un client vechi) își creează sesiunea cu aceeași
    // cheie (sau, rar, Stripe a salvat pe cheie eroarea primei cereri — vezi
    // `CHECKOUT_IN_PROGRESS_MSG`). Plasa de cursă a listei de mai sus: la
    // reîncercare lista vede sesiunea câștigătoare și o reia sau o închide.
    // Mesajul englezesc al Stripe rămâne doar în log.
    if (isIdempotencyConflict(e)) {
      return jsonResponse(409, { error: CHECKOUT_IN_PROGRESS_MSG, code: 'checkout_in_progress' })
    }
    return jsonResponse(502, { error: CHECKOUT_CREATE_FAILED_MSG, code: 'checkout_create_failed' })
  }

  // REPLAY al cheii (runda 3): o cerere SIMULTANĂ a listat înaintea sesiunii
  // noastre, a calculat aceeași cheie și primește acum de la Stripe răspunsul
  // SALVAT al creării — cu starea `open` de ATUNCI, chiar dacă între timp o
  // altă cerere a închis sesiunea (`expire`) sau omul a finalizat-o. Starea
  // curentă se recitește; orice altceva decât `open` (sau recitirea eșuată) →
  // 409 retryable. NU se creează aici o sesiune cu o cheie nouă calculată din
  // același instantaneu (lista citită ÎNAINTEA sesiunii): la reîncercare lista
  // o vede, iar segmentul de stare dă altă cheie. O creare proaspătă (fără
  // replay) e mereu `open` și nu costă o cerere în plus. Recitirea ÎNGUSTEAZĂ
  // fereastra, n-o închide: o închidere a altei cereri între recitire și
  // răspuns lasă tot un 200 cu URL-ul unei sesiuni închise (consemnat la
  // `settleOpenSessions`).
  if (isIdempotentReplay(session)) {
    let current = null
    try {
      current = await stripe.checkout.sessions.retrieve(session.id)
    } catch (e) {
      console.error('[stripe-checkout] replayed session not re-read (fail-closed):', {
        type: e?.type, code: e?.code, message: e?.message,
      })
    }
    if (current?.status !== 'open') {
      return jsonResponse(409, { error: CHECKOUT_IN_PROGRESS_MSG, code: 'checkout_in_progress' })
    }
  }

  return jsonResponse(200, { url: session.url })
}
