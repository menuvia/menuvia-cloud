// =============================================================
// Menuvia — src/components/TablesManager.tsx
// QR generation: local via `qrcode` npm — no external API dependency.
// PDF generation: local via `jspdf` npm — no CDN injection.
// =============================================================

import { useState, useEffect, useCallback } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'
import type { Restaurant } from '../hooks/useData'

interface QrTokenRow {
  id: string
  restaurant_id: string
  table_id: string
  token: string
  is_active: boolean
  expires_at: string | null
  created_at: string
}
interface TableRow {
  id: string
  restaurant_id: string
  name: string
  slug: string
  seats: number | null
  is_active: boolean
  created_at: string
  updated_at: string
  active_token: QrTokenRow | null
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
  whiteSpace: 'nowrap',
  ...extra,
})
const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '10px 13px',
  fontSize: '0.9rem',
  color: D.t1,
  outline: 'none',
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}
function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/^-|-$/g, '') || 'masa'
  )
}

// ── QR helpers — all local, no external API ─────────────────
function qrUrl(token: string): string {
  const base = import.meta.env.VITE_APP_URL || window.location.origin
  return `${base}/q/${token}`
}

async function generateQRDataURL(token: string, size: number): Promise<string> {
  return QRCode.toDataURL(qrUrl(token), {
    width: size,
    margin: 1,
    color: { dark: '#1A1208', light: '#F8F3EB' },
  })
}

// ── QRImage component — generates QR locally on mount ────────
function QRImage({ token, size = 80 }: { token: string; size?: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    generateQRDataURL(token, size * 2)
      .then(setSrc)
      .catch(() => setSrc('')) // 2x for sharpness
  }, [token, size])
  if (!src)
    return <div style={{ width: size, height: size, background: '#F8F3EB', borderRadius: 4 }} />
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="QR"
      style={{ display: 'block', borderRadius: 4 }}
    />
  )
}

// ── Toast ─────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState<{ id: string; msg: string; type: string }[]>([])
  const toast = useCallback((msg: string, type = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000)
  }, [])
  return { toasts, toast }
}
function Toast({ toasts }: { toasts: { id: string; msg: string; type: string }[] }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 80,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: D.s3,
            borderLeft: `3px solid ${t.type === 'error' ? D.red : D.green}`,
            borderRadius: 10,
            padding: '10px 16px',
            fontSize: '0.875rem',
            color: D.t1,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            minWidth: 220,
          }}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// ── TableModal ────────────────────────────────────────────────
function TableModal({
  table,
  restaurantId,
  onSave,
  onClose,
}: {
  table: TableRow | null
  restaurantId: string
  onSave: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(table?.name || '')
  const [slug, setSlug] = useState(table?.slug || '')
  const [seats, setSeats] = useState(table?.seats?.toString() || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const auto = !table

  const save = async () => {
    if (!name.trim()) {
      setError('Numele este obligatoriu.')
      return
    }
    setSaving(true)
    setError(null)
    const s = slug || slugify(name)
    const payload = { name: name.trim(), slug: s, seats: seats ? parseInt(seats) : null }
    const { error: e } = table
      ? await supabase.from('tables').update(payload).eq('id', table.id)
      : await supabase.from('tables').insert({ ...payload, restaurant_id: restaurantId })
    if (e) {
      setError(e.message)
      setSaving(false)
      return
    }
    onSave()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: D.s2,
          border: `1px solid ${D.border}`,
          borderRadius: 16,
          width: '100%',
          maxWidth: 400,
          padding: 24,
        }}
      >
        <div
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.05rem',
            color: D.t1,
            marginBottom: 20,
          }}
        >
          {table ? 'Editează masă' : 'Adaugă masă'}
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}>
            Nume masă *
          </label>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (auto) setSlug(slugify(e.target.value))
            }}
            placeholder="Masa 1, Terasa A..."
            style={inp}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}>
            Slug URL
          </label>
          <input
            value={slug}
            onChange={(e) => setSlug(slugify(e.target.value))}
            placeholder="masa-1"
            style={inp}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
          <div style={{ fontSize: '0.7rem', color: D.t3, marginTop: 4 }}>
            Identificator unic în URL-ul QR
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}>
            Locuri (opțional)
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            placeholder="4"
            style={{ ...inp, width: 100 }}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
        </div>
        {error && (
          <div
            style={{
              background: 'rgba(224,85,85,0.1)',
              border: `1px solid rgba(224,85,85,0.3)`,
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              color: D.red,
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
          >
            Anulează
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.7 : 1 })}
          >
            {saving ? 'Se salvează...' : 'Salvează'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── TablesManager ─────────────────────────────────────────────
export default function TablesManager({ restaurant }: { restaurant: Restaurant }) {
  const { toasts, toast } = useToast()
  const [tables, setTables] = useState<TableRow[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<TableRow | 'add' | null>(null)
  const [delId, setDelId] = useState<string | null>(null)
  const [rotating, setRotating] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const { data: tData, error: tErr } = await supabase
        .from('tables')
        .select('*')
        .eq('restaurant_id', restaurant.id)
        .order('name')
      if (tErr) throw tErr
      const ids = (tData || []).map((t: Record<string, unknown>) => t.id as string)
      const tokenMap: Record<string, QrTokenRow> = {}
      if (ids.length > 0) {
        const { data: tkData } = await supabase
          .from('qr_tokens')
          .select('*')
          .in('table_id', ids)
          .eq('is_active', true)
        for (const tk of (tkData || []) as QrTokenRow[]) tokenMap[tk.table_id] = tk
      }
      setTables(
        (tData || []).map((t: Record<string, unknown>) => ({
          ...(t as unknown as TableRow),
          active_token: tokenMap[t.id as string] || null,
        })),
      )
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : 'Nu s-au putut încărca mesele')
    }
    setLoading(false)
  }, [restaurant.id])

  useEffect(() => {
    load()
  }, [load])

  const ensureTokens = async () => {
    try {
      const { data: tData } = await supabase
        .from('tables')
        .select('id')
        .eq('restaurant_id', restaurant.id)
      const ids = (tData || []).map((t: Record<string, unknown>) => t.id as string)
      if (!ids.length) return
      const { data: existing } = await supabase
        .from('qr_tokens')
        .select('table_id')
        .in('table_id', ids)
        .eq('is_active', true)
      const covered = new Set(
        (existing || []).map((t: Record<string, unknown>) => t.table_id as string),
      )
      const missing = ids.filter((id) => !covered.has(id))
      if (missing.length > 0)
        await supabase
          .from('qr_tokens')
          .insert(missing.map((table_id) => ({ restaurant_id: restaurant.id, table_id })))
      await load()
    } catch {
      toast('Eroare la generarea tokenurilor QR', 'error')
    }
  }

  const handleSave = async () => {
    setModal(null)
    try {
      await load()
      await ensureTokens()
      toast(modal === 'add' ? 'Masă adăugată' : 'Masă actualizată')
    } catch {
      toast('Eroare la salvare', 'error')
    }
  }

  const handleDelete = async () => {
    if (!delId) return
    try {
      const { error } = await supabase.from('tables').delete().eq('id', delId)
      if (error) throw error
      toast('Masă ștearsă')
      await load()
    } catch {
      toast('Eroare la ștergere', 'error')
    }
    setDelId(null)
  }

  const toggleActive = async (t: TableRow) => {
    try {
      const { error } = await supabase
        .from('tables')
        .update({ is_active: !t.is_active })
        .eq('id', t.id)
      if (error) throw error
      toast(t.is_active ? 'Masă dezactivată' : 'Masă activată')
      await load()
    } catch {
      toast('Eroare la actualizare', 'error')
    }
  }

  const rotateToken = async (t: TableRow) => {
    setRotating(t.id)
    try {
      await supabase
        .from('qr_tokens')
        .update({ is_active: false })
        .eq('table_id', t.id)
        .eq('is_active', true)
      const { error } = await supabase
        .from('qr_tokens')
        .insert({ restaurant_id: restaurant.id, table_id: t.id })
      if (error) throw error
      toast('Token reînnoit')
    } catch {
      toast('Eroare la reînnoire token', 'error')
    }
    await load()
    setRotating(null)
  }

  const copyLink = (t: TableRow) => {
    if (!t.active_token) return
    navigator.clipboard
      .writeText(qrUrl(t.active_token.token))
      .then(() => toast('Link copiat'))
      .catch(() => toast('Nu s-a putut copia linkul', 'error'))
  }

  // PDF: jsPDF loads on-demand (560KB) — only when user actually exports
  const downloadPdf = async () => {
    const active = tables.filter((t) => t.is_active && t.active_token)
    if (!active.length) {
      toast('Nicio masă activă cu token', 'error')
      return
    }
    setDownloading(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const cols = 2,
        rows = 3,
        cW = 80,
        cH = 82,
        pW = 210,
        pH = 297
      const mX = (pW - cols * cW) / (cols + 1),
        mY = (pH - rows * cH) / (rows + 1)

      for (let i = 0; i < active.length; i++) {
        if (i > 0 && i % (cols * rows) === 0) doc.addPage()
        const idx = i % (cols * rows),
          col = idx % cols,
          row = Math.floor(idx / cols)
        const x = mX + col * (cW + mX),
          y = mY + row * (cH + mY)

        // Card background + border
        doc.setFillColor(248, 243, 235)
        doc.roundedRect(x, y, cW, cH, 4, 4, 'F')
        doc.setDrawColor(200, 150, 60)
        doc.setLineWidth(0.5)
        doc.roundedRect(x, y, cW, cH, 4, 4, 'S')

        // Restaurant name
        doc.setFontSize(8)
        doc.setTextColor(26, 18, 8)
        doc.setFont('helvetica', 'bold')
        const rn =
          restaurant.name.length > 26 ? restaurant.name.slice(0, 24) + '…' : restaurant.name
        doc.text(rn, x + cW / 2, y + 10, { align: 'center' })

        // Table name
        doc.setFontSize(13)
        doc.setTextColor(200, 150, 60)
        doc.text(active[i].name, x + cW / 2, y + 19, { align: 'center' })

        // QR code — generated locally, no external request
        const qs = 40,
          qx = x + (cW - qs) / 2,
          qy = y + 23
        try {
          const imgData = await generateQRDataURL(active[i].active_token!.token, 400)
          doc.addImage(imgData, 'PNG', qx, qy, qs, qs)
        } catch {
          doc.setFillColor(220, 215, 208)
          doc.rect(qx, qy, qs, qs, 'F')
        }

        doc.setFontSize(7)
        doc.setTextColor(138, 126, 108)
        doc.setFont('helvetica', 'normal')
        doc.text('Scanează pentru a comanda', x + cW / 2, y + 68, { align: 'center' })
        doc.setFontSize(5)
        doc.setTextColor(190, 180, 170)
        doc.text('menuvia.ro', x + cW / 2, y + 78, { align: 'center' })
      }

      doc.save(`QR-Mese-${restaurant.name.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`)
      toast('PDF descărcat')
    } catch (e) {
      toast('Eroare PDF: ' + (e instanceof Error ? e.message : 'unknown'), 'error')
    }
    setDownloading(false)
  }

  return (
    <div>
      <Toast toasts={toasts} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.5rem',
              color: D.t1,
              letterSpacing: '-0.02em',
            }}
          >
            Mese
          </h2>
          <p style={{ color: D.t3, fontSize: '0.78rem', marginTop: 3 }}>
            {tables.filter((t) => t.is_active).length} active · {tables.length} total
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tables.length > 0 && (
            <button
              onClick={downloadPdf}
              disabled={downloading}
              style={btn({
                background: D.s3,
                color: D.t1,
                border: `1px solid ${D.border}`,
                opacity: downloading ? 0.7 : 1,
              })}
            >
              ⬇ {downloading ? 'Se generează...' : 'PDF QR'}
            </button>
          )}
          <button
            onClick={() => setModal('add')}
            style={btn({ background: D.gold, color: '#000' })}
          >
            + Adaugă masă
          </button>
        </div>
      </div>

      {/* QR domain warning — shown when VITE_APP_URL differs from current origin or is a preview URL */}
      {(() => {
        const appUrl = import.meta.env.VITE_APP_URL || ''
        const origin = window.location.origin
        const isPreview = origin.includes('netlify.app') && !appUrl
        const mismatch = appUrl && !origin.startsWith(appUrl) && !origin.includes('localhost')
        if (!isPreview && !mismatch) return null
        return (
          <div
            style={{
              background: 'rgba(232,160,32,0.1)',
              border: '1px solid rgba(232,160,32,0.25)',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div style={{ fontSize: '0.78rem', color: '#E8A020', lineHeight: 1.5 }}>
              {isPreview
                ? 'VITE_APP_URL nu e setat — QR-urile generate vor conține URL-ul de preview, nu domeniul final.'
                : 'Ești pe un domeniu diferit de VITE_APP_URL. QR-urile generate vor folosi domeniul din setări, nu cel curent.'}
              {isPreview && (
                <span style={{ color: D.t2 }}>
                  {' '}
                  Setează-l în Netlify env vars înainte de a printa QR-uri.
                </span>
              )}
            </div>
          </div>
        )
      })()}

      {loading ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: D.t3 }}>Se încarcă...</div>
      ) : loadError ? (
        <div style={{ padding: '48px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
          <div style={{ color: D.t2, fontSize: 14, marginBottom: 16 }}>{loadError}</div>
          <button
            onClick={load}
            style={btn({ background: D.s2, color: D.gold, border: `1px solid ${D.border}` })}
          >
            Reîncearcă
          </button>
        </div>
      ) : tables.length === 0 ? (
        <div
          style={{
            padding: '60px 20px',
            textAlign: 'center',
            background: D.s2,
            border: `1px solid ${D.border}`,
            borderRadius: 16,
            color: D.t3,
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>🪑</div>
          <div style={{ fontSize: '0.95rem', marginBottom: 8, color: D.t2 }}>
            Nicio masă configurată
          </div>
          <button
            onClick={() => setModal('add')}
            style={btn({ background: D.gold, color: '#000' })}
          >
            Adaugă prima masă
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tables.map((t) => (
            <div
              key={t.id}
              style={{
                background: D.s2,
                border: `1px solid ${D.border}`,
                borderRadius: 12,
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                opacity: t.is_active ? 1 : 0.6,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: D.s3,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.1rem',
                  flexShrink: 0,
                }}
              >
                🪑
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: D.t1 }}>{t.name}</span>
                  {t.seats && (
                    <span style={{ fontSize: '0.72rem', color: D.t3 }}>{t.seats} locuri</span>
                  )}
                  {!t.is_active && (
                    <span
                      style={{
                        fontSize: '0.65rem',
                        background: D.s3,
                        color: D.t3,
                        padding: '1px 6px',
                        borderRadius: 4,
                      }}
                    >
                      Inactiv
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 2 }}>
                  {t.active_token
                    ? `Token: ${t.active_token.token.slice(0, 16)}…`
                    : '⚠️ Fără token QR'}
                </div>
              </div>
              {/* FIX: QRImage generates locally — no api.qrserver.com */}
              {t.active_token && (
                <div style={{ background: '#F8F3EB', borderRadius: 8, padding: 4, flexShrink: 0 }}>
                  <QRImage token={t.active_token.token} size={48} />
                </div>
              )}
              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                {t.active_token && (
                  <button
                    onClick={() => copyLink(t)}
                    title="Copiază link"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 7,
                      background: D.s3,
                      border: `1px solid ${D.border}`,
                      color: D.t2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    🔗
                  </button>
                )}
                <button
                  onClick={() => rotateToken(t)}
                  disabled={rotating === t.id}
                  title="Reînnoit token"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 7,
                    background: D.s3,
                    border: `1px solid ${D.border}`,
                    color: D.t2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    opacity: rotating === t.id ? 0.5 : 1,
                  }}
                >
                  ↻
                </button>
                <button
                  onClick={() => toggleActive(t)}
                  title={t.is_active ? 'Dezactivează' : 'Activează'}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 7,
                    background: t.is_active ? 'rgba(76,175,110,0.12)' : D.s3,
                    border: `1px solid ${t.is_active ? 'rgba(76,175,110,0.3)' : D.border}`,
                    color: t.is_active ? D.green : D.t3,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  {t.is_active ? '✓' : '○'}
                </button>
                <button
                  onClick={() => setModal(t)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 7,
                    background: D.s3,
                    border: `1px solid ${D.border}`,
                    color: D.t2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  ✏
                </button>
                <button
                  onClick={() => setDelId(t.id)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 7,
                    background: 'rgba(224,85,85,0.1)',
                    border: `1px solid rgba(224,85,85,0.2)`,
                    color: D.red,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <TableModal
          table={modal === 'add' ? null : modal}
          restaurantId={restaurant.id}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
      {delId && (
        <div
          onClick={() => setDelId(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 16,
              padding: 24,
              maxWidth: 360,
              width: '100%',
            }}
          >
            <div
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: '1.05rem',
                color: D.t1,
                marginBottom: 12,
              }}
            >
              Șterge masă
            </div>
            <p style={{ color: D.t2, marginBottom: 22, fontSize: '0.875rem' }}>
              Toate tokenurile QR asociate vor fi șterse. Comenzile existente nu sunt afectate.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDelId(null)}
                style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
              >
                Anulează
              </button>
              <button onClick={handleDelete} style={btn({ background: D.red, color: '#fff' })}>
                Șterge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
