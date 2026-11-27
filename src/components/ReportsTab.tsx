// ─────────────────────────────────────────────────────────────
// ReportsTab — Rapoarte periodice (zilnic / săptămânal / lunar / custom)
// Înlocuiește DailyReportTab. Queries orders + order_items direct.
// Extended (migration 033): vânzări per ospătar, oră, categorie + CSV.
// Limba personalului (lotul L7): textele din namespace-ul `reports` (+ `common`
// pentru rezerva erorilor și „Reîncearcă”), cerute SUS, înaintea oricărui
// `return`. Eticheta perioadei și exporturile CSV/PDF sunt compuse de
// lib/reportsExport.ts (textele românești sunt cele de dinainte; CSV-ul are din
// lotul C6a forma pe care o deschide corect Excel-ul limbii). Seria graficului
// e lib/dailySeries.ts, perioada aleasă se păstrează pe sesiune
// (`useSessionChoice`). Eroarea de încărcare e ținută ca DATĂ și tradusă la
// randare.
// ─────────────────────────────────────────────────────────────
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { D, D_RAW } from '../lib/constants'
import { QueryError } from './PageLoader'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'
import { useIsMobile } from '../hooks/useIsMobile'
import { DEFAULT_RESTAURANT_TZ, toZonedYMD, zonedDayRange } from '../lib/dates'
import {
  chartSeries,
  reportDayTotals,
  seriesPointLabel,
  seriesSpansYears,
  type DayTotals,
} from '../lib/dailySeries'
import { REPORTS_CHOICE_KEY, defaultReportsChoice, parseReportsChoice } from '../lib/reportChoice'
import { useSessionChoice } from '../hooks/useSessionChoice'
import { patchPdfDiacritics } from '../lib/pdf'
import {
  fetchWaiterSales,
  fetchHourlySales,
  fetchCategorySales,
  downloadCsv,
  type WaiterSalesRow,
  type HourlySalesRow,
  type CategorySalesRow,
} from '../lib/reports'
import {
  buildReportCsv,
  categoryRowLabel,
  periodLabelT,
  reportCsvDialect,
  reportPeriodRange,
  reportPdfFilename,
  reportPdfText,
  waiterRowLabel,
} from '../lib/reportsExport'
import { useT } from '../i18n/useT'
import { useUiLang } from '../i18n/UiLangContext'
import { staffLocale } from '../i18n/format'
import { describeStaffError } from '../i18n/staffErrors'
import { reportsNs } from '../i18n/ns/reports'
import { commonNs } from '../i18n/ns/common'

// Pagina unei interogări PostgREST (`fetchAllPages` din `load`).
interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}
type PageFetch<T> = (lo: number, hi: number) => PromiseLike<PageResult<T>>

interface Props {
  restaurantId: string
  // Regula de aur (review monetizare): bani + bon = Plan 3, fără excepții.
  // false (Plan 1/2) → „evidență operațională": ce s-a comandat (cantități,
  // mix, top produse), FĂRĂ revenue/cash/card/bon mediu și fără exporturi
  // care arată sume — plata reală + bonul se fac pe casa existentă.
  fiscalReports?: boolean
  // Fusul ZILEI DE RAPORTARE (`reportTimeZone`, lotul G2b), calculat o dată în
  // DashboardPage: pe un local românesc București — banii, `v_daily_payments_
  // by_method` și `report_by_hour` sunt pe ziua românească —, altfel fusul
  // localului (pe Planurile 1/2, fără bani). O singură definiție a zilei pentru
  // toată fila: perioada, granițele interogărilor, gruparea și graficul.
  timeZone?: string
}

type Period = 'today' | 'week' | 'month' | 'custom'

// Perioada (azi / 7 / 30 de zile / interval) e `reportPeriodRange`
// (lib/reportsExport.ts), iar granițele de zi `zonedDayRange` (lib/dates) —
// surse unice, DST-aware, independente de fusul browserului.

// ─── Shared UI ────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 12,
        padding: '16px 18px',
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          color: D.t3,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'Fraunces,serif',
          fontSize: '1.6rem',
          color: color || D.t1,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 5 }}>{sub}</div>}
    </div>
  )
}

const btn = (active?: boolean): React.CSSProperties => ({
  padding: '7px 14px',
  // Touch target ≥44px — controale primare, folosite frecvent pe telefon.
  minHeight: 44,
  fontSize: '0.8rem',
  fontFamily: 'DM Sans,sans-serif',
  fontWeight: active ? 600 : 400,
  border: `1px solid ${active ? D.gold + '55' : D.border}`,
  borderRadius: 8,
  cursor: 'pointer',
  outline: 'none',
  background: active ? D.goldA : 'transparent',
  color: active ? D.goldL : D.t2,
  transition: 'all .15s',
})

// Pereche etichetă/valoare pentru cardurile de pe mobil (când tabelele cu multe
// coloane s-ar înghesui / ar cere scroll orizontal).
function ReportMetric({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div>
      <div
        style={{
          fontSize: '0.62rem',
          color: D.t3,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '0.85rem',
          color: accent ? D.gold : D.t2,
          fontWeight: accent ? 600 : 500,
        }}
      >
        {value}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────
export default function ReportsTab({ restaurantId, fiscalReports = true, timeZone = DEFAULT_RESTAURANT_TZ }: Props) {
  // Necondiționat, SUS: o limbă nouă suspendă o singură dată, la prima randare.
  const tr = useT(reportsNs)
  const tc = useT(commonNs)
  // Datele (perioada, ziua de pe grafic, exporturile) în formatul limbii
  // UTILIZATORULUI, nu limba dicționarului servit (clichetul LF din L6b).
  const { lang: uiLang } = useUiLang()
  const locale = staffLocale(uiLang)
  // Perioada aleasă supraviețuiește ieșirii din filă (lotul C6a): fila e
  // leneșă și se demontează la schimbarea filei, deci înainte revenea mereu pe
  // „Azi” și pierdea intervalul personalizat. `sessionStorage`, validat pe ziua
  // de azi în fusul zilei de raportare (toISO/UTC dădea „ieri" între 00:00–03:00
  // ora României).
  const [choice, setChoice] = useSessionChoice(
    REPORTS_CHOICE_KEY,
    () => defaultReportsChoice(toZonedYMD(new Date(), timeZone)),
    (raw) => parseReportsChoice(raw, toZonedYMD(new Date(), timeZone)),
  )
  const period: Period = choice.period
  const custom = choice.custom
  const setPeriod = (p: Period) => setChoice((c) => ({ ...c, period: p }))
  const setCustom = (f: (c: { from: string; to: string }) => { from: string; to: string }) =>
    setChoice((c) => ({ ...c, custom: f(c.custom) }))
  const [loading, setLoading] = useState(true)
  // Eroarea ca DATĂ (tradusă la randare): o schimbare de limbă o retraduce.
  const [error, setError] = useState<{ err: unknown } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(false)
  const isMobile = useIsMobile()
  // Tabelul „Top produse": coloanele de sume doar pe planul cu bon (lotul P).
  const topProductCols = fiscalReports ? '28px 1fr 60px 90px 90px' : '28px 1fr 60px'

  // Aggregated metrics
  const [metrics, setMetrics] = useState({
    totalOrders: 0,
    revenue: 0,
    cashRev: 0,
    cardRev: 0,
    voucherRev: 0,
    onlineRev: 0,
    otherRev: 0,
    qrOrders: 0,
    waiterOrders: 0,
    avgTicket: 0,
  })
  // Totalurile pe zi (cheia YYYY-MM-DD în fusul zilei de raportare) ȘI
  // intervalul pentru care au fost cerute: seria graficului se construiește din
  // ACEST interval (nu din perioada de pe ecran, care se poate schimba înainte
  // să sosească datele noi).
  const [dayTotals, setDayTotals] = useState<{
    from: string
    to: string
    totals: Map<string, DayTotals>
  } | null>(null)
  // Graficul are FIECARE zi a intervalului (lotul C6a): o zi închisă e o bară
  // de 0, nu dispare; peste 62 de zile, o bară pe săptămână.
  const series = useMemo(
    () => (dayTotals ? chartSeries(dayTotals.from, dayTotals.to, dayTotals.totals) : null),
    [dayTotals],
  )
  const [topProducts, setTopProducts] = useState<
    { name: string; qty: number; revenue: number; emoji: string }[]
  >([])

  // Extended reports (migration 033)
  const [waiterSales, setWaiterSales] = useState<WaiterSalesRow[]>([])
  const [hourlySales, setHourlySales] = useState<HourlySalesRow[]>([])
  const [categorySales, setCategorySales] = useState<CategorySalesRow[]>([])

  // Guard de secvență: la schimbarea restaurantului/perioadei, răspunsul unui load
  // vechi nu trebuie să afișeze venitul/raportul altui restaurant sau interval.
  const loadSeqRef = useRef(0)
  const load = useCallback(async () => {
    // Cap-ul implicit PostgREST (max-rows) e 1000: un SELECT fără .range() se
    // trunchia TĂCUT la 1000 de rânduri — un local cu >1000 comenzi/perioadă
    // (~33/zi pe view-ul lunar) vedea venit și count-uri FALSE, fără nicio
    // eroare (audit aug 2026). Paginăm explicit: pagini de 1000 până la prima
    // pagină incompletă. Factory (nu builder reținut) — builderul supabase e
    // one-shot; fiecare pagină cere un lanț nou cu .range() propriu.
    const PG_PAGE = 1000
    async function fetchAllPages<T>(page: PageFetch<T>): Promise<T[]> {
      const all: T[] = []
      for (let lo = 0; ; lo += PG_PAGE) {
        const { data, error } = await page(lo, lo + PG_PAGE - 1)
        if (error) throw error
        const rows = data ?? []
        all.push(...rows)
        if (rows.length < PG_PAGE) return all
      }
    }
    const seq = ++loadSeqRef.current
    const range = reportPeriodRange(period, custom, timeZone)
    setLoading(true)
    setError(null)
    try {
      // Granițe de zi în fusul zilei de raportare, DST-aware. Hardcodarea lui
      // +03:00 muta granița cu o oră iarna și pierdea/dubla comenzi pe margini.
      const startISO = zonedDayRange(range.from, timeZone).from
      const endISO = zonedDayRange(range.to, timeZone).to

      // ── Single source of truth: orders table (not v_daily_orders) ──
      // Includes ALL non-cancelled orders, not just paid ones.
      // OPT-R2: comenzile (pe created_at) și cele plătite (pe paid_at) sunt
      // interogări INDEPENDENTE — le lansăm în paralel (−1 RTT serial la
      // fiecare schimbare de perioadă). Gating-ul monetar Plan 3 și
      // defense-in-depth pe coloane rămân IDENTICE.
      // Paginat cu fetchAllPages (anti-trunchiere la 1000); `id` ca tiebreaker
      // de ordine — paginarea PostgREST fără ordine total-deterministă poate
      // sări/dubla rânduri la egalitate de created_at.
      const ordersP = fetchAllPages((lo, hi) =>
        supabase
          .from('orders')
          // Pe Plan 1/2 (fiscalReports=false) NU aducem coloanele monetare in browser
          // (defense-in-depth: venit = Plan 3). Doar count-ul operational ramane.
          .select(
            fiscalReports
              ? 'id, source, status, total, paid_amount, payment_method, created_at'
              : 'id, source, status, created_at',
          )
          .eq('restaurant_id', restaurantId)
          .neq('status', 'cancelled')
          .gte('created_at', startISO)
          .lte('created_at', endISO)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(lo, hi),
      )
      // Venitul se calculează pe comenzile PLĂTITE, bucketate după `paid_at`
      // (momentul încasării), NU după created_at: o comandă creată ieri și plătită
      // azi trebuie să intre în venitul de azi. Query separat, mărginit pe paid_at.
      // Coloanele monetare rămân gate-uite pe Plan 3 (fiscalReports).
      const paidP = fiscalReports
        ? fetchAllPages((lo, hi) =>
            supabase
              .from('orders')
              .select('id, total, paid_amount, payment_method, paid_at')
              .eq('restaurant_id', restaurantId)
              .eq('status', 'paid')
              .gte('paid_at', startISO)
              .lte('paid_at', endISO)
              .order('paid_at', { ascending: true })
              .order('id', { ascending: true })
              .range(lo, hi),
          )
        : Promise.resolve([])
      // Defalcarea pe metodă vine din REGISTRUL de plăți (mig 267), nu din
      // `orders.payment_method`: enum-ul e unul singur per comandă, deci orice
      // split (parțiale, split pe itemi, online + rest cash) îl duce pe 'other'
      // și TOȚI banii aterizau în „Alte metode". Măsurat pe producție înainte
      // de fix: 41 lei card + 47 lei cash raportați ca 88 lei „alte".
      // `day` din view e deja ziua ÎNCASĂRII în fusul României, deci se
      // filtrează direct cu `range.from`/`range.to` (YYYY-MM-DD): pe un local cu
      // bani (fiscal ⇒ România) ziua de raportare e chiar ziua românească.
      // IIFE `async`, nu lanț `.then` pe builder: builder-ul supabase-js e doar
      // `PromiseLike`, iar un lanț adnotat `Promise<...>` pică TS2322 DOAR pe
      // Netlify (capcana E5b din CLAUDE.md).
      const breakdownP: Promise<Record<string, unknown>[] | null> = fiscalReports
        ? (async () => {
            try {
              // Paginat ca restul interogărilor din tab: PostgREST trunchiază
              // TĂCUT la `max-rows` (1000). View-ul dă un rând pe zi, deci un
              // interval personalizat mai lung de 1000 de zile s-ar tăia — și,
              // fiindcă reziduul se pliază în „Alte metode", TOTALUL ar continua
              // să închidă, deci nimic n-ar arăta stricat: doar cash/card/
              // tichete/online ar fi subevaluate. `day` e unic per restaurant,
              // deci e o ordine total-deterministă pentru paginare.
              return await fetchAllPages<Record<string, unknown>>((lo, hi) =>
                supabase
                  .from('v_daily_payments_by_method')
                  .select(
                    'cash_revenue, card_revenue, voucher_revenue, online_revenue, other_revenue, total_revenue',
                  )
                  .eq('restaurant_id', restaurantId)
                  .gte('day', range.from)
                  .lte('day', range.to)
                  .order('day', { ascending: true })
                  .range(lo, hi),
              )
            } catch {
              // View-ul apare abia cu mig 267, iar frontend-ul se deployează
              // ÎNAINTEA migrației (ca peste tot în repo) — `null` = „nu am sursa
              // unică", nu „zero lei".
              return null
            }
          })()
        : Promise.resolve([])
      const [ordersRaw, paidRaw, breakdownRows] = await Promise.all([
        ordersP,
        paidP,
        breakdownP,
      ])

      // `as unknown as` — select-ul condiționat (ternar) face ca tipul rândului dedus de
      // supabase-js să fie un union ne-literal (ParserError), deci trecem prin unknown.
      const allOrders = (ordersRaw ?? []) as unknown as Record<string, unknown>[]
      const totalOrders = allOrders.length
      const paidOrders = (paidRaw ?? []) as unknown as Record<string, unknown>[]
      const revenue = paidOrders.reduce((s, o) => s + Number(o.paid_amount ?? o.total ?? 0), 0)
      // Fallback pe bucketarea veche (client-side, pe enum) DOAR cât timp
      // view-ul nu există: frontend-ul se deployează ÎNAINTEA migrației, ca
      // peste tot în repo (fetchMenuForRestaurant, kitchen_tickets_mark_stale).
      // Cifrele sunt cele de dinainte de fix — corecte pentru comenzile fără
      // split, greșite pentru cele cu — dar tab-ul nu se albește.
      const bucketLegacy = (m: string) =>
        paidOrders
          .filter((o) =>
            m === 'other'
              ? o.payment_method === 'other' ||
                o.payment_method == null ||
                o.payment_method === ''
              : o.payment_method === m,
          )
          .reduce((s2, o) => s2 + Number(o.paid_amount ?? o.total ?? 0), 0)

      const sumCol = (col: string) =>
        (breakdownRows ?? []).reduce((s2, r) => s2 + Number(r[col] ?? 0), 0)

      const cashRev = breakdownRows ? sumCol('cash_revenue') : bucketLegacy('cash')
      const cardRev = breakdownRows ? sumCol('card_revenue') : bucketLegacy('card_pos')
      // Tichetele de masă se decontează separat cu emitentul (Edenred/Sodexo/Up) —
      // operatorul are nevoie de totalul lor distinct pentru reconciliere.
      const voucherRev = breakdownRows ? sumCol('voucher_revenue') : bucketLegacy('meal_voucher')
      // Plăți online la masă (Stripe, mig 202/203). Fără bucket propriu,
      // cash+card+tichete nu închideau cu venitul total pe Plan 3 cu plăți
      // online — reconcilierea cu Stripe nu bătea (audit v3 CA-02 / MF-12).
      const onlineRev = breakdownRows ? sumCol('online_revenue') : bucketLegacy('card_online')
      // Restul: metode necunoscute + comenzi vechi fără metodă. Cu bucket-ul
      // ăsta defalcarea ÎNCHIDE cu venitul total, deci reconcilierea de seară
      // e completă.
      // Reziduul se PLIAZĂ în „Alte metode", ca cele cinci carduri să însumeze
      // ÎNTOTDEAUNA cardul „Venituri" de deasupra lor. `revenue` se calculează
      // client-side ca `paid_amount ?? total`, iar view-ul acoperă aceeași
      // fereastră; pentru datele conforme (mig 264: `paid_amount ==
      // sum(order_payments)`) diferența e ZERO. Pe un rând anormal — scris
      // direct prin PostgREST sub `orders: admin all` — fără plierea asta banii
      // ar dispărea tăcut din defalcare, exact regresia pe care bucketarea
      // veche NU o avea (partiționa aceeași valoare, deci închidea mereu).
      const otherRev = breakdownRows
        ? sumCol('other_revenue') + (revenue - sumCol('total_revenue'))
        : bucketLegacy('other')
      const qrOrders = allOrders.filter((o) => o.source === 'qr').length
      const waiterOrders = totalOrders - qrOrders
      // Bon mediu = venit încasat / număr comenzi plătite (nu împărți la comenzi deschise).
      const avgTicket = paidOrders.length > 0 ? revenue / paidOrders.length : 0

      if (seq !== loadSeqRef.current) return
      setMetrics({
        totalOrders,
        revenue,
        cashRev,
        cardRev,
        voucherRev,
        onlineRev,
        otherRev,
        qrOrders,
        waiterOrders,
        avgTicket,
      })

      // ── Totalurile pe zi ale graficului (agregare client-side) ──
      // Comenzile (count) pe ziua created_at; venitul pe ziua paid_at
      // (consecvent cu metricile de mai sus), ambele în fusul zilei de
      // raportare (`reportDayTotals`, lib/dailySeries.ts). Seria cu FIECARE zi
      // a intervalului se construiește la randare (`chartSeries`), deci ordinea
      // barelor nu mai depinde de ordinea în care apar zilele aici.
      setDayTotals({ from: range.from, to: range.to, totals: reportDayTotals(allOrders, paidOrders, timeZone) })

      // ── Top products — same orders, consistent data ──
      const orderIds = allOrders.map((o) => o.id as string)

      if (orderIds.length > 0) {
        // Step B: get order_items for those orders.
        // OPT-R2: order_id-urile se trimit în LOTURI — un singur `.in()` cu mii de
        // UUID-uri construia un URL de sute de KB care depășea limita de lungime
        // (414) pe localurile aglomerate pe perioade lungi. Loturile rulează în
        // paralel (browserul le serializează oricum ~6/host) și se concatenează;
        // agregarea de mai jos rămâne identică.
        const cols = fiscalReports
          ? 'product_name_snapshot, quantity, unit_price_snapshot, product_id'
          : 'product_name_snapshot, quantity, product_id'
        const CHUNK = 150
        const idChunks: string[][] = []
        for (let i = 0; i < orderIds.length; i += CHUNK) {
          idChunks.push(orderIds.slice(i, i + CHUNK))
        }
        // Fiecare lot de 150 de comenzi poate avea >1000 de itemi (7+/comandă)
        // → și loturile se paginează (fetchAllPages), altfel top-produse ar
        // sub-număra tăcut pe perioade lungi. Ordine pe id = paginare stabilă.
        const itemResults = await Promise.all(
          idChunks.map((ids) =>
            fetchAllPages((lo, hi) =>
              supabase
                .from('order_items')
                .select(cols)
                .in('order_id', ids)
                .order('id', { ascending: true })
                .range(lo, hi),
            ),
          ),
        )
        const items = itemResults.flat()

        // Step C: aggregate on client
        const map = new Map<
          string,
          { name: string; qty: number; revenue: number; emoji: string; productId: string }
        >()
        for (const item of (items ?? []) as unknown as Record<string, unknown>[]) {
          const key = item.product_id as string
          const prev = map.get(key)
          const qty = Number(item.quantity || 1)
          const rev = qty * Number(item.unit_price_snapshot || 0)
          if (prev) {
            prev.qty += qty
            prev.revenue += rev
          } else {
            map.set(key, {
              name: item.product_name_snapshot as string,
              emoji: '🍽️',
              qty,
              revenue: rev,
              productId: key,
            })
          }
        }

        const sorted = Array.from(map.values()).sort((a, b) => b.qty - a.qty)

        // Enrich with emoji from products table
        if (sorted.length > 0) {
          const { data: prods } = await supabase
            .from('products')
            .select('id, emoji')
            .in(
              'id',
              sorted.slice(0, 20).map((p) => p.productId),
            )
          const emojiMap = new Map(
            (prods ?? []).map((p: Record<string, unknown>) => [p.id as string, p.emoji as string]),
          )
          sorted.forEach((p) => {
            const e = emojiMap.get(p.productId)
            if (e) p.emoji = e
          })
        }

        if (seq !== loadSeqRef.current) return
        setTopProducts(sorted.slice(0, 10))
      } else {
        if (seq !== loadSeqRef.current) return
        setTopProducts([])
      }

      // ── Extended reports (server-side RPCs) — DOAR pe Plan 3. Pe Plan 1/2 nu le
      // mai cerem deloc (raportele de venit/ospatari/categorii nu se afiseaza oricum).
      if (fiscalReports) {
        const [ws, hs, cs] = await Promise.all([
          fetchWaiterSales(restaurantId, startISO, endISO).catch(() => [] as WaiterSalesRow[]),
          fetchHourlySales(restaurantId, startISO, endISO).catch(() => [] as HourlySalesRow[]),
          fetchCategorySales(restaurantId, startISO, endISO).catch(() => [] as CategorySalesRow[]),
        ])
        if (seq !== loadSeqRef.current) return
        setWaiterSales(ws)
        setHourlySales(hs)
        setCategorySales(cs)
      } else {
        if (seq !== loadSeqRef.current) return
        setWaiterSales([])
        setHourlySales([])
        setCategorySales([])
      }
    } catch (e: unknown) {
      if (seq !== loadSeqRef.current) return
      setError({ err: e })
    }
    setLoading(false)
  }, [restaurantId, period, custom.from, custom.to, fiscalReports, timeZone]) // eslint-disable-line react-hooks/exhaustive-deps

  const range = reportPeriodRange(period, custom, timeZone)

  useEffect(() => {
    void load()
  }, [load])

  // ─── Export CSV ──────────────────────────────────────────────
  function exportCsv() {
    const label = periodLabelT(tr, locale, period, range.from, range.to)
    // Separatorul și virgula zecimală urmează limba UTILIZATORULUI (formatul,
    // ca `locale`), nu limba dicționarului servit.
    const { filename, content } = buildReportCsv(
      tr,
      label,
      range,
      { metrics, topProducts, waiterSales, categorySales, hourlySales },
      reportCsvDialect(uiLang),
    )
    downloadCsv(filename, content)
  }

  // ─── Export PDF ──────────────────────────────────────────────
  async function exportPdf() {
    setExporting(true)
    setExportError(false)
    try {
      const { default: jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      // Fonturile standard jsPDF nu au ă/ș/ț — fără patch, etichetele și numele
      // de produse ieșeau cu caractere rupte în raportul exportat.
      patchPdfDiacritics(doc)
      const label = periodLabelT(tr, locale, period, range.from, range.to)
      const m = metrics
      const txt = reportPdfText(tr, m)

      doc.setFontSize(18)
      doc.setFont('helvetica', 'bold')
      doc.text(txt.title, 20, 25)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'normal')
      doc.text(label, 20, 33)
      doc.setDrawColor(200, 150, 60)
      doc.setLineWidth(0.5)
      doc.line(20, 37, 190, 37)

      let y = 47
      // Metrics
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text(txt.summary, 20, y)
      y += 9
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text(txt.totalOrders, 24, y)
      y += 6
      doc.text(txt.revenueLine, 24, y)
      y += 6
      doc.text(txt.methodsLine, 24, y)
      y += 6
      doc.text(txt.sourcesLine, 24, y)
      y += 14

      if (topProducts.length > 0) {
        doc.setFontSize(12)
        doc.setFont('helvetica', 'bold')
        doc.text(txt.topTitle, 20, y)
        y += 9
        doc.setFontSize(10)
        doc.setFont('helvetica', 'normal')
        // Header
        doc.setFillColor(245, 240, 230)
        doc.rect(20, y - 4, 170, 8, 'F')
        doc.setFont('helvetica', 'bold')
        doc.text('#', 22, y)
        doc.text(txt.colProduct, 30, y)
        doc.text(txt.colQty, 130, y)
        doc.text(txt.colRevenue, 155, y)
        y += 7
        doc.setFont('helvetica', 'normal')
        topProducts.forEach((p, i) => {
          if (y > 270) {
            doc.addPage()
            y = 20
          }
          const bg = i % 2 === 0
          if (bg) {
            doc.setFillColor(252, 248, 243)
            doc.rect(20, y - 4, 170, 7, 'F')
          }
          doc.text(`${i + 1}`, 22, y)
          doc.text(p.name.slice(0, 45), 30, y)
          doc.text(`${p.qty}`, 130, y)
          doc.text(`${p.revenue.toFixed(2)} lei`, 155, y)
          y += 7
        })
        y += 6
      }

      doc.setFontSize(8)
      doc.setTextColor(150, 150, 150)
      doc.text(txt.disclaimer, 20, y + 10)
      doc.save(reportPdfFilename(tr, range.from, range.to))
    } catch (e) {
      console.error('PDF export failed', e)
      setExportError(true)
    }
    setExporting(false)
  }

  const {
    totalOrders,
    revenue,
    cashRev,
    cardRev,
    voucherRev,
    onlineRev,
    otherRev,
    qrOrders,
    waiterOrders,
    avgTicket,
  } = metrics
  const qrPct = totalOrders > 0 ? Math.round((qrOrders / totalOrders) * 100) : 0
  const waiterPct = 100 - qrPct
  // Punctele graficului: eticheta e ziua (formatul limbii utilizatorului); pe
  // săptămâni prima ei zi, cu anul când intervalul trece peste un an.
  const labelWithYear = series ? series.granularity === 'week' && seriesSpansYears(series) : false
  const chartPoints = (series?.points ?? []).map((p) => ({
    zi: seriesPointLabel(p, locale, labelWithYear),
    revenue: p.revenue,
    orders: p.orders,
  }))

  if (error)
    return (
      <div>
        <QueryError
          message={describeStaffError(error.err, tc, { fallback: tr.t('err_load') })}
          onRetry={load}
          retryLabel={tc.t('retry')}
        />
      </div>
    )

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <p style={{ color: D.t2, fontSize: '0.78rem', marginTop: 3 }}>
            {periodLabelT(tr, locale, period, range.from, range.to)}
          </p>
        </div>
        {/* Export-urile conțin sume (revenue, cash/card, vânzări per ospătar) —
            doar pe Plan 3. Plan 2 = evidență pe ecran, fără documente. */}
        <div style={{ display: fiscalReports ? 'flex' : 'none', gap: 8 }}>
          <button
            onClick={() => exportCsv()}
            disabled={loading || totalOrders === 0}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 14px',
              minHeight: 44,
              borderRadius: 9,
              fontSize: '0.85rem',
              fontWeight: 500,
              border: `1px solid ${D.border}`,
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
              background: D.s2,
              color: D.t1,
              opacity: totalOrders === 0 ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            <Icon name="download" size={16} />
            {tr.t('export_csv')}
          </button>
          <button
            onClick={() => void exportPdf()}
            disabled={exporting || loading || totalOrders === 0}
            title={tr.t('export_pdfTitle')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 16px',
              minHeight: 44,
              borderRadius: 9,
              fontSize: '0.85rem',
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
              background: D.gold,
              color: '#000',
              opacity: exporting || totalOrders === 0 ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {exporting ? (
              tr.t('export_generating')
            ) : (
              <>
                <Icon name="receipt" size={16} color="#000" />
                {tr.t('export_pdf')}
              </>
            )}
          </button>
        </div>
        {/* Eșecul exportului PDF era doar în consolă — acum vizibil pentru user. */}
        {exportError && (
          <div role="alert" style={{ color: D.red, fontSize: '0.8rem', marginTop: 8 }}>
            {tr.t('err_pdf')}
          </div>
        )}
      </div>

      {/* Period selector */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 20,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {(['today', 'week', 'month', 'custom'] as Period[]).map((p) => (
          <button
            key={p}
            style={btn(period === p)}
            aria-pressed={period === p}
            onClick={() => setPeriod(p)}
          >
            {p === 'today'
              ? tr.t('btn_today')
              : p === 'week'
                ? tr.t('btn_week')
                : p === 'month'
                  ? tr.t('btn_month')
                  : tr.t('btn_custom')}
          </button>
        ))}
        {period === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
            <input
              type="date"
              aria-label={tr.t('date_from')}
              value={custom.from}
              max={custom.to}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              style={{
                background: D.s3,
                border: `1px solid ${D.border}`,
                borderRadius: 7,
                padding: '6px 10px',
                minHeight: 44,
                color: D.t1,
                fontSize: '0.8rem',
                fontFamily: 'DM Sans,sans-serif',
              }}
            />
            <span style={{ color: D.t3, fontSize: 12 }}>→</span>
            <input
              type="date"
              aria-label={tr.t('date_to')}
              value={custom.to}
              min={custom.from}
              max={toZonedYMD(new Date(), timeZone)}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              style={{
                background: D.s3,
                border: `1px solid ${D.border}`,
                borderRadius: 7,
                padding: '6px 10px',
                minHeight: 44,
                color: D.t1,
                fontSize: '0.8rem',
                fontFamily: 'DM Sans,sans-serif',
              }}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
              gap: 10,
            }}
          >
            <Skeleton variant="card" count={4} />
          </div>
          <Skeleton variant="card" />
        </div>
      ) : totalOrders === 0 ? (
        <EmptyState
          icon="chart"
          title={tr.t('empty_title')}
          description={tr.t('empty_desc')}
        />
      ) : (
        <>
          {/* Plan 1/2: evidență operațională — o notă discretă de o linie, nu o
              alertă (lotul P): planul nu are sume, deci nu are ce „avertiza". */}
          {!fiscalReports && (
            <div style={{ color: D.t3, fontSize: '0.75rem', marginBottom: 12 }}>
              {tr.t('ops_note')}
            </div>
          )}

          {/* Metrics grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
              gap: 10,
              marginBottom: 14,
            }}
          >
            <StatCard label={tr.t('stat_orders')} value={String(totalOrders)} />
            {fiscalReports && (
              <>
                <StatCard
                  label={tr.t('stat_revenue')}
                  value={`${revenue.toFixed(0)} lei`}
                  color={D.gold}
                />
                <StatCard
                  label={tr.t('stat_avgTicket')}
                  value={`${avgTicket.toFixed(2)} lei`}
                  color={D.goldL}
                />
                <StatCard
                  label={tr.t('stat_cash')}
                  value={`${cashRev.toFixed(0)} lei`}
                  color={D.green}
                  sub={revenue > 0 ? `${Math.round((cashRev / revenue) * 100)}%` : undefined}
                />
                <StatCard
                  label={tr.t('stat_card')}
                  value={`${cardRev.toFixed(0)} lei`}
                  color="#7EB8F7"
                  sub={revenue > 0 ? `${Math.round((cardRev / revenue) * 100)}%` : undefined}
                />
                {voucherRev > 0 && (
                  <StatCard
                    label={tr.t('stat_voucher')}
                    value={`${voucherRev.toFixed(0)} lei`}
                    color={D.goldL}
                    sub={revenue > 0 ? `${Math.round((voucherRev / revenue) * 100)}%` : undefined}
                  />
                )}
                {onlineRev > 0 && (
                  <StatCard
                    label={tr.t('stat_online')}
                    value={`${onlineRev.toFixed(0)} lei`}
                    color="#B08CF2"
                    sub={revenue > 0 ? `${Math.round((onlineRev / revenue) * 100)}%` : undefined}
                  />
                )}
                {otherRev > 0 && (
                  <StatCard
                    label={tr.t('stat_other')}
                    value={`${otherRev.toFixed(0)} lei`}
                    color={D.t2}
                    sub={revenue > 0 ? `${Math.round((otherRev / revenue) * 100)}%` : undefined}
                  />
                )}
              </>
            )}
          </div>

          {/* QR vs Waiter */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
              gap: 10,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                background: D.s2,
                border: `1px solid ${D.border}`,
                borderRadius: 12,
                padding: '16px 18px',
              }}
            >
              <div
                style={{
                  fontSize: '0.7rem',
                  color: D.t3,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Icon name="qr" size={14} color={D.t3} />
                {tr.t('src_qr')}
              </div>
              <div
                style={{
                  fontFamily: 'Fraunces,serif',
                  fontSize: '1.6rem',
                  color: D.gold,
                  fontWeight: 700,
                }}
              >
                {qrOrders}
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 4 }}>
                {tr.t('pct_ofTotal', { pct: qrPct })}
              </div>
              {/* Mini bar */}
              <div
                style={{
                  height: 4,
                  background: D.s3,
                  borderRadius: 2,
                  marginTop: 8,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${qrPct}%`,
                    background: D.gold,
                    borderRadius: 2,
                  }}
                />
              </div>
            </div>
            <div
              style={{
                background: D.s2,
                border: `1px solid ${D.border}`,
                borderRadius: 12,
                padding: '16px 18px',
              }}
            >
              <div
                style={{
                  fontSize: '0.7rem',
                  color: D.t3,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Icon name="users" size={14} color={D.t3} />
                {tr.t('src_waiter')}
              </div>
              <div
                style={{
                  fontFamily: 'Fraunces,serif',
                  fontSize: '1.6rem',
                  color: D.t1,
                  fontWeight: 700,
                }}
              >
                {waiterOrders}
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 4 }}>
                {tr.t('pct_ofTotal', { pct: waiterPct })}
              </div>
              <div
                style={{
                  height: 4,
                  background: D.s3,
                  borderRadius: 2,
                  marginTop: 8,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${waiterPct}%`,
                    background: D.t3,
                    borderRadius: 2,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Graficul pe zile (lotul C6a: FIECARE zi a intervalului, cu 0 pe
              zilele fără vânzări; peste 62 de zile pe săptămâni). Pe Planul 3
              venitul (venit = fiscal); pe Planurile 1/2 numărul de comenzi —
              evidența operațională, fără sume. O singură zi („Azi”) = fără
              grafic, ca înainte. */}
          {series && series.points.length > 1 && (
            <div
              style={{
                background: D.s2,
                border: `1px solid ${D.border}`,
                borderRadius: 12,
                padding: '16px 18px',
                marginBottom: 20,
              }}
            >
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: D.t1, marginBottom: 14 }}>
                {fiscalReports
                  ? tr.t(series.granularity === 'week' ? 'chart_weeklyTitle' : 'chart_dailyTitle')
                  : tr.t(series.granularity === 'week' ? 'chart_weeklyOrdersTitle' : 'chart_dailyOrdersTitle')}
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={chartPoints} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={D_RAW.border} vertical={false} />
                  <XAxis
                    dataKey="zi"
                    tick={{ fill: D_RAW.t3, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: D_RAW.t3, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={fiscalReports}
                  />
                  <Tooltip
                    contentStyle={{
                      background: D.s2,
                      border: `1px solid ${D.border}`,
                      borderRadius: 8,
                      fontSize: '0.8rem',
                      color: D.t1,
                    }}
                    formatter={(v: unknown) =>
                      fiscalReports
                        ? [`${Number(v ?? 0).toFixed(0)} lei`, tr.t('chart_revenue')]
                        : [String(v ?? 0), tr.t('chart_orders')]
                    }
                  />
                  <Bar
                    dataKey={fiscalReports ? 'revenue' : 'orders'}
                    fill={fiscalReports ? D_RAW.gold : D_RAW.goldL}
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top products */}
          {topProducts.length > 0 && (
            <>
              <div
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: D.t1,
                  marginBottom: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Icon name="star" size={16} color={D.gold} />
                {tr.tp('top_title', topProducts.length)}
                <span style={{ fontSize: '0.72rem', color: D.t2, fontWeight: 400, marginLeft: 2 }}>
                  {tr.t('top_sub')}
                </span>
              </div>
              <div
                style={{
                  background: D.s2,
                  border: `1px solid ${D.border}`,
                  borderRadius: 14,
                  // Pe mobil tabelul cu 5 coloane scrollează orizontal intern, nu sparge pagina
                  overflowX: 'auto',
                  marginBottom: 24,
                }}
              >
                {isMobile ? (
                  topProducts.map((p, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '12px 16px',
                        borderBottom:
                          i < topProducts.length - 1 ? `1px solid ${D.border}` : 'none',
                      }}
                    >
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}
                      >
                        <span
                          style={{
                            fontSize: '0.82rem',
                            color: i < 3 ? D.gold : D.t3,
                            fontWeight: 700,
                            minWidth: 20,
                            textAlign: 'center',
                          }}
                        >
                          {i + 1}
                        </span>
                        <span style={{ fontSize: '1rem' }}>{p.emoji}</span>
                        <span style={{ fontSize: '0.9rem', color: D.t1, fontWeight: 600 }}>
                          {p.name}
                        </span>
                      </div>
                      <div
                        style={{ display: 'flex', gap: 20, flexWrap: 'wrap', paddingLeft: 28 }}
                      >
                        <ReportMetric label={tr.t('col_qty')} value={String(p.qty)} />
                        {/* Sumele doar pe planul cu bon (lotul P): pe Planul 2
                            coloanele nu se arată deloc, nici ca „—". */}
                        {fiscalReports && (
                          <>
                            <ReportMetric
                              label={tr.t('col_revenue')}
                              accent
                              value={`${p.revenue.toFixed(0)} lei`}
                            />
                            <ReportMetric
                              label={tr.t('col_avgPrice')}
                              value={`${(p.revenue / p.qty).toFixed(2)} lei`}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <>
                    {/* Table header */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: topProductCols,
                        minWidth: 360,
                        padding: '8px 16px',
                        background: D.s3,
                        borderBottom: `1px solid ${D.border}`,
                      }}
                    >
                      {(fiscalReports
                        ? [
                            '#',
                            tr.t('col_product'),
                            tr.t('col_qty'),
                            tr.t('col_revenue'),
                            tr.t('col_avgPrice'),
                          ]
                        : ['#', tr.t('col_product'), tr.t('col_qty')]
                      ).map((h) => (
                    <div
                      key={h}
                      style={{
                        fontSize: '0.65rem',
                        color: D.t3,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.07em',
                      }}
                    >
                      {h}
                    </div>
                  ))}
                </div>
                {topProducts.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: topProductCols,
                      minWidth: 360,
                      padding: '11px 16px',
                      borderBottom: i < topProducts.length - 1 ? `1px solid ${D.border}` : 'none',
                      alignItems: 'center',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = D.s3)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div
                      style={{ fontSize: '0.78rem', color: i < 3 ? D.gold : D.t3, fontWeight: 700 }}
                    >
                      {i + 1}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '1rem' }}>{p.emoji}</span>
                      <span style={{ fontSize: '0.875rem', color: D.t1, fontWeight: 500 }}>
                        {p.name}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.875rem', color: D.t2, fontWeight: 600 }}>
                      {p.qty}
                    </div>
                    {fiscalReports && (
                      <>
                        <div style={{ fontSize: '0.875rem', color: D.gold, fontWeight: 600 }}>
                          {`${p.revenue.toFixed(0)} lei`}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: D.t3 }}>
                          {`${(p.revenue / p.qty).toFixed(2)} lei`}
                        </div>
                      </>
                    )}
                  </div>
                ))}
                  </>
                )}
              </div>
            </>
          )}

          {/* ── Hourly heatmap ───────────────────────────────── */}
          {fiscalReports && hourlySales.some((h) => h.order_count > 0) && (
            <div
              style={{
                marginTop: 24,
                marginBottom: 24,
                background: D.s2,
                border: `1px solid ${D.border}`,
                borderRadius: 14,
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '14px 18px', borderBottom: `1px solid ${D.border}` }}>
                <div
                  style={{
                    fontFamily: 'Fraunces,serif',
                    fontSize: '0.95rem',
                    color: D.t1,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                >
                  <Icon name="clock" size={16} color={D.gold} />
                  {tr.t('hourly_title')}
                </div>
                <div style={{ fontSize: '0.74rem', color: D.t2, marginTop: 2 }}>
                  {tr.t('hourly_desc')}
                </div>
              </div>
              <div style={{ padding: '14px 18px', height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={hourlySales.map((h) => ({
                      hour: `${String(h.hour).padStart(2, '0')}h`,
                      orders: h.order_count,
                      revenue: Number(h.total_revenue),
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={D_RAW.border} vertical={false} />
                    <XAxis dataKey="hour" stroke={D_RAW.t3} tick={{ fontSize: 11 }} interval={1} />
                    <YAxis stroke={D_RAW.t3} tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: D.s1,
                        border: `1px solid ${D.border}`,
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v, n) => [
                        n === tr.t('chart_revenue') ? `${Number(v ?? 0).toFixed(2)} lei` : String(v ?? ''),
                        n,
                      ]}
                    />
                    {/* Cheile datelor sunt interne (`orders`/`revenue`); numele
                        seriei din tooltip vine din `name`, în limba personalului. */}
                    <Bar dataKey="orders" name={tr.t('chart_orders')} radius={[3, 3, 0, 0]}>
                      {hourlySales.map((h, i) => {
                        const max = Math.max(...hourlySales.map((x) => x.order_count))
                        const intensity = max > 0 ? h.order_count / max : 0
                        // Color gradient: low orders = muted, high = gold
                        const color =
                          intensity > 0.7
                            ? D.gold
                            : intensity > 0.4
                              ? D.goldL
                              : intensity > 0
                                ? D.border
                                : D.s3
                        return <Cell key={i} fill={color} />
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Sales by waiter ──────────────────────────────── */}
          {fiscalReports && waiterSales.length > 0 && (
            <div
              style={{
                marginBottom: 24,
                background: D.s2,
                border: `1px solid ${D.border}`,
                borderRadius: 14,
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '14px 18px', borderBottom: `1px solid ${D.border}` }}>
                <div
                  style={{
                    fontFamily: 'Fraunces,serif',
                    fontSize: '0.95rem',
                    color: D.t1,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                >
                  <Icon name="users" size={16} color={D.gold} />
                  {tr.t('waiter_title')}
                </div>
                <div style={{ fontSize: '0.74rem', color: D.t2, marginTop: 2 }}>
                  {tr.t('waiter_desc')}
                </div>
              </div>
              {isMobile ? (
                <div>
                  {waiterSales.map((w, i) => (
                    <div
                      key={w.waiter_id ?? `null-${i}`}
                      style={{
                        padding: '12px 18px',
                        borderBottom:
                          i < waiterSales.length - 1 ? `1px solid ${D.border}` : 'none',
                      }}
                    >
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 7,
                          color: w.waiter_id ? D.t1 : D.t3,
                          fontWeight: 500,
                          marginBottom: 8,
                        }}
                      >
                        <Icon
                          name={w.waiter_id ? 'users' : 'box'}
                          size={14}
                          color={w.waiter_id ? D.t2 : D.t3}
                        />
                        {waiterRowLabel(w, tr)}
                      </div>
                      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                        <ReportMetric label={tr.t('col_orders')} value={String(w.order_count)} />
                        <ReportMetric
                          label={tr.t('col_revenue')}
                          accent
                          value={`${Number(w.total_revenue).toFixed(0)} lei`}
                        />
                        <ReportMetric
                          label={tr.t('col_avgTicket')}
                          value={`${Number(w.avg_ticket).toFixed(2)} lei`}
                        />
                        <ReportMetric
                          label={tr.t('col_discounts')}
                          value={
                            w.discount_total > 0
                              ? `${Number(w.discount_total).toFixed(2)} lei`
                              : '—'
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${D.border}`, color: D.t3 }}>
                      <th
                        style={{
                          textAlign: 'left',
                          padding: '10px 18px',
                          fontWeight: 500,
                          fontSize: '0.72rem',
                          textTransform: 'uppercase',
                        }}
                      >
                        {tr.t('col_waiter')}
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: '10px 12px',
                          fontWeight: 500,
                          fontSize: '0.72rem',
                          textTransform: 'uppercase',
                        }}
                      >
                        {tr.t('col_orders')}
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: '10px 12px',
                          fontWeight: 500,
                          fontSize: '0.72rem',
                          textTransform: 'uppercase',
                        }}
                      >
                        {tr.t('col_revenue')}
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: '10px 12px',
                          fontWeight: 500,
                          fontSize: '0.72rem',
                          textTransform: 'uppercase',
                        }}
                      >
                        {tr.t('col_avgTicket')}
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: '10px 18px',
                          fontWeight: 500,
                          fontSize: '0.72rem',
                          textTransform: 'uppercase',
                        }}
                      >
                        {tr.t('col_discounts')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {waiterSales.map((w, i) => (
                      <tr
                        key={w.waiter_id ?? `null-${i}`}
                        style={{
                          borderBottom:
                            i < waiterSales.length - 1 ? `1px solid ${D.border}` : 'none',
                        }}
                      >
                        <td style={{ padding: '10px 18px', color: w.waiter_id ? D.t1 : D.t3 }}>
                          <span
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
                          >
                            <Icon
                              name={w.waiter_id ? 'users' : 'box'}
                              size={14}
                              color={w.waiter_id ? D.t2 : D.t3}
                            />
                            {waiterRowLabel(w, tr)}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: '10px 12px',
                            textAlign: 'right',
                            color: D.t1,
                            fontWeight: 500,
                          }}
                        >
                          {w.order_count}
                        </td>
                        <td
                          style={{
                            padding: '10px 12px',
                            textAlign: 'right',
                            color: D.gold,
                            fontWeight: 600,
                          }}
                        >
                          {`${Number(w.total_revenue).toFixed(0)} lei`}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: D.t2 }}>
                          {`${Number(w.avg_ticket).toFixed(2)} lei`}
                        </td>
                        <td
                          style={{
                            padding: '10px 18px',
                            textAlign: 'right',
                            color: w.discount_total > 0 ? D.green : D.t3,
                          }}
                        >
                          {w.discount_total > 0
                            ? `${Number(w.discount_total).toFixed(2)} lei`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          )}

          {/* ── Sales by category ────────────────────────────── */}
          {fiscalReports && categorySales.length > 0 && (
            <div
              style={{
                marginBottom: 24,
                background: D.s2,
                border: `1px solid ${D.border}`,
                borderRadius: 14,
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '14px 18px', borderBottom: `1px solid ${D.border}` }}>
                <div
                  style={{
                    fontFamily: 'Fraunces,serif',
                    fontSize: '0.95rem',
                    color: D.t1,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                >
                  <Icon name="utensils" size={16} color={D.gold} />
                  {tr.t('cat_title')}
                </div>
                <div style={{ fontSize: '0.74rem', color: D.t2, marginTop: 2 }}>
                  {tr.t('cat_desc')}
                </div>
              </div>
              <div>
                {categorySales.map((c, i) => (
                  <div
                    key={c.category_id ?? `null-${i}`}
                    style={{
                      padding: '12px 18px',
                      borderBottom: i < categorySales.length - 1 ? `1px solid ${D.border}` : 'none',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 6,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: '0.88rem',
                          color: D.t1,
                        }}
                      >
                        <span style={{ fontSize: '1.1rem' }}>{c.category_emoji || '🍽️'}</span>
                        <span style={{ fontWeight: 500 }}>{categoryRowLabel(c, tr)}</span>
                        <span style={{ color: D.t3, fontSize: '0.78rem' }}>
                          {tr.t('cat_items', { n: c.item_count })}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: D.gold, fontWeight: 600, fontSize: '0.92rem' }}>
                          {`${Number(c.total_revenue).toFixed(0)} lei`}
                        </div>
                        <div style={{ color: D.t3, fontSize: '0.74rem' }}>
                          {Number(c.percent_total).toFixed(1)}%
                        </div>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div
                      style={{ height: 4, background: D.s3, borderRadius: 2, overflow: 'hidden' }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, Number(c.percent_total))}%`,
                          background: i === 0 ? D.gold : i === 1 ? D.goldL : D.border,
                          transition: 'width .25s',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Nota despre raportul Z doar pe planul cu bon (lotul P): pe Planul 2
              casa de marcat nu e în aplicație, deci nici comparația cu ea. */}
          {fiscalReports && (
            <div
              style={{
                fontSize: '0.7rem',
                color: D.t3,
                textAlign: 'center',
                padding: '8px 0',
                lineHeight: 1.6,
              }}
            >
              {tr.t('disclaimer')}
            </div>
          )}
        </>
      )}
    </div>
  )
}
