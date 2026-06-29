// FounderAiPanel — dashboard fondator pentru consum AI (Faza E)
// Vizibil DOAR pentru platform admin (is_platform_admin = georgeradu119@…).
// Arată consumul AI per restaurant pe 30 de zile + cota inclusă + creditele,
// și permite setarea limitei lunare incluse per restaurant (admin_set_ai_limit).
import { useState, useEffect, useCallback } from 'react'
import { D } from '../lib/constants'
import { useIsMobile } from '../hooks/useIsMobile'
import { getAdminAiOverview, setAiLimit, type AiOverviewRow } from '../lib/ai'

export default function FounderAiPanel() {
  const isMobile = useIsMobile()
  const [rows, setRows] = useState<AiOverviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftLimit, setDraftLimit] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await getAdminAiOverview())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcare.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function saveLimit(restaurantId: string) {
    const n = parseInt(draftLimit, 10)
    if (!isFinite(n) || n < 0) {
      setError('Limita trebuie să fie un număr pozitiv.')
      return
    }
    if (n > 1_000_000_000) {
      setError('Limita e prea mare (max 1 miliard de tokens).')
      return
    }
    setSavingId(restaurantId)
    setError(null)
    try {
      await setAiLimit(restaurantId, n)
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la salvare.')
    } finally {
      setSavingId(null)
    }
  }

  const totalTokens30d = rows.reduce((s, r) => s + (r.tokens_30d || 0), 0)
  const totalCost30d = rows.reduce((s, r) => s + Number(r.cost_30d || 0), 0)

  const th = { textAlign: 'left' as const, fontSize: '0.68rem', color: D.t3, textTransform: 'uppercase' as const, letterSpacing: '0.05em', padding: '8px 10px', fontWeight: 700, whiteSpace: 'nowrap' as const }
  const td = { fontSize: '0.85rem', color: D.t1, padding: '10px', borderTop: `1px solid ${D.border}`, whiteSpace: 'nowrap' as const }

  if (loading) return <div style={{ color: D.t2, padding: 20 }}>Se încarcă…</div>

  return (
    <div style={{ maxWidth: 980 }}>
      <h1 style={{ fontFamily: 'Fraunces,serif', fontSize: '1.5rem', fontWeight: 600, color: D.t1, marginBottom: 6 }}>
        Consum AI · Fondator
      </h1>
      <p style={{ color: D.t2, fontSize: '0.9rem', marginBottom: 20 }}>
        Consumul AI pe ultimele 30 de zile, per restaurant. Setează limita lunară inclusă pentru fiecare.
      </p>

      {/* Sumar */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3,1fr)', gap: 12, marginBottom: 22 }}>
        <SummaryCard label="Restaurante" value={String(rows.length)} />
        <SummaryCard label="Tokens (30 zile)" value={totalTokens30d.toLocaleString('ro-RO')} />
        <SummaryCard label="Cost estimat (30 zile)" value={`$${totalCost30d.toFixed(2)}`} />
      </div>

      {error && (
        <div style={{ background: D.redA, border: `1px solid ${D.red}44`, color: D.red, borderRadius: 9, padding: '10px 13px', fontSize: '0.84rem', marginBottom: 14 }}>{error}</div>
      )}

      {/* Tabel */}
      <div style={{ background: D.s2, border: `1px solid ${D.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr style={{ background: D.s3 }}>
                <th style={th}>Restaurant</th>
                <th style={th}>Tokens 30z</th>
                <th style={th}>Cost 30z</th>
                <th style={th}>Inclus / lună</th>
                <th style={th}>Folosit</th>
                <th style={th}>Credite</th>
                <th style={th}>Acțiune</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td style={td} colSpan={7}>Niciun restaurant.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.restaurant_id}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.restaurant_name}</td>
                  <td style={td}>{(r.tokens_30d || 0).toLocaleString('ro-RO')}</td>
                  <td style={td}>${Number(r.cost_30d || 0).toFixed(2)}</td>
                  <td style={td}>
                    {editing === r.restaurant_id ? (
                      <input
                        autoFocus
                        type="number"
                        value={draftLimit}
                        onChange={(e) => setDraftLimit(e.target.value)}
                        style={{ width: 100, background: D.s3, border: `1px solid ${D.gold}55`, borderRadius: 6, color: D.t1, padding: '5px 7px', fontSize: '0.82rem' }}
                      />
                    ) : (
                      (r.included_tokens ?? 50000).toLocaleString('ro-RO')
                    )}
                  </td>
                  <td style={td}>{(r.used_tokens ?? 0).toLocaleString('ro-RO')}</td>
                  <td style={td}>{(r.credit_balance ?? 0).toLocaleString('ro-RO')}</td>
                  <td style={td}>
                    {editing === r.restaurant_id ? (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => void saveLimit(r.restaurant_id)} disabled={savingId === r.restaurant_id} style={{ background: D.green, color: '#000', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer' }}>
                          {savingId === r.restaurant_id ? '…' : 'Salvează'}
                        </button>
                        <button onClick={() => setEditing(null)} style={{ background: 'transparent', color: D.t3, border: `1px solid ${D.border}`, borderRadius: 6, padding: '5px 10px', fontSize: '0.76rem', cursor: 'pointer' }}>
                          Anulează
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => { setEditing(r.restaurant_id); setDraftLimit(String(r.included_tokens ?? 50000)) }}
                        className="pressable"
                        style={{ background: 'transparent', color: D.gold, border: `1px solid ${D.gold}55`, borderRadius: 6, padding: '5px 12px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer' }}
                      >
                        Setează limită
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: D.s2, border: `1px solid ${D.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: '0.68rem', color: D.t3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'Fraunces,serif', fontSize: '1.5rem', color: D.t1, fontWeight: 600 }}>{value}</div>
    </div>
  )
}
