// =============================================================
// Menuvia — src/components/OrderAuditSheet.tsx
// Istoricul mutațiilor pe o comandă (orders + order_items).
// Vizibil pentru owner/manager (RLS audit_log restricționează waiter).
// =============================================================

import { useEffect, useState } from 'react'
import { fetchOrderAuditHistory, type AuditEntry } from '../lib/orders'
import { D } from '../lib/constants'

interface Props {
  orderId: string
  orderShortId: string
  onClose: () => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ro-RO', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function describeEntry(e: AuditEntry): string {
  if (e.table_name === 'orders') {
    if (e.operation === 'INSERT') return 'A creat comanda'
    if (e.operation === 'DELETE') return 'A șters comanda'
    if (e.changed_keys?.includes('status')) {
      const diff = e.diff_short as Record<string, { from?: string; to?: string }> | null
      const to = diff?.status?.to
      if (to === 'confirmed') return 'A confirmat comanda'
      if (to === 'preparing') return 'A trimis la pregătire'
      if (to === 'ready') return 'A marcat ca gata'
      if (to === 'served') return 'A marcat ca servit'
      if (to === 'paid') return 'A încasat plata'
      if (to === 'cancelled') return 'A anulat comanda'
      return `Status → ${to}`
    }
    if (e.changed_keys?.some((k) => k.startsWith('discount'))) {
      return 'A modificat reducerea'
    }
    if (e.changed_keys?.includes('total')) return 'A recalculat totalul'
    return 'A modificat comanda'
  }
  if (e.table_name === 'order_items') {
    // Audit-summary de la update_order_items: diff_short = {items:{from,to}, total:{from,to}}
    const diff = e.diff_short as
      | { items?: { from?: unknown[]; to?: unknown[] }; total?: { from?: number; to?: number } }
      | null
    if (e.operation === 'UPDATE' && (diff?.items || diff?.total)) {
      const fromCount = Array.isArray(diff?.items?.from) ? diff.items.from.length : null
      const toCount = Array.isArray(diff?.items?.to) ? diff.items.to.length : null
      const toTotal = diff?.total?.to
      const countPart =
        fromCount != null && toCount != null ? `${fromCount} → ${toCount} produse` : 'produse'
      const totalPart = typeof toTotal === 'number' ? ` · total ${toTotal.toFixed(2)} lei` : ''
      return `A modificat comanda (${countPart}${totalPart})`
    }
    if (e.operation === 'INSERT') {
      const item = e.diff_short as { product_name_snapshot?: string; quantity?: number } | null
      return `A adăugat ${item?.product_name_snapshot ?? 'produs'} × ${item?.quantity ?? 1}`
    }
    if (e.operation === 'DELETE') {
      const item = e.diff_short as { product_name_snapshot?: string; quantity?: number } | null
      return `A șters ${item?.product_name_snapshot ?? 'produs'} × ${item?.quantity ?? 1}`
    }
    return 'A modificat un produs'
  }
  return `${e.table_name} · ${e.operation}`
}

export default function OrderAuditSheet({ orderId, orderShortId, onClose }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchOrderAuditHistory(orderId)
      .then((data) => {
        if (cancelled) return
        setEntries(data)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Eroare la încărcare')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orderId])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 250,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: D.bg,
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 560,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '16px 20px 12px',
            borderBottom: `1px solid ${D.s3}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 18,
                fontWeight: 700,
                color: D.t1,
              }}
            >
              Istoric comandă
            </div>
            <div style={{ fontSize: 12, color: D.t3, marginTop: 2 }}>#{orderShortId}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: D.t2,
              cursor: 'pointer',
              fontSize: 20,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {loading && (
            <div style={{ color: D.t3, textAlign: 'center', padding: 32 }}>Se încarcă…</div>
          )}
          {error && (
            <div
              style={{
                color: D.red,
                background: `${D.red}11`,
                padding: 12,
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}
          {!loading && !error && entries.length === 0 && (
            <div style={{ color: D.t3, textAlign: 'center', padding: 32, fontSize: 13 }}>
              Niciun eveniment înregistrat încă pentru această comandă.
            </div>
          )}
          {!loading && entries.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entries.map((e) => (
                <div
                  key={e.id}
                  style={{
                    background: D.s2,
                    border: `1px solid ${D.s3}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 13, color: D.t1, fontWeight: 600 }}>
                      {describeEntry(e)}
                    </span>
                    <span style={{ fontSize: 10, color: D.t3, whiteSpace: 'nowrap' }}>
                      {formatTime(e.created_at)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: D.t2, marginTop: 3 }}>
                    {e.actor_name ?? (e.actor_id ? e.actor_id.slice(0, 8) : 'sistem')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
