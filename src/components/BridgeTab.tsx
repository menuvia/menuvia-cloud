// ─────────────────────────────────────────────────────────────
// BridgeTab — Management casă de marcat (FiscalNet integration)
//
// Permite:
//   • Înregistrare device bridge (generează device_secret)
//   • Vizualizare status device (online/offline/error + last seen)
//   • Listă bonuri pending/sent/success/error/cancelled cu retry/cancel
//   • Mapare grupe TVA → grupe FiscalNet (1-5)
//
// Bridge-ul local (Node.js + tray icon Windows) folosește device_secret
// ca să se autentifice la RPC-urile bridge_* din migration 030.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { confirm as confirmDialog } from './ui/confirm'
import { InlineSpinner } from './PageLoader'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'

interface BridgeDevice {
  id: string
  restaurant_id: string
  name: string
  device_secret: string
  status: 'online' | 'offline' | 'error'
  last_seen_at: string | null
  last_error: string | null
  fiscalnet_brand: string | null
  fiscalnet_model: string | null
  fiscalnet_license_type: 'pro' | 'plus' | null
  prints_kitchen_receipts: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

interface PendingReceipt {
  id: string
  restaurant_id: string
  order_id: string
  payload: string
  status: 'pending' | 'sent' | 'success' | 'error' | 'cancelled'
  bridge_device_id: string | null
  bon_number: string | null
  error_code: string | null
  error_info: string | null
  retry_count: number
  total_snapshot: number
  created_at: string
  claimed_at: string | null
  completed_at: string | null
}

interface VatRateRow {
  vat_group: number
  rate_percent: number
  label: string
  fiscalnet_group: number
}

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
  fontSize: '0.88rem',
  color: D.t1,
  outline: 'none',
  height: 40,
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}
const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 14px',
  height: 38,
  borderRadius: 9,
  fontSize: '0.85rem',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
  ...extra,
})
const lbl: React.CSSProperties = {
  fontSize: '0.72rem',
  color: D.t2,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 6,
  fontWeight: 500,
}

// ── Status helpers ────────────────────────────────────────────
const DEVICE_STATUS: Record<BridgeDevice['status'], { label: string; color: string; bg: string }> =
  {
    online: { label: '● Online', color: D.green, bg: D.greenA },
    offline: { label: '○ Offline', color: D.t2, bg: D.s3 },
    error: { label: '⚠ Eroare', color: D.red, bg: D.redA },
  }

const RECEIPT_STATUS: Record<
  PendingReceipt['status'],
  { label: string; color: string; bg: string }
> = {
  pending: { label: 'În așteptare', color: D.amber, bg: 'rgba(232,160,32,0.12)' },
  sent: { label: 'Trimis la casă', color: D.goldL, bg: D.goldA },
  success: { label: '✓ Tipărit', color: D.green, bg: D.greenA },
  error: { label: '✗ Eroare', color: D.red, bg: D.redA },
  cancelled: { label: 'Anulat', color: D.t3, bg: D.s2 },
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'niciodată'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'acum'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h`
  return `${Math.floor(diff / 86_400_000)} zile`
}

function ronFmt(n: number): string {
  return n.toFixed(2).replace('.', ',') + ' RON'
}

// ── Main component ────────────────────────────────────────────
export default function BridgeTab({ restaurantId }: Props) {
  const [devices, setDevices] = useState<BridgeDevice[]>([])
  const [receipts, setReceipts] = useState<PendingReceipt[]>([])
  const [vatRates, setVatRates] = useState<VatRateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // Register modal
  const [showRegister, setShowRegister] = useState(false)
  const [regName, setRegName] = useState('Casa de marcat principală')
  const [regBrand, setRegBrand] = useState('datecs')
  const [regModel, setRegModel] = useState('')
  const [regBusy, setRegBusy] = useState(false)
  const [newSecret, setNewSecret] = useState<{ deviceId: string; secret: string } | null>(null)

  // VAT mapping editor
  const [showVatMap, setShowVatMap] = useState(false)
  const [vatEdits, setVatEdits] = useState<Record<number, number>>({})
  const [vatBusy, setVatBusy] = useState(false)

  // Filter
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'error' | 'done'>('active')

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [dRes, rRes, vRes] = await Promise.all([
        supabase
          .from('bridge_devices')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .order('created_at'),
        supabase
          .from('pending_receipts')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('vat_rates')
          .select('vat_group,rate_percent,label,fiscalnet_group')
          .eq('restaurant_id', restaurantId)
          .order('vat_group'),
      ])
      if (dRes.error) throw dRes.error
      if (rRes.error) throw rRes.error
      if (vRes.error) throw vRes.error
      setDevices((dRes.data || []) as BridgeDevice[])
      setReceipts((rRes.data || []) as PendingReceipt[])
      setVatRates((vRes.data || []) as VatRateRow[])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare la încărcare')
    } finally {
      setLoading(false)
    }
  }, [restaurantId])

  useEffect(() => {
    void load()
  }, [load])

  // Auto-refresh la 15s pentru live status
  useEffect(() => {
    const t = setInterval(() => {
      void load()
    }, 15_000)
    return () => clearInterval(t)
  }, [load])

  async function handleRegister() {
    if (!regName.trim()) return
    setRegBusy(true)
    try {
      const { data, error } = await supabase.rpc('bridge_register', {
        p_restaurant_id: restaurantId,
        p_name: regName.trim(),
        p_fiscalnet_brand: regBrand || null,
        p_fiscalnet_model: regModel.trim() || null,
      })
      if (error) throw error
      const row = Array.isArray(data) && data.length ? data[0] : null
      if (row) {
        setNewSecret({ deviceId: row.device_id, secret: row.device_secret })
      }
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare la înregistrare')
    } finally {
      setRegBusy(false)
    }
  }

  async function handleDeleteDevice(id: string) {
    const ok = await confirmDialog({
      title: 'Ștergi acest device?',
      description: 'Bridge-ul instalat nu va mai putea trimite bonuri.',
      confirmLabel: 'Șterge device',
      destructive: true,
    })
    if (!ok) return
    try {
      const { error } = await supabase.from('bridge_devices').delete().eq('id', id)
      if (error) throw error
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare la ștergere')
    }
  }

  async function handleRetry(id: string) {
    try {
      const { error } = await supabase.rpc('bridge_retry_receipt', { p_receipt_id: id })
      if (error) throw error
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare la retrimitere')
    }
  }

  async function handleCancel(id: string) {
    const ok = await confirmDialog({
      title: 'Anulezi acest bon?',
      description: 'Nu va mai fi trimis la casă.',
      confirmLabel: 'Anulează bon',
      destructive: true,
    })
    if (!ok) return
    try {
      const { error } = await supabase.rpc('bridge_cancel_receipt', { p_receipt_id: id })
      if (error) throw error
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare la anulare')
    }
  }

  function openVatMap() {
    const map: Record<number, number> = {}
    vatRates.forEach((v) => {
      map[v.vat_group] = v.fiscalnet_group
    })
    setVatEdits(map)
    setShowVatMap(true)
  }

  async function handleSaveVatMap() {
    setVatBusy(true)
    try {
      for (const [vg, fg] of Object.entries(vatEdits)) {
        const { error } = await supabase
          .from('vat_rates')
          .update({ fiscalnet_group: fg })
          .eq('restaurant_id', restaurantId)
          .eq('vat_group', Number(vg))
        if (error) throw error
      }
      setShowVatMap(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare la salvare mapare TVA')
    } finally {
      setVatBusy(false)
    }
  }

  // Filtered receipts
  const filtered = receipts.filter((r) => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'active') return r.status === 'pending' || r.status === 'sent'
    if (statusFilter === 'error') return r.status === 'error'
    if (statusFilter === 'done') return r.status === 'success' || r.status === 'cancelled'
    return true
  })

  // Stats today
  const today = new Date().toISOString().slice(0, 10)
  const todayReceipts = receipts.filter((r) => r.created_at.startsWith(today))
  const stats = {
    pending: todayReceipts.filter((r) => r.status === 'pending' || r.status === 'sent').length,
    success: todayReceipts.filter((r) => r.status === 'success').length,
    errors: todayReceipts.filter((r) => r.status === 'error').length,
  }

  if (loading && devices.length === 0) {
    return <InlineSpinner label="Se încarcă casa de marcat..." />
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <h1
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              fontSize: '1.4rem',
              fontWeight: 600,
              color: D.t1,
              margin: 0,
              fontFamily: 'Fraunces,serif',
            }}
          >
            <Icon name="receipt" size={24} color={D.gold} />
            Casă de marcat
          </h1>
          <div style={{ fontSize: '0.82rem', color: D.t2, marginTop: 4 }}>
            Integrare FiscalNet (Datecs / Activa / Tremol). Bonurile fiscale se tipăresc automat la
            plată.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={openVatMap}
            style={btn({ background: D.s2, color: D.t1, border: `1px solid ${D.border}` })}
          >
            <Icon name="percent" size={15} />
            Mapare TVA
          </button>
          <button
            onClick={() => setShowRegister(true)}
            style={btn({ background: D.gold, color: '#0a0a0a' })}
          >
            <Icon name="plus" size={15} />
            Înregistrează casă
          </button>
        </div>
      </div>

      {err && (
        <div
          style={{
            ...card,
            borderColor: D.red,
            background: D.redA,
            color: D.red,
            marginBottom: 16,
          }}
        >
          {err}
          <button
            onClick={() => setErr(null)}
            aria-label="Închide eroarea"
            style={{
              float: 'right',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 28,
              minHeight: 28,
              background: 'transparent',
              border: 'none',
              color: D.red,
              cursor: 'pointer',
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {/* Stats today */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <StatCard label="În așteptare azi" value={stats.pending} color={D.amber} />
        <StatCard label="Tipărite azi" value={stats.success} color={D.green} />
        <StatCard label="Eșuate azi" value={stats.errors} color={stats.errors > 0 ? D.red : D.t2} />
      </div>

      {/* Devices */}
      <div style={card}>
        <h2 style={h2}>Case de marcat înregistrate</h2>
        {devices.length === 0 ? (
          <EmptyState
            icon="receipt"
            title="Nu ai înregistrat nicio casă de marcat."
            description="Înregistrează prima casă ca să primești cheia de instalare pentru Bridge-ul Menuvia."
            action={
              <button
                onClick={() => setShowRegister(true)}
                style={btn({ background: D.gold, color: '#0a0a0a' })}
              >
                <Icon name="plus" size={15} />
                Înregistrează casă
              </button>
            }
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {devices.map((d) => {
              const st = DEVICE_STATUS[d.status]
              return (
                <div
                  key={d.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: 14,
                    background: D.s2,
                    borderRadius: 10,
                    border: `1px solid ${D.border}`,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontSize: '0.95rem', color: D.t1, fontWeight: 500 }}>
                      {d.name}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: D.t2, marginTop: 3 }}>
                      {d.fiscalnet_brand ? d.fiscalnet_brand.toUpperCase() : 'Brand nedefinit'}
                      {d.fiscalnet_model ? ` · ${d.fiscalnet_model}` : ''}
                      {' · Ultim semnal '}
                      {relativeTime(d.last_seen_at)}
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'inline-flex',
                      padding: '5px 10px',
                      borderRadius: 6,
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      color: st.color,
                      background: st.bg,
                    }}
                  >
                    {st.label}
                  </div>
                  <button
                    onClick={() => handleDeleteDevice(d.id)}
                    style={btn({
                      background: 'transparent',
                      color: D.red,
                      border: `1px solid ${D.border}`,
                      height: 32,
                      fontSize: '0.78rem',
                    })}
                  >
                    Șterge
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pending receipts */}
      <div style={card}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <h2 style={{ ...h2, margin: 0 }}>Bonuri fiscale</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['active', 'error', 'done', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={btn({
                  background: statusFilter === s ? D.goldA : D.s2,
                  color: statusFilter === s ? D.goldL : D.t2,
                  border: `1px solid ${statusFilter === s ? D.gold : D.border}`,
                  height: 32,
                  fontSize: '0.78rem',
                })}
              >
                {s === 'active'
                  ? 'Active'
                  : s === 'error'
                    ? 'Eșuate'
                    : s === 'done'
                      ? 'Finalizate'
                      : 'Toate'}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div
            style={{ padding: '24px 16px', textAlign: 'center', color: D.t2, fontSize: '0.88rem' }}
          >
            {receipts.length === 0
              ? 'Niciun bon fiscal trimis încă. Când o comandă trece în "plătit" iar casa este conectată, bonul se generează automat.'
              : 'Niciun bon în categoria aleasă.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${D.border}`, color: D.t2 }}>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.76rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Creat
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.76rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Total
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.76rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Status
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.76rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Bon #
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.76rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Detalii
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.76rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Acțiuni
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const st = RECEIPT_STATUS[r.status]
                  return (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${D.border}` }}>
                      <td style={{ padding: '10px 8px', color: D.t2, whiteSpace: 'nowrap' }}>
                        {relativeTime(r.created_at)}
                      </td>
                      <td style={{ padding: '10px 8px', color: D.t1, fontWeight: 500 }}>
                        {ronFmt(r.total_snapshot)}
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: 5,
                            fontSize: '0.76rem',
                            color: st.color,
                            background: st.bg,
                          }}
                        >
                          {st.label}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: '10px 8px',
                          color: D.t2,
                          fontFamily: 'monospace',
                          fontSize: '0.78rem',
                        }}
                      >
                        {r.bon_number || '—'}
                      </td>
                      <td
                        style={{
                          padding: '10px 8px',
                          color: D.t2,
                          fontSize: '0.76rem',
                          maxWidth: 220,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.error_info || (r.retry_count > 0 ? `${r.retry_count} încercări` : '')}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                        {(r.status === 'error' || r.status === 'cancelled') && (
                          <button
                            onClick={() => handleRetry(r.id)}
                            style={btn({
                              background: 'transparent',
                              color: D.goldL,
                              border: `1px solid ${D.border}`,
                              height: 28,
                              fontSize: '0.74rem',
                              padding: '0 10px',
                            })}
                          >
                            Retrimit
                          </button>
                        )}
                        {r.status === 'pending' && (
                          <button
                            onClick={() => handleCancel(r.id)}
                            style={btn({
                              background: 'transparent',
                              color: D.red,
                              border: `1px solid ${D.border}`,
                              height: 28,
                              fontSize: '0.74rem',
                              padding: '0 10px',
                            })}
                          >
                            Anulează
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Register Modal ─── */}
      {showRegister && !newSecret && (
        <Modal onClose={() => setShowRegister(false)} title="Înregistrează casă de marcat">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={lbl}>Nume *</div>
              <input
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                style={inp}
                placeholder="ex: Casa de marcat principală"
              />
            </div>
            <div>
              <div style={lbl}>Brand</div>
              <select value={regBrand} onChange={(e) => setRegBrand(e.target.value)} style={inp}>
                <option value="datecs">Datecs</option>
                <option value="activa">Activa</option>
                <option value="tremol">Tremol</option>
                <option value="custom">Custom Q3X</option>
                <option value="other">Alt brand</option>
              </select>
            </div>
            <div>
              <div style={lbl}>Model (opțional)</div>
              <input
                value={regModel}
                onChange={(e) => setRegModel(e.target.value)}
                style={inp}
                placeholder="ex: DP-25, MP-55"
              />
            </div>
            <div
              style={{
                fontSize: '0.78rem',
                color: D.t2,
                lineHeight: 1.5,
                background: D.s3,
                padding: 12,
                borderRadius: 8,
              }}
            >
              După înregistrare vei primi o cheie unică (device_secret). O folosești o singură dată
              la instalarea Bridge-ului pe PC-ul cu FiscalNet. Cheia poate fi recuperată mai târziu
              doar prin re-înregistrare.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
              <button
                onClick={() => setShowRegister(false)}
                style={btn({ background: D.s2, color: D.t2, border: `1px solid ${D.border}` })}
              >
                Anulează
              </button>
              <button
                onClick={handleRegister}
                disabled={regBusy || !regName.trim()}
                style={btn({ background: D.gold, color: '#0a0a0a', opacity: regBusy ? 0.6 : 1 })}
              >
                {regBusy ? 'Se înregistrează...' : 'Înregistrează'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── New Secret Display ─── */}
      {newSecret && (
        <Modal
          onClose={() => {
            setNewSecret(null)
            setShowRegister(false)
            setRegName('Casa de marcat principală')
            setRegModel('')
          }}
          title="Casă înregistrată"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: '0.88rem', color: D.t1, lineHeight: 1.55 }}>
              Cheia de instalare pentru Bridge:
            </div>
            <div
              style={{
                background: D.s3,
                padding: 14,
                borderRadius: 9,
                border: `1px solid ${D.gold}`,
                fontFamily: 'monospace',
                fontSize: '0.82rem',
                color: D.goldL,
                wordBreak: 'break-all',
              }}
            >
              {newSecret.secret}
            </div>
            <button
              onClick={() =>
                navigator.clipboard?.writeText(newSecret.secret).catch(() => undefined)
              }
              style={btn({ background: D.s2, color: D.t1, border: `1px solid ${D.border}` })}
            >
              <Icon name="copy" size={15} />
              Copiază cheia
            </button>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: '0.78rem',
                color: D.amber,
                background: 'rgba(232,160,32,0.08)',
                padding: 12,
                borderRadius: 8,
                lineHeight: 1.5,
              }}
            >
              <span style={{ flexShrink: 0, marginTop: 1 }}>
                <Icon name="alert" size={15} />
              </span>
              <span>
                Salvează cheia acum. După închiderea acestei ferestre nu mai poate fi recuperată.
                Dacă o pierzi, șterge device-ul și înregistrează unul nou.
              </span>
            </div>
            <button
              onClick={() => {
                setNewSecret(null)
                setShowRegister(false)
                setRegName('Casa de marcat principală')
                setRegModel('')
              }}
              style={btn({ background: D.gold, color: '#0a0a0a', alignSelf: 'flex-end' })}
            >
              Am salvat cheia
            </button>
          </div>
        </Modal>
      )}

      {/* ── VAT Mapping Modal ─── */}
      {showVatMap && (
        <Modal onClose={() => setShowVatMap(false)} title="Mapare grupe TVA → FiscalNet">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: '0.82rem', color: D.t2, lineHeight: 1.55 }}>
              La fiscalizare, instalatorul setează grupele TVA pe casă (1-5). Asigură-te că maparea
              de mai jos corespunde cu setarea reală a casei tale — altfel bonurile vor ieși cu TVA
              greșit.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {vatRates.map((v) => (
                <div
                  key={v.vat_group}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 10,
                    background: D.s2,
                    borderRadius: 8,
                    border: `1px solid ${D.border}`,
                  }}
                >
                  <div style={{ flex: 1, fontSize: '0.85rem', color: D.t1 }}>
                    <div>
                      Grupa {v.vat_group} · <span style={{ color: D.goldL }}>{v.label}</span>
                    </div>
                    <div style={{ fontSize: '0.74rem', color: D.t2 }}>{v.rate_percent}% TVA</div>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: D.t3 }}>→ FiscalNet</div>
                  <select
                    value={vatEdits[v.vat_group] ?? v.fiscalnet_group}
                    onChange={(e) =>
                      setVatEdits((s) => ({ ...s, [v.vat_group]: Number(e.target.value) }))
                    }
                    style={{ ...inp, width: 80, height: 34 }}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        Gr. {n}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowVatMap(false)}
                style={btn({ background: D.s2, color: D.t2, border: `1px solid ${D.border}` })}
              >
                Anulează
              </button>
              <button
                onClick={handleSaveVatMap}
                disabled={vatBusy}
                style={btn({ background: D.gold, color: '#0a0a0a', opacity: vatBusy ? 0.6 : 1 })}
              >
                {vatBusy ? 'Se salvează...' : 'Salvează maparea'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{ background: D.s1, border: `1px solid ${D.border}`, borderRadius: 10, padding: 14 }}
    >
      <div
        style={{
          fontSize: '0.74rem',
          color: D.t2,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '1.6rem',
          fontWeight: 600,
          color,
          marginTop: 6,
          fontFamily: 'Fraunces,serif',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
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
          maxWidth: 480,
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
            aria-label="Închide"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 32,
              minHeight: 32,
              background: 'transparent',
              border: 'none',
              color: D.t2,
              cursor: 'pointer',
              lineHeight: 1,
              padding: 4,
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
