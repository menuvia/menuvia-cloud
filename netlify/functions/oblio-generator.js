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

  // Token cache per (api_email) for batch
  const tokenCache = new Map()

  let issued = 0, failed = 0

  for (const inv of queued) {
    try {
      // Get / refresh access token
      let token = tokenCache.get(inv.api_email)
      if (!token) {
        token = await getOblioToken(inv.api_email, inv.api_secret, inv.test_mode)
        tokenCache.set(inv.api_email, token)
      }

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
      console.error(`[oblio] Failed for invoice ${inv.invoice_id}:`, errMsg)
      await supabase.rpc('bridge_oblio_mark_failed', {
        p_invoice_id: inv.invoice_id,
        p_error:      errMsg.slice(0, 1000),
      })
      failed++

      // If auth failed, drop token cache (force re-auth next iteration)
      if (errMsg.includes('401') || errMsg.includes('Unauthorized')) {
        tokenCache.delete(inv.api_email)
      }
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ processed: queued.length, issued, failed }),
  }
}

// ── Oblio API: get access token ───────────────────────────────
async function getOblioToken(apiEmail, apiSecret, testMode) {
  const base = testMode ? OBLIO_TEST_BASE : OBLIO_BASE

  const res = await fetch(`${base}/authorize/token`, {
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
  return data.access_token
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

  // Get VAT rates for the restaurant
  const { data: order } = await supabase
    .from('orders').select('restaurant_id').eq('id', orderId).single()

  const { data: vatRates } = await supabase
    .from('vat_rates')
    .select('vat_group, rate_percent')
    .eq('restaurant_id', order.restaurant_id)

  const vatMap = {}
  for (const v of (vatRates || [])) {
    vatMap[v.vat_group] = parseFloat(v.rate_percent)
  }

  return items.map((it) => {
    const name = it.products?.name || 'Produs'
    const vatGroup = it.products?.vat_group ?? 1
    const vatPercent = vatMap[vatGroup] ?? 19  // fallback 19% if undefined
    // #6: pretul de linie = item_total/quantity (include modifier + extras deltas), nu doar
    // pretul de baza al produsului — altfel totalul facturii diverge de order.total.
    // Factură fiscală: o cantitate zero/null/non-numerică e dată coruptă — eșuăm înainte de
    // a trimite la Oblio (altfel price s-ar calcula cu un fallback iar payload-ul ar trimite
    // cantitatea originală invalidă → total divergent).
    const qty = Number(it.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Cantitate invalidă pe linia de comandă (produs: ${name})`)
    }
    // item_total / unit_price_snapshot sunt GROSS (prețul plătit de client, TVA INCLUS;
    // order.total = Σ item_total). Oblio interpretează `price` în funcție de `vatIncluded`:
    //   - vatIncluded=true  → price e gross, Oblio nu mai adaugă TVA;
    //   - vatIncluded=false → price e NET, Oblio adaugă TVA pe deasupra.
    // Trimiteam mereu gross-ul, dar cu vatIncluded din config → când config-ul cere
    // prețuri fără TVA, Oblio adăuga TVA peste gross și totalul facturii ieșea
    // order.total*(1+TVA), divergent de suma încasată. Fix: derivă NET-ul când
    // vatIncluded=false, ca totalul facturii să rămână = gross-ul plătit în ambele cazuri.
    const grossUnit =
      it.item_total != null
        ? parseFloat(it.item_total) / qty
        : parseFloat(it.unit_price_snapshot)
    const price = vatIncluded ? grossUnit : grossUnit / (1 + vatPercent / 100)
    return {
      name,
      quantity: it.quantity,
      price,
      vatPercentage: vatPercent,
      vatIncluded,
    }
  })
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
      vatName:        'Normala',
      vatPercentage:  li.vatPercentage,
      vatIncluded:    li.vatIncluded,
      quantity:       li.quantity,
      productType:    'Marfa',
    })),
    issuerName:   '',
    issuerId:     '',
    noticeNumber: '',
    internalNote: '',
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

  const res = await fetch(`${base}/docs/invoice`, {
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
