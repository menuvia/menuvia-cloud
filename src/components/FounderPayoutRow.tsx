// FounderPayoutRow — un payout de afiliat în FounderPage, cu profilul de plată
// (beneficiar, formă juridică, CUI, IBAN) și butoanele de tranziție (mig 294).
// Serverul decide (RPC-urile admin_payout_*); aici doar oglindim matricea
// (lib/payoutFlow) și afișăm refuzul cu textul serverului. Câmpurile de text
// (factură, referință, motiv) sunt INLINE, nu window.prompt (iOS PWA).
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { D } from '../lib/constants'
import { confirm } from './ui/confirm'
import { useToast } from './ui/useToast'
import {
  markPayoutPaid,
  requestPayoutInvoice,
  matchPayoutInvoice,
  startPayoutTransfer,
  holdPayout,
  failPayout,
  cancelPayout,
  runPayoutBatch,
  type AdminActionResult,
  type AdminPayoutRow,
  type PayoutPaymentMethod,
} from '../lib/founder'
import {
  availablePayoutActions,
  cancelNeedsMoneyReturnConfirm,
  currentPayoutPeriod,
  describePayoutRefusal,
  formatIban,
  MONEY_RETURN_CONFIRM_TITLE,
  payoutActionNeedsInput,
  PAYMENT_METHOD_LABELS,
  PAYOUT_ACTION_LABELS,
  type PayoutAction,
} from '../lib/payoutFlow'

const STATUS_LABELS: Record<string, string> = {
  draft: 'ciornă',
  awaiting_invoice: 'așteaptă factura',
  invoice_matched: 'factură confirmată',
  processing: 'în procesare',
  paid: 'plătit',
  failed: 'eșuat',
  on_hold: 'în verificare',
  canceled: 'anulat',
}

const LEGAL_FORM_LABELS: Record<string, string> = { pfa: 'PFA', srl: 'SRL', other: 'altă formă' }

function formatMoney(cents: number, currency: string): string {
  const v = (cents / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2 })
  return currency === 'RON' ? v + ' lei' : v + ' ' + currency
}

const btnBase: CSSProperties = {
  padding: '8px 12px',
  minHeight: 40,
  borderRadius: 9,
  cursor: 'pointer',
  fontSize: '0.76rem',
  fontWeight: 600,
  fontFamily: 'DM Sans,sans-serif',
}
const primaryBtn: CSSProperties = { ...btnBase, border: 'none', background: D.gold, color: D.onGold }
const ghostBtn: CSSProperties = { ...btnBase, border: `1px solid ${D.border}`, background: 'transparent', color: D.t2 }
const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: D.s1,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '9px 11px',
  color: D.t1,
  fontSize: '0.82rem',
  fontFamily: 'DM Sans,sans-serif',
  minHeight: 40,
}

function busyStyle(base: CSSProperties, busy: boolean): CSSProperties {
  return busy ? { ...base, opacity: 0.55, cursor: 'not-allowed' } : base
}

// Etichetele câmpului de text pentru acțiunile care cer input.
const INPUT_LABELS: Partial<Record<PayoutAction, string>> = {
  match_invoice: 'Numărul facturii emise de afiliat',
  start_transfer: 'Referința plății (id transfer Wise / nr. OP / document)',
  hold: 'De ce e în verificare',
  mark_failed: 'De ce a eșuat',
  cancel: 'Motivul anulării (pe un eșec cu transfer: confirmarea că banii NU au plecat)',
}

export default function FounderPayoutRow({
  payout,
  onChanged,
}: {
  payout: AdminPayoutRow
  onChanged: () => Promise<void>
}) {
  const toast = useToast()
  const [pending, setPending] = useState<PayoutAction | null>(null)
  const [text, setText] = useState('')
  const [method, setMethod] = useState<PayoutPaymentMethod>('bank_transfer')
  const [busy, setBusy] = useState(false)

  const p = payout
  const hasReference = Boolean(p.payment_reference || p.wise_transfer_id)
  const actions = availablePayoutActions(p.status, hasReference)
  // Afiliat șters (GDPR, mig 295): fără email, dar payout-ul rămâne (evidență).
  const payeeLabel = p.affiliate_email ?? (p.affiliate_erased ? 'Afiliat șters (GDPR)' : 'Afiliat fără email')

  function call(action: PayoutAction, value: string, moneyReturned: boolean): Promise<AdminActionResult> {
    switch (action) {
      case 'request_invoice':
        return requestPayoutInvoice(p.id)
      case 'match_invoice':
        return matchPayoutInvoice(p.id, value)
      case 'start_transfer':
        return startPayoutTransfer(p.id, method, value)
      case 'mark_paid':
        return markPayoutPaid(p.id)
      case 'hold':
        return holdPayout(p.id, value)
      case 'mark_failed':
        return failPayout(p.id, value)
      case 'cancel':
        return cancelPayout(p.id, value, moneyReturned)
    }
  }

  async function run(action: PayoutAction, value: string) {
    if (action === 'mark_paid') {
      const ok = await confirm({
        title: 'Marchezi payout-ul ca plătit?',
        description: `${payeeLabel} · ${formatMoney(p.gross_cents, p.currency)}. Debitul se înscrie în ledger — acțiune ireversibilă. Confirmă întâi în extrasul băncii că banii au plecat.`,
        confirmLabel: 'Marchează plătit',
      })
      if (!ok) return
    }
    // Failed CU referință: transferul a plecat. Anularea eliberează suma pentru
    // o plată nouă, deci cere confirmarea EXPLICITĂ că banii nu au ajuns
    // (serverul refuză altfel cu `money_return_unconfirmed`, mig 294).
    let moneyReturned = false
    if (action === 'cancel' && cancelNeedsMoneyReturnConfirm(p.status, hasReference)) {
      const ok = await confirm({
        title: MONEY_RETURN_CONFIRM_TITLE,
        description: `${payeeLabel} · ${formatMoney(p.gross_cents, p.currency)}${p.payment_reference ? ` · ref. ${p.payment_reference}` : ''}. Transferul acesta a plecat. Anularea eliberează suma pentru o plată nouă — dacă banii au ajuns totuși la afiliat, ar fi plătiți DE DOUĂ ORI. Confirmă doar după ce ai verificat în extrasul băncii.`,
        confirmLabel: 'Confirm, banii nu au ajuns',
        destructive: true,
      })
      if (!ok) return
      moneyReturned = true
    }
    setBusy(true)
    try {
      const res = await call(action, value.trim(), moneyReturned)
      if (!res.ok) throw new Error(describePayoutRefusal(res))
      toast.success(`${PAYOUT_ACTION_LABELS[action]}: gata`)
      setPending(null)
      setText('')
      await onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Eroare')
    } finally {
      setBusy(false)
    }
  }

  function onAction(action: PayoutAction) {
    if (payoutActionNeedsInput(action)) {
      setPending(action)
      setText('')
      return
    }
    void run(action, '')
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 12px',
        background: D.s3,
        borderRadius: 10,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 600, overflowWrap: 'anywhere' }}>
          {payeeLabel} · {formatMoney(p.gross_cents, p.currency)}
          {p.period_month ? ` · ${p.period_month.slice(0, 7)}` : ''}
        </div>
        <div style={{ fontSize: '0.72rem', color: D.t3, overflowWrap: 'anywhere' }}>
          {STATUS_LABELS[p.status] ?? p.status}
          {p.invoice_number ? ` · factura ${p.invoice_number}` : ''}
          {p.payment_method ? ` · ${PAYMENT_METHOD_LABELS[p.payment_method]}` : ''}
          {p.payment_reference ? ` · ref. ${p.payment_reference}` : ''}
          {p.paid_at ? ` · plătit ${new Date(p.paid_at).toLocaleDateString('ro-RO')}` : ''}
          {p.failure_reason ? ` · ${p.failure_reason}` : ''}
        </div>
        {/* Profilul de plată: DOAR fondatorul îl primește (gate-ul RPC-ului). */}
        <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 4, overflowWrap: 'anywhere' }}>
          {p.payee_iban ? (
            <>
              {p.payee_name || 'Beneficiar necompletat'}
              {p.payee_legal_form ? ` · ${LEGAL_FORM_LABELS[p.payee_legal_form] ?? p.payee_legal_form}` : ''}
              {p.payee_cui ? ` · CUI ${p.payee_cui}` : ''}
              {' · IBAN '}
              <span style={{ fontFamily: 'monospace', color: D.t1 }}>{formatIban(p.payee_iban)}</span>
            </>
          ) : (
            <span style={{ color: D.amber }}>Afiliatul nu și-a completat datele de plată (IBAN).</span>
          )}
        </div>
      </div>

      {pending ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pending === 'start_transfer' && (
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PayoutPaymentMethod)}
              style={inputStyle}
              aria-label="Metoda de plată"
            >
              {(Object.keys(PAYMENT_METHOD_LABELS) as PayoutPaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          )}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={INPUT_LABELS[pending] ?? ''}
            aria-label={INPUT_LABELS[pending] ?? PAYOUT_ACTION_LABELS[pending]}
            style={inputStyle}
            maxLength={200}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => void run(pending, text)}
              disabled={busy || text.trim() === ''}
              className="pressable"
              style={busyStyle(pending === 'cancel' || pending === 'mark_failed' ? { ...primaryBtn, background: D.red, color: '#fff' } : primaryBtn, busy || text.trim() === '')}
            >
              {busy ? 'Se salvează...' : PAYOUT_ACTION_LABELS[pending]}
            </button>
            <button onClick={() => setPending(null)} disabled={busy} className="pressable" style={ghostBtn}>
              Renunță
            </button>
          </div>
        </div>
      ) : (
        actions.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {actions.map((a, i) => (
              <button
                key={a}
                onClick={() => onAction(a)}
                disabled={busy}
                className="pressable"
                style={busyStyle(i === 0 ? primaryBtn : ghostBtn, busy)}
              >
                {busy && i === 0 ? 'Se salvează...' : PAYOUT_ACTION_LABELS[a]}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  )
}

// Rularea MANUALĂ a batch-ului lunar (admin_run_payout_batch): cât timp
// Netlify e mort (issue #250) e singura cale prin care se creează ciorne.
// Idempotent pe (afiliat, lună, monedă); lacătul din batch refuză o rulare
// concurentă cu cron-ul.
export function RunPayoutBatchButton({ onDone }: { onDone: () => Promise<void> }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function run() {
    const period = currentPayoutPeriod(new Date())
    const ok = await confirm({
      title: `Rulezi batch-ul de plăți pentru ${period.slice(0, 7)}?`,
      description:
        'Creează ciorne din comisioanele trecute de perioada de reținere. Nu mișcă bani; o a doua rulare pe aceeași lună nu dublează nimic.',
      confirmLabel: 'Rulează batch-ul',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await runPayoutBatch(period)
      const failed = Array.isArray(res.errors) ? res.errors.length : 0
      if (!res.ok && failed === 0) throw new Error(describePayoutRefusal(res))
      if (failed > 0) {
        toast.error(`${failed} afiliat(i) săriți din cauza unei erori — vezi logurile, apoi rulează din nou.`)
      } else {
        toast.success(`Batch rulat: ${res.created ?? 0} ciorne noi.`)
      }
      await onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Eroare')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button onClick={() => void run()} disabled={busy} className="pressable" style={busyStyle(ghostBtn, busy)}>
      {busy ? 'Se rulează...' : 'Rulează batch-ul lunii'}
    </button>
  )
}
