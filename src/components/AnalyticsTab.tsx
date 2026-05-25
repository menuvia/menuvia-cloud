import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'
import { QueryError } from './PageLoader'
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

interface Props {
  restaurantId: string
  plan: string
  onUpgrade: () => void
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

export default function AnalyticsTab({ restaurantId, plan, onUpgrade }: Props) {
  const [daily, setDaily] = useState<Record<string, unknown>[]>([])
  const [products, setProducts] = useState<Record<string, unknown>[]>([])
  const [waiters, setWaiters] = useState<Record<string, unknown>[]>([])
  const [hourly, setHourly] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const hasAccess = plan === 'pro' || plan === 'business'

  const loadData = useCallback(async () => {
    if (!restaurantId || !hasAccess) return
    setLoading(true)
    setError(null)
    try {
      const since = new Date()
      since.setDate(since.getDate() - days)
      const [d, p, w, h] = await Promise.all([
        supabase
          .from('v_daily_orders')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .gte('day', since.toISOString())
          .order('day', { ascending: true }),
        supabase
          .from('v_product_performance')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .order('revenue', { ascending: false })
          .limit(10),
        supabase
          .from('v_waiter_performance')
          .select('*,profile:profiles(full_name,email)')
          .eq('restaurant_id', restaurantId),
        supabase.from('v_hourly_distribution').select('*').eq('restaurant_id', restaurantId),
      ])
      setDaily(d.data || [])
      setProducts(p.data || [])
      setWaiters(w.data || [])
      setHourly(h.data || [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcarea statisticilor')
    }
    setLoading(false)
  }, [restaurantId, days, hasAccess])

  useEffect(() => {
    loadData()
  }, [loadData])

  if (!hasAccess)
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
          Analytics
        </h2>
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
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>📊</div>
          <div style={{ marginBottom: 16 }}>Analytics disponibil din planul Pro</div>
          <button
            onClick={onUpgrade}
            style={{
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 9,
              padding: '12px 24px',
              fontFamily: 'DM Sans,sans-serif',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Upgrade la Pro
          </button>
        </div>
      </div>
    )

  const totalOrders = daily.reduce((s, d) => s + Number(d.total_orders || 0), 0)
  const totalRevenue = daily.reduce((s, d) => s + Number(d.revenue || 0), 0)
  const avgTicket = totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : '—'
  const qrOrders = daily.reduce((s, d) => s + Number(d.qr_orders || 0), 0)
  const qrRate = totalOrders > 0 ? Math.round((qrOrders / totalOrders) * 100) : 0
  const cashRev = daily.reduce((s, d) => s + Number(d.cash_revenue || 0), 0)
  const cardRev = daily.reduce((s, d) => s + Number(d.card_revenue || 0), 0)

  const chartData = daily.map((d) => ({
    zi: new Date(d.day as string).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' }),
    comenzi: Number(d.total_orders || 0),
    revenue: Number(d.revenue || 0),
  }))
  const payPie = [
    { name: 'Cash', value: cashRev, color: D.green },
    { name: 'Card', value: cardRev, color: '#7EB8F7' },
  ].filter((x) => x.value > 0)
  const srcPie = [
    { name: 'QR', value: qrOrders, color: D.gold },
    { name: 'Ospătar', value: totalOrders - qrOrders, color: D.t2 },
  ].filter((x) => x.value > 0)

  if (loading)
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
          Analytics
        </h2>
        <div style={{ padding: '48px', textAlign: 'center', color: D.t3 }}>Se încarcă...</div>
      </div>
    )
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
          Analytics
        </h2>
        <QueryError message={error} onRetry={loadData} />
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
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.5rem',
              color: D.t1,
              letterSpacing: '-0.02em',
            }}
          >
            Analytics
          </h2>
          <p style={{ color: D.t3, fontSize: '0.78rem', marginTop: 3 }}>Ultimele {days} zile</p>
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
              {d}z
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
          gap: 10,
          marginBottom: 20,
        }}
      >
        <Stat label="Comenzi" value={totalOrders} />
        <Stat label="Revenue" value={`${totalRevenue.toFixed(0)} lei`} color={D.gold} />
        <Stat label="Ticket mediu" value={avgTicket !== '—' ? `${avgTicket} lei` : '—'} />
        <Stat label="Rata QR" value={`${qrRate}%`} />
      </div>

      {daily.length === 0 ? (
        <div
          style={{
            padding: '48px 20px',
            textAlign: 'center',
            background: D.s2,
            border: `1px solid ${D.border}`,
            borderRadius: 14,
            color: D.t3,
          }}
        >
          <div style={{ fontSize: '1.5rem', marginBottom: 10 }}>📊</div>
          <div>Nicio comandă plătită în perioada selectată.</div>
        </div>
      ) : (
        <>
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
            Revenue pe zi
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
                <CartesianGrid strokeDasharray="3 3" stroke={D.border} vertical={false} />
                <XAxis
                  dataKey="zi"
                  tick={{ fill: D.t3, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fill: D.t3, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={tt}
                  formatter={(v: unknown) => [`${Number(v ?? 0).toFixed(2)} lei`, 'Revenue']}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke={D.gold}
                  strokeWidth={2.5}
                  dot={{ fill: D.gold, r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Orders chart */}
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: D.t1, marginBottom: 10 }}>
            Comenzi pe zi
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
                <CartesianGrid strokeDasharray="3 3" stroke={D.border} vertical={false} />
                <XAxis
                  dataKey="zi"
                  tick={{ fill: D.t3, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: D.t3, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={tt}
                  formatter={(v: unknown) => [String(v ?? ''), 'Comenzi']}
                />
                <Bar dataKey="comenzi" fill={D.goldL} radius={[4, 4, 0, 0]} />
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
                    Sursă comenzi
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
                        label={({ name, percent }: { name: string; percent: number }) =>
                          `${name} ${(percent * 100).toFixed(0)}%`
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
                    Metodă plată
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
                        label={({ name, percent }: { name: string; percent: number }) =>
                          `${name} ${(percent * 100).toFixed(0)}%`
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
                Ore de vârf
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
                      ora: `${h.hour}:00`,
                      comenzi: Number(h.order_count || 0),
                    }))}
                    margin={{ left: -20, right: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={D.border} vertical={false} />
                    <XAxis
                      dataKey="ora"
                      tick={{ fill: D.t3, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: D.t3, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={tt}
                      formatter={(v: unknown) => [String(v ?? ''), 'Comenzi']}
                    />
                    <Bar dataKey="comenzi" fill={D.amber} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {/* Top products */}
          {products.length > 0 && (
            <>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: D.t1, marginBottom: 10 }}>
                Top produse
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
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 70px 70px 80px',
                    padding: '8px 16px',
                    background: D.s3,
                    borderBottom: `1px solid ${D.border}`,
                  }}
                >
                  {['Produs', 'Cant.', 'Comenzi', 'Revenue'].map((h) => (
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
                {products.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 70px 70px 80px',
                      padding: '11px 16px',
                      borderBottom: i < products.length - 1 ? `1px solid ${D.border}` : 'none',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ fontSize: '0.875rem', color: D.t1, fontWeight: 500 }}>
                      {p.product_name as string}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: D.t2 }}>
                      {p.total_quantity as number}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: D.t2 }}>
                      {p.order_appearances as number}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: D.gold, fontWeight: 600 }}>
                      {Number(p.revenue).toFixed(0)} lei
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Waiters */}
          {waiters.length > 0 && (
            <>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: D.t1, marginBottom: 10 }}>
                Performanță ospătar
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
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 70px 70px 100px',
                    padding: '8px 16px',
                    background: D.s3,
                    borderBottom: `1px solid ${D.border}`,
                  }}
                >
                  {['Ospătar', 'Introd.', 'Servite', 'Revenue'].map((h) => (
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
                {waiters.map((w, i) => {
                  const p = w.profile as { full_name: string | null; email: string } | null
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 70px 70px 100px',
                        padding: '11px 16px',
                        borderBottom: i < waiters.length - 1 ? `1px solid ${D.border}` : 'none',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ fontSize: '0.875rem', color: D.t1 }}>
                        {p?.full_name || p?.email || 'Anonim'}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: D.t2 }}>
                        {w.orders_entered as number}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: D.t2 }}>
                        {w.orders_served as number}
                      </div>
                      <div style={{ fontSize: '0.875rem', color: D.gold, fontWeight: 600 }}>
                        {Number(w.revenue_collected || 0).toFixed(0)} lei
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
