// =============================================================
// Menuvia — src/components/InvoicesTab.tsx
// Tab admin: configurare Oblio + listă facturi emise + status live.
// =============================================================
import { useEffect, useState, useCallback } from 'react'
import { D } from '../lib/constants'
import { useIsMobile } from '../hooks/useIsMobile'
import { useToast } from './ui/useToast'
import { confirm as confirmDialog } from './ui/confirm'
import { Skeleton } from './ui/Skeleton'
import {
  fetchOblioConfig,
  saveOblioConfig,
  deleteOblioConfig,
  listInvoices,
  cancelInvoice,
  type OblioConfig,
  type Invoice,
  invoiceStatusLabel,
  invoiceStatusColor,
} from '../lib/invoices'
import IssueInvoiceModal from './IssueInvoiceModal'

const PALETTE = { green: D.green, gold: D.gold, red: D.red, t3: D.t3 }

interface Props {
  restaurantId: string
  restaurantName: string
}

export default function InvoicesTab({ restaurantId, restaurantName }: Props) {
  const [config, setConfig] = useState<OblioConfig | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [showConfig, setShowConfig] = useState(false)
  const [showIssue, setShowIssue] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [cfg, inv] = await Promise.all([
        fetchOblioConfig(restaurantId),
        listInvoices(restaurantId, 50, 0),
      ])
      setConfig(cfg)
      setInvoices(inv)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare')
    } finally {
      setLoading(false)
    }
  }, [restaurantId])

  useEffect(() => {
    void load()
  }, [load])

  // Auto-refresh la 10s dacă există facturi pending
  useEffect(() => {
    const pending = invoices.some((i) => i.status === 'queued' || i.status === 'generating')
    if (!pending) return
    const t = setInterval(() => {
      void load()
    }, 10_000)
    return () => clearInterval(t)
  }, [invoices, load])

  if (loading)
    return (
      <div style={{ padding: 24 }}>
        <Skeleton variant="table-row" count={4} />
      </div>
    )

  // Empty state — no config
  if (!config && !showConfig) {
    return (
      <div style={{ maxWidth: 720, margin: '40px auto', padding: 24 }}>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>📄</div>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 28,
              color: D.t1,
              margin: '0 0 12px',
              letterSpacing: '-0.02em',
            }}
          >
            Emite facturi automate cu Oblio
          </h2>
          <p
            style={{
              color: D.t2,
              fontSize: 15,
              lineHeight: 1.6,
              maxWidth: 540,
              margin: '0 auto 24px',
            }}
          >
            Conectează contul tău Oblio (~50 RON/lună pe oblio.eu) și emite facturi conform
            legislației române direct din Menuvia. Suportă și e-Factura SPV ANAF pentru B2B.
          </p>
          <button
            onClick={() => setShowConfig(true)}
            style={{
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 10,
              padding: '12px 24px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Configurează Oblio →
          </button>
          <div style={{ marginTop: 24, fontSize: 12, color: D.t3 }}>
            Nu ai cont?{' '}
            <a
              href="https://www.oblio.eu"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: D.gold }}
            >
              Creează unul gratis pe oblio.eu
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{ maxWidth: 980, margin: '0 auto', padding: 24, fontFamily: 'DM Sans, sans-serif' }}
    >
      {/* Header */}
      <div
        style={{
          marginBottom: 24,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              color: D.t3,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            Facturare Oblio
          </div>
          <h1
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 28,
              fontWeight: 600,
              color: D.t1,
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Facturi emise
          </h1>
          {config && (
            <div style={{ fontSize: 13, color: D.t3, marginTop: 6 }}>
              Conectat ca {config.company_name} ({config.company_cif})
              {config.test_mode && (
                <span style={{ color: D.amber, marginLeft: 8 }}>· MOD TEST</span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowIssue(true)}
            style={{
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Factură nouă
          </button>
          <button
            onClick={() => setShowConfig(true)}
            style={{
              background: 'transparent',
              color: D.t1,
              border: `1px solid ${D.border}`,
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            ⚙ Configurare
          </button>
        </div>
      </div>

      {err && (
        <div
          style={{
            background: 'rgba(224,85,85,0.1)',
            color: D.red,
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          {err}
        </div>
      )}

      {/* Invoices list */}
      {invoices.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: D.t2 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
          <div style={{ fontFamily: 'Fraunces,serif', fontSize: 18, color: D.t1, marginBottom: 8 }}>
            Nicio factură emisă încă
          </div>
          <p style={{ fontSize: 14, maxWidth: 460, margin: '0 auto' }}>
            Pentru a emite o factură, mergi la o comandă plătită și apasă "Emite factură" în
            detalii.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {invoices.map((inv) => (
            <InvoiceRow key={inv.id} invoice={inv} onAfterAction={load} />
          ))}
        </div>
      )}

      {/* Config modal */}
      {showConfig && (
        <OblioConfigModal
          restaurantId={restaurantId}
          restaurantName={restaurantName}
          existing={config}
          onClose={() => setShowConfig(false)}
          onSaved={async () => {
            setShowConfig(false)
            await load()
          }}
          onDeleted={async () => {
            setShowConfig(false)
            await load()
          }}
        />
      )}

      {/* Issue invoice modal */}
      {showIssue && (
        <IssueInvoiceModal
          restaurantId={restaurantId}
          onClose={() => setShowIssue(false)}
          onIssued={async () => {
            setShowIssue(false)
            await load()
          }}
        />
      )}
    </div>
  )
}

// ── Invoice row ────────────────────────────────────────────────
function InvoiceRow({ invoice, onAfterAction }: { invoice: Invoice; onAfterAction: () => void }) {
  const toast = useToast()
  const [acting, setActing] = useState(false)
  const color = invoiceStatusColor(invoice.status, PALETTE)

  async function handleCancel() {
    const ok = await confirmDialog({
      title: `Anulezi factura ${invoice.oblio_series}-${invoice.oblio_number}?`,
      description: `Către ${invoice.customer_name}. Anularea în Menuvia nu emite automat factură de stornare la Oblio — discută cu contabilul tău.`,
      confirmLabel: 'Anulează factura',
      destructive: true,
    })
    if (!ok) return
    setActing(true)
    try {
      await cancelInvoice(invoice.id)
      onAfterAction()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Eroare')
    } finally {
      setActing(false)
    }
  }

  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
        padding: 14,
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
            marginBottom: 4,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontFamily: 'Fraunces,serif', fontSize: 16, fontWeight: 600, color: D.t1 }}>
            {invoice.customer_name}
            {invoice.is_b2b && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'rgba(200,150,60,0.15)',
                  color: D.gold,
                  fontFamily: 'DM Sans, sans-serif',
                  fontWeight: 600,
                }}
              >
                B2B
              </span>
            )}
          </div>
          <div
            style={{ fontFamily: 'Fraunces,serif', fontSize: 15, color: D.gold, fontWeight: 600 }}
          >
            {invoice.total_with_vat.toFixed(2)} lei
          </div>
        </div>
        <div style={{ fontSize: 12, color: D.t3, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {invoice.oblio_series && invoice.oblio_number ? (
            <span>
              📋 {invoice.oblio_series}-{invoice.oblio_number}
            </span>
          ) : (
            <span style={{ color, fontWeight: 600 }}>{invoiceStatusLabel(invoice.status)}</span>
          )}
          {invoice.customer_cif && <span>CIF: {invoice.customer_cif}</span>}
          <span>
            {new Date(invoice.created_at).toLocaleString('ro-RO', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </span>
        </div>
        {invoice.last_error && invoice.status === 'failed' && (
          <div
            style={{
              marginTop: 6,
              padding: 8,
              background: 'rgba(224,85,85,0.06)',
              borderRadius: 6,
              fontSize: 12,
              color: D.red,
              fontFamily: 'monospace',
            }}
          >
            {invoice.last_error}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {invoice.status === 'issued' && invoice.oblio_link && (
          <a
            href={invoice.oblio_link}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: D.gold,
              color: '#000',
              textDecoration: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            PDF →
          </a>
        )}
        {invoice.status === 'issued' && (
          <button
            onClick={handleCancel}
            disabled={acting}
            style={{
              background: 'transparent',
              color: D.t3,
              border: `1px solid ${D.border}`,
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Anulează
          </button>
        )}
      </div>
    </div>
  )
}

// ── Config modal ───────────────────────────────────────────────
function OblioConfigModal({
  restaurantId,
  restaurantName,
  existing,
  onClose,
  onSaved,
  onDeleted,
}: {
  restaurantId: string
  restaurantName: string
  existing: OblioConfig | null
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const [form, setForm] = useState({
    api_email: existing?.api_email ?? '',
    api_secret: existing?.api_secret ?? '',
    company_cif: existing?.company_cif ?? '',
    company_name: existing?.company_name ?? restaurantName,
    company_address: existing?.company_address ?? '',
    default_series: existing?.default_series ?? 'MENU',
    vat_included: existing?.vat_included ?? true,
    send_email: existing?.send_email ?? true,
    test_mode: existing?.test_mode ?? false,
    is_active: existing?.is_active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isMobile = useIsMobile()

  async function save() {
    if (!form.api_email || !form.api_secret || !form.company_cif || !form.company_name) {
      setErr('Toate câmpurile marcate cu * sunt obligatorii')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await saveOblioConfig({
        restaurant_id: restaurantId,
        ...form,
        company_state: existing?.company_state ?? null,
        company_city: existing?.company_city ?? null,
        language: 'RO',
      })
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: 'Ștergi configurația Oblio?',
      description: 'Facturile existente rămân, dar nu vei mai putea emite altele noi.',
      confirmLabel: 'Șterge',
      destructive: true,
    })
    if (!ok) return
    setSaving(true)
    try {
      await deleteOblioConfig(restaurantId)
      onDeleted()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare')
      setSaving(false)
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
          maxWidth: 560,
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
          Configurare Oblio
        </h2>
        <p style={{ fontSize: 13, color: D.t2, margin: '0 0 20px' }}>
          Găsești API email + secret în Oblio → Setări → API → Generare cheie.
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>API email (cont Oblio) *</label>
            <input
              type="email"
              style={fieldStyle}
              value={form.api_email}
              onChange={(e) => setForm({ ...form, api_email: e.target.value })}
            />
          </div>

          <div>
            <label style={labelStyle}>API secret *</label>
            <input
              type="password"
              style={fieldStyle}
              value={form.api_secret}
              onChange={(e) => setForm({ ...form, api_secret: e.target.value })}
              placeholder={existing ? '(schimbă doar dacă vrei să actualizezi)' : ''}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>CIF firmă *</label>
              <input
                style={fieldStyle}
                value={form.company_cif}
                onChange={(e) => setForm({ ...form, company_cif: e.target.value })}
                placeholder="RO12345678"
              />
            </div>
            <div>
              <label style={labelStyle}>Seria documente *</label>
              <input
                style={fieldStyle}
                value={form.default_series}
                onChange={(e) => setForm({ ...form, default_series: e.target.value.toUpperCase() })}
                placeholder="MENU"
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Denumire firmă *</label>
            <input
              style={fieldStyle}
              value={form.company_name}
              onChange={(e) => setForm({ ...form, company_name: e.target.value })}
            />
          </div>

          <div>
            <label style={labelStyle}>Adresă firmă</label>
            <input
              style={fieldStyle}
              value={form.company_address ?? ''}
              onChange={(e) => setForm({ ...form, company_address: e.target.value })}
            />
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: 12,
              background: D.s1,
              borderRadius: 8,
            }}
          >
            <Toggle
              label="Prețurile produselor includ TVA"
              checked={form.vat_included}
              onChange={(v) => setForm({ ...form, vat_included: v })}
            />
            <Toggle
              label="Oblio trimite mail clientului cu factura"
              checked={form.send_email}
              onChange={(v) => setForm({ ...form, send_email: v })}
            />
            <Toggle
              label="Mod test (sandbox Oblio, nu emite documente reale)"
              checked={form.test_mode}
              onChange={(v) => setForm({ ...form, test_mode: v })}
              warning
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'space-between' }}>
          {existing && (
            <button
              onClick={remove}
              disabled={saving}
              style={{
                background: 'transparent',
                color: D.red,
                border: `1px solid ${D.red}`,
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Șterge config
            </button>
          )}
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
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
              onClick={save}
              disabled={saving}
              style={{
                background: D.gold,
                color: '#000',
                border: 'none',
                borderRadius: 8,
                padding: '10px 22px',
                fontSize: 13,
                fontWeight: 600,
                cursor: saving ? 'wait' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Se salvează…' : 'Salvează'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  warning,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  warning?: boolean
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        fontSize: 13,
        color: warning && checked ? D.amber : D.t1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: D.gold, width: 16, height: 16, cursor: 'pointer' }}
      />
      {label}
    </label>
  )
}
