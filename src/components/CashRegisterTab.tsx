// ─────────────────────────────────────────────────────────────
// CashRegisterTab — Tab Casă & Tură în Dashboard
//
// Funcționalitate:
//   • Status tură curentă (deschisă/închisă)
//   • Deschidere tură cu fond inițial
//   • Adăugare mișcări cash (depunere, retragere, cheltuială etc.)
//   • Închidere tură cu numărare cash + diferență față de așteptat
//   • La închidere: trimitere automată Raport Z la casa de marcat
//   • Istoric ture recente
//
// Permisiune: admin/manager only (RPC-urile blochează waiter).
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react'
import { D } from '../lib/constants'
import {
  getCurrentShift,
  openShift,
  closeShift,
  addCashMovement,
  getShiftSummary,
  listRecentShifts,
  MOVEMENT_LABELS,
  type CurrentShift,
  type RecentShift,
  type ShiftSummary,
  type CashMovementType,
} from '../lib/cashShifts'
import { InlineSpinner } from './PageLoader'

interface Props {
  restaurantId: string
}

// ── Style tokens ──────────────────────────────────────────────
const card: React.CSSProperties = {
  background: D.s1,
  border: `1px solid ${D.border}`,
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
}
const h2: React.CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 600,
  color: D.t1,
  margin: '0 0 14px',
  fontFamily: 'Fraunces,serif',
}
const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '10px 12px',
  fontSize: '0.92rem',
  color: D.t1,
  outline: 'none',
  height: 42,
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}
const lbl: React.CSSProperties = {
  fontSize: '0.74rem',
  color: D.t2,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 6,
  fontWeight: 500,
}
const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 16px',
  height: 40,
  borderRadius: 9,
  fontSize: '0.88rem',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
  ...extra,
})

function ron(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toFixed(2).replace('.', ',') + ' lei'
}
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h >= 24) return Math.floor(h / 24) + 'z ' + (h % 24) + 'h'
  if (h > 0) return h + 'h ' + m + 'min'
  if (m > 0) return m + ' min'
  return 'acum'
}

// ── Main ──────────────────────────────────────────────────────
export default function CashRegisterTab({ restaurantId }: Props) {
  const [current, setCurrent] = useState<CurrentShift | null>(null)
  const [recent, setRecent] = useState<RecentShift[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [showOpen, setShowOpen] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [showMovement, setShowMovement] = useState(false)
  const [historySummaryId, setHistorySummaryId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [cur, hist] = await Promise.all([
        getCurrentShift(restaurantId),
        listRecentShifts(restaurantId, 30),
      ])
      setCurrent(cur)
      setRecent(hist)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare la încărcare')
    } finally {
      setLoading(false)
    }
  }, [restaurantId])

  useEffect(() => {
    void load()
  }, [load])

  // Auto-refresh la 20s pentru live cash_collected updates
  useEffect(() => {
    const t = setInterval(() => {
      void load()
    }, 20_000)
    return () => clearInterval(t)
  }, [load])

  if (loading && current == null && recent.length === 0) {
    return <InlineSpinner label="Se încarcă casa..." />
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h1
          style={{
            fontSize: '1.4rem',
            fontWeight: 600,
            color: D.t1,
            margin: 0,
            fontFamily: 'Fraunces,serif',
          }}
        >
          💰 Încasări
        </h1>
        <div style={{ fontSize: '0.82rem', color: D.t2, marginTop: 4 }}>
          Gestiune fond casă, depuneri/retrageri și închidere zi cu Raport Z automat.
        </div>
      </div>

      {err && (
        <div style={{ ...card, borderColor: D.red, background: D.redA, color: D.red }}>
          {err}
          <button
            onClick={() => setErr(null)}
            style={{
              float: 'right',
              background: 'transparent',
              border: 'none',
              color: D.red,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Current shift block */}
      {current == null ? (
        <NoShiftCard onOpen={() => setShowOpen(true)} />
      ) : (
        <CurrentShiftCard
          shift={current}
          onAddMovement={() => setShowMovement(true)}
          onClose={() => setShowClose(true)}
          onRefresh={() => void load()}
        />
      )}

      {/* History */}
      <div style={card}>
        <h2 style={h2}>Istoric ture</h2>
        {recent.length === 0 ? (
          <div style={{ color: D.t2, fontSize: '0.88rem', padding: '12px 0' }}>
            Nicio tură înregistrată încă.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${D.border}`, color: D.t2 }}>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.74rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    Deschisă
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.74rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    Închisă
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.74rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    Fond
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.74rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    Comenzi
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.74rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    Așteptat
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.74rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    Numărat
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.74rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    Δ
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${D.border}` }}>
                    <td style={{ padding: '10px 8px', color: D.t1 }}>
                      {new Date(s.opened_at).toLocaleString('ro-RO', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td
                      style={{ padding: '10px 8px', color: s.status === 'open' ? D.green : D.t2 }}
                    >
                      {s.status === 'open'
                        ? '● activă'
                        : new Date(s.closed_at!).toLocaleString('ro-RO', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', color: D.t2 }}>
                      {ron(s.initial_float)}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', color: D.t1 }}>
                      {s.order_count}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', color: D.t1 }}>
                      {ron(s.expected_cash)}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', color: D.t1 }}>
                      {ron(s.counted_cash)}
                    </td>
                    <td
                      style={{
                        padding: '10px 8px',
                        textAlign: 'right',
                        color:
                          s.cash_diff == null
                            ? D.t3
                            : Math.abs(s.cash_diff) < 0.01
                              ? D.green
                              : s.cash_diff < 0
                                ? D.red
                                : D.amber,
                        fontWeight: 600,
                      }}
                    >
                      {s.cash_diff == null
                        ? '—'
                        : (s.cash_diff > 0 ? '+' : '') + ron(s.cash_diff).replace(' lei', '')}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                      <button
                        onClick={() => setHistorySummaryId(s.id)}
                        style={btn({
                          background: 'transparent',
                          color: D.t2,
                          border: `1px solid ${D.border}`,
                          height: 30,
                          fontSize: '0.78rem',
                          padding: '0 10px',
                        })}
                      >
                        Detalii
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showOpen && (
        <OpenShiftModal
          restaurantId={restaurantId}
          onClose={() => setShowOpen(false)}
          onDone={() => {
            setShowOpen(false)
            void load()
          }}
        />
      )}

      {showMovement && current && (
        <MovementModal
          restaurantId={restaurantId}
          onClose={() => setShowMovement(false)}
          onDone={() => {
            setShowMovement(false)
            void load()
          }}
        />
      )}

      {showClose && current && (
        <CloseShiftModal
          shift={current}
          onClose={() => setShowClose(false)}
          onDone={() => {
            setShowClose(false)
            void load()
          }}
        />
      )}

      {historySummaryId && (
        <SummaryDetailModal shiftId={historySummaryId} onClose={() => setHistorySummaryId(null)} />
      )}
    </div>
  )
}

// ── No-shift state ────────────────────────────────────────────
function NoShiftCard({ onOpen }: { onOpen: () => void }) {
  return (
    <div style={{ ...card, textAlign: 'center', padding: '32px 20px' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🌅</div>
      <h2 style={{ ...h2, marginBottom: 6 }}>Nicio tură deschisă</h2>
      <div
        style={{
          fontSize: '0.88rem',
          color: D.t2,
          marginBottom: 18,
          maxWidth: 480,
          margin: '0 auto 18px',
        }}
      >
        Deschide tura de azi pentru a începe să încasezi. Vei declara fondul inițial din sertar
        (mărunțișul cu care începi).
      </div>
      <button
        onClick={onOpen}
        style={btn({ background: D.gold, color: '#0a0a0a', height: 44, padding: '0 24px' })}
      >
        🔓 Deschide tură
      </button>
    </div>
  )
}

// ── Current shift display ─────────────────────────────────────
function CurrentShiftCard({
  shift,
  onAddMovement,
  onClose,
}: {
  shift: CurrentShift
  onAddMovement: () => void
  onClose: () => void
  onRefresh: () => void
}) {
  return (
    <div style={{ ...card, borderColor: D.gold, background: 'rgba(212,165,116,0.04)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 10px',
              background: D.greenA,
              border: `1px solid ${D.green}`,
              borderRadius: 6,
              fontSize: '0.78rem',
              color: D.green,
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            ● TURĂ ACTIVĂ
          </div>
          <h2 style={{ ...h2, margin: 0 }}>Deschisă acum {relTime(shift.opened_at)}</h2>
          <div style={{ fontSize: '0.82rem', color: D.t2, marginTop: 4 }}>
            {new Date(shift.opened_at).toLocaleString('ro-RO')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onAddMovement}
            style={btn({ background: D.s2, color: D.t1, border: `1px solid ${D.border}` })}
          >
            💵 Mișcare cash
          </button>
          <button onClick={onClose} style={btn({ background: D.gold, color: '#0a0a0a' })}>
            🔒 Închide tură
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))',
          gap: 12,
        }}
      >
        <Metric label="Fond inițial" value={ron(shift.initial_float)} color={D.t2} />
        <Metric label="Cash încasat" value={ron(shift.cash_collected)} color={D.green} />
        <Metric
          label="Mișcări"
          value={`${shift.movement_count} (${ron(shift.cash_movements_total)})`}
          color={shift.cash_movements_total < 0 ? D.red : D.t1}
        />
        <Metric label="Așteptat în casă" value={ron(shift.cash_expected)} color={D.gold} big />
        <Metric label="Comenzi" value={String(shift.order_count)} color={D.t1} />
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  color,
  big,
}: {
  label: string
  value: string
  color: string
  big?: boolean
}) {
  return (
    <div
      style={{ background: D.s2, border: `1px solid ${D.border}`, borderRadius: 10, padding: 14 }}
    >
      <div
        style={{
          fontSize: '0.72rem',
          color: D.t2,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: big ? '1.4rem' : '1.05rem',
          fontWeight: big ? 700 : 500,
          color,
          fontFamily: big ? 'Fraunces,serif' : 'DM Sans,sans-serif',
        }}
      >
        {value}
      </div>
    </div>
  )
}

// ── Open shift modal ──────────────────────────────────────────
function OpenShiftModal({
  restaurantId,
  onClose,
  onDone,
}: {
  restaurantId: string
  onClose: () => void
  onDone: () => void
}) {
  const [amount, setAmount] = useState('100')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function go() {
    const n = Number(amount.replace(',', '.'))
    if (isNaN(n) || n < 0) {
      setErr('Valoare invalidă')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await openShift(restaurantId, n, notes.trim() || null)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare la deschidere')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} title="Deschidere tură">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={lbl}>Fond inițial în sertar (lei)</div>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={10}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={inp}
            autoFocus
          />
          <div style={{ fontSize: '0.76rem', color: D.t3, marginTop: 4 }}>
            Numerarul cu care începi (mărunțiș pentru rest, fond de bază).
          </div>
        </div>
        <div>
          <div style={lbl}>Notă (opțional)</div>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={inp}
            placeholder="ex: tura matinală Andrei"
            maxLength={200}
          />
        </div>
        {err && (
          <div
            style={{
              color: D.red,
              background: D.redA,
              padding: 10,
              borderRadius: 8,
              fontSize: '0.86rem',
            }}
          >
            {err}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={btn({ background: D.s2, color: D.t2, border: `1px solid ${D.border}` })}
          >
            Anulează
          </button>
          <button
            onClick={go}
            disabled={busy}
            style={btn({ background: D.gold, color: '#0a0a0a', opacity: busy ? 0.6 : 1 })}
          >
            {busy ? 'Se deschide...' : 'Deschide tură'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Movement modal ────────────────────────────────────────────
function MovementModal({
  restaurantId,
  onClose,
  onDone,
}: {
  restaurantId: string
  onClose: () => void
  onDone: () => void
}) {
  const [type, setType] = useState<CashMovementType>('deposit')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [sendFiscal, setSendFiscal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Corecția de numărare poate fi în plus SAU în minus (sertar mai gol/mai plin
  // decât așteptat). Pentru ea lăsăm utilizatorul să aleagă semnul.
  const [correctionPositive, setCorrectionPositive] = useState(true)

  const meta = MOVEMENT_LABELS[type]
  const isCorrection = type === 'correction'

  async function go() {
    const n = Number(amount.replace(',', '.'))
    if (isNaN(n) || n <= 0) {
      setErr('Suma trebuie să fie pozitivă')
      return
    }
    if (!reason.trim()) {
      setErr('Motivul e obligatoriu')
      return
    }
    const finalAmount = isCorrection ? (correctionPositive ? n : -n) : meta.isPositive ? n : -n
    setBusy(true)
    setErr(null)
    try {
      await addCashMovement(restaurantId, finalAmount, type, reason.trim(), sendFiscal)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} title="Mișcare cash în sertar">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={lbl}>Tip mișcare</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6 }}>
            {(
              Object.entries(MOVEMENT_LABELS) as [
                CashMovementType,
                (typeof MOVEMENT_LABELS)[CashMovementType],
              ][]
            ).map(([k, v]) => (
              <button
                key={k}
                onClick={() => setType(k)}
                style={btn({
                  background: type === k ? D.goldA : D.s3,
                  color: type === k ? D.goldL : D.t2,
                  border: `1px solid ${type === k ? D.gold : D.border}`,
                  fontSize: '0.8rem',
                  height: 36,
                  padding: '0 10px',
                  justifyContent: 'flex-start',
                })}
              >
                <span>{v.emoji}</span>
                <span>{v.label}</span>
              </button>
            ))}
          </div>
          {isCorrection ? (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[
                { pos: true, label: '+ în plus în sertar' },
                { pos: false, label: '− în minus în sertar' },
              ].map((opt) => (
                <button
                  key={String(opt.pos)}
                  onClick={() => setCorrectionPositive(opt.pos)}
                  style={btn({
                    flex: 1,
                    background: correctionPositive === opt.pos ? D.goldA : D.s3,
                    color:
                      correctionPositive === opt.pos
                        ? opt.pos
                          ? D.green
                          : D.amber
                        : D.t2,
                    border: `1px solid ${correctionPositive === opt.pos ? D.gold : D.border}`,
                    fontSize: '0.78rem',
                    height: 36,
                  })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : (
            <div
              style={{
                fontSize: '0.74rem',
                color: meta.isPositive ? D.green : D.amber,
                marginTop: 6,
              }}
            >
              {meta.isPositive ? '+ adăugat în sertar' : '− scos din sertar'}
            </div>
          )}
        </div>

        <div>
          <div style={lbl}>Sumă (lei)</div>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.5}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={inp}
            placeholder="ex: 50"
            autoFocus
          />
        </div>

        <div>
          <div style={lbl}>Motiv *</div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={inp}
            placeholder="ex: lapte de la magazin, schimb 100 lei"
            maxLength={200}
          />
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '0.86rem',
            color: D.t2,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={sendFiscal}
            onChange={(e) => setSendFiscal(e.target.checked)}
          />
          <span>Înregistrează și pe casa de marcat (I^/O^)</span>
        </label>

        {err && (
          <div
            style={{
              color: D.red,
              background: D.redA,
              padding: 10,
              borderRadius: 8,
              fontSize: '0.86rem',
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={btn({ background: D.s2, color: D.t2, border: `1px solid ${D.border}` })}
          >
            Anulează
          </button>
          <button
            onClick={go}
            disabled={busy}
            style={btn({ background: D.gold, color: '#0a0a0a', opacity: busy ? 0.6 : 1 })}
          >
            {busy ? 'Se salvează...' : 'Înregistrează'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Close shift modal ─────────────────────────────────────────
function CloseShiftModal({
  shift,
  onClose,
  onDone,
}: {
  shift: CurrentShift
  onClose: () => void
  onDone: () => void
}) {
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [sendZ, setSendZ] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<{
    diff: number
    counted: number
    expected: number
    z_sent: boolean
  } | null>(null)

  const countedNum = Number(counted.replace(',', '.'))
  const valid = !isNaN(countedNum) && countedNum >= 0
  const diff = valid ? countedNum - shift.cash_expected : 0

  async function go() {
    if (!valid) {
      setErr('Sumă invalidă')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const result = await closeShift(shift.id, countedNum, notes.trim() || null, sendZ)
      setConfirmation({
        diff: result.cash_diff,
        counted: result.counted_cash,
        expected: result.expected_cash,
        z_sent: result.z_sent,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare')
    } finally {
      setBusy(false)
    }
  }

  if (confirmation) {
    return (
      <Modal
        onClose={() => {
          onClose()
          onDone()
        }}
        title="✓ Tură închisă"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: D.s2, borderRadius: 10, padding: 14 }}>
            <Row label="Așteptat în sertar:" value={ron(confirmation.expected)} />
            <Row label="Numărat real:" value={ron(confirmation.counted)} />
            <div style={{ borderTop: `1px solid ${D.border}`, marginTop: 8, paddingTop: 8 }}>
              <Row
                label="Diferență:"
                value={(confirmation.diff > 0 ? '+' : '') + ron(confirmation.diff)}
                color={
                  Math.abs(confirmation.diff) < 0.01
                    ? D.green
                    : confirmation.diff < 0
                      ? D.red
                      : D.amber
                }
                bold
              />
            </div>
          </div>
          {confirmation.z_sent && (
            <div
              style={{
                background: D.greenA,
                border: `1px solid ${D.green}`,
                borderRadius: 8,
                padding: 10,
                fontSize: '0.86rem',
                color: D.green,
              }}
            >
              ✓ Raport Z trimis la casa de marcat. Verifică tab-ul "Fiscalizare" pentru confirmare.
            </div>
          )}
          <button
            onClick={() => {
              onClose()
              onDone()
            }}
            style={btn({ background: D.gold, color: '#0a0a0a' })}
          >
            OK
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} title="Închidere tură">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: D.s2, borderRadius: 10, padding: 14, fontSize: '0.88rem' }}>
          <Row label="Fond inițial:" value={ron(shift.initial_float)} />
          <Row label="Cash încasat:" value={ron(shift.cash_collected)} color={D.green} />
          <Row
            label="Mișcări manuale:"
            value={ron(shift.cash_movements_total)}
            color={shift.cash_movements_total < 0 ? D.red : D.t2}
          />
          <div style={{ borderTop: `1px solid ${D.border}`, marginTop: 6, paddingTop: 6 }}>
            <Row label="Așteptat în sertar:" value={ron(shift.cash_expected)} color={D.gold} bold />
          </div>
        </div>

        <div>
          <div style={lbl}>Numerar numărat real în sertar (lei) *</div>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.5}
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            style={inp}
            placeholder={`Așteptat: ${ron(shift.cash_expected)}`}
            autoFocus
          />
          {valid && (
            <div
              style={{
                fontSize: '0.78rem',
                marginTop: 4,
                color: Math.abs(diff) < 0.01 ? D.green : diff < 0 ? D.red : D.amber,
              }}
            >
              Diferență: {diff > 0 ? '+' : ''}
              {ron(diff)}
              {Math.abs(diff) < 0.01 && ' ✓ exact'}
              {diff < -0.01 && ' — lipsă'}
              {diff > 0.01 && ' — surplus'}
            </div>
          )}
        </div>

        <div>
          <div style={lbl}>Notă închidere (opțional)</div>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={inp}
            placeholder="ex: am dat 50 lei la livrare, fără chitanță"
            maxLength={500}
          />
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '0.86rem',
            color: D.t2,
            cursor: 'pointer',
            background: D.s2,
            padding: 10,
            borderRadius: 8,
          }}
        >
          <input type="checkbox" checked={sendZ} onChange={(e) => setSendZ(e.target.checked)} />
          <span>📟 Trimite automat Raport Z la casa de marcat</span>
        </label>

        {err && (
          <div
            style={{
              color: D.red,
              background: D.redA,
              padding: 10,
              borderRadius: 8,
              fontSize: '0.86rem',
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={btn({ background: D.s2, color: D.t2, border: `1px solid ${D.border}` })}
          >
            Anulează
          </button>
          <button
            onClick={go}
            disabled={busy || !valid}
            style={btn({
              background: valid ? D.gold : D.s3,
              color: valid ? '#0a0a0a' : D.t3,
              opacity: busy ? 0.6 : 1,
            })}
          >
            {busy ? 'Se închide...' : 'Închide tura'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Summary detail modal (history view) ───────────────────────
function SummaryDetailModal({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const [data, setData] = useState<ShiftSummary | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const s = await getShiftSummary(shiftId)
        if (alive) setData(s)
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Eroare')
      }
    })()
    return () => {
      alive = false
    }
  }, [shiftId])

  return (
    <Modal onClose={onClose} title="Detalii tură" wide>
      {err && (
        <div style={{ color: D.red, padding: 10, background: D.redA, borderRadius: 8 }}>{err}</div>
      )}
      {!data && !err && <InlineSpinner label="Se încarcă..." />}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: '0.88rem' }}>
          <div style={{ fontSize: '0.84rem', color: D.t2 }}>
            <strong>Deschisă:</strong> {new Date(data.opened_at).toLocaleString('ro-RO')}
            {data.closed_at && (
              <>
                {' '}
                · <strong>Închisă:</strong> {new Date(data.closed_at).toLocaleString('ro-RO')}
              </>
            )}
          </div>

          <div style={{ background: D.s2, borderRadius: 10, padding: 14 }}>
            <div style={{ ...h2, fontSize: '0.92rem', marginBottom: 8 }}>Vânzări</div>
            <Row label="Comenzi:" value={String(data.orders.count)} />
            <Row label="Total brut:" value={ron(data.orders.gross_total)} />
            <Row
              label="Total reduceri:"
              value={'− ' + ron(data.orders.discount_total)}
              color={D.green}
            />
            <Row label="Total net:" value={ron(data.orders.net_total)} bold />
          </div>

          <div style={{ background: D.s2, borderRadius: 10, padding: 14 }}>
            <div style={{ ...h2, fontSize: '0.92rem', marginBottom: 8 }}>Plăți pe metodă</div>
            {Object.entries(data.payments_by_method).length === 0 ? (
              <div style={{ color: D.t3 }}>Nicio plată înregistrată.</div>
            ) : (
              Object.entries(data.payments_by_method).map(([m, v]) => (
                <Row
                  key={m}
                  label={m === 'cash' ? '💵 Cash:' : m === 'card_pos' ? '💳 Card:' : '📋 Alte:'}
                  value={ron(v as number)}
                />
              ))
            )}
          </div>

          <div style={{ background: D.s2, borderRadius: 10, padding: 14 }}>
            <div style={{ ...h2, fontSize: '0.92rem', marginBottom: 8 }}>Cash în sertar</div>
            <Row label="Fond inițial:" value={ron(data.initial_float)} />
            <Row label="+ Cash încasat:" value={ron(data.cash_collected)} color={D.green} />
            <Row
              label={`± Mișcări (${data.cash_movements.length}):`}
              value={ron(data.cash_movements_total)}
              color={data.cash_movements_total < 0 ? D.red : D.t2}
            />
            <div style={{ borderTop: `1px solid ${D.border}`, marginTop: 6, paddingTop: 6 }}>
              <Row label="= Așteptat:" value={ron(data.cash_expected)} bold color={D.gold} />
              {data.counted_cash != null && (
                <Row label="Numărat:" value={ron(data.counted_cash)} bold />
              )}
              {data.cash_diff != null && (
                <Row
                  label="Diferență:"
                  value={(data.cash_diff > 0 ? '+' : '') + ron(data.cash_diff)}
                  color={
                    Math.abs(data.cash_diff) < 0.01 ? D.green : data.cash_diff < 0 ? D.red : D.amber
                  }
                  bold
                />
              )}
            </div>
          </div>

          {data.cash_movements.length > 0 && (
            <div style={{ background: D.s2, borderRadius: 10, padding: 14 }}>
              <div style={{ ...h2, fontSize: '0.92rem', marginBottom: 8 }}>
                Mișcări ({data.cash_movements.length})
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {data.cash_movements.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      padding: '6px 0',
                      borderBottom: `1px solid ${D.border}`,
                      fontSize: '0.84rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>
                        {MOVEMENT_LABELS[m.type]?.emoji} {MOVEMENT_LABELS[m.type]?.label || m.type}
                      </span>
                      <span style={{ color: m.amount > 0 ? D.green : D.red, fontWeight: 600 }}>
                        {m.amount > 0 ? '+' : ''}
                        {ron(m.amount)}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.76rem', color: D.t3, marginTop: 2 }}>{m.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

// ── Reusable bits ─────────────────────────────────────────────
function Row({
  label,
  value,
  color,
  bold,
}: {
  label: string
  value: string
  color?: string
  bold?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '3px 0',
        fontSize: bold ? '1rem' : '0.88rem',
      }}
    >
      <span style={{ color: D.t2, fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span style={{ color: color || D.t1, fontWeight: bold ? 700 : 500 }}>{value}</span>
    </div>
  )
}

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: D.s1,
          border: `1px solid ${D.border}`,
          borderRadius: 14,
          padding: 22,
          maxWidth: wide ? 600 : 480,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <h2
            style={{
              fontSize: '1rem',
              fontWeight: 600,
              color: D.t1,
              margin: 0,
              fontFamily: 'Fraunces,serif',
            }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: D.t2,
              cursor: 'pointer',
              fontSize: '1.3rem',
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
