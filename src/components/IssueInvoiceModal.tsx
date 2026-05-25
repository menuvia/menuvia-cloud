// =============================================================
// Menuvia — src/components/IssueInvoiceModal.tsx
// Modal pentru emitere factură către o comandă plătită.
// Admin alege ordin, completează date client, enqueue → cron face restul.
// =============================================================
import { useEffect, useState } from 'react'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { enqueueInvoice } from '../lib/invoices'

interface PaidOrder {
  id: string
  table_name: string | null
  total: number
  created_at: string
}

interface Props {
  restaurantId: string
  onClose: () => void
  onIssued: () => void
}

export default function IssueInvoiceModal({ restaurantId, onClose, onIssued }: Props) {
  const [orders, setOrders] = useState<PaidOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOrderId, setSelectedOrderId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [step, setStep] = useState<'pick' | 'details'>('pick')
  const [form, setForm] = useState({
    customer_name: '',
    customer_cif: '',
    customer_address: '',
    customer_email: '',
    customer_phone: '',
  })
  const [issuing, setIssuing] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Load recent paid orders (last 90 days, no invoice yet)
  useEffect(() => {
    let alive = true
    void (async () => {
      // Step 1: get orders with no associated invoice
      const since = new Date(Date.now() - 90 * 86400_000).toISOString()
      const { data, error } = await supabase
        .from('orders')
        .select('id, table_name, total, created_at')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'paid')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200)

      if (!alive) return
      if (error) {
        setErr(error.message)
        setLoading(false)
        return
      }

      // Step 2: filter out orders that already have queued/issued invoices
      const { data: existing } = await supabase
        .from('invoices')
        .select('order_id')
        .eq('restaurant_id', restaurantId)
        .in('status', ['queued', 'generating', 'issued'])

      const taken = new Set((existing || []).map((e) => e.order_id))
      setOrders((data || []).filter((o) => !taken.has(o.id)) as PaidOrder[])
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [restaurantId])

  const filteredOrders = orders.filter((o) => {
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return (
      (o.table_name || '').toLowerCase().includes(s) ||
      o.id.startsWith(s) ||
      o.total.toString().includes(s)
    )
  })

  const pickedOrder = orders.find((o) => o.id === selectedOrderId)

  async function handleIssue() {
    if (!selectedOrderId || !form.customer_name.trim()) {
      setErr('Selectează o comandă și completează numele clientului')
      return
    }
    setIssuing(true)
    setErr(null)
    try {
      await enqueueInvoice({
        orderId: selectedOrderId,
        customerName: form.customer_name.trim(),
        customerCif: form.customer_cif.trim() || undefined,
        customerAddress: form.customer_address.trim() || undefined,
        customerEmail: form.customer_email.trim() || undefined,
        customerPhone: form.customer_phone.trim() || undefined,
      })
      onIssued()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare')
    } finally {
      setIssuing(false)
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    background: D.s1,
    border: `1px solid ${D.border}`,
    borderRadius: 6,
    padding: '10px 12px',
    fontSize: 14,
    color: D.t1,
    fontFamily: 'DM Sans, sans-serif',
    boxSizing: 'border-box',
    outline: 'none',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: D.t2,
    marginBottom: 4,
    fontWeight: 500,
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 16px',
        overflow: 'auto',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 600,
          width: '100%',
          background: D.s2,
          border: `1px solid ${D.border}`,
          borderRadius: 14,
          padding: 24,
          fontFamily: 'DM Sans, sans-serif',
        }}
      >
        <h2
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: 22,
            color: D.t1,
            margin: '0 0 6px',
            letterSpacing: '-0.02em',
          }}
        >
          {step === 'pick' ? 'Alege comanda' : 'Date client'}
        </h2>
        <p style={{ fontSize: 13, color: D.t2, margin: '0 0 20px' }}>
          {step === 'pick'
            ? 'Selectează comanda plătită pentru care emiți factura.'
            : 'Completează datele clientului. Pentru factură B2B (firmă), completează CIF-ul.'}
        </p>

        {err && (
          <div
            style={{
              background: 'rgba(224,85,85,0.1)',
              color: D.red,
              padding: 10,
              borderRadius: 6,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            {err}
          </div>
        )}

        {step === 'pick' && (
          <>
            <input
              style={fieldStyle}
              placeholder="Caută după masă sau total..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div
              style={{
                marginTop: 12,
                maxHeight: 360,
                overflowY: 'auto',
                border: `1px solid ${D.border}`,
                borderRadius: 8,
              }}
            >
              {loading ? (
                <div style={{ padding: 30, textAlign: 'center', color: D.t2 }}>
                  Se încarcă comenzile…
                </div>
              ) : filteredOrders.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', color: D.t2 }}>
                  Nicio comandă plătită fără factură.
                </div>
              ) : (
                filteredOrders.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setSelectedOrderId(o.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background:
                        selectedOrderId === o.id ? 'rgba(200,150,60,0.12)' : 'transparent',
                      border: 'none',
                      borderBottom: `1px solid ${D.border}`,
                      padding: 12,
                      cursor: 'pointer',
                      color: D.t1,
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: 14,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 600 }}>
                        {o.table_name || 'Fără masă'} —{' '}
                        {new Date(o.created_at).toLocaleString('ro-RO', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </div>
                      <div style={{ fontSize: 11, color: D.t3, fontFamily: 'monospace' }}>
                        {o.id.slice(0, 8)}
                      </div>
                    </div>
                    <div style={{ color: D.gold, fontFamily: 'Fraunces,serif', fontWeight: 600 }}>
                      {o.total.toFixed(2)} lei
                    </div>
                  </button>
                ))
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{
                  background: 'transparent',
                  color: D.t2,
                  border: `1px solid ${D.border}`,
                  borderRadius: 8,
                  padding: '10px 18px',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Anulează
              </button>
              <button
                onClick={() => setStep('details')}
                disabled={!selectedOrderId}
                style={{
                  background: D.gold,
                  color: '#000',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 22px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: selectedOrderId ? 'pointer' : 'not-allowed',
                  opacity: selectedOrderId ? 1 : 0.4,
                }}
              >
                Continuă →
              </button>
            </div>
          </>
        )}

        {step === 'details' && pickedOrder && (
          <>
            <div
              style={{
                padding: 12,
                marginBottom: 16,
                background: D.s1,
                borderRadius: 8,
                fontSize: 13,
                color: D.t2,
              }}
            >
              <div>
                Comandă:{' '}
                <span style={{ color: D.t1, fontFamily: 'Fraunces,serif' }}>
                  {pickedOrder.table_name || 'Fără masă'}
                </span>
              </div>
              <div>
                Total:{' '}
                <span style={{ color: D.gold, fontWeight: 600 }}>
                  {pickedOrder.total.toFixed(2)} lei
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Nume client / firmă *</label>
                <input
                  style={fieldStyle}
                  value={form.customer_name}
                  onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                  placeholder="Ion Popescu sau SC Exemplu SRL"
                  autoFocus
                />
              </div>

              <div>
                <label style={labelStyle}>CIF firmă (lasă gol pentru B2C)</label>
                <input
                  style={fieldStyle}
                  value={form.customer_cif}
                  onChange={(e) => setForm({ ...form, customer_cif: e.target.value })}
                  placeholder="RO12345678"
                />
                <div style={{ fontSize: 11, color: D.t3, marginTop: 4 }}>
                  Completat = factură B2B + e-Factura SPV ANAF
                </div>
              </div>

              <div>
                <label style={labelStyle}>Adresă</label>
                <input
                  style={fieldStyle}
                  value={form.customer_address}
                  onChange={(e) => setForm({ ...form, customer_address: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Email</label>
                  <input
                    type="email"
                    style={fieldStyle}
                    value={form.customer_email}
                    onChange={(e) => setForm({ ...form, customer_email: e.target.value })}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Telefon</label>
                  <input
                    style={fieldStyle}
                    value={form.customer_phone}
                    onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div
              style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'space-between' }}
            >
              <button
                onClick={() => setStep('pick')}
                style={{
                  background: 'transparent',
                  color: D.t2,
                  border: `1px solid ${D.border}`,
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                ← Înapoi
              </button>
              <button
                onClick={handleIssue}
                disabled={issuing}
                style={{
                  background: D.gold,
                  color: '#000',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 22px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: issuing ? 'wait' : 'pointer',
                  opacity: issuing ? 0.6 : 1,
                }}
              >
                {issuing ? 'Se enqueueză…' : 'Emite factura'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
