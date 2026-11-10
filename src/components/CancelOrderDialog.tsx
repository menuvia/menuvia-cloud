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
import { useT } from '../i18n/useT'
import { ordersNs } from '../i18n/ns/orders'
import { fillNodes } from '../i18n/fillNodes'
import type { StringKey, Translator } from '../i18n/core'
import type ordersRo from '../i18n/ns/orders/ro'

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

// Eticheta metodei din `order_payments.method`; o metodă necunoscută rămâne
// afișată cu id-ul ei (ca înainte).
const METHOD_KEY: Readonly<Record<string, StringKey<typeof ordersRo>>> = {
  cash: 'method_cash',
  card_pos: 'method_card_pos',
  card_online: 'method_card_online',
  meal_voucher: 'method_meal_voucher',
  other: 'method_other',
}

function paymentMethodLabel(t: Translator<typeof ordersRo>['t'], method: string): string {
  const key = Object.prototype.hasOwnProperty.call(METHOD_KEY, method) ? METHOD_KEY[method] : undefined
  return key ? t(key) : method
}

/** Dialogul de anulare: tristate pe plăți (necunoscut → serverul decide), storno cu motiv când există bani încasați. */
export default function CancelOrderDialog({
  order,
  payments,
  onConfirm,
  onVoidAndCancel,
  onClose,
}: Props) {
  const { t } = useT(ordersNs)
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
  // Când motivul e obligatoriu (served / storno), butonul rămâne dezactivat
  // până se scrie ceva — altfel clickul pleacă gol la server și se întoarce
  // `cancel_reason_required`, un refuz previzibil transformat în eroare.
  const reasonMissing = reasonRequired && trimmedReason.length === 0

  /** Aplică rezultatul unei anulări/stornări: la refuz deblochează butonul și afișează mesajul serverului. */
  function handleResult(res: CancelResult): void {
    // La eșec deblocăm butonul ca utilizatorul să poată reîncerca ȘI afișăm
    // eroarea DIRECT în dialog; la succes părintele demontează dialogul.
    if (!res.ok) {
      setSubmitting(false)
      setError(res.message || t('cancel_errGeneric'))
    }
  }

  return (
    <div
      // Cât timp cererea e în zbor NU se închide pe backdrop: părintele ar
      // demonta dialogul și un refuz venit după ar rămâne fără nicio suprafață.
      onClick={() => {
        if (!submitting) onClose()
      }}
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
        aria-label={t('cancel_title')}
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
            {t('cancel_title')}
          </div>
          <div style={{ fontSize: 12, color: D.t3, marginTop: 4 }}>
            #{order.id.slice(-6).toUpperCase()}
            {order.table?.name ? ` · ${t('tableLabel', { table: order.table.name })}` : ''}
            {' · '}
            {t('money', { amount: order.total.toFixed(2) })}
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
              {t('cancel_blocked', { amount: paidSoFar.toFixed(2) })}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, color: D.t2 }}>
              {(payments ?? []).map((p) => (
                <li key={p.id}>
                  {t('money', { amount: p.amount.toFixed(2) })} · {paymentMethodLabel(t, p.method)}
                </li>
              ))}
            </ul>
            <div style={{ color: D.t2 }}>
              {fillNodes(t('cancel_voidHelp'), {
                returned: <strong>{t('cancel_voidHelpReturned')}</strong>,
              })}
              {hasOnline && (
                <>
                  {' '}
                  {fillNodes(t('cancel_voidOnline'), {
                    refund: <strong>{t('cancel_voidOnlineRefund')}</strong>,
                  })}
                </>
              )}
            </div>
          </div>
        )}

        <div>
          <label style={{ fontSize: 12, color: D.t2, display: 'block', marginBottom: 6 }}>
            {blockedByPayments
              ? t('cancel_reasonVoid')
              : reasonRequired
                ? t('cancel_reasonServed')
                : t('cancel_reasonOptional')}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('cancel_reasonPlaceholder')}
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
            {t('cancel_dismiss')}
          </button>
          {blockedByPayments ? (
            <button
              onClick={() => {
                if (!onVoidAndCancel || reasonMissing) return
                setSubmitting(true)
                setError(null)
                void onVoidAndCancel(trimmedReason).then(handleResult)
              }}
              disabled={submitting || !onVoidAndCancel || reasonMissing}
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
                opacity: submitting || !onVoidAndCancel || reasonMissing ? 0.6 : 1,
              }}
            >
              {submitting ? t('cancel_voiding') : t('cancel_voidAndCancel')}
            </button>
          ) : (
            <button
              onClick={() => {
                if (reasonMissing) return
                setSubmitting(true)
                setError(null)
                void onConfirm(trimmedReason ? trimmedReason : undefined).then(handleResult)
              }}
              disabled={submitting || reasonMissing}
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
                opacity: submitting || reasonMissing ? 0.6 : 1,
              }}
            >
              {submitting ? t('cancel_cancelling') : t('cancel_title')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
