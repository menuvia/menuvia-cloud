// FounderActivationCard — funelul de activare (capitolul „retenție/activare"
// din auditul aug 2026: nimeni nu măsura semnup → meniu publicat → prima
// comandă; PLAN_1M.md are gate „activare peste 50%" fără nicio măsurătoare).
//
// FĂRĂ migrație: fondatorul vede toate rândurile prin escape-ul
// is_platform_admin din funelul RLS (mig 186), deci calculul se face
// client-side din 3 SELECT-uri simple. La scară (>~100 restaurante /
// >~5000 comenzi) se mută într-un RPC agregat — plafonul e notat pe query-uri.
import { useCallback, useEffect, useState } from 'react'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'

interface RestaurantRow {
  id: string
  name: string
  created_at: string
}

interface ActivationRow {
  id: string
  name: string
  created_at: string
  hasMenu: boolean
  firstOrderAt: string | null
}

interface ActivationData {
  rows: ActivationRow[]
  totals: { restaurants: number; withMenu: number; withOrder: number }
}

const card: React.CSSProperties = {
  background: D.s2,
  border: `1px solid ${D.border}`,
  borderRadius: 14,
  padding: '16px 18px',
  marginTop: 12,
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86400000))
}

export default function FounderActivationCard() {
  const [data, setData] = useState<ActivationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: restaurants, error: rErr } = await supabase
        .from('restaurants')
        .select('id, name, created_at')
        .order('created_at', { ascending: false })
        .limit(100)
      if (rErr) throw new Error(rErr.message)

      const { data: prods, error: pErr } = await supabase
        .from('products')
        .select('restaurant_id')
        .limit(10000)
      if (pErr) throw new Error(pErr.message)
      const withMenu = new Set((prods ?? []).map((p) => p.restaurant_id as string))

      // Prima comandă per restaurant: comenzile vin cronologic, prima apariție
      // a fiecărui restaurant e prima lui comandă.
      const { data: orders, error: oErr } = await supabase
        .from('orders')
        .select('restaurant_id, created_at')
        .order('created_at', { ascending: true })
        .limit(5000)
      if (oErr) throw new Error(oErr.message)
      const firstOrder = new Map<string, string>()
      for (const o of orders ?? []) {
        const rid = o.restaurant_id as string
        if (!firstOrder.has(rid)) firstOrder.set(rid, o.created_at as string)
      }

      const rows: ActivationRow[] = ((restaurants ?? []) as RestaurantRow[]).map((r) => ({
        id: r.id,
        name: r.name,
        created_at: r.created_at,
        hasMenu: withMenu.has(r.id),
        firstOrderAt: firstOrder.get(r.id) ?? null,
      }))
      setData({
        rows,
        totals: {
          restaurants: rows.length,
          withMenu: rows.filter((r) => r.hasMenu).length,
          withOrder: rows.filter((r) => r.firstOrderAt != null).length,
        },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcare')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0)

  return (
    <div style={card}>
      <div
        style={{
          fontSize: '0.72rem',
          color: D.t3,
          marginBottom: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 700,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>Activare — semnup → meniu → prima comandă</span>
        {error && (
          <button
            onClick={() => void load()}
            style={{
              background: 'none',
              border: `1px solid ${D.border}`,
              borderRadius: 8,
              color: D.t2,
              padding: '4px 10px',
              fontSize: '0.72rem',
              cursor: 'pointer',
            }}
          >
            Reîncearcă
          </button>
        )}
      </div>

      {loading && <div style={{ color: D.t2, fontSize: '0.85rem' }}>Se calculează…</div>}
      {!loading && error && <div style={{ color: D.red, fontSize: '0.85rem' }}>{error}</div>}

      {!loading && !error && data && (
        <>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14 }}>
            {[
              { label: 'Cu meniu publicat', n: data.totals.withMenu },
              { label: 'Cu ≥1 comandă', n: data.totals.withOrder },
            ].map((s) => (
              <div key={s.label}>
                <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: '1.4rem', color: D.t1 }}>
                  {s.n}/{data.totals.restaurants}
                  <span style={{ fontSize: '0.85rem', color: D.gold, marginLeft: 6 }}>
                    {pct(s.n, data.totals.restaurants)}%
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: D.t2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.rows.slice(0, 10).map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: '0.8rem',
                  color: D.t2,
                }}
              >
                <span style={{ color: D.t1, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name}
                </span>
                <span style={{ color: r.hasMenu ? D.green : D.t3 }}>
                  {r.hasMenu ? '✓ meniu' : '— meniu'}
                </span>
                <span style={{ color: r.firstOrderAt ? D.green : D.t3, minWidth: 110, textAlign: 'right' }}>
                  {r.firstOrderAt
                    ? `✓ comandă în ${daysBetween(r.created_at, r.firstOrderAt)}z`
                    : '— comandă'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
