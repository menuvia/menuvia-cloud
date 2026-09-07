// =============================================================
// Menuvia — src/components/CancelOrderDialog.tsx
// Mic modal de confirmare anulare cu textarea pentru motiv.
// Înlocuiește window.prompt (blocat în iOS PWA standalone + UX urât).
//
// Audit v3 RES-25 (mig 270): o comandă cu bani deja încasați (parțiale cash,
// split online) NU se poate anula — serverul refuză cu `cancel_over_payments`
// (trigger în DATE). Dialogul arată suma încasată și dezactivează butonul
// când o CUNOAȘTE; când suma e necunoscută (RPC picat) butonul rămâne activ
// și serverul rămâne gate-ul (tristate, ca BridgeOfflineBanner). Mesajul de
// refuz vine de la server, nu dintr-un text generic.
// =============================================================

import { useState } from 'react'
import type { Order } from '../lib/orders'
import { D } from '../lib/constants'

export interface CancelResult {
  ok: boolean
  /** Mesajul de refuz al serverului (deja tradus), afișat în dialog. */
  message?: string
}

interface Props {
  order: Order
  // Cât s-a încasat deja pe comandă (order_payments): >0 = anularea e
  // imposibilă; 0 = liberă; null = NECUNOSCUT (nu blocăm — serverul decide).
  paidSoFar: number | null
  // Întoarce {ok:true} dacă anularea a reușit. La ok:false dialogul rămâne
  // deschis și afișează `message` (sau un text generic).
  onConfirm: (reason: string | undefined) => Promise<CancelResult>
  onClose: () => void
}

const GENERIC_ERROR =
  'Anularea a fost respinsă. Verifică rolul tău sau motivul comenzii și încearcă din nou.'

export default function CancelOrderDialog({ order, paidSoFar, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Eroarea de refuz trebuie afișată AICI, nu doar prin banner-ul din pagina
  // părinte — banner-ul e acoperit de overlay-ul acestui modal (zIndex mai
  // mic) cât timp dialogul e deschis, deci userul nu-l vede niciodată.
  const [error, setError] = useState<string | null>(null)
  const blockedByPayments = paidSoFar != null && paidSoFar > 0
  // mig 118: motivul e OBLIGATORIU la anularea unei comenzi servite — eticheta
  // spunea „opțional" și pe served, iar refuzul serverului părea o eroare.
  const reasonRequired = order.status === 'served'

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
        role="dialog"
        aria-label="Anulează comanda"
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

        {blockedByPayments && paidSoFar != null && (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: D.red,
              background: `${D.red}11`,
              border: `1px solid ${D.red}44`,
              padding: '8px 10px',
              borderRadius: 6,
              lineHeight: 1.5,
            }}
          >
            Comanda are <strong>{paidSoFar.toFixed(2)} lei</strong> plăți încasate și nu poate fi
            anulată. Finalizează prin plată (restul se deduce automat).
          </div>
        )}

        <div>
          <label style={{ fontSize: 12, color: D.t2, display: 'block', marginBottom: 6 }}>
            {reasonRequired ? 'Motiv (obligatoriu — comanda a fost servită)' : 'Motiv (opțional)'}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex: clientul a anulat, produs nedisponibil…"
            autoFocus
            rows={3}
            disabled={blockedByPayments}
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
            role="alert"
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
              void onConfirm(reason.trim() ? reason.trim() : undefined).then((res) => {
                // La eșec deblocăm butonul ca utilizatorul să poată reîncerca
                // ȘI afișăm eroarea DIRECT în dialog (banner-ul din pagina
                // părinte e acoperit de overlay-ul modalului, deci invizibil
                // cât timp dialogul e deschis); la succes părintele demontează
                // dialogul.
                if (!res.ok) {
                  setSubmitting(false)
                  setError(res.message || GENERIC_ERROR)
                }
              })
            }}
            disabled={submitting || blockedByPayments}
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
              cursor: submitting ? 'wait' : blockedByPayments ? 'not-allowed' : 'pointer',
              opacity: submitting || blockedByPayments ? 0.6 : 1,
            }}
          >
            {submitting ? 'Se anulează…' : 'Anulează comanda'}
          </button>
        </div>
      </div>
    </div>
  )
}
