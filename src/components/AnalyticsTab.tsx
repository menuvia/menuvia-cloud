import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { D, D_RAW } from '../lib/constants'
import { QueryError } from './PageLoader'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'
import { useIsMobile } from '../hooks/useIsMobile'
import { analyticsAccess } from '../lib/features'
import { formatYmd, lastDaysStartYmd, toRomaniaYMD } from '../lib/dates'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { useT } from '../i18n/useT'
import { useUiLang } from '../i18n/UiLangContext'
import { staffLocale } from '../i18n/format'
import { describeStaffError } from '../i18n/staffErrors'
import { analyticsNs } from '../i18n/ns/analytics'
import { commonNs } from '../i18n/ns/common'

interface Props {
  restaurantId: string
  plan: string
  // `fiscal_receipt.enabled` din features: false CUNOSCUT = restaurant din
  // afara RO (mig 296) — toate view-urile tab-ului au gate fiscal în date.
  // Absent/null = necunoscut → comportamentul de dinainte.
  fiscalEnabled?: boolean | null
}

const tt = {
  background: D.s2,
  border: `1px solid ${D.border}`,
  borderRadius: 8,
  fontSize: '0.8rem',
  color: D.t1,
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
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
          fontSize: '0.72rem',
          color: D.t3,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
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
        }}
      >
        {value ?? '—'}
      </div>
    </div>
  )
}

// Tabel de metrici cu colaps la carduri pe mobil. Pe desktop: antet + grid cu
// coloane fixe (ca înainte). Pe mobil: fiecare rând devine un card cu numele sus
// și metricile ca perechi etichetă/valoare — se citește fără scroll orizontal.
interface MetricCell {
  text: string
  accent?: boolean
}
function DataTable({
  headers,
  gridCols,
  rows,
  isMobile,
}: {
  headers: string[]
  gridCols: string
  rows: { name: string; cells: MetricCell[] }[]
  isMobile: boolean
}) {
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              padding: '12px 16px',
              borderBottom: i < rows.length - 1 ? `1px solid ${D.border}` : 'none',
            }}
          >
            <div style={{ fontSize: '0.875rem', color: D.t1, fontWeight: 600, marginBottom: 8 }}>
              {r.name}
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              {r.cells.map((c, j) => (
                <div key={j}>
                  <div
                    style={{
                      fontSize: '0.62rem',
                      color: D.t3,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: 2,
                    }}
                  >
                    {headers[j + 1]}
                  </div>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      color: c.accent ? D.gold : D.t2,
                      fontWeight: c.accent ? 600 : 500,
                    }}
                  >
                    {c.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: gridCols,
          padding: '8px 16px',
          background: D.s3,
          borderBottom: `1px solid ${D.border}`,
        }}
      >
        {headers.map((h) => (
          <div
            key={h}
            style={{
              fontSize: '0.7rem',
              color: D.t3,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {h}
          </div>
        ))}
      </div>
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: gridCols,
            padding: '11px 16px',
            borderBottom: i < rows.length - 1 ? `1px solid ${D.border}` : 'none',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: '0.875rem', color: D.t1, fontWeight: 500 }}>{r.name}</div>
          {r.cells.map((c, j) => (
            <div
              key={j}
              style={{
                fontSize: c.accent ? '0.875rem' : '0.8rem',
                color: c.accent ? D.gold : D.t2,
                fontWeight: c.accent ? 600 : 400,
              }}
            >
              {c.text}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

// Cache de sesiune (nivel de modul): tab-urile mari sunt lazy + se demontează
// la schimbare, deci re-vizitarea reface toate cele 5 query-uri. Analytics-ul pe
// 30 de zile nu se schimbă de la secundă la secundă → în fereastra TTL servim
// din cache și SĂRIM rețeaua. Cheia include `days` (alt filtru = alt fetch), iar
// erorile NU se cache-uiesc (retry-ul reîncarcă). Persistă cât ține sesiunea de
// browser; la altă restaurantId cheia diferă, deci fără scurgeri cross-tenant.
type AnalyticsSnapshot = {
  daily: Record<string, unknown>[]
  products: Record<string, unknown>[]
  waiters: Record<string, unknown>[]
  hourly: Record<string, unknown>[]
  staffNames: Record<string, { full_name: string | null; email: string }>
}
const ANALYTICS_TTL_MS = 60_000
const analyticsCache = new Map<string, { ts: number; data: AnalyticsSnapshot }>()

export default function AnalyticsTab({ restaurantId, plan, fiscalEnabled = null }: Props) {
  // Limba personalului (lotul L7): `analytics` + `common`, cerute SUS și
  // necondiționat — o singură suspendare la prima randare într-o limbă nouă.
  const ta = useT(analyticsNs)
  const tc = useT(commonNs)
  // Formatele urmează limba UTILIZATORULUI, nu `ta.lang` (clichetul LF din L6b).
  const { lang: uiLang } = useUiLang()
  const isMobile = useIsMobile()
  const [daily, setDaily] = useState<Record<string, unknown>[]>([])
  const [products, setProducts] = useState<Record<string, unknown>[]>([])
  const [waiters, setWaiters] = useState<Record<string, unknown>[]>([])
  // Nume ospătari pe user_id — embed-ul profiles din view-ul agregat nu rezolvă
  // FK-ul, deci numele veneau „Anonim". Mapăm separat din restaurant_memberships
  // (același embed care funcționează în TeamManager), fără migrație/RLS nou.
  const [staffNames, setStaffNames] = useState<
    Record<string, { full_name: string | null; email: string }>
  >({})
  const [hourly, setHourly] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  // Eroarea de încărcare ținută ca DATĂ (cauza), tradusă la randare: o
  // schimbare de limbă cu eroarea pe ecran o retraduce.
  const [error, setError] = useState<{ cause: unknown } | null>(null)
  const [days, setDays] = useState(30)
  // 'business' a fost eliminat din taxonomie (mig 062 → free/starter/growth/pro/enterprise).
  // Enterprise include tot Pro, deci ambele au acces.
  // analyticsAccess (lib/features.ts): pe RO identic cu `plan === 'pro' ||
  // plan === 'enterprise'`; în afara RO panourile (toate de încasări, cu gate
  // fiscal în view) nu se încarcă — altfel „Nicio comandă" ar minți.
  const access = analyticsAccess(plan, fiscalEnabled)
  const hasAccess = access === 'full'

  const loadData = useCallback(async () => {
    if (!restaurantId || !hasAccess) return
    // Servire din cache-ul de sesiune dacă e proaspăt (fără spinner, fără rețea).
    const cacheKey = `${restaurantId}:${days}`
    const cached = analyticsCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < ANALYTICS_TTL_MS) {
      setDaily(cached.data.daily)
      setProducts(cached.data.products)
      setWaiters(cached.data.waiters)
      setHourly(cached.data.hourly)
      setStaffNames(cached.data.staffNames)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      // Fereastra pe ziua ROMÂNEASCĂ (`day` din v_daily_orders e ziua românească
      // a comenzii, mig 267), ca șir YYYY-MM-DD comparat cu o coloană `date` —
      // înainte era ziua UTC a unui instant al browserului, deci între 00:00 și
      // 02:00/03:00 ora României fereastra pornea cu o zi mai devreme.
      // „Ultimele N zile” = N date, inclusiv azi (`gte` e inclusiv).
      const since = lastDaysStartYmd(toRomaniaYMD(new Date()), days)
      const [d, p, w, h, m] = await Promise.all([
        supabase
          .from('v_daily_orders')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .gte('day', since)
          .order('day', { ascending: true }),
        supabase
          .from('v_product_performance')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .order('revenue', { ascending: false })
          .limit(10),
        supabase.from('v_waiter_performance').select('*').eq('restaurant_id', restaurantId),
        supabase.from('v_hourly_distribution').select('*').eq('restaurant_id', restaurantId),
        supabase
          .from('restaurant_memberships')
          .select('user_id, user:profiles(full_name,email)')
          .eq('restaurant_id', restaurantId),
      ])
      // supabase-js NU aruncă pe eroare — fără verificare explicită, un blip
      // RLS/rețea colapsează tăcut totul la [] și pagina minte cu „Nicio comandă".
      // Aruncăm prima eroare găsită ca să activeze QueryError + Reîncearcă.
      for (const r of [d, p, w, h, m]) {
        if (r.error) throw r.error
      }
      setDaily(d.data || [])
      setProducts(p.data || [])
      setWaiters(w.data || [])
      setHourly(h.data || [])
      // Map user_id → nume (pentru tabelul „Performanță ospătar").
      const names: Record<string, { full_name: string | null; email: string }> = {}
      // supabase-js tipează embed-ul ca array, dar la runtime FK-ul to-one întoarce
      // un obiect (ca în TeamManager) — cast prin unknown + normalizare defensivă.
      for (const row of (m.data || []) as unknown as Array<{
        user_id: string
        user:
          | { full_name: string | null; email: string }
          | { full_name: string | null; email: string }[]
          | null
      }>) {
        const u = Array.isArray(row.user) ? row.user[0] : row.user
        if (u) names[row.user_id] = u
      }
      setStaffNames(names)
      // Populăm cache-ul de sesiune DOAR pe succes (erorile nu se cache-uiesc).
      analyticsCache.set(cacheKey, {
        ts: Date.now(),
        data: {
          daily: d.data || [],
          products: p.data || [],
          waiters: w.data || [],
          hourly: h.data || [],
          staffNames: names,
        },
      })
    } catch (e: unknown) {
      setError({ cause: e })
    }
    setLoading(false)
  }, [restaurantId, days, hasAccess])

  useEffect(() => {
    loadData()
  }, [loadData])

  if (access === 'country_unavailable')
    return (
      <div>
        <div
          style={{
            background: D.s2,
            border: `1px solid ${D.border}`,
            borderRadius: 14,
            padding: '60px 20px',
            textAlign: 'center',
            color: D.t2,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: D.gold }}>
            <Icon name="chart" size={32} />
          </div>
          <div>{ta.t('country_unavailable')}</div>
        </div>
      </div>
    )

  // Sub Fiscalizare fila nu există (NAV_GROUPS minTier 3), iar upsell-ul e unul
  // singur, pe Acasă (lotul P) — fără prompt de upgrade aici.
  if (!hasAccess) return null

  const totalOrders = daily.reduce((s, d) => s + Number(d.total_orders || 0), 0)
  const totalRevenue = daily.reduce((s, d) => s + Number(d.revenue || 0), 0)
  const avgTicket = totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : '—'
  const qrOrders = daily.reduce((s, d) => s + Number(d.qr_orders || 0), 0)
  const qrRate = totalOrders > 0 ? Math.round((qrOrders / totalOrders) * 100) : 0
  const cashRev = daily.reduce((s, d) => s + Number(d.cash_revenue || 0), 0)
  const cardRev = daily.reduce((s, d) => s + Number(d.card_revenue || 0), 0)
  // voucher_revenue apare abia în mig 232 — tolerant la coloana absentă
  // (frontend înaintea migrației): lipsă → 0 → felia nu se randează.
  const voucherRev = daily.reduce((s, d) => s + Number(d.voucher_revenue || 0), 0)
  // online_revenue apare în mig 263 (plăți online la masă) — la fel de tolerant.
  const onlineRev = daily.reduce((s, d) => s + Number(d.online_revenue || 0), 0)
  // other_revenue (mig 263): split cu metode MIXTE (comanda primește 'other')
  // + comenzi vechi fără metodă. Fără felia asta, suma feliilor era mai mică
  // decât venitul total și operatorul vedea bani „dispăruți".
  const otherRev = daily.reduce((s, d) => s + Number(d.other_revenue || 0), 0)

  // Ziua de pe axă în limba personalului (`staffLocale`: în română EXACT
  // „ro-RO”, ca înainte). `day` e o DATĂ fără oră (ziua românească, mig 267),
  // deci se formatează ca dată (`formatYmd`), nu ca instant pe fusul
  // browserului — acolo, la vest de UTC, ieșea ziua de DINAINTE (lotul G2b).
  // Cheile seriilor (`day`/`orders`) sunt interne recharts, nu text.
  const dayLocale = staffLocale(uiLang)
  const chartData = daily.map((d) => ({
    day: formatYmd(String(d.day), dayLocale, { day: '2-digit', month: '2-digit' }),
    orders: Number(d.total_orders || 0),
    revenue: Number(d.revenue || 0),
  }))
  const payPie = [
    { name: ta.t('method_cash'), value: cashRev, color: D.green },
    { name: ta.t('method_card'), value: cardRev, color: '#7EB8F7' },
    { name: ta.t('method_voucher'), value: voucherRev, color: D.goldL },
    { name: ta.t('method_online'), value: onlineRev, color: '#B08CF2' },
    { name: ta.t('method_other'), value: otherRev, color: D.t2 },
  ].filter((x) => x.value > 0)
  const srcPie = [
    { name: ta.t('src_qr'), value: qrOrders, color: D.gold },
    { name: ta.t('src_waiter'), value: totalOrders - qrOrders, color: D.t2 },
  ].filter((x) => x.value > 0)

  if (loading)
    return (
      <div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
            gap: 10,
            marginBottom: 20,
          }}
        >
          <Skeleton variant="card" count={4} />
        </div>
        <Skeleton variant="card" />
      </div>
    )
  if (error)
    return (
      <div>
        <QueryError
          message={describeStaffError(error.cause, tc, { fallback: ta.t('err_load') })}
          onRetry={loadData}
          retryLabel={tc.t('retry')}
        />
      </div>
    )

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <p style={{ color: D.t2, fontSize: '0.78rem', marginTop: 3 }}>{ta.tp('period_last', days)}</p>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
                fontSize: '0.82rem',
                background: days === d ? D.goldA : D.s2,
                color: days === d ? D.goldL : D.t2,
              }}
            >
              {ta.tp('range_days', d)}
            </button>
          ))}
        </div>
      </div>

      {daily.length === 0 ? (
        <EmptyState
          icon="chart"
          title={ta.t('empty_title')}
          description={ta.t('empty_desc')}
        />
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
              gap: 10,
              marginBottom: 20,
            }}
          >
            <Stat label={ta.t('stat_orders')} value={totalOrders} />
            <Stat label={ta.t('stat_revenue')} value={`${totalRevenue.toFixed(0)} lei`} color={D.gold} />
            <Stat label={ta.t('stat_avgTicket')} value={avgTicket !== '—' ? `${avgTicket} lei` : '—'} />
            <Stat label={ta.t('stat_qrRate')} value={`${qrRate}%`} />
          </div>

          {/* Revenue chart */}
          <div
            style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              color: D.t1,
              marginBottom: 10,
              marginTop: 4,
            }}
          >
            {ta.t('chart_revenue')}
          </div>
          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: '20px 20px 12px',
              marginBottom: 16,
            }}
          >
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={D_RAW.border} vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fill: D_RAW.t3, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fill: D_RAW.t3, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={tt}
                  formatter={(v: unknown) => [`${Number(v ?? 0).toFixed(2)} lei`, ta.t('series_revenue')]}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke={D_RAW.gold}
                  strokeWidth={2.5}
                  dot={{ fill: D_RAW.gold, r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Orders chart */}
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: D.t1, marginBottom: 10 }}>
            {ta.t('chart_orders')}
          </div>
          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: '20px 20px 12px',
              marginBottom: 16,
            }}
          >
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={D_RAW.border} vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fill: D_RAW.t3, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: D_RAW.t3, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={tt}
                  formatter={(v: unknown) => [String(v ?? ''), ta.t('series_orders')]}
                />
                <Bar dataKey="orders" fill={D_RAW.goldL} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Pie charts */}
          {(srcPie.length > 0 || payPie.length > 0) && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
                gap: 12,
                marginBottom: 16,
              }}
            >
              {srcPie.length > 0 && (
                <div
                  style={{
                    background: D.s2,
                    border: `1px solid ${D.border}`,
                    borderRadius: 14,
                    padding: '16px 20px',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', color: D.t2, marginBottom: 8 }}>
                    {ta.t('pie_source')}
                  </div>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie
                        data={srcPie}
                        cx="50%"
                        cy="50%"
                        outerRadius={55}
                        dataKey="value"
                        nameKey="name"
                        label={({ name, percent }: { name?: string; percent?: number }) =>
                          `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
                        }
                        labelLine={false}
                        fontSize={10}
                      >
                        {srcPie.map((e, i) => (
                          <Cell key={i} fill={e.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tt} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              {payPie.length > 0 && (
                <div
                  style={{
                    background: D.s2,
                    border: `1px solid ${D.border}`,
                    borderRadius: 14,
                    padding: '16px 20px',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', color: D.t2, marginBottom: 8 }}>
                    {ta.t('pie_method')}
                  </div>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie
                        data={payPie}
                        cx="50%"
                        cy="50%"
                        outerRadius={55}
                        dataKey="value"
                        nameKey="name"
                        label={({ name, percent }: { name?: string; percent?: number }) =>
                          `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
                        }
                        labelLine={false}
                        fontSize={10}
                      >
                        {payPie.map((e, i) => (
                          <Cell key={i} fill={e.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={tt}
                        formatter={(v: unknown) => [`${Number(v ?? 0).toFixed(0)} lei`]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Hourly */}
          {hourly.length > 0 && (
            <>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: D.t1, marginBottom: 10 }}>
                {ta.t('hourly_title')}{' '}
                <span style={{ fontWeight: 400, color: D.t3 }}>{ta.t('hourly_sub')}</span>
              </div>
              <div
                style={{
                  background: D.s2,
                  border: `1px solid ${D.border}`,
                  borderRadius: 14,
                  padding: '20px 20px 12px',
                  marginBottom: 16,
                }}
              >
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart
                    data={hourly.map((h) => ({
                      hour: `${h.hour}:00`,
                      orders: Number(h.order_count || 0),
                    }))}
                    margin={{ left: -20, right: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={D_RAW.border} vertical={false} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fill: D_RAW.t3, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: D_RAW.t3, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={tt}
                      formatter={(v: unknown) => [String(v ?? ''), ta.t('series_orders')]}
                    />
                    <Bar dataKey="orders" fill={D_RAW.amber} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {/* Top products */}
          {products.length > 0 && (
            <>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: D.t1, marginBottom: 10 }}>
                {ta.t('top_title')} <span style={{ fontWeight: 400, color: D.t3 }}>{ta.t('sub_allTime')}</span>
              </div>
              <div
                style={{
                  background: D.s2,
                  border: `1px solid ${D.border}`,
                  borderRadius: 14,
                  overflow: 'hidden',
                  marginBottom: 16,
                }}
              >
                <DataTable
                  isMobile={isMobile}
                  gridCols="1fr 70px 70px 80px"
                  headers={[ta.t('col_product'), ta.t('col_qty'), ta.t('col_orders'), ta.t('col_revenue')]}
                  rows={products.map((p) => ({
                    name: p.product_name as string,
                    cells: [
                      { text: String(p.total_quantity as number) },
                      { text: String(p.order_appearances as number) },
                      { text: `${Number(p.revenue).toFixed(0)} lei`, accent: true },
                    ],
                  }))}
                />
              </div>
            </>
          )}

          {/* Waiters */}
          {waiters.length > 0 && (
            <>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: D.t1, marginBottom: 10 }}>
                {ta.t('waiters_title')}{' '}
                <span style={{ fontWeight: 400, color: D.t3 }}>{ta.t('sub_allTime')}</span>
              </div>
              <div
                style={{
                  background: D.s2,
                  border: `1px solid ${D.border}`,
                  borderRadius: 14,
                  overflow: 'hidden',
                  marginBottom: 24,
                }}
              >
                <DataTable
                  isMobile={isMobile}
                  gridCols="1fr 80px 70px 100px"
                  headers={[ta.t('col_waiter'), ta.t('col_entered'), ta.t('col_served'), ta.t('col_revenue')]}
                  rows={waiters.map((w) => {
                    const p = staffNames[w.user_id as string] ?? null
                    return {
                      name: p?.full_name || p?.email || ta.t('anonymous'),
                      cells: [
                        { text: String(w.orders_entered as number) },
                        { text: String(w.orders_served as number) },
                        { text: `${Number(w.revenue_collected || 0).toFixed(0)} lei`, accent: true },
                      ],
                    }
                  })}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
