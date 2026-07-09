// netlify/functions/oblio-generator.js
// Cron-triggered: la fiecare 2 min, procesează coada `invoices` cu status='queued'.
// Schedule (netlify.toml):
//   [functions."oblio-generator"]
//     schedule = "*/2 * * * *"
//
// Flux:
//   1. Claim până la 5 facturi din coadă (skip-locked atomic via RPC)
//   2. Pentru fiecare: autentificare Oblio → POST /api/docs/invoice
//   3. Pe succes: mark_issued cu series + number + link PDF
//   4. Pe eșec: mark_failed, retry până la 3 ori cu backoff
//
// Oblio API docs: https://www.oblio.eu/api
//   Auth: POST /api/authorize/token cu {client_id: api_email, client_secret: api_secret}
//         → returnează access_token (Bearer)
//   Create invoice: POST /api/docs/invoice cu JSON
//         → returnează {status, statusMessage, data: {seriesName, number, link, einvoice, token}}

const { createClient } = require('@supabase/supabase-js')

const OBLIO_BASE = 'https://www.oblio.eu/api'
const OBLIO_TEST_BASE = 'https://test.oblio.eu/api'  // sandbox dacă există

const FETCH_TIMEOUT_MS = 9000

// Fetch cu timeout explicit via AbortController — un Oblio agățat nu trebuie
// să blocheze cron-ul (rulează la fiecare 2 min) peste durata funcției Netlify.
async function fetchWithTimeout(url, options) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

exports.handler = async () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: 'Missing env' }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Claim queue
  const { data: queued, error } = await supabase.rpc('bridge_oblio_get_queued', { p_limit: 5 })

  if (error) {
    console.error('[oblio] Claim failed:', error.message)
    return { statusCode: 500, body: error.message }
  }

  if (!queued || queued.length === 0) {
    return { statusCode: 200, body: 'No queued invoices' }
  }

  // Token cache per (api_email + test_mode) for batch — o cheie compusă previne
  // reutilizarea unui token sandbox pe API-ul live (sau invers) când aceeași
  // adresă de email are atât credențiale test, cât și live în coadă.
  const tokenCache = new Map()

  let issued = 0, failed = 0

  for (const inv of queued) {
    try {
      // Get / refresh access token — cache-uit cu expirare; re-autentificăm
      // proactiv dacă tokenul curent a expirat (sau e pe cale să expire).
      const tokenCacheKey = `${inv.api_email}:${inv.test_mode}`
      let cached = tokenCache.get(tokenCacheKey)
      if (!cached || Date.now() >= cached.expiresAt) {
        cached = await getOblioToken(inv.api_email, inv.api_secret, inv.test_mode)
        tokenCache.set(tokenCacheKey, cached)
      }
      const token = cached.token

      // Fetch order details for line items
      const lineItems = await fetchOrderLineItems(supabase, inv.order_id, inv.vat_included)

      // Compose Oblio payload
      const payload = composeOblioInvoice(inv, lineItems)

      // POST to Oblio
      const oblio = await postOblioInvoice(payload, token, inv.test_mode)

      // Mark issued
      await supabase.rpc('bridge_oblio_mark_issued', {
        p_invoice_id: inv.invoice_id,
        p_series:     oblio.seriesName || inv.default_series,
        p_number:     String(oblio.number || ''),
        p_link:       oblio.link || '',
        p_einvoice:   oblio.einvoice || null,
        p_token:      oblio.token || null,
      })
      issued++

      console.log(`[oblio] Issued ${oblio.seriesName}-${oblio.number} for invoice ${inv.invoice_id}`)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      // Rezultat AMBIGUU (timeout/rețea în timpul POST-ului): Oblio POATE fi creat
      // deja factura, iar retry-ul ar produce un DUPLICAT fiscal (HIGH-3). Nu putem
      // preveni activ duplicatul fără un endpoint de căutare Oblio, dar marcăm clar
      // riscul în last_error ca founderul să verifice în Oblio ÎNAINTE ca retry-ul
      // să trimită din nou. O eroare 4xx de la Oblio = factura sigur NU s-a creat
      // (retry sigur); un abort/network = incert.
      const ambiguous =
        (err && err.name === 'AbortError') ||
        /aborted|timeout|network|fetch failed|ECONNRESET|ETIMEDOUT/i.test(errMsg)
      const storedErr = ambiguous
        ? `POSIBIL DUPLICAT — verifică în Oblio (order:${inv.order_id}) înainte de retry. Cauză: ${errMsg}`
        : errMsg
      console.error(`[oblio] Failed for invoice ${inv.invoice_id}${ambiguous ? ' (AMBIGUU/posibil duplicat)' : ''}:`, errMsg)
      await supabase.rpc('bridge_oblio_mark_failed', {
        p_invoice_id: inv.invoice_id,
        p_error:      storedErr.slice(0, 1000),
      })
      failed++

      // If auth failed, drop token cache (force re-auth next iteration)
      if (errMsg.includes('401') || errMsg.includes('Unauthorized')) {
        tokenCache.delete(`${inv.api_email}:${inv.test_mode}`)
      }
    }
  }

  // Status code reflectă rezultatul batch-ului, ca monitorizarea externă bazată
  // pe status code (nu doar pe body) să vadă problema:
  //   - eșec total (toate facturile din batch au eșuat) → 500
  //   - eșec parțial → 200, cu detaliile issued/failed în body
  //   - succes total → 200
  const allFailed = failed > 0 && failed === queued.length
  const statusCode = allFailed ? 500 : 200

  return {
    statusCode,
    body: JSON.stringify({ processed: queued.length, issued, failed }),
  }
}

// ── Oblio API: get access token ───────────────────────────────
// Întoarce { token, expiresAt } — expiresAt e un timestamp (ms epoch) calculat
// din data.expires_in, folosit de apelant pentru a re-autentifica proactiv
// înainte de expirare (vezi tokenCache în handler).
async function getOblioToken(apiEmail, apiSecret, testMode) {
  const base = testMode ? OBLIO_TEST_BASE : OBLIO_BASE

  const res = await fetchWithTimeout(`${base}/authorize/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      client_id:     apiEmail,
      client_secret: apiSecret,
      grant_type:    'client_credentials',
    }).toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Oblio auth ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = await res.json()
  if (!data.access_token) {
    throw new Error(`Oblio auth response missing access_token: ${JSON.stringify(data).slice(0, 200)}`)
  }

  // expires_in e în secunde; scădem o marjă de siguranță de 30s ca să nu
  // trimitem un POST cu un token care expiră chiar în timpul cererii.
  const expiresInSec = Number(data.expires_in)
  const safetyMarginMs = 30_000
  const expiresAt = Number.isFinite(expiresInSec)
    ? Date.now() + expiresInSec * 1000 - safetyMarginMs
    : Date.now() + 5 * 60_000 - safetyMarginMs  // fallback conservator: 5 min dacă lipsește expires_in

  return { token: data.access_token, expiresAt }
}

// ── Fetch order line items from DB ───────────────────────────
async function fetchOrderLineItems(supabase, orderId, vatIncluded) {
  // #4: coloana corecta e unit_price_snapshot (nu unit_price, inexistent). item_total include
  // delta-urile de modificatori/extras → folosit pentru pretul real de linie (#6).
  const { data: items, error } = await supabase
    .from('order_items')
    .select('quantity, unit_price_snapshot, item_total, products(name, vat_group)')
    .eq('order_id', orderId)

  if (error) throw new Error(`Order items fetch: ${error.message}`)

  if (!items || items.length === 0) {
    throw new Error(`Order ${orderId} has no items`)
  }

  // Get VAT rates for the restaurant + totalul REAL (post-discount) al comenzii.
  const { data: order } = await supabase
    .from('orders').select('restaurant_id, total, discount_amount').eq('id', orderId).single()

  const { data: vatRates } = await supabase
    .from('vat_rates')
    .select('vat_group, rate_percent')
    .eq('restaurant_id', order.restaurant_id)

  const vatMap = {}
  for (const v of (vatRates || [])) {
    vatMap[v.vat_group] = parseFloat(v.rate_percent)
  }

  // Normalizăm întâi liniile la GROSS/unitate (TVA inclus, ca order.total).
  const rows = items.map((it) => {
    const name = it.products?.name || 'Produs'
    const vatGroup = it.products?.vat_group ?? 1
    // Aliniat cu src/lib/vat.ts getVatRate: o grupă TVA lipsă din configurație e un
    // gap de configurare, NU 0%/19% implicit. Calculul silențios cu o cotă presupusă
    // ar produce subdeclarare/supradeclarare TVA pe bonul fiscal — eșuăm explicit,
    // handler-ul prinde eroarea și marchează factura `failed` cu mesaj clar.
    if (!Object.prototype.hasOwnProperty.call(vatMap, vatGroup)) {
      throw new Error(`Grupă TVA ${vatGroup} lipsă din configurație pentru produsul ${name}`)
    }
    const vatPercent = vatMap[vatGroup]
    // Factură fiscală: o cantitate zero/null/non-numerică e dată coruptă — eșuăm înainte de
    // a trimite la Oblio (altfel price s-ar calcula cu un fallback iar payload-ul ar trimite
    // cantitatea originală invalidă → total divergent).
    const qty = Number(it.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Cantitate invalidă pe linia de comandă (produs: ${name})`)
    }
    // #6: prețul de linie = item_total/quantity (include modifier + extras deltas), nu doar
    // prețul de bază al produsului. item_total/unit_price_snapshot sunt GROSS (TVA inclus).
    const grossUnit =
      it.item_total != null
        ? parseFloat(it.item_total) / qty
        : parseFloat(it.unit_price_snapshot)
    return { name, qty, vatPercent, grossUnit }
  })

  // ── Discount la nivel de comandă (HIGH-1) ──────────────────────────────────
  // Liniile (item_total) sunt PRE-discount, dar order.total e POST-discount
  // (mig 031: total = subtotal − discount_amount) — și exact order.total e ce a
  // plătit clientul și ce s-a fiscalizat pe casă. Fără corecție, factura Oblio
  // supra-factura cu discount_amount (TVA supradeclarat + factură ≠ bon ≠ încasat).
  // Distribuim discount-ul PROPORȚIONAL scalând fiecare linie cu order.total/subtotal;
  // TVA per linie rămâne corect (proporțional redus), iar Σ linii = order.total.
  const subtotalGross = rows.reduce((s, r) => s + r.grossUnit * r.qty, 0)
  const orderTotal = order && order.total != null ? parseFloat(order.total) : NaN
  const discountAmount = order && order.discount_amount != null ? parseFloat(order.discount_amount) : 0
  const factor =
    discountAmount > 0 && subtotalGross > 0 && Number.isFinite(orderTotal)
      ? orderTotal / subtotalGross
      : 1

  return rows.map((r) => {
    const grossUnit = r.grossUnit * factor
    // Oblio interpretează `price` în funcție de `vatIncluded`: gross (nu mai adaugă
    // TVA) sau net (adaugă TVA peste). Derivăm NET-ul când vatIncluded=false, ca
    // totalul facturii să rămână = gross-ul plătit (post-discount) în ambele cazuri.
    const price = vatIncluded ? grossUnit : grossUnit / (1 + r.vatPercent / 100)
    return {
      name: r.name,
      quantity: r.qty,
      price,
      vatPercentage: r.vatPercent,
      vatIncluded,
    }
  })
}

// ── Derivă denumirea cotei TVA (vatName) din procentul real ──
// Oblio cere un `vatName` care corespunde procentului; hardcodarea 'Normala' pentru
// orice cotă (9%/5%/0%) producea o etichetă TVA greșită pe factură (risc fiscal).
// Mapare pe cotele RO uzuale:
//   - 19/21 → 'Normala' (cota standard)
//   - 9/5/11 → 'Redusa' (cote reduse)
//   - 0 → 'SFDD' (scutit fără drept de deducere)
// ATENȚIE: aceste denumiri TREBUIE să existe ca și cote configurate în contul Oblio al
// clientului; dacă un client folosește alte denumiri, factura e respinsă de Oblio.
function vatNameFromPercent(pct) {
  const p = Number(pct)
  if (p === 0) return 'SFDD'
  if (p === 9 || p === 5 || p === 11) return 'Redusa'
  // 19/21 și orice altă cotă pozitivă necunoscută → cota standard 'Normala'.
  return 'Normala'
}

// ── Compose Oblio invoice payload ────────────────────────────
function composeOblioInvoice(inv, lineItems) {
  const today = new Date().toISOString().slice(0, 10)

  const payload = {
    cif:       inv.company_cif,
    client: {
      cif:       inv.customer_cif || '0',
      name:      inv.customer_name,
      rc:        '',
      address:   inv.customer_address || '',
      state:     '',
      city:      '',
      country:   'Romania',
      iban:      '',
      bank:      '',
      email:     inv.customer_email || '',
      phone:     inv.customer_phone || '',
      contact:   '',
      vatPayer:  inv.is_b2b,
    },
    issueDate:    today,
    dueDate:      today,
    deliveryDate: today,
    seriesName:   inv.default_series,
    language:     'RO',
    precision:    2,
    currency:     'RON',
    products: lineItems.map((li) => ({
      name:           li.name,
      code:           '',
      description:    '',
      price:          li.price,
      measuringUnit:  'buc',
      currency:       'RON',
      vatName:        vatNameFromPercent(li.vatPercentage),
      vatPercentage:  li.vatPercentage,
      vatIncluded:    li.vatIncluded,
      quantity:       li.quantity,
      productType:    'Marfa',
    })),
    issuerName:   '',
    issuerId:     '',
    noticeNumber: '',
    // Trasabilitate/dedup pe partea Oblio: legăm factura de order_id-ul intern.
    // LIMITARE: Oblio API nu expune (după research curent) un endpoint de căutare
    // după internalNote/idempotency key înainte de creare — deci acest câmp NU
    // previne activ un duplicat dacă primul POST a reușit la Oblio dar răspunsul
    // s-a pierdut înainte de mark_issued (retry va crea totuși un doc nou).
    // E doar trasabilitate manuală (căutare/reconciliere ulterioară în Oblio după
    // internalNote). Dedup real ar necesita un research suplimentar pe API-ul
    // Oblio (ex. verificare existență document pe seriesName+client înainte de POST).
    internalNote: `order:${inv.order_id}`,
    deputyName:   '',
    deputyIdentityCard: '',
    deputyAuto:   '',
    selesAgent:   '',
    mentions:     '',
    workStation:  'Sediu',
    useStock:     0,
    sendEmail:    inv.send_email ? 1 : 0,
  }

  return payload
}

// ── POST invoice to Oblio ────────────────────────────────────
async function postOblioInvoice(payload, token, testMode) {
  const base = testMode ? OBLIO_TEST_BASE : OBLIO_BASE

  const res = await fetchWithTimeout(`${base}/docs/invoice`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }

  // Succesul Oblio se confirmă POZITIV, nu prin absența substringului „error"
  // (care marca greșit mesaje gen „No errors"). Cerem: HTTP ok + status 200 (dacă
  // e prezent) + un NUMĂR de factură real în data.data — altfel un răspuns ambiguu
  // putea fi marcat `issued` cu number gol.
  const httpOk = res.ok && (data.status == null || Number(data.status) === 200)
  const invoiceNumber = data?.data?.number
  const hasNumber = invoiceNumber != null && String(invoiceNumber).trim().length > 0
  if (!httpOk || !hasNumber) {
    throw new Error(`Oblio invoice ${res.status}: ${data.statusMessage || text.slice(0, 200)}`)
  }

  // Successful response: { status: 200, statusMessage: 'Success', data: { seriesName, number, link, ... } }
  return data.data
}
