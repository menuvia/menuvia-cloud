// =============================================================
// Menuvia — src/components/CancelOrderDialog.tsx
// Mic modal de confirmare anulare cu textarea pentru motiv.
// Înlocuiește window.prompt (blocat în iOS PWA standalone + UX urât).
// =============================================================

import { useState } from 'react'
import type { Order } from '../lib/orders'
import { D } from '../lib/constants'

interface Props {
  order: Order
  // Întoarce true dacă anularea a reușit. La false, dialogul rămâne deschis
  // (RPC respins — ex. rol insuficient / motiv obligatoriu) în loc să se închidă optimist.
  onConfirm: (reason: string | undefined) => Promise<boolean>
  onClose: () => void
}

export default function CancelOrderDialog({ order, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Eroarea de refuz trebuie afișată AICI, nu doar prin banner-ul din pagina
  // părinte — banner-ul e acoperit de overlay-ul acestui modal (zIndex mai
  // mic) cât timp dialogul e deschis, deci userul nu-l vede niciodată.
  const [error, setError] = useState<string | null>(null)

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 260,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: D.s2,
          border: `1px solid ${D.s3}`,
          borderRadius: 14,
          padding: 24,
          width: '100%',
          maxWidth: 380,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
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
            Anulează comanda
          </div>
          <div style={{ fontSize: 12, color: D.t3, marginTop: 4 }}>
            #{order.id.slice(-6).toUpperCase()}
            {order.table?.name ? ` · Masa ${order.table.name}` : ''}
            {' · '}
            {order.total.toFixed(2)} lei
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, color: D.t2, display: 'block', marginBottom: 6 }}>
            Motiv (opțional)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex: clientul a anulat, produs nedisponibil…"
            autoFocus
            rows={3}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: D.s3,
              border: `1px solid ${D.s3}`,
              borderRadius: 8,
              color: D.t1,
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              padding: '10px 12px',
              resize: 'none',
            }}
          />
        </div>

        {error != null && (
          <div
            style={{
              fontSize: 12,
              color: D.red,
              background: `${D.red}11`,
              padding: '8px 10px',
              borderRadius: 6,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              flex: 1,
              background: 'transparent',
              border: `1px solid ${D.s3}`,
              borderRadius: 8,
              color: D.t2,
              padding: '11px 0',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              fontWeight: 600,
              cursor: submitting ? 'wait' : 'pointer',
            }}
          >
            Renunță
          </button>
          <button
            onClick={() => {
              setSubmitting(true)
              setError(null)
              void onConfirm(reason.trim() ? reason.trim() : undefined).then((ok) => {
                // La eșec deblocăm butonul ca utilizatorul să poată reîncerca
                // ȘI afișăm eroarea DIRECT în dialog (banner-ul din pagina
                // părinte e acoperit de overlay-ul modalului, deci invizibil
                // cât timp dialogul e deschis); la succes părintele demontează
                // dialogul.
                if (!ok) {
                  setSubmitting(false)
                  setError(
                    'Anularea a fost respinsă. Verifică rolul tău sau motivul comenzii și încearcă din nou.',
                  )
                }
              })
            }}
            disabled={submitting}
            style={{
              flex: 1,
              background: D.red,
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              padding: '11px 0',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              fontWeight: 700,
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Se anulează…' : 'Anulează comanda'}
          </button>
        </div>
      </div>
    </div>
  )
}
