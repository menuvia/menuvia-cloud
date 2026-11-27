// ─────────────────────────────────────────────────────────────
// SplitBillModal — „Plată parțială” de pe ecranul ospătarului (Planul 3).
// Extras din WaiterPage la lotul C2a, unde modalul putea înregistra sume
// greșite fără ca ospătarul să afle:
//   - plățile rămâneau ale comenzii deschise ANTERIOR până la răspuns, iar pe
//     eroare lista veche (sau „Rămas = total”) rămânea pe ecran tăcut. Acum
//     registrul e TRISTATE: `null` = nu știm ce s-a încasat → „Reîncearcă” și
//     „Adaugă plata” dezactivat; părintele montează modalul cu `key` pe comandă;
//   - totalul venea din instantaneul de la deschidere: o reducere/editare
//     făcută între timp nu se vedea. Părintele trimite comanda VIE;
//   - o plată care achita tot închidea modalul fără niciun mesaj: acum toast;
//   - „0”, „-5” erau ignorate tăcut, iar `type=number` refuza virgula pe unele
//     browsere: suma se citește cu `parseDecimalCents` și se compară în CENȚI
//     (mig 291 cere egalitate exactă), cu motivul afișat sub câmp;
//   - un tap pe fundal (sau pe „Închide”) închidea modalul și în timpul
//     cererii.
// Gate-ul de bani rămâne în RPC (`add_partial_payment`, mig 291); aici e doar
// validare de input. Supra-încasarea e semnalată, nu blocată (convenția
// PayModal): serverul o respinge cu `overpayment`.
// ─────────────────────────────────────────────────────────────
import { useEffect, useId, useRef, useState } from 'react'
import type { Order, OrderPaymentRow, PaymentMethod } from '../lib/orders'
import { addPartialPayment, getOrderPayments } from '../lib/orders'
import { D } from '../lib/constants'
import { checkSplitAmount, remainingCents, centsText } from '../lib/partialPayments'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { Button } from './ui/Button'
import { useToast } from './ui/useToast'
import { useT } from '../i18n/useT'
import { waiterNs } from '../i18n/ns/waiter'
import { commonNs } from '../i18n/ns/common'
import { paymentsNs } from '../i18n/ns/payments'
import { describeStaffError } from '../i18n/staffErrors'

interface SplitBillModalProps {
  /** Comanda VIE (lista realtime a paginii), nu instantaneul de la deschidere. */
  order: Order
  onClose: () => void
}

const METHODS: readonly PaymentMethod[] = ['cash', 'card_pos', 'meal_voucher', 'other']

export function SplitBillModal({ order, onClose }: SplitBillModalProps) {
  useBodyScrollLock(true)
  // Namespace-urile sunt cerute de WaiterPage la montare: aici nu se suspendă.
  const tw = useT(waiterNs)
  const tc = useT(commonNs)
  const tpay = useT(paymentsNs)
  const toast = useToast()
  const titleId = useId()
  const amountLabelId = useId()

  // TRISTATE: `null` = registrul nu e (încă) cunoscut; `loadFailed` spune dacă
  // citirea e în curs sau a eșuat.
  const [payments, setPayments] = useState<OrderPaymentRow[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [submitting, setSubmitting] = useState(false)
  // Blocare sincronă (dublu-tap pe „Adaugă plata” înainte de re-randare).
  const submittingRef = useRef(false)

  useEffect(() => {
    let alive = true
    setPayments(null)
    setLoadFailed(false)
    getOrderPayments(order.id)
      .then((ps) => {
        if (alive) setPayments(ps)
      })
      .catch(() => {
        if (alive) setLoadFailed(true)
      })
    return () => {
      alive = false
    }
  }, [order.id, attempt])

  const rest = payments != null ? remainingCents(order.total, payments) : null
  const check = checkSplitAmount(amount, rest)
  const canSubmit =
    payments != null && !submitting && (check.kind === 'ok' || check.kind === 'over')

  async function submit(): Promise<void> {
    if (submittingRef.current || payments == null) return
    if (check.kind !== 'ok' && check.kind !== 'over') return
    const cents = check.cents
    submittingRef.current = true
    setSubmitting(true)
    let fullyPaid: boolean
    try {
      const result = await addPartialPayment(order.id, cents / 100, method)
      fullyPaid = result.fully_paid
    } catch (err) {
      // Nu înghițim tăcut o eroare pe o cale de bani (poate masca un refuz de gate / rol).
      console.error('[SplitBillModal] partial payment failed', err)
      // În română: mesajul serverului ca atare (textul de dinainte). În altă
      // limbă un text românesc al serverului nu se arată: clasa erorii, plafonul
      // de supra-încasare (hint `overpayment`, mig 258) sau textul generic.
      const msg = err instanceof Error ? err.message : tw.t('split_errUnknown')
      toast.error(
        tw.lang === 'ro'
          ? tw.t('split_errWithMsg', { msg })
          : describeStaffError(err, tc, {
              fallback: tw.t('split_errGeneric'),
              hints: {
                overpayment: tw.t('split_errOverpayment'),
                insufficient_role: tpay.t('payRej_role'),
              },
            }),
      )
      submittingRef.current = false
      setSubmitting(false)
      return
    }
    if (fullyPaid) {
      // Comanda a trecut în Plătit (și pleacă bonul): ospătarul AFLĂ asta,
      // nu vede doar modalul dispărând.
      toast.success(tw.t('split_okFull'))
      onClose()
      return
    }
    toast.success(tw.t('split_okPartial', { amount: centsText(cents) }))
    setAmount('')
    submittingRef.current = false
    setSubmitting(false)
    // Re-citirea registrului e SEPARATĂ de plată: un eșec aici NU înseamnă că
    // plata n-a fost înregistrată (înainte același toast „Plata nu a fost
    // înregistrată” acoperea și re-citirea — o retrimitere = încasare dublă).
    setAttempt((n) => n + 1)
  }

  const methodLabel = (m: string, short: boolean): string =>
    m === 'cash'
      ? tw.t(short ? 'split_btnCash' : 'split_listCash')
      : m === 'card_pos'
        ? tw.t(short ? 'split_btnCard' : 'split_listCard')
        : m === 'meal_voucher'
          ? tw.t(short ? 'split_btnVoucher' : 'split_listVoucher')
          : tw.t(short ? 'split_btnOther' : 'split_listOther')

  return (
    <div
      className="animate-backdrop"
      // Cât plata e în zbor, un tap scăpat pe fundal NU închide modalul.
      onClick={() => {
        if (!submitting) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: D.overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: 16,
      }}
    >
      <div
        className="animate-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: D.s2,
          border: '1px solid ' + D.s3,
          borderRadius: 16,
          padding: 28,
          width: 400,
          maxWidth: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: D.shadowLg,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div
          id={titleId}
          style={{
            fontFamily: D.fontDisplay,
            fontSize: 20,
            fontWeight: 700,
            color: D.t1,
          }}
        >
          {tw.t('split_title')}
        </div>
        <div>
          <div style={{ color: D.t2, fontSize: 13 }}>
            {tw.t('split_table', { table: order.table?.name ?? '-' })}
          </div>
          <div
            style={{
              fontFamily: D.fontDisplay,
              fontSize: 28,
              fontWeight: 900,
              color: D.gold,
            }}
          >
            {tw.t('money', { amount: order.total.toFixed(2) })}
          </div>
        </div>

        {/* Registrul: necunoscut (se citește / a eșuat) sau cunoscut, cu
            „Rămas” mereu vizibil — exact informația de care are nevoie
            ospătarul ca să împartă nota. */}
        {payments == null ? (
          <div
            role={loadFailed ? 'alert' : 'status'}
            style={{
              background: loadFailed ? D.redA : D.s3,
              border: '1px solid ' + (loadFailed ? D.redBorder : D.s3),
              borderRadius: 8,
              padding: 12,
              fontSize: 13,
              color: loadFailed ? D.red : D.t2,
              lineHeight: 1.5,
            }}
          >
            {loadFailed ? tw.t('split_loadError') : tw.t('split_loadingPayments')}
            {loadFailed && (
              <Button
                variant="secondary"
                size="sm"
                className="pressable"
                style={{ display: 'flex', marginTop: 8 }}
                onClick={() => setAttempt((n) => n + 1)}
              >
                {tc.t('retry')}
              </Button>
            )}
          </div>
        ) : (
          <div style={{ background: D.s3, borderRadius: 8, padding: 12 }}>
            {payments.length > 0 && (
              <>
                <div style={{ fontSize: 12, color: D.t2, marginBottom: 8 }}>
                  {tw.t('split_recorded')}
                </div>
                {payments.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 13,
                      color: D.t2,
                      padding: '2px 0',
                    }}
                  >
                    <span>{methodLabel(p.method, false)}</span>
                    <span style={{ color: D.green }}>
                      {tw.t('money', { amount: Number(p.amount).toFixed(2) })}
                    </span>
                  </div>
                ))}
              </>
            )}
            <div
              style={{
                borderTop: payments.length > 0 ? '1px solid ' + D.border : 'none',
                marginTop: payments.length > 0 ? 8 : 0,
                paddingTop: payments.length > 0 ? 8 : 0,
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              <span style={{ color: D.t2 }}>{tw.t('split_remaining')}</span>
              <span style={{ color: D.t1 }}>
                {tw.t('money', { amount: centsText(rest ?? 0) })}
              </span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          {METHODS.map((m) => (
            <button
              key={m}
              type="button"
              className="pressable"
              aria-pressed={method === m}
              onClick={() => setMethod(m)}
              style={{
                flex: 1,
                padding: '10px 0',
                background: method === m ? D.goldA : D.s3,
                border: '1px solid ' + (method === m ? D.gold : D.s3),
                borderRadius: 8,
                color: method === m ? D.gold : D.t2,
                fontFamily: D.fontBody,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {methodLabel(m, true)}
            </button>
          ))}
        </div>

        <div>
          <div id={amountLabelId} style={{ color: D.t2, fontSize: 12, marginBottom: 6 }}>
            {tw.t('split_amountLabel')}
          </div>
          {/* Text, nu `type=number`: pe unele browsere acela refuză virgula. */}
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-labelledby={amountLabelId}
            aria-invalid={check.kind === 'invalid' || undefined}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: D.s3,
              border: '1px solid ' + D.s3,
              borderRadius: 8,
              color: D.t1,
              fontFamily: D.fontBody,
              fontSize: 16,
              padding: '10px 12px',
            }}
          />
          {/* Scurtătura „Restul”: suma exactă, în cenți, fără calcul de mână. */}
          {rest != null && rest > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="pressable"
              onClick={() => setAmount(centsText(rest))}
              style={{ marginTop: 8 }}
            >
              {tw.t('split_fillRest', { amount: centsText(rest) })}
            </Button>
          )}
          {check.kind === 'invalid' && (
            <div role="alert" style={{ fontSize: 12, color: D.red, marginTop: 6, lineHeight: 1.5 }}>
              {tw.t('split_amountInvalid')}
            </div>
          )}
          {check.kind === 'over' && rest != null && (
            <div role="status" style={{ fontSize: 12, color: D.amber, marginTop: 6, lineHeight: 1.5 }}>
              {tw.t('split_over', { rest: centsText(rest) })}
            </div>
          )}
          {check.kind === 'ok' && check.coversRest && (
            <div role="status" style={{ fontSize: 12, color: D.green, marginTop: 6, lineHeight: 1.5 }}>
              {tw.t('split_coversRest')}
            </div>
          )}
        </div>

        <Button
          variant="primary"
          size="lg"
          fullWidth
          className="pressable"
          onClick={() => {
            void submit()
          }}
          disabled={!canSubmit}
          loading={submitting}
        >
          {submitting ? tw.t('split_processing') : tw.t('split_add')}
        </Button>
        {/* Ca fundalul: cât plata e în zbor, „Închide” e blocat. Închiderea
            demonta modalul (și `submittingRef`), iar unul redeschis înainte de
            răspuns citea registrul fără plata în zbor și o putea trimite a doua
            oară — `add_partial_payment` înregistrează fiecare apel separat. */}
        <Button
          variant="secondary"
          fullWidth
          className="pressable"
          disabled={submitting}
          onClick={onClose}
        >
          {tc.t('close')}
        </Button>
      </div>
    </div>
  )
}
