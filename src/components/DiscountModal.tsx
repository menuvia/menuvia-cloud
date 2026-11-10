// ─────────────────────────────────────────────────────────────
// DiscountModal — Aplică / scoate reducere pe o comandă
//
// Folosit din WaiterPage (înainte de plată; butonul din PayModal).
// Permisiune: doar owner/manager (verificat de RPC).
// Textele vin din namespace-ul `payments` (+ „Anulează” din `common`, lotul
// L4b). Calculul previzualizării și apelurile RPC sunt NEATINSE.
//
// Suportă:
//   • Procent (1-100%)
//   • Sumă fixă (RON) — capped la subtotal pe backend
//   • Motiv opțional (logat în orders.discount_reason)
//
// Dacă order are deja discount, modalul afișează "Reducere aplicată: …"
// cu buton de ștergere + opțiunea de a-l modifica.
// ─────────────────────────────────────────────────────────────
import { useState, useMemo } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import type { Order } from '../lib/orders'
import { applyOrderDiscount, removeOrderDiscount, orderSubtotal } from '../lib/orders'
import { D } from '../lib/constants'
import { useT } from '../i18n/useT'
import { paymentsNs } from '../i18n/ns/payments'
import { commonNs } from '../i18n/ns/common'
import { describeStaffError } from '../i18n/staffErrors'
import type { Translator } from '../i18n/core'
import type commonRo from '../i18n/ns/common/ro'
import type paymentsRo from '../i18n/ns/payments/ro'

/**
 * Refuzul RPC-ului de reducere. În ROMÂNĂ exact `toUserMessage(e, fallback)`
 * de dinainte (mesajul serverului ca atare — hint-urile NU se aplică, altfel
 * româna s-ar schimba); în altă limbă hint-urile de business din mig 291 au
 * textul lor, restul cade pe clasa erorii sau pe textul de rezervă.
 */
function describeDiscountError(
  e: unknown,
  t: Translator<typeof paymentsRo>['t'],
  tc: Translator<typeof commonRo>,
  fallback: string,
): string {
  return describeStaffError(e, tc, {
    fallback,
    hints:
      tc.lang === 'ro'
        ? undefined
        : {
            discount_over_payments: t('disc_errOverPayments'),
            discount_online_payment: t('disc_errOnlinePayment'),
          },
  })
}

interface Props {
  order: Order
  onClose: () => void
  onApplied: () => void // caller reîncarcă comanda
}

export default function DiscountModal({ order, onClose, onApplied }: Props) {
  useBodyScrollLock(true)
  // Hook-urile de limbă, necondiționat, sus (WaiterPage cere deja `payments`).
  const { t } = useT(paymentsNs)
  const tc = useT(commonNs)
  const subtotal = useMemo(() => orderSubtotal(order), [order])
  const hasExisting = order.discount_type != null && order.discount_value != null

  const [mode, setMode] = useState<'percent' | 'amount'>(order.discount_type ?? 'percent')
  const [value, setValue] = useState<string>(
    order.discount_value != null ? String(order.discount_value) : '',
  )
  const [reason, setReason] = useState<string>(order.discount_reason ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const numValue = Number(value.replace(',', '.'))
  const validValue = !isNaN(numValue) && numValue > 0 && (mode === 'amount' || numValue <= 100)

  const previewDiscount = useMemo(() => {
    if (!validValue) return 0
    if (mode === 'percent') return Math.round(subtotal * numValue) / 100
    return Math.min(subtotal, numValue)
  }, [mode, numValue, validValue, subtotal])

  const previewTotal = Math.max(0, subtotal - previewDiscount)

  async function handleApply() {
    if (!validValue) return
    setBusy(true)
    setErr(null)
    try {
      await applyOrderDiscount(order.id, mode, numValue, reason.trim() || null)
      onApplied()
      onClose()
    } catch (e) {
      setErr(describeDiscountError(e, t, tc, t('disc_errApply')))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    setErr(null)
    try {
      await removeOrderDiscount(order.id)
      onApplied()
      onClose()
    } catch (e) {
      setErr(describeDiscountError(e, t, tc, t('disc_errRemove')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 220,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: D.s2,
          border: `1px solid ${D.s3}`,
          borderRadius: 16,
          padding: 24,
          width: '100%',
          maxWidth: 420,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          fontFamily: 'DM Sans, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 20,
              fontWeight: 700,
              color: D.t1,
            }}
          >
            {t('disc_title')}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: D.t2,
              fontSize: 22,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {hasExisting && (
          <div
            style={{
              background: D.goldA,
              border: `1px solid ${D.gold}`,
              borderRadius: 10,
              padding: 12,
              fontSize: 13,
              color: D.t1,
            }}
          >
            <div style={{ marginBottom: 4 }}>
              <strong>{t('disc_active')}</strong>{' '}
              {order.discount_type === 'percent'
                ? t('disc_activePct', { value: String(order.discount_value) })
                : t('money', { amount: String(order.discount_value?.toFixed(2)) })}{' '}
              {t('disc_off', { amount: order.discount_amount.toFixed(2) })}
            </div>
            {order.discount_reason && (
              <div style={{ color: D.t2, fontSize: 12 }}>
                {t('disc_reasonShown', { reason: order.discount_reason })}
              </div>
            )}
          </div>
        )}

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 8 }}>
          {(['percent', 'amount'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m)
                setValue('')
              }}
              style={{
                flex: 1,
                padding: '10px 0',
                background: mode === m ? D.goldA : D.s3,
                border: `1px solid ${mode === m ? D.gold : D.s3}`,
                borderRadius: 9,
                color: mode === m ? D.gold : D.t2,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {m === 'percent' ? t('disc_modePct') : t('disc_modeAmount')}
            </button>
          ))}
        </div>

        {/* Value input */}
        <div>
          <label style={{ display: 'block', fontSize: 12, color: D.t2, marginBottom: 6 }}>
            {mode === 'percent' ? t('disc_labelPct') : t('disc_labelAmount')}
          </label>
          <input
            type="number"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={mode === 'percent' ? t('disc_phPct') : t('disc_phAmount')}
            min={0}
            max={mode === 'percent' ? 100 : undefined}
            step={mode === 'percent' ? 1 : 0.5}
            style={{
              width: '100%',
              height: 44,
              padding: '0 14px',
              background: D.s3,
              border: `1px solid ${D.border}`,
              borderRadius: 9,
              color: D.t1,
              fontSize: 16,
              outline: 'none',
              fontFamily: 'DM Sans, sans-serif',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Reason input */}
        <div>
          <label style={{ display: 'block', fontSize: 12, color: D.t2, marginBottom: 6 }}>
            {t('disc_reasonLabel')}
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('disc_reasonPh')}
            maxLength={200}
            style={{
              width: '100%',
              height: 40,
              padding: '0 14px',
              background: D.s3,
              border: `1px solid ${D.border}`,
              borderRadius: 9,
              color: D.t1,
              fontSize: 13,
              outline: 'none',
              fontFamily: 'DM Sans, sans-serif',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Live preview breakdown */}
        <div style={{ background: D.s3, borderRadius: 10, padding: 14, fontSize: 13 }}>
          <Row
            label={t('disc_subtotal')}
            value={t('money', { amount: subtotal.toFixed(2) })}
            color={D.t1}
          />
          <Row
            label={t('disc_discount')}
            value={t('disc_minusMoney', { amount: previewDiscount.toFixed(2) })}
            color={previewDiscount > 0 ? D.green : D.t3}
          />
          <div style={{ borderTop: `1px solid ${D.border}`, marginTop: 8, paddingTop: 8 }}>
            {/* `bold` înaintea expresiilor: scanerul SK5 lua `bold />` după `}` drept text. */}
            <Row
              bold
              label={t('disc_newTotal')}
              value={t('money', { amount: previewTotal.toFixed(2) })}
              color={D.gold}
            />
          </div>
        </div>

        {err && (
          <div
            style={{
              color: D.red,
              background: 'rgba(224,85,85,0.10)',
              padding: 10,
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            {err}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {hasExisting && (
            <button
              onClick={handleRemove}
              disabled={busy}
              style={{
                flex: '1 1 100%',
                height: 42,
                background: 'transparent',
                border: `1px solid ${D.red}`,
                borderRadius: 9,
                color: D.red,
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              {t('disc_remove')}
            </button>
          )}
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              flex: 1,
              height: 44,
              background: D.s3,
              border: `1px solid ${D.border}`,
              borderRadius: 9,
              color: D.t2,
              fontSize: 14,
              fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {tc.t('cancel')}
          </button>
          <button
            onClick={handleApply}
            disabled={busy || !validValue}
            style={{
              flex: 1,
              height: 44,
              background: validValue ? D.gold : D.s3,
              border: 'none',
              borderRadius: 9,
              color: validValue ? '#0a0a0a' : D.t3,
              fontSize: 14,
              fontWeight: 600,
              cursor: busy || !validValue ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? t('disc_applying') : hasExisting ? t('disc_update') : t('disc_apply')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  color,
  bold,
}: {
  label: string
  value: string
  color: string
  bold?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '3px 0',
      }}
    >
      <span style={{ color: D.t2, fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span style={{ color, fontWeight: bold ? 700 : 500, fontSize: bold ? 16 : 13 }}>{value}</span>
    </div>
  )
}
