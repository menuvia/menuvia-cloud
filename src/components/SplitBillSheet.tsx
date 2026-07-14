// SplitBillSheet — „Împarte nota": clientul își alege produsele LUI din nota
// mesei și plătește doar partea lui (mig 229). Lazy-loaded din QrMenuPage.
// Suma afișată aici e o ESTIMARE client-side (proporțională cu discountul);
// suma finală o calculează EXCLUSIV serverul (begin_split_payment) și apare
// în PayTableSheet înainte de confirmare.
import { useCallback, useEffect, useState, lazy, Suspense } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import {
  fetchTableBill,
  type SplitClaimInput,
  type TableBill,
} from '../lib/payments'
import { fmtPrice, resolveMenuCurrency, type MenuCurrency } from '../lib/currency'

const PayTableSheet = lazy(() => import('./PayTableSheet'))

interface PUBColors {
  bg: string
  surface: string
  text: string
  text2: string
  text3: string
  border: string
  borderStrong: string
}

interface Props {
  token: string
  sessionId: string
  PUB: PUBColors
  accent: string
  onClose: () => void
  /** Chemat DOAR după o plată split confirmată (parțială sau completă). */
  onPaid: () => void
}

const HINT_COPY: Record<string, string> = {
  module_disabled: 'Plata online nu este activată la acest local. Cere nota ospătarului.',
  feature_disabled: 'Împărțirea notei nu este disponibilă la acest local.',
  invalid_session: 'Sesiunea mesei a expirat. Scanează din nou codul QR.',
  invalid_token: 'Cod QR invalid pentru această masă.',
}

export default function SplitBillSheet({ token, sessionId, PUB, accent, onClose, onPaid }: Props) {
  const [bill, setBill] = useState<TableBill | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // order_item_id → cantitatea aleasă de ACEST client.
  const [selection, setSelection] = useState<Record<string, number>>({})
  const [claims, setClaims] = useState<readonly SplitClaimInput[] | null>(null)
  const [paid, setPaid] = useState(false)

  useBodyScrollLock(true)

  const load = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const b = await fetchTableBill(token, sessionId)
      setBill(b)
      // Curățăm selecțiile care nu mai încap (altcineva a revendicat între timp).
      setSelection((prev) => {
        const next: Record<string, number> = {}
        for (const o of b.orders) {
          for (const it of o.items) {
            const want = prev[it.id] ?? 0
            if (want > 0 && !o.locked) next[it.id] = Math.min(want, it.remaining_qty)
          }
        }
        return next
      })
    } catch (e) {
      const hint = (e as Error & { hint?: string }).hint
      setErrorMsg(
        (hint && HINT_COPY[hint]) ||
          (e instanceof Error ? e.message : 'Nota nu a putut fi încărcată.'),
      )
    } finally {
      setLoading(false)
    }
  }, [token, sessionId])

  useEffect(() => {
    void load()
  }, [load])

  const currency: MenuCurrency = resolveMenuCurrency(bill?.currency ?? 'RON')

  // Estimarea client-side: proporțional cu discountul comenzii. DOAR pentru
  // afișare — nu replica math-ul serverului ca sursă de adevăr.
  let estimate = 0
  let selectedUnits = 0
  if (bill) {
    for (const o of bill.orders) {
      if (o.locked || o.subtotal <= 0) continue
      for (const it of o.items) {
        const q = selection[it.id] ?? 0
        if (q > 0 && it.quantity > 0) {
          estimate += Math.round(((it.item_total * q) / it.quantity) * (o.total / o.subtotal) * 100) / 100
          selectedUnits += q
        }
      }
    }
  }

  function setQty(itemId: string, qty: number, max: number): void {
    setSelection((prev) => {
      const next = { ...prev }
      const clamped = Math.max(0, Math.min(max, qty))
      if (clamped === 0) delete next[itemId]
      else next[itemId] = clamped
      return next
    })
  }

  function startPayment(): void {
    const list: SplitClaimInput[] = []
    for (const id of Object.keys(selection)) {
      const qty = selection[id]
      if (typeof qty === 'number' && qty > 0) list.push({ order_item_id: id, quantity: qty })
    }
    if (list.length === 0) return
    setClaims(list)
  }

  // PayTableSheet s-a închis: dacă plata a reușit, închidem tot; altfel
  // reîmprospătăm nota (claims-urile eliberate / conflicte apărute între timp).
  function handlePayClose(): void {
    setClaims(null)
    if (paid) {
      onClose()
    } else {
      void load()
    }
  }

  return (
    <div
      onClick={claims ? undefined : onClose}
      className="animate-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,18,8,0.45)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 118,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: PUB.bg,
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          maxHeight: '88vh',
          overflowY: 'auto',
          padding: '16px 20px calc(20px + env(safe-area-inset-bottom))',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div
          style={{ width: 40, height: 4, borderRadius: 2, background: PUB.border, margin: '0 auto' }}
        />
        <span
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 20,
            fontWeight: 700,
            color: PUB.text,
          }}
        >
          Împarte nota
        </span>
        <div style={{ fontSize: 13, color: PUB.text2, lineHeight: 1.5, marginTop: -8 }}>
          Alege produsele tale — plătești doar partea ta, cu cardul.
        </div>

        {loading && (
          <div
            role="status"
            aria-busy="true"
            style={{ color: PUB.text2, fontSize: 14, padding: '24px 0', textAlign: 'center' }}
          >
            Se încarcă nota mesei…
          </div>
        )}

        {errorMsg && !loading && (
          <div
            style={{
              background: 'rgba(192,57,43,0.08)',
              border: '1px solid rgba(192,57,43,0.25)',
              borderRadius: 12,
              padding: '14px 16px',
              color: '#c0392b',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {errorMsg}
          </div>
        )}

        {!loading && !errorMsg && bill && bill.orders.length === 0 && (
          <div style={{ color: PUB.text2, fontSize: 14, padding: '18px 0', textAlign: 'center' }}>
            Nu există comenzi de plătit — probabil nota a fost deja încasată.
          </div>
        )}

        {!loading &&
          bill?.orders.map((o) => (
            <div
              key={o.id}
              style={{
                background: PUB.surface,
                border: `1px solid ${PUB.border}`,
                borderRadius: 14,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  color: PUB.text3,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                <span>Comanda #{o.short_id}</span>
                <span>{fmtPrice(o.total, currency)}</span>
              </div>
              {o.locked && (
                <div style={{ fontSize: 12.5, color: PUB.text2, lineHeight: 1.45 }}>
                  Această comandă se încheie la ospătar (are o plată parțială în desfășurare).
                </div>
              )}
              {o.items.map((it) => {
                const q = selection[it.id] ?? 0
                const selectable = !o.locked && it.remaining_qty > 0
                return (
                  <div
                    key={it.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      opacity: selectable ? 1 : 0.5,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14.5,
                          color: PUB.text,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {it.name}
                      </div>
                      <div style={{ fontSize: 12, color: PUB.text3 }}>
                        {it.quantity} × {fmtPrice(it.item_total / Math.max(1, it.quantity), currency)}
                        {it.claimed_qty > 0 && ` · ${it.claimed_qty} deja în plată`}
                      </div>
                    </div>
                    {selectable ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => setQty(it.id, q - 1, it.remaining_qty)}
                          disabled={q === 0}
                          aria-label={`Scade cantitatea pentru ${it.name}`}
                          className={q === 0 ? '' : 'pressable'}
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            border: `1px solid ${PUB.borderStrong}`,
                            background: 'transparent',
                            color: q === 0 ? PUB.text3 : PUB.text,
                            fontSize: 18,
                            cursor: q === 0 ? 'default' : 'pointer',
                          }}
                        >
                          −
                        </button>
                        <span
                          style={{
                            minWidth: 20,
                            textAlign: 'center',
                            fontSize: 15,
                            fontWeight: 700,
                            color: q > 0 ? accent : PUB.text2,
                          }}
                        >
                          {q}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQty(it.id, q + 1, it.remaining_qty)}
                          disabled={q >= it.remaining_qty}
                          aria-label={`Crește cantitatea pentru ${it.name}`}
                          className={q >= it.remaining_qty ? '' : 'pressable'}
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            border: `1px solid ${PUB.borderStrong}`,
                            background: 'transparent',
                            color: q >= it.remaining_qty ? PUB.text3 : PUB.text,
                            fontSize: 18,
                            cursor: q >= it.remaining_qty ? 'default' : 'pointer',
                          }}
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      !o.locked && (
                        <span style={{ fontSize: 12, color: PUB.text3 }}>în plată ✓</span>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          ))}

        {!loading && selectedUnits > 0 && (
          <div style={{ fontSize: 12, color: PUB.text3, textAlign: 'center' }}>
            Estimare: {fmtPrice(estimate, currency)} — suma finală o confirmă serverul înainte de
            plată.
          </div>
        )}

        <button
          type="button"
          disabled={selectedUnits === 0 || loading}
          onClick={startPayment}
          className={selectedUnits > 0 && !loading ? 'pressable' : ''}
          style={{
            background: selectedUnits > 0 && !loading ? accent : PUB.surface,
            color: selectedUnits > 0 && !loading ? '#fff' : PUB.text3,
            border: 'none',
            borderRadius: 16,
            padding: '15px 0',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 16,
            fontWeight: 700,
            cursor: selectedUnits > 0 && !loading ? 'pointer' : 'not-allowed',
          }}
        >
          {selectedUnits > 0
            ? `Continuă la plată · ~${fmtPrice(estimate, currency)}`
            : 'Alege produsele tale'}
        </button>

        <button
          type="button"
          onClick={onClose}
          className="pressable"
          style={{
            background: 'transparent',
            color: PUB.text2,
            border: `1px solid ${PUB.borderStrong}`,
            borderRadius: 16,
            padding: '13px 0',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            minHeight: 44,
          }}
        >
          Înapoi
        </button>

        {claims && (
          <Suspense fallback={null}>
            <PayTableSheet
              token={token}
              sessionId={sessionId}
              PUB={PUB}
              accent={accent}
              claims={claims}
              onClose={handlePayClose}
              onPaid={() => {
                setPaid(true)
                onPaid()
              }}
              onPayOtherwise={handlePayClose}
            />
          </Suspense>
        )}
      </div>
    </div>
  )
}
