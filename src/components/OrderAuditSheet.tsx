// =============================================================
// Menuvia — src/components/OrderAuditSheet.tsx
// Istoricul mutațiilor pe o comandă (orders + order_items).
// Vizibil pentru owner/manager (RLS audit_log restricționează waiter).
// =============================================================

import { useEffect, useState } from 'react'
import { fetchOrderAuditHistory, describeAuditEntry, type AuditEntry } from '../lib/orders'
import { D } from '../lib/constants'
import { useT } from '../i18n/useT'
import { ordersNs } from '../i18n/ns/orders'
import { commonNs } from '../i18n/ns/common'
import { describeStaffError } from '../i18n/staffErrors'

interface Props {
  orderId: string
  orderShortId: string
  onClose: () => void
}

// Ora rămâne formatată EXACT ca înainte ('ro-RO'): formatarea pe limba
// personalului e un lot separat (regula L3a).
function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ro-RO', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function OrderAuditSheet({ orderId, orderShortId, onClose }: Props) {
  const tr = useT(ordersNs)
  const { t } = tr
  const tc = useT(commonNs)
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
        // În română: exact `toUserMessage(e, 'Eroare la încărcare')` de dinainte.
        setError(describeStaffError(e, tc, { fallback: t('audit_errLoad') }))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // Traducătorii sunt memoizați pe limbă: stabili cât limba nu se schimbă.
  }, [orderId, t, tc])

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
              {t('audit_title')}
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
            <div style={{ color: D.t3, textAlign: 'center', padding: 32 }}>{tc.t('loading')}</div>
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
              {t('audit_empty')}
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
                      {describeAuditEntry(e, tr)}
                    </span>
                    <span style={{ fontSize: 10, color: D.t3, whiteSpace: 'nowrap' }}>
                      {formatTime(e.created_at)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: D.t2, marginTop: 3 }}>
                    {e.actor_name ?? (e.actor_id ? e.actor_id.slice(0, 8) : t('audit_system'))}
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
