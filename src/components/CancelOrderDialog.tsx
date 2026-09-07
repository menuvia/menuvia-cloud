// =============================================================
// Menuvia — src/components/CancelOrderDialog.tsx
// Mic modal de confirmare anulare cu textarea pentru motiv.
// Înlocuiește window.prompt (blocat în iOS PWA standalone + UX urât).
//
// Audit v3 RES-25 (mig 270): o comandă cu bani deja încasați (parțiale cash,
// split online) NU se poate anula direct — serverul refuză cu
// `cancel_over_payments` (trigger în DATE). Ieșirea legitimă e STORNO-ul:
// banii au fost RETURNAȚI clientului (cash înapoi / refund manual în Stripe),
// adminul stornează cu motiv obligatoriu (audit_log), abia apoi anularea trece.
// Dialogul arată plățile când le CUNOAȘTE și oferă „Stornează și anulează";
// când lista e necunoscută (RPC picat) nu blochează nimic — serverul rămâne
// gate-ul (tristate, ca BridgeOfflineBanner). Mesajul de refuz vine de la
// server, nu dintr-un text generic.
// =============================================================

import { useState } from 'react'
import type { Order, OrderPaymentRow } from '../lib/orders'
import { D } from '../lib/constants'

export interface CancelResult {
  ok: boolean
  /** Mesajul de refuz al serverului (deja tradus), afișat în dialog. */
  message?: string
}

interface Props {
  order: Order
  // Plățile deja înregistrate pe comandă (order_payments): listă ne-goală =
  // anularea directă e imposibilă; [] = liberă; null = NECUNOSCUT (nu blocăm —
  // serverul decide).
  payments: OrderPaymentRow[] | null
  // Întoarce {ok:true} dacă anularea a reușit. La ok:false dialogul rămâne
  // deschis și afișează `message` (sau un text generic).
  onConfirm: (reason: string | undefined) => Promise<CancelResult>
  // Storno pe TOATE plățile (banii au fost returnați) + anulare, cu motiv
  // obligatoriu. Doar owner/manager — serverul refuză restul (role_insufficient).
  onVoidAndCancel?: (reason: string) => Promise<CancelResult>
  onClose: () => void
}

const GENERIC_ERROR =
  'Anularea a fost respinsă. Verifică rolul tău sau motivul comenzii și încearcă din nou.'

const METHOD_LABEL: Record<string, string> = {
  cash: 'Numerar',
  card_pos: 'Card (POS)',
  card_online: 'Card online',
  meal_voucher: 'Tichet de masă',
  other: 'Altă metodă',
}

export default function CancelOrderDialog({
  order,
  payments,
  onConfirm,
  onVoidAndCancel,
  onClose,
}: Props) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Eroarea de refuz trebuie afișată AICI, nu doar prin banner-ul din pagina
  // părinte — banner-ul e acoperit de overlay-ul acestui modal (zIndex mai
  // mic) cât timp dialogul e deschis, deci userul nu-l vede niciodată.
  const [error, setError] = useState<string | null>(null)
  const paidSoFar = payments == null ? null : payments.reduce((s, p) => s + p.amount, 0)
  const blockedByPayments = paidSoFar != null && paidSoFar > 0
  const hasOnline = (payments ?? []).some((p) => p.method === 'card_online')
  // mig 118: motivul e OBLIGATORIU la anularea unei comenzi servite — eticheta
  // spunea „opțional" și pe served, iar refuzul serverului părea o eroare.
  // Pe storno (mig 270) motivul e obligatoriu indiferent de status.
  const reasonRequired = order.status === 'served' || blockedByPayments
  const trimmedReason = reason.trim()

  function handleResult(res: CancelResult): void {
    // La eșec deblocăm butonul ca utilizatorul să poată reîncerca ȘI afișăm
    // eroarea DIRECT în dialog; la succes părintele demontează dialogul.
    if (!res.ok) {
      setSubmitting(false)
      setError(res.message || GENERIC_ERROR)
    }
  }

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
              color: D.t1,
              background: `${D.red}11`,
              border: `1px solid ${D.red}44`,
              padding: '10px 12px',
              borderRadius: 8,
              lineHeight: 1.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ color: D.red, fontWeight: 600 }}>
              Comanda are {paidSoFar.toFixed(2)} lei plăți încasate și nu poate fi anulată direct.
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, color: D.t2 }}>
              {(payments ?? []).map((p) => (
                <li key={p.id}>
                  {p.amount.toFixed(2)} lei · {METHOD_LABEL[p.method] ?? p.method}
                </li>
              ))}
            </ul>
            <div style={{ color: D.t2 }}>
              Dacă banii au fost <strong>returnați clientului</strong>, stornează plățile (cu motiv,
              se înregistrează în audit) și comanda se anulează. Altfel finalizează prin plată.
              {hasOnline && (
                <>
                  {' '}
                  <strong>Plățile online se rambursează manual din Stripe</strong> înainte de
                  storno.
                </>
              )}
            </div>
          </div>
        )}

        <div>
          <label style={{ fontSize: 12, color: D.t2, display: 'block', marginBottom: 6 }}>
            {blockedByPayments
              ? 'Motiv (obligatoriu pentru stornare)'
              : reasonRequired
                ? 'Motiv (obligatoriu — comanda a fost servită)'
                : 'Motiv (opțional)'}
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
          {blockedByPayments ? (
            <button
              onClick={() => {
                if (!onVoidAndCancel || trimmedReason.length === 0) return
                setSubmitting(true)
                setError(null)
                void onVoidAndCancel(trimmedReason).then(handleResult)
              }}
              disabled={submitting || !onVoidAndCancel || trimmedReason.length === 0}
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
                opacity: submitting || !onVoidAndCancel || trimmedReason.length === 0 ? 0.6 : 1,
              }}
            >
              {submitting ? 'Se stornează…' : 'Stornează plățile și anulează'}
            </button>
          ) : (
            <button
              onClick={() => {
                setSubmitting(true)
                setError(null)
                void onConfirm(trimmedReason ? trimmedReason : undefined).then(handleResult)
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
          )}
        </div>
      </div>
    </div>
  )
}
