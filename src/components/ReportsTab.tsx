// ─────────────────────────────────────────────────────────────
// ReportsTab — Rapoarte periodice (zilnic / săptămânal / lunar / custom)
// Înlocuiește DailyReportTab. Queries orders + order_items direct.
// Extended (migration 033): vânzări per ospătar, oră, categorie + CSV.
// ─────────────────────────────────────────────────────────────
import { useState, useCallback, useEffect } from 'react'
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
import {
  fetchWaiterSales,
  fetchHourlySales,
  fetchCategorySales,
  toCsv,
  downloadCsv,
  type WaiterSalesRow,
  type HourlySalesRow,
  type CategorySalesRow,
} from '../lib/reports'

interface Props {
  restaurantId: string
}

type Period = 'today' | 'week' | 'month' | 'custom'

// ─── Date helpers ─────────────────────────────────────────────
function toISO(d: Date) {
  return d.toISOString().slice(0, 10)
}
function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function periodRange(
  p: Period,
  custom: { from: string; to: string },
): { from: string; to: string } {
  const today = new Date()
  if (p === 'today') return { from: toISO(today), to: toISO(today) }
  if (p === 'week') return { from: toISO(addDays(today, -6)), to: toISO(today) }
  if (p === 'month') return { from: toISO(addDays(today, -29)), to: toISO(today) }
  return custom
}

function periodLabel(p: Period, from: string, to: string) {
  if (p === 'today') return 'Azi'
  if (p === 'week') return 'Ultimele 7 zile'
  if (p === 'month') return 'Ultimele 30 zile'
  if (from === to)
    return new Date(from).toLocaleDateString('ro-RO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  return `${new Date(from).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' })} – ${new Date(to).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })}`
}

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

// ─── Main component ───────────────────────────────────────────
export default function ReportsTab({ restaurantId }: Props) {
  const [period, setPeriod] = useState<Period>('today')
  const [custom, setCustom] = useState({ from: toISO(new Date()), to: toISO(new Date()) })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // Aggregated metrics
  const [metrics, setMetrics] = useState({
    totalOrders: 0,
    revenue: 0,
    cashRev: 0,
    cardRev: 0,
    qrOrders: 0,
    waiterOrders: 0,
    avgTicket: 0,
  })
  const [chartData, setChartData] = useState<{ zi: string; comenzi: number; revenue: number }[]>([])
  const [topProducts, setTopProducts] = useState<
    { name: string; qty: number; revenue: number; emoji: string }[]
  >([])

  // Extended reports (migration 033)
  const [waiterSales, setWaiterSales] = useState<WaiterSalesRow[]>([])
  const [hourlySales, setHourlySales] = useState<HourlySalesRow[]>([])
  const [categorySales, setCategorySales] = useState<CategorySalesRow[]>([])

  const load = useCallback(async () => {
    const range = periodRange(period, custom)
    setLoading(true)
    setError(null)
    try {
      // Explicit Romania timezone boundaries — avoids UTC drift on day edges
      const startISO = range.from + 'T00:00:00+03:00'
      const endISO = range.to + 'T23:59:59.999+03:00'

      // ── Single source of truth: orders table (not v_daily_orders) ──
      // Includes ALL non-cancelled orders, not just paid ones.
      const { data: ordersRaw, error: oErr } = await supabase
        .from('orders')
        .select('id, source, status, total, paid_amount, payment_method, created_at')
        .eq('restaurant_id', restaurantId)
        .neq('status', 'cancelled')
        .gte('created_at', startISO)
        .lte('created_at', endISO)
        .order('created_at', { ascending: true })
      if (oErr) throw oErr

      const allOrders = (ordersRaw ?? []) as Record<string, unknown>[]
      const totalOrders = allOrders.length
      const revenue = allOrders.reduce((s, o) => s + Number(o.paid_amount ?? o.total ?? 0), 0)
      const cashRev = allOrders
        .filter((o) => o.payment_method === 'cash')
        .reduce((s, o) => s + Number(o.paid_amount ?? o.total ?? 0), 0)
      const cardRev = allOrders
        .filter((o) => o.payment_method === 'card_pos')
        .reduce((s, o) => s + Number(o.paid_amount ?? o.total ?? 0), 0)
      const qrOrders = allOrders.filter((o) => o.source === 'qr').length
      const waiterOrders = totalOrders - qrOrders
      const avgTicket = totalOrders > 0 ? revenue / totalOrders : 0

      setMetrics({ totalOrders, revenue, cashRev, cardRev, qrOrders, waiterOrders, avgTicket })

      // ── Build daily chart data (client-side aggregation) ──
      const dayMap = new Map<string, { comenzi: number; revenue: number }>()
      for (const o of allOrders) {
        const d = new Date(o.created_at as string)
        const key = d.toLocaleDateString('ro-RO', {
          day: '2-digit',
          month: '2-digit',
          timeZone: 'Europe/Bucharest',
        })
        const prev = dayMap.get(key) ?? { comenzi: 0, revenue: 0 }
        prev.comenzi += 1
        prev.revenue += Number(o.paid_amount ?? o.total ?? 0)
        dayMap.set(key, prev)
      }
      setChartData(Array.from(dayMap.entries()).map(([zi, v]) => ({ zi, ...v })))

      // ── Top products — same orders, consistent data ──
      const orderIds = allOrders.map((o) => o.id as string)

      if (orderIds.length > 0) {
        // Step B: get order_items for those orders
        const { data: items, error: iErr } = await supabase
          .from('order_items')
          .select('product_name_snapshot, quantity, unit_price_snapshot, product_id')
          .in('order_id', orderIds)
        if (iErr) throw iErr

        // Step C: aggregate on client
        const map = new Map<
          string,
          { name: string; qty: number; revenue: number; emoji: string; productId: string }
        >()
        for (const item of (items ?? []) as Record<string, unknown>[]) {
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

        setTopProducts(sorted.slice(0, 10))
      } else {
        setTopProducts([])
      }

      // ── Extended reports (server-side RPCs, run in parallel) ──
      const [ws, hs, cs] = await Promise.all([
        fetchWaiterSales(restaurantId, startISO, endISO).catch(() => [] as WaiterSalesRow[]),
        fetchHourlySales(restaurantId, startISO, endISO).catch(() => [] as HourlySalesRow[]),
        fetchCategorySales(restaurantId, startISO, endISO).catch(() => [] as CategorySalesRow[]),
      ])
      setWaiterSales(ws)
      setHourlySales(hs)
      setCategorySales(cs)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcarea raportului')
    }
    setLoading(false)
  }, [restaurantId, period, custom.from, custom.to]) // eslint-disable-line react-hooks/exhaustive-deps

  const range = periodRange(period, custom)

  useEffect(() => {
    void load()
  }, [load])

  // ─── Export CSV ──────────────────────────────────────────────
  function exportCsv() {
    const label = periodLabel(period, range.from, range.to)
    const safe = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    const sections: string[] = []

    sections.push(`Raport Menuvia — ${label}`)
    sections.push('')

    sections.push('# Sumar')
    sections.push(
      toCsv([
        {
          Comenzi: totalOrders,
          'Venituri (lei)': revenue.toFixed(2),
          'Bon mediu (lei)': avgTicket.toFixed(2),
          'Cash (lei)': cashRev.toFixed(2),
          'Card (lei)': cardRev.toFixed(2),
          'Comenzi QR': qrOrders,
          'Comenzi ospătar': waiterOrders,
        },
      ]),
    )
    sections.push('')

    if (topProducts.length > 0) {
      sections.push('# Top produse')
      sections.push(
        toCsv(
          topProducts.map((p, i) => ({
            '#': i + 1,
            Produs: p.name,
            Cantitate: p.qty,
            'Venituri (lei)': p.revenue.toFixed(2),
            'Preț mediu (lei)': (p.revenue / p.qty).toFixed(2),
          })),
        ),
      )
      sections.push('')
    }

    if (waiterSales.length > 0) {
      sections.push('# Vânzări pe ospătar')
      sections.push(
        toCsv(
          waiterSales.map((w) => ({
            Ospătar: w.waiter_name,
            Comenzi: w.order_count,
            'Venituri (lei)': w.total_revenue.toFixed(2),
            'Bon mediu (lei)': w.avg_ticket.toFixed(2),
            'Reduceri aplicate (lei)': w.discount_total.toFixed(2),
          })),
        ),
      )
      sections.push('')
    }

    if (categorySales.length > 0) {
      sections.push('# Vânzări pe categorie')
      sections.push(
        toCsv(
          categorySales.map((c) => ({
            Categorie: c.category_name,
            'Bucăți vândute': c.item_count,
            'Venituri (lei)': c.total_revenue.toFixed(2),
            '% din total': c.percent_total.toFixed(1) + '%',
          })),
        ),
      )
      sections.push('')
    }

    if (hourlySales.some((h) => h.order_count > 0)) {
      sections.push('# Vânzări pe oră')
      sections.push(
        toCsv(
          hourlySales.map((h) => ({
            Ora: `${String(h.hour).padStart(2, '0')}:00`,
            Comenzi: h.order_count,
            'Venituri (lei)': h.total_revenue.toFixed(2),
          })),
        ),
      )
    }

    downloadCsv(`raport-menuvia-${safe}.csv`, sections.join('\n'))
  }

  // ─── Export PDF ──────────────────────────────────────────────
  async function exportPdf() {
    setExporting(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const label = periodLabel(period, range.from, range.to)

      doc.setFontSize(18)
      doc.setFont('helvetica', 'bold')
      doc.text('Raport Menuvia', 20, 25)
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
      doc.text('Sumar', 20, y)
      y += 9
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      const m = metrics
      doc.text(`Total comenzi: ${m.totalOrders}`, 24, y)
      y += 6
      doc.text(
        `Revenue: ${m.revenue.toFixed(2)} lei  |  Bon mediu: ${m.avgTicket.toFixed(2)} lei`,
        24,
        y,
      )
      y += 6
      doc.text(`Cash: ${m.cashRev.toFixed(2)} lei  |  Card: ${m.cardRev.toFixed(2)} lei`, 24, y)
      y += 6
      doc.text(`QR: ${m.qrOrders} comenzi  |  Ospătar manual: ${m.waiterOrders} comenzi`, 24, y)
      y += 14

      if (topProducts.length > 0) {
        doc.setFontSize(12)
        doc.setFont('helvetica', 'bold')
        doc.text('Top Produse', 20, y)
        y += 9
        doc.setFontSize(10)
        doc.setFont('helvetica', 'normal')
        // Header
        doc.setFillColor(245, 240, 230)
        doc.rect(20, y - 4, 170, 8, 'F')
        doc.setFont('helvetica', 'bold')
        doc.text('#', 22, y)
        doc.text('Produs', 30, y)
        doc.text('Buc.', 130, y)
        doc.text('Revenue', 155, y)
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
      doc.text(
        'Document operațional intern. Nu înlocuiește raportul Z fiscal al casei de marcat.',
        20,
        y + 10,
      )
      doc.save(`Raport-Menuvia-${range.from}${range.from !== range.to ? '-' + range.to : ''}.pdf`)
    } catch (e) {
      console.error('PDF export failed', e)
    }
    setExporting(false)
  }

  const { totalOrders, revenue, cashRev, cardRev, qrOrders, waiterOrders, avgTicket } = metrics
  const qrPct = totalOrders > 0 ? Math.round((qrOrders / totalOrders) * 100) : 0
  const waiterPct = 100 - qrPct

  if (error)
    return (
      <div>
        <h2
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.5rem',
            color: D.t1,
            marginBottom: 20,
          }}
        >
          Rapoarte
        </h2>
        <QueryError message={error} onRetry={load} />
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
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.5rem',
              color: D.t1,
              letterSpacing: '-0.02em',
            }}
          >
            Rapoarte
          </h2>
          <p style={{ color: D.t3, fontSize: '0.78rem', marginTop: 3 }}>
            {periodLabel(period, range.from, range.to)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => exportCsv()}
            disabled={loading || totalOrders === 0}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 14px',
              height: 38,
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
            📊 Export CSV
          </button>
          <button
            onClick={() => void exportPdf()}
            disabled={exporting || loading || totalOrders === 0}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 16px',
              height: 38,
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
            {exporting ? 'Se generează...' : '📄 Export PDF'}
          </button>
        </div>
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
          <button key={p} style={btn(period === p)} onClick={() => setPeriod(p)}>
            {p === 'today' ? 'Azi' : p === 'week' ? '7 zile' : p === 'month' ? '30 zile' : 'Custom'}
          </button>
        ))}
        {period === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
            <input
              type="date"
              value={custom.from}
              max={custom.to}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              style={{
                background: D.s3,
                border: `1px solid ${D.border}`,
                borderRadius: 7,
                padding: '6px 10px',
                color: D.t1,
                fontSize: '0.8rem',
                fontFamily: 'DM Sans,sans-serif',
              }}
            />
            <span style={{ color: D.t3, fontSize: 12 }}>→</span>
            <input
              type="date"
              value={custom.to}
              min={custom.from}
              max={toISO(new Date())}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              style={{
                background: D.s3,
                border: `1px solid ${D.border}`,
                borderRadius: 7,
                padding: '6px 10px',
                color: D.t1,
                fontSize: '0.8rem',
                fontFamily: 'DM Sans,sans-serif',
              }}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: D.t3, fontSize: '0.875rem' }}>
          Se încarcă...
        </div>
      ) : totalOrders === 0 ? (
        <div
          style={{
            background: D.s2,
            border: `1px solid ${D.border}`,
            borderRadius: 14,
            padding: '60px 20px',
            textAlign: 'center',
            color: D.t3,
          }}
        >
          <div style={{ fontSize: '1.5rem', marginBottom: 10 }}>📊</div>
          <div>Nicio comandă în această perioadă.</div>
        </div>
      ) : (
        <>
          {/* Metrics grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
              gap: 10,
              marginBottom: 14,
            }}
          >
            <StatCard label="Comenzi" value={String(totalOrders)} />
            <StatCard label="Revenue" value={`${revenue.toFixed(0)} lei`} color={D.gold} />
            <StatCard label="Bon mediu" value={`${avgTicket.toFixed(2)} lei`} color={D.goldL} />
            <StatCard
              label="Cash"
              value={`${cashRev.toFixed(0)} lei`}
              color={D.green}
              sub={revenue > 0 ? `${Math.round((cashRev / revenue) * 100)}%` : undefined}
            />
            <StatCard
              label="Card"
              value={`${cardRev.toFixed(0)} lei`}
              color="#7EB8F7"
              sub={revenue > 0 ? `${Math.round((cardRev / revenue) * 100)}%` : undefined}
            />
          </div>

          {/* QR vs Waiter */}
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}
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
                }}
              >
                📱 Comenzi QR
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
                {qrPct}% din total
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
                }}
              >
                🧑‍💼 Comenzi ospătar
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
                {waiterPct}% din total
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

          {/* Chart — only when > 1 day */}
          {chartData.length > 1 && (
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
                Revenue zilnic
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={D_RAW.border} vertical={false} />
                  <XAxis
                    dataKey="zi"
                    tick={{ fill: D_RAW.t3, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tick={{ fill: D_RAW.t3, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: D.s2,
                      border: `1px solid ${D.border}`,
                      borderRadius: 8,
                      fontSize: '0.8rem',
                      color: D.t1,
                    }}
                    formatter={(v: number) => [`${v.toFixed(0)} lei`, 'Revenue']}
                  />
                  <Bar dataKey="revenue" fill={D_RAW.gold} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top products */}
          {topProducts.length > 0 && (
            <>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: D.t1, marginBottom: 10 }}>
                🏆 Top {topProducts.length} produse
                <span style={{ fontSize: '0.72rem', color: D.t3, fontWeight: 400, marginLeft: 6 }}>
                  după cantitate comandată
                </span>
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
                {/* Table header */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '28px 1fr 60px 90px 90px',
                    padding: '8px 16px',
                    background: D.s3,
                    borderBottom: `1px solid ${D.border}`,
                  }}
                >
                  {['#', 'Produs', 'Buc.', 'Revenue', 'Bon med.'].map((h) => (
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
                      gridTemplateColumns: '28px 1fr 60px 90px 90px',
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
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
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
                    <div style={{ fontSize: '0.875rem', color: D.gold, fontWeight: 600 }}>
                      {p.revenue.toFixed(0)} lei
                    </div>
                    <div style={{ fontSize: '0.8rem', color: D.t3 }}>
                      {(p.revenue / p.qty).toFixed(2)} lei
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Hourly heatmap ───────────────────────────────── */}
          {hourlySales.some((h) => h.order_count > 0) && (
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
                  }}
                >
                  🕒 Vânzări pe oră
                </div>
                <div style={{ fontSize: '0.74rem', color: D.t3, marginTop: 2 }}>
                  Când vinde localul. Identifică peak hours.
                </div>
              </div>
              <div style={{ padding: '14px 18px', height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={hourlySales.map((h) => ({
                      hour: `${String(h.hour).padStart(2, '0')}h`,
                      Comenzi: h.order_count,
                      Venituri: Number(h.total_revenue),
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
                      formatter={(v: number, n: string) => [
                        n === 'Venituri' ? `${v.toFixed(2)} lei` : v,
                        n,
                      ]}
                    />
                    <Bar dataKey="Comenzi" radius={[3, 3, 0, 0]}>
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
          {waiterSales.length > 0 && (
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
                  }}
                >
                  👥 Vânzări pe ospătar
                </div>
                <div style={{ fontSize: '0.74rem', color: D.t3, marginTop: 2 }}>
                  Atribuire prin servit → plătit → creat.
                </div>
              </div>
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
                        Ospătar
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
                        Comenzi
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
                        Venituri
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
                        Bon mediu
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
                        Reduceri
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
                          {w.waiter_id ? '👤 ' : '🔲 '}
                          {w.waiter_name}
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
                          {Number(w.total_revenue).toFixed(0)} lei
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: D.t2 }}>
                          {Number(w.avg_ticket).toFixed(2)} lei
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
            </div>
          )}

          {/* ── Sales by category ────────────────────────────── */}
          {categorySales.length > 0 && (
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
                  }}
                >
                  🍔 Vânzări pe categorie
                </div>
                <div style={{ fontSize: '0.74rem', color: D.t3, marginTop: 2 }}>
                  Ce mănâncă mai mult clienții. Reducerile NU se împart proporțional.
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
                        <span style={{ fontWeight: 500 }}>{c.category_name}</span>
                        <span style={{ color: D.t3, fontSize: '0.78rem' }}>
                          · {c.item_count} buc.
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: D.gold, fontWeight: 600, fontSize: '0.92rem' }}>
                          {Number(c.total_revenue).toFixed(0)} lei
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

          <div
            style={{
              fontSize: '0.7rem',
              color: D.t3,
              textAlign: 'center',
              padding: '8px 0',
              lineHeight: 1.6,
            }}
          >
            Document operațional intern. Nu înlocuiește raportul Z fiscal al casei de marcat.
          </div>
        </>
      )}
    </div>
  )
}
