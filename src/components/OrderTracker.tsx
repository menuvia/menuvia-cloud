// ─────────────────────────────────────────────────────────────
// OrderTracker + ActiveOrdersBanner — order confirmation & session tracking
// Extracted from QrMenuPage to reduce file size.
// FIX: RLS blochează SELECT pe `orders` pentru anon users, așa că
// `postgres_changes` nu primea niciodată UPDATE-urile. Acum polling
// prin get_order_public_status RPC (SECURITY DEFINER).
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from 'react'
import type { OrderConfirmationPayload } from '../lib/orders'
import {
  getOrderPublicStatus,
  requestFiscalReceipt,
  serverOrderDiscount,
  serverOrderTotal,
} from '../lib/orders'
import { fmtPrice, type MenuCurrency } from '../lib/currency'
import PaymentConfirmedScreen from './PaymentConfirmedScreen'
import { T, type PublicMenuStringKey } from '../lib/publicMenuStrings'
import { Tf } from '../lib/guestI18n'
import OrderClosedScreen from './OrderClosedScreen'
import { legibleOn, readableTextOn } from '../lib/themes'

// Ritmul polling-ului (perf-guest-11): 5 s cât comanda se mișcă prin bucătărie
// (new → ready), 20 s pe `served` — după servire mai urmează doar închiderea
// (Plan 2) sau plata (Plan 3), care durează minute, nu secunde.
const ACTIVE_POLL_MS = 5000
const SERVED_POLL_MS = 20000

const ORDER_STEPS: ReadonlyArray<{ status: string; labelKey: PublicMenuStringKey; n: string }> = [
  { status: 'new', labelKey: 'ot_step_new', n: '1' },
  { status: 'confirmed', labelKey: 'ot_step_confirmed', n: '2' },
  { status: 'preparing', labelKey: 'ot_step_preparing', n: '3' },
  { status: 'ready', labelKey: 'ot_step_ready', n: '4' },
  { status: 'served', labelKey: 'ot_step_served', n: '5' },
]

interface OrderTrackerProps {
  confirmation: OrderConfirmationPayload
  accent: string
  onReset: (addMore?: boolean) => void
  previousOrders: OrderConfirmationPayload[]
  // Sesiunea mesei — necesară pentru payload-ul complet (mig 092).
  // Fără ea, serverul întoarce doar statusul. NU se afișează în UI.
  sessionId?: string | null
  // Moneda meniului (mig 205) — default RON, ca la call-site-urile istorice.
  currency?: MenuCurrency
  // Limba aleasă în meniu (T() din publicMenuStrings) — pentru ecranul `closed`.
  lang?: string
  // „Fără branding" (resolveHideBranding) — ecranele terminale îl respectă.
  hideBranding?: boolean
  // Totalul confirmat de server diferă de cel cunoscut (Happy Hour aplicat la
  // COMMIT, editare de ospătar, reducere manuală — lotul C8b). Părintele îl
  // propagă în lista comenzilor: butonul „Plătește masa”, lista „La bucătărie”
  // și baza bacșișului citesc de acolo.
  onServerTotal?: (orderId: string, total: number) => void
}

function OrderTracker({
  confirmation,
  accent,
  onReset,
  previousOrders,
  sessionId = null,
  currency = 'RON',
  lang = 'ro',
  hideBranding = false,
  onServerTotal,
}: OrderTrackerProps) {
  const [status, setStatus] = useState<string>(confirmation.status ?? 'new')
  // Totalul afișat e al SERVERULUI din momentul în care vine primul poll:
  // `create_order` întoarce suma DINAINTEA reducerii (contract mig 191, HH1),
  // iar Happy Hour se aplică la COMMIT (trigger amânat, mig 077). Până la
  // primul răspuns, sau pe payload-ul minim fără bani, rămâne cel cunoscut.
  const [displayTotal, setDisplayTotal] = useState<number>(Number(confirmation.total))
  const [discountAmount, setDiscountAmount] = useState<number>(0)
  // Ultimul total raportat părintelui: fără el, fiecare poll (5 s) ar re-scrie
  // lista comenzilor cu aceeași valoare.
  const reportedTotalRef = useRef<number>(Number(confirmation.total))
  const onServerTotalRef = useRef(onServerTotal)
  onServerTotalRef.current = onServerTotal
  const [tipsAmount, setTipsAmount] = useState<number>(0)
  const [paidAmount, setPaidAmount] = useState<number>(Number(confirmation.total))
  const [restaurantInfo, setRestaurantInfo] = useState<{
    name: string
    slug: string
    google_review_url: string | null
  } | null>(null)
  const [fiscalRequestedAt, setFiscalRequestedAt] = useState<string | null>(null)
  // Mig 092: serverul a downgradat payload-ul (sesiune lipsă/expirată) —
  // statusul merge în continuare, dar sumele și review-ul nu mai vin.
  const [limitedTracking, setLimitedTracking] = useState(false)
  const [fiscalRequesting, setFiscalRequesting] = useState(false)
  const statusRef = useRef<string>(status)
  statusRef.current = status

  useEffect(() => {
    // Skip polling entirely for LOCAL- offline orders (not in DB yet)
    if (confirmation.short_id?.startsWith('LOCAL-')) return

    let cancelled = false
    // Stările TERMINALE ale serverului (advance_order → `order_terminal` pe
    // paid/cancelled/closed, mig 264): după ele NIMIC nu mai variază server-side
    // — paid_amount/tips/restaurant vin în același payload cu statusul, iar
    // `fiscal_receipt_requested_at` e scris DOAR de acțiunea proprie a
    // clientului (requestFiscalReceipt → state local). Vechea justificare
    // („paid rămâne polling ca să prindem bonul") era FALSĂ și lăsa un RPC anon
    // la 5 s, nelimitat, cât timp ecranul „Plată confirmată" stătea deschis
    // (audit v3 RES-36). `served` RĂMÂNE poll-uit: Plan 2 → closed, Plan 3 →
    // paid. Paritate cu lista din ActiveOrdersBanner.
    const TERMINAL = ['paid', 'cancelled', 'closed']

    const poll = async () => {
      if (TERMINAL.includes(statusRef.current)) return
      const payload = await getOrderPublicStatus(confirmation.id, sessionId)
      if (cancelled || !payload) return
      const p = payload as unknown as Record<string, unknown>
      // Ref-ul se actualizează ACUM, nu la următoarea randare: programarea
      // următorului tick (mai jos) citește starea imediat după răspuns.
      statusRef.current = p.status as string
      setStatus(p.status as string)
      setLimitedTracking(!('total' in p))
      // După trimitere, banii vin din numărul serverului; reducerea NU se
      // recalculează în client (regula Happy Hour din CLAUDE.md).
      const serverTotal = serverOrderTotal(payload)
      if (serverTotal != null) {
        setDisplayTotal(serverTotal)
        setDiscountAmount(serverOrderDiscount(payload))
        if (serverTotal !== reportedTotalRef.current) {
          reportedTotalRef.current = serverTotal
          onServerTotalRef.current?.(confirmation.id, serverTotal)
        }
      }
      if (typeof p.tips_amount === 'number' || typeof p.tips_amount === 'string') {
        setTipsAmount(Number(p.tips_amount) || 0)
      }
      if (typeof p.paid_amount === 'number' || typeof p.paid_amount === 'string') {
        setPaidAmount(Number(p.paid_amount) || (serverTotal ?? Number(confirmation.total)))
      }
      if (p.fiscal_receipt_requested_at) {
        setFiscalRequestedAt(p.fiscal_receipt_requested_at as string)
      }
      if (p.restaurant && typeof p.restaurant === 'object') {
        const r = p.restaurant as Record<string, unknown>
        setRestaurantInfo({
          name: String(r.name || ''),
          slug: String(r.slug || ''),
          google_review_url: (r.google_review_url as string) || null,
        })
      }
    }

    // Un singur lanț de timeout-uri (nu setInterval), ca ritmul să se poată
    // schimba după stare. Odată terminală, comanda nu mai are ce aduce: nu se mai
    // programează nimic. Telefonul cu tab-ul în fundal (client care a comandat și
    // și-a băgat telefonul în buzunar) nu trimite cereri — același guard ca în
    // useOrders.
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false
    const run = async (): Promise<void> => {
      if (cancelled || TERMINAL.includes(statusRef.current)) return
      if (!document.hidden) {
        inFlight = true
        try {
          await poll()
        } catch {
          // Tranzitoriu (rețea): lanțul continuă la următorul tick.
        } finally {
          inFlight = false
        }
      }
      if (cancelled || TERMINAL.includes(statusRef.current)) return
      const delay = statusRef.current === 'served' ? SERVED_POLL_MS : ACTIVE_POLL_MS
      timer = setTimeout(() => void run(), delay)
    }
    // La revenirea în tab oaspetele vrea starea de ACUM, nu peste până la 20 s:
    // poll imediat, apoi ritmul normal. Dacă o cerere e deja în zbor, ea
    // programează singură următorul tick.
    const onVisibility = (): void => {
      if (document.hidden || inFlight || cancelled) return
      if (timer !== undefined) clearTimeout(timer)
      void run()
    }
    document.addEventListener('visibilitychange', onVisibility)
    void run()

    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // status exclus din deps intentionat — folosim ref pentru a evita
    // restart-ul polling-ului la fiecare update de status
  }, [confirmation.id, confirmation.short_id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRequestFiscalReceipt() {
    if (fiscalRequesting || fiscalRequestedAt) return
    setFiscalRequesting(true)
    try {
      const result = await requestFiscalReceipt(confirmation.id, sessionId)
      if (result?.requested_at) {
        setFiscalRequestedAt(String(result.requested_at))
      }
    } catch (e) {
      console.warn('fiscal receipt request failed:', e)
    } finally {
      setFiscalRequesting(false)
    }
  }

  const currentIdx = ORDER_STEPS.findIndex((s) => s.status === status)
  // 'closed' = Plan 2 terminal (mulțumire fără bon fiscal); 'paid' = Plan 3 cu bon.
  const isPaid = status === 'paid'
  const isClosed = status === 'closed'
  const isDone = status === 'served' || status === 'paid' || status === 'closed'
  const isCancelled = status === 'cancelled'
  const showDiscount = discountAmount > 0 && !isCancelled
  // Accentul vine din Setări (7 culori) sau din temă: textul PESTE el și accentul
  // folosit ca TEXT trec AA prin calcul, nu prin alb fix (alb pe auriu = 2,66:1).
  const onAccent = readableTextOn(accent, PUB.text)
  const accentInk = legibleOn(accent, PUB.bg)

  // ── Plan 2 (`closed`): nota închisă de ospătar, plata e la casa localului —
  // NU „Plată confirmată" (Menuvia n-a încasat nimic). Randat și fără
  // restaurantInfo (urmărire limitată): starea e terminală, nu mai vine nimic.
  if (isClosed) {
    return (
      <OrderClosedScreen
        confirmation={{ ...confirmation, total: displayTotal }}
        lang={lang}
        accent={accent}
        restaurantName={restaurantInfo?.name ?? null}
        googleReviewUrl={restaurantInfo?.google_review_url ?? null}
        sessionId={sessionId}
        currency={currency}
        hideBranding={hideBranding}
      />
    )
  }

  // ── Plată confirmată (Plan 3, `paid`) → ecranul dedicat cu feedback + Google review
  if (isPaid && restaurantInfo) {
    return (
      <PaymentConfirmedScreen
        confirmation={{ ...confirmation, total: paidAmount } as OrderConfirmationPayload}
        restaurantName={restaurantInfo.name}
        googleReviewUrl={restaurantInfo.google_review_url}
        accent={accent}
        tipsAmount={tipsAmount}
        onRequestFiscalReceipt={handleRequestFiscalReceipt}
        fiscalReceiptRequested={!!fiscalRequestedAt}
        hideBranding={hideBranding}
        // Fără sesiune, submit_order_feedback respinge comenzile de la masă
        // (session-gate mig 094) — funnel-ul de recenzii ar fi mort silențios.
        sessionId={sessionId}
        currency={currency}
        lang={lang}
      />
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: PUB.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '48px 24px 32px',
        zIndex: 300,
        overflowY: 'auto',
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
      <div
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 22,
          fontWeight: 700,
          color: PUB.text,
          marginBottom: 4,
          textAlign: 'center',
        }}
      >
        {T(lang, 'ot_sent_title')}
      </div>
      <div style={{ fontSize: 13, color: '#5C4A2A', marginBottom: 10 }}>
        {T(lang, 'ot_kitchen_received')} · #{confirmation.short_id}
      </div>
      {limitedTracking && (
        <div
          style={{
            background: 'rgba(232,160,32,0.12)',
            border: '1px solid rgba(232,160,32,0.3)',
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 13,
            color: '#80651D',
            textAlign: 'center',
            lineHeight: 1.5,
            maxWidth: 320,
          }}
        >
          {T(lang, 'ot_limited')}
          <br />
          {T(lang, 'ask_staff')}
        </div>
      )}
      <div
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 20,
          fontWeight: 700,
          color: accentInk,
          marginBottom: showDiscount ? 4 : 32,
        }}
      >
        {fmtPrice(displayTotal, currency)}
      </div>
      {/* Reducerea vine din payload-ul serverului. Motivul (Happy Hour sau
          reducere manuală) nu e în proiecția publică (mig 092), deci eticheta
          e neutră: un „Happy Hour” pe o reducere de ospătar ar fi fals. */}
      {showDiscount && (
        <div
          data-testid="ot-discount"
          style={{ fontSize: 13, fontWeight: 600, color: '#357A4D', marginBottom: 28 }}
        >
          {Tf(lang, 'ot_discount', { amount: fmtPrice(discountAmount, currency) })}
        </div>
      )}

      {isCancelled ? (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: 48, color: '#c0392b' }}>✕</div>
          <div style={{ color: '#c0392b', fontSize: 16, fontWeight: 600, marginTop: 12 }}>
            {T(lang, 'ot_cancelled')}
          </div>
        </div>
      ) : (
        <div
          style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 0 }}
        >
          {ORDER_STEPS.map((step, i) => {
            const isActive = i === currentIdx
            const isPast = i < currentIdx || isDone
            const isFuture = i > currentIdx && !isDone
            return (
              <div
                key={step.status}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 16, position: 'relative' }}
              >
                {i < ORDER_STEPS.length - 1 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 19,
                      top: 40,
                      width: 2,
                      height: 28,
                      background: isPast ? accent : '#D4C8B8',
                    }}
                  />
                )}
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: isPast || isActive ? accent : '#EDE7D9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    border: isActive ? '3px solid ' + accent : 'none',
                    boxShadow: isActive ? '0 0 0 4px ' + accent + '33' : 'none',
                    color: isPast || isActive ? onAccent : PUB.text,
                    fontWeight: 700,
                  }}
                >
                  {isPast ? '✓' : step.n}
                </div>
                <div style={{ paddingTop: 8, paddingBottom: 28 }}>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: isActive ? 700 : 500,
                      color: isFuture ? PUB.muted : PUB.text,
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                  >
                    {T(lang, step.labelKey)}
                  </div>
                  {isActive && !isDone && (
                    <div style={{ fontSize: 12, color: '#5C4A2A', marginTop: 2 }}>{T(lang, 'ot_now')}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          marginTop: 24,
          width: '100%',
          maxWidth: 320,
        }}
      >
        {/* "Add more" — keeps session history, goes back to menu */}
        {!isCancelled && (
          <button
            onClick={() => onReset(true)}
            style={{
              background: accent,
              color: onAccent,
              border: 'none',
              borderRadius: 12,
              padding: '14px 0',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            {T(lang, 'add_more_items')}
          </button>
        )}
        {/* Full reset — clears everything */}
        <button
          onClick={() => onReset(false)}
          style={{
            background: 'transparent',
            color: '#6B5A3F',
            border: '1px solid #D4C8B8',
            borderRadius: 12,
            padding: '12px 0',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 14,
            cursor: 'pointer',
            width: '100%',
          }}
        >
          {isCancelled ? T(lang, 'ot_new_order') : T(lang, 'ot_close_session')}
        </button>
      </div>
      {/* Show session total if there are previous orders. Runda curentă vine din
          poll-ul de aici; rundele anterioare sunt cum le-a confirmat ultima dată
          ActiveOrdersBanner — pe ecranul ăsta nu se poll-uiesc, iar bannerul le
          reîmprospătează imediat ce oaspetele revine în meniu (unde stă și
          „Plătește masa”). */}
      {previousOrders.length > 0 && !isCancelled && (
        <div style={{ marginTop: 16, fontSize: '0.8rem', color: '#6B5A3F', textAlign: 'center' }}>
          {T(lang, 'ot_session_total')}{' '}
          {fmtPrice(
            previousOrders.reduce((s, o) => s + Number(o.total), 0) + displayTotal,
            currency,
          )}{' '}
          ({previousOrders.length + 1} {T(lang, 'order_many')})
        </div>
      )}
    </div>
  )
}

// `muted` = text3 al temei implicite: ≥4.5:1 pe bg, pe cardul banner-ului și pe
// rândurile lui (fostele #B8AD9E / #9A8C7A aveau 2,0 / 2,97:1).
const PUB = { bg: '#F8F3EB', text: '#1A1208', muted: '#776A5C', card: '#FDF8F2' } as const

// ── ActiveOrdersBanner ─────────────────────────────────────────
// Shows live status of all orders placed in this QR session.
// Collapses to a single line, expands to show each order's status.

// Culoarea e și a TEXTULUI etichetei (0.72rem), deci trece AA (≥4.5:1) pe
// rândurile banner-ului — variantele vii de dashboard (#E8A020, #7EB8F7…) aveau
// 1,9–2,7:1 pe crem.
const STATUS_LABEL: Record<string, { labelKey: PublicMenuStringKey; color: string }> = {
  new: { labelKey: 'st_new', color: '#5C4A2A' },
  confirmed: { labelKey: 'st_confirmed', color: '#926514' },
  preparing: { labelKey: 'st_preparing', color: '#8A6729' },
  ready: { labelKey: 'ot_step_ready', color: '#357A4D' },
  served: { labelKey: 'st_served', color: '#4D7097' },
  paid: { labelKey: 'st_paid', color: '#706D69' },
  // Plan 2 (fără fiscalizare): comanda se termină în `closed`, nu în `paid`
  // (audit v3 FC-06 — înainte apărea „closed" brut și rămânea „activă" + poll-uită).
  closed: { labelKey: 'st_closed', color: '#706D69' },
  cancelled: { labelKey: 'st_cancelled', color: '#c0392b' },
}

interface ActiveOrdersBannerProps {
  sessionId?: string | null
  orders: OrderConfirmationPayload[]
  accent: string
  onAddMore: () => void
  // Moneda meniului (mig 205) — default RON, ca la call-site-urile istorice.
  currency?: MenuCurrency
  // Limba aleasă de oaspete în meniu — default 'ro'.
  lang?: string
  // Totalul de server al unei comenzi diferă de cel din listă (lotul C8b,
  // aceeași semantică ca la OrderTracker).
  onServerTotal?: (orderId: string, total: number) => void
  // Coșul e deschis, deci „Plătește masa · X” e pe ecran: la trecerea închis →
  // deschis bannerul reîmprospătează IMEDIAT toate comenzile ne-terminale (și
  // pe cele `served`), ca suma de pe buton să fie a serverului de acum.
  billOpen?: boolean
}

// Ritmul bannerului: comenzile încă în lucru la fiecare tick; cele `served` la
// fiecare al treilea (≈18 s, aproape de SERVED_POLL_MS din OrderTracker) —
// după servire banii se mai mișcă doar la notă, nu din secundă în secundă.
const BANNER_POLL_MS = 6000
const BANNER_SERVED_EVERY_TICKS = 3

function ActiveOrdersBanner({
  orders,
  accent,
  onAddMore,
  sessionId = null,
  currency = 'RON',
  lang = 'ro',
  onServerTotal,
  billOpen = false,
}: ActiveOrdersBannerProps) {
  const [expanded, setExpanded] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(orders.map((o) => [o.id, o.status])),
  )
  // Totalurile confirmate de server (payload complet, cu sesiune validă);
  // lipsa unei intrări = se afișează totalul din listă.
  const [serverTotals, setServerTotals] = useState<Record<string, number>>({})
  const statusesRef = useRef(statuses)
  statusesRef.current = statuses
  const onServerTotalRef = useRef(onServerTotal)
  onServerTotalRef.current = onServerTotal
  // `pollAll` al efectului montat acum — deschiderea coșului îl cheamă forțat.
  const pollAllRef = useRef<((includeServed: boolean) => Promise<void>) | null>(null)

  // Polling pentru toate comenzile active
  useEffect(() => {
    if (orders.length === 0) return

    let cancelled = false

    // Polling-ul se oprește DOAR pe stările terminale ale serverului (paritate
    // cu OrderTracker, RES-36). `served` NU e terminal pentru bani: reducerea
    // manuală e permisă pe `served` (apply_order_discount, mig 291), la fel
    // editarea liniilor (update_order_items) — exact la notă, când oaspetele e
    // în meniu și apasă „Plătește masa”, care citește totalul de aici. Cu
    // `served` printre terminale, totalul butonului rămânea cel de dinaintea
    // reducerii, iar PayTableSheet încasa altă sumă (recenzia lotului C8b).
    const TERMINAL = ['paid', 'cancelled', 'closed']

    const pollAll = async (includeServed: boolean) => {
      // Poll solo pentru comenzi non-terminale și non-offline; cele `served`
      // doar când tick-ul le include (ritm rar) sau la o reîmprospătare forțată.
      const active = orders.filter((o) => {
        if (o.short_id?.startsWith('LOCAL-')) return false
        const st = statusesRef.current[o.id] ?? o.status
        if (TERMINAL.includes(st)) return false
        return includeServed || st !== 'served'
      })
      if (active.length === 0) return

      const results = await Promise.all(
        active.map(async (o) => {
          const payload = await getOrderPublicStatus(o.id, sessionId)
          return {
            id: o.id,
            status: payload?.status ?? null,
            total: serverOrderTotal(payload),
            known: Number(o.total),
          }
        }),
      )
      if (cancelled) return
      setStatuses((prev) => {
        const next = { ...prev }
        for (const r of results) {
          if (r.status) next[r.id] = r.status
        }
        return next
      })
      // Payload-ul minim (sesiune expirată, mig 092) n-are bani: lista rămâne.
      const totals: Array<{ id: string; total: number; known: number }> = []
      for (const r of results) {
        if (r.total != null) totals.push({ id: r.id, total: r.total, known: r.known })
      }
      if (totals.length > 0) {
        setServerTotals((prev) => {
          const next = { ...prev }
          for (const r of totals) next[r.id] = r.total
          return next
        })
      }
      for (const r of totals) {
        if (r.total !== r.known) onServerTotalRef.current?.(r.id, r.total)
      }
    }

    pollAllRef.current = pollAll
    void pollAll(true)
    let ticks = 0
    const interval = setInterval(() => {
      // Guard identic cu polling-ul principal: tab în fundal = zero cereri.
      if (document.hidden) return
      ticks += 1
      void pollAll(ticks % BANNER_SERVED_EVERY_TICKS === 0)
    }, BANNER_POLL_MS)
    // La revenirea în tab: starea de acum, nu peste până la 6 s.
    const onVisibility = (): void => {
      if (!document.hidden) void pollAll(true)
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      pollAllRef.current = null
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [orders, sessionId])

  // Doar pe TRANZIȚIA închis → deschis: montarea are deja poll-ul ei, iar o
  // re-randare cu coșul deja deschis nu trebuie să mai trimită nimic.
  const billOpenRef = useRef(billOpen)
  useEffect(() => {
    const wasOpen = billOpenRef.current
    billOpenRef.current = billOpen
    if (billOpen && !wasOpen) void pollAllRef.current?.(true)
  }, [billOpen])

  const orderTotal = (o: OrderConfirmationPayload): number => serverTotals[o.id] ?? Number(o.total)
  const totalSpent = orders.reduce((s, o) => s + orderTotal(o), 0)
  const onAccent = readableTextOn(accent, PUB.text)
  const activeCount = orders.filter((o) => {
    const st = statuses[o.id] || o.status
    return !['served', 'paid', 'cancelled', 'closed'].includes(st)
  }).length

  return (
    <div
      style={{
        background: PUB.card,
        border: '1px solid #E8DFD0',
        borderRadius: 12,
        margin: '0 0 12px',
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '11px 14px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🧾</span>
          <div>
            <span
              style={{
                fontSize: '0.82rem',
                fontWeight: 700,
                color: '#1A1208',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              {orders.length} {orders.length === 1 ? T(lang, 'order_one') : T(lang, 'order_many')} ·{' '}
              {fmtPrice(totalSpent, currency)} {T(lang, 'total_suffix')}
            </span>
            {activeCount > 0 && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: '0.7rem',
                  background: accent + '22',
                  // Textul temei, nu accentul: pe nuanța de accent auriul ar avea ~2,4:1.
                  color: PUB.text,
                  padding: '1px 7px',
                  borderRadius: 100,
                  fontWeight: 600,
                  border: `1px solid ${accent}44`,
                }}
              >
                {activeCount} {activeCount === 1 ? T(lang, 'active_one') : T(lang, 'active_many')}
              </span>
            )}
          </div>
        </div>
        <span
          style={{
            color: PUB.muted,
            fontSize: 12,
            transition: 'transform .2s',
            transform: expanded ? 'rotate(180deg)' : 'none',
          }}
        >
          ▾
        </span>
      </button>

      {/* Expanded list */}
      {expanded && (
        <div
          style={{
            borderTop: '1px solid #E8DFD0',
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {orders.map((order) => {
            const st = statuses[order.id] || order.status
            const known = STATUS_LABEL[st]
            // Status necunoscut (server mai nou) → afișat brut, nu ascuns.
            const meta = known
              ? { label: T(lang, known.labelKey), color: known.color }
              : { label: st, color: '#5C4A2A' }
            return (
              <div
                key={order.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: '#FFF9F3',
                  borderRadius: 8,
                  border: '1px solid #EDE3D4',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: meta.color,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: '0.82rem',
                      color: '#1A1208',
                      fontFamily: 'DM Sans, sans-serif',
                      fontWeight: 500,
                    }}
                  >
                    {T(lang, 'order_hash')}
                    {order.short_id}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '0.72rem', color: meta.color, fontWeight: 600 }}>
                    {meta.label}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: PUB.muted }}>
                    {fmtPrice(orderTotal(order), currency)}
                  </span>
                </div>
              </div>
            )
          })}
          <button
            onClick={onAddMore}
            style={{
              marginTop: 4,
              background: accent,
              color: onAccent,
              border: 'none',
              borderRadius: 8,
              padding: '10px 0',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            {T(lang, 'add_more_items')}
          </button>
        </div>
      )}
    </div>
  )
}

export { OrderTracker, ActiveOrdersBanner }
