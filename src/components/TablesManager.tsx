// =============================================================
// Menuvia — src/components/TablesManager.tsx
// QR generation: local via `qrcode` npm — no external API dependency.
// PDF generation: local via `jspdf` npm — no CDN injection.
// =============================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { useFeatures } from '../hooks/useFeatures'
import { getPlanByInternalId } from '../lib/plans'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'
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
  zone: string | null
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
  padding: '0 16px',
  // A11y: țintă tactilă min. 44px (WCAG 2.5.5) — înlocuiește height:38.
  minHeight: 44,
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

// "#C8963C" → [200, 150, 60]; fallback null pe input invalid → caller folosește accent default.
function hexToRgb(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) return null
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
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
  const [zone, setZone] = useState(table?.zone || '')
  const [existingZones, setExistingZones] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const auto = !table

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('tables')
        .select('zone')
        .eq('restaurant_id', restaurantId)
        .not('zone', 'is', null)
      if (cancelled) return
      const uniq = Array.from(
        new Set(
          ((data ?? []) as { zone: string | null }[])
            .map((r) => r.zone)
            .filter(Boolean) as string[],
        ),
      ).sort((a, b) => a.localeCompare(b, 'ro'))
      setExistingZones(uniq)
    })()
    return () => {
      cancelled = true
    }
  }, [restaurantId])

  const save = async () => {
    if (!name.trim()) {
      setError('Numele este obligatoriu.')
      return
    }
    setSaving(true)
    setError(null)
    const s = slug || slugify(name)
    const z = zone.trim().length > 0 ? zone.trim() : null
    const payload = { name: name.trim(), slug: s, seats: seats ? parseInt(seats) : null, zone: z }
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
      // A11y: Escape închide modalul (evenimentul urcă de la input-ul focusat).
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
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
        role="dialog"
        aria-modal="true"
        aria-label={table ? 'Editează masă' : 'Adaugă masă'}
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
            // A11y: focus automat pe primul câmp la deschiderea modalului.
            autoFocus
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
          <div style={{ fontSize: '0.7rem', color: D.t2, marginTop: 4 }}>
            Identificator unic în URL-ul QR
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
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
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}>
            Zonă (opțional)
          </label>
          <input
            list="table-zones"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            placeholder="Terasa, Interior, Bar..."
            style={inp}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
          {existingZones.length > 0 && (
            <datalist id="table-zones">
              {existingZones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          )}
          <div style={{ fontSize: '0.7rem', color: D.t2, marginTop: 4 }}>
            Filtru pentru sheet-ul de rezervări publice (Terasa vs Interior)
          </div>
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
  // UX: regenerarea invalidează QR-ul printat — cerem confirmare explicită.
  const [rotateTarget, setRotateTarget] = useState<TableRow | null>(null)
  // Descărcare PDF: reținem FORMATUL în curs (nu doar un boolean) ca spinner-ul
  // să apară doar pe opțiunea apăsată, nu pe toate deodată.
  type PdfFormat = 'grid' | 'tent' | 'poster'
  const [downloading, setDownloading] = useState<PdfFormat | null>(null)
  // Dropdown „Descarcă QR-uri" — colapsează cele 3 butoane de export într-unul.
  const [pdfMenuOpen, setPdfMenuOpen] = useState(false)
  const pdfMenuRef = useRef<HTMLDivElement>(null)
  // Căutare + filtru pe zonă pentru lista de mese (utile la zeci de mese).
  const [search, setSearch] = useState('')
  const [zoneFilter, setZoneFilter] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  // Generare rapidă: „Câte mese ai?" → creăm Masa 1..N dintr-un foc.
  const [bulkCount, setBulkCount] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [limitMsg, setLimitMsg] = useState<string | null>(null)

  // Limita de mese: numărul REAL din DB (get_restaurant_features, aliniat cu
  // plans.ts prin mig 089); fallback pe config-ul comercial dacă fetch-ul
  // eșuează. null = nelimitat (enterprise).
  const restaurantFeatures = useFeatures(restaurant.id)
  const maxTables: number | null = restaurantFeatures.features
    ? restaurantFeatures.limit('max_tables')
    : getPlanByInternalId('free').limits.maxTables

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
      // Rotație ATOMICĂ prin RPC (dezactivare + insert într-o singură tranzacție) — fără
      // fereastra în care masa rămânea fără token activ (mig 166).
      const { error } = await supabase.rpc('rotate_qr_token', { p_table_id: t.id })
      if (error) throw error
      toast('Token reînnoit')
    } catch {
      toast('Eroare la reînnoire token', 'error')
    }
    await load()
    setRotating(null)
  }

  // „Câte mese ai?" → completăm de la Masa {existente+1} până la Masa N.
  // Idempotent prin design: rulat de două ori cu același N nu creează dubluri.
  const bulkGenerate = async () => {
    const n = parseInt(bulkCount, 10)
    setLimitMsg(null)
    if (!n || n < 1) {
      toast('Introdu numărul de mese (ex. 80)', 'error')
      return
    }
    if (n <= tables.length) {
      toast(`Ai deja ${tables.length} mese configurate`)
      return
    }
    if (maxTables != null && n > maxTables) {
      setLimitMsg(
        `Planul tău permite până la ${maxTables} mese / QR-uri. Pentru mai multe, poți face upgrade.`,
      )
      return
    }
    setBulkBusy(true)
    try {
      // Indici LIBERI pe baza slug-urilor existente masa-N (nu tables.length+1) — altfel, cu
      // goluri (ex. Masa 3 ștearsă), am genera un slug care coliziează. Creăm exact
      // (n - tables.length) mese, sărind peste numerele deja folosite.
      const usedNums = new Set(
        tables
          .map((t) => {
            const m = /^masa-(\d+)$/.exec(t.slug || '')
            return m ? parseInt(m[1], 10) : null
          })
          .filter((x): x is number => x != null),
      )
      const rows: { restaurant_id: string; name: string; slug: string }[] = []
      let idx = 1
      while (tables.length + rows.length < n) {
        if (!usedNums.has(idx)) {
          rows.push({ restaurant_id: restaurant.id, name: `Masa ${idx}`, slug: `masa-${idx}` })
        }
        idx++
      }
      const { error } = await supabase.from('tables').insert(rows)
      if (error) throw error
      await load()
      await ensureTokens()
      await load()
      setBulkCount('')
      toast(`${rows.length} mese create, fiecare cu QR-ul ei`)
    } catch (e) {
      toast('Eroare la generare: ' + (e instanceof Error ? e.message : 'unknown'), 'error')
    }
    setBulkBusy(false)
  }

  // Descarcă QR-ul unei singure mese ca PNG (pentru re-print rapid).
  const downloadPng = async (t: TableRow) => {
    if (!t.active_token) return
    try {
      const dataUrl = await generateQRDataURL(t.active_token.token, 600)
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `QR-${t.name.replace(/[^a-zA-Z0-9ăâîșțĂÂÎȘȚ ]/g, '')}.png`
      a.click()
      toast(`QR descărcat pentru ${t.name}`)
    } catch {
      toast('Eroare la descărcare', 'error')
    }
  }

  const copyLink = (t: TableRow) => {
    if (!t.active_token) return
    navigator.clipboard
      .writeText(qrUrl(t.active_token.token))
      .then(() => toast('Link copiat'))
      .catch(() => toast('Nu s-a putut copia linkul', 'error'))
  }

  // PDF: jsPDF loads on-demand (560KB) — only when user actually exports
  // Format: 'grid' (6/A4, current), 'poster' (1/A4, mare), 'tent' (4/A4, pliabil)
  const downloadPdf = async (format: PdfFormat = 'grid') => {
    const active = tables.filter((t) => t.is_active && t.active_token)
    if (!active.length) {
      toast('Nicio masă activă cu token', 'error')
      return
    }
    setDownloading(format)
    try {
      const { default: jsPDF } = await import('jspdf')
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const accent = hexToRgb(restaurant.primary_color) || [200, 150, 60]
      const subtitleRo = 'Scanează pentru a comanda'
      const subtitleEn = 'Scan to order'

      const drawCard = async (
        i: number,
        x: number,
        y: number,
        cW: number,
        cH: number,
        scale: 'sm' | 'md' | 'lg',
      ) => {
        const sizes = {
          sm: { rn: 8, tn: 13, qFrac: 0.5, sub: 7, brand: 5 },
          md: { rn: 11, tn: 18, qFrac: 0.55, sub: 9, brand: 6 },
          lg: { rn: 18, tn: 36, qFrac: 0.6, sub: 14, brand: 9 },
        }[scale]

        // Card background + border (cu accent restaurant)
        doc.setFillColor(248, 243, 235)
        doc.roundedRect(x, y, cW, cH, 4, 4, 'F')
        doc.setDrawColor(accent[0], accent[1], accent[2])
        doc.setLineWidth(scale === 'lg' ? 1.2 : 0.5)
        doc.roundedRect(x, y, cW, cH, 4, 4, 'S')

        // Restaurant name
        doc.setFontSize(sizes.rn)
        doc.setTextColor(26, 18, 8)
        doc.setFont('helvetica', 'bold')
        const maxRn = scale === 'lg' ? 38 : 26
        const rn =
          restaurant.name.length > maxRn
            ? restaurant.name.slice(0, maxRn - 2) + '…'
            : restaurant.name
        doc.text(rn, x + cW / 2, y + cH * 0.1, { align: 'center' })

        // Table name (cu accent restaurant)
        doc.setFontSize(sizes.tn)
        doc.setTextColor(accent[0], accent[1], accent[2])
        doc.text(active[i].name, x + cW / 2, y + cH * 0.2, { align: 'center' })

        // QR code — generated locally, no external request
        const qs = Math.min(cW, cH) * sizes.qFrac
        const qx = x + (cW - qs) / 2
        const qy = y + cH * 0.27
        try {
          const imgData = await generateQRDataURL(active[i].active_token!.token, 400)
          doc.addImage(imgData, 'PNG', qx, qy, qs, qs)
        } catch {
          doc.setFillColor(220, 215, 208)
          doc.rect(qx, qy, qs, qs, 'F')
        }

        // Bilingual subtitle
        doc.setFontSize(sizes.sub)
        doc.setTextColor(60, 50, 38)
        doc.setFont('helvetica', 'normal')
        doc.text(subtitleRo, x + cW / 2, y + cH * 0.85, { align: 'center' })
        doc.setFontSize(sizes.sub - 1)
        doc.setTextColor(138, 126, 108)
        doc.text(subtitleEn, x + cW / 2, y + cH * 0.9, { align: 'center' })

        // Brand footer
        doc.setFontSize(sizes.brand)
        doc.setTextColor(190, 180, 170)
        doc.text('menuvia.ro', x + cW / 2, y + cH * 0.96, { align: 'center' })
      }

      const pW = 210,
        pH = 297

      if (format === 'poster') {
        // 1 card/A4, aproape full-page → ideal pentru intrare/poster
        const margin = 15
        for (let i = 0; i < active.length; i++) {
          if (i > 0) doc.addPage()
          await drawCard(i, margin, margin, pW - 2 * margin, pH - 2 * margin, 'lg')
        }
      } else if (format === 'tent') {
        // 4 cards/A4 portrait (2x2), card pătrat 90x90mm — pliabil ca tent card
        const cols = 2,
          rows = 2,
          cW = 90,
          cH = 90
        const mX = (pW - cols * cW) / (cols + 1)
        const mY = (pH - rows * cH) / (rows + 1)
        for (let i = 0; i < active.length; i++) {
          if (i > 0 && i % (cols * rows) === 0) doc.addPage()
          const idx = i % (cols * rows)
          const col = idx % cols,
            row = Math.floor(idx / cols)
          await drawCard(i, mX + col * (cW + mX), mY + row * (cH + mY), cW, cH, 'md')
        }
      } else {
        // grid — 6 cards/A4 (2x3), default
        const cols = 2,
          rows = 3,
          cW = 80,
          cH = 82
        const mX = (pW - cols * cW) / (cols + 1)
        const mY = (pH - rows * cH) / (rows + 1)
        for (let i = 0; i < active.length; i++) {
          if (i > 0 && i % (cols * rows) === 0) doc.addPage()
          const idx = i % (cols * rows)
          const col = idx % cols,
            row = Math.floor(idx / cols)
          await drawCard(i, mX + col * (cW + mX), mY + row * (cH + mY), cW, cH, 'sm')
        }
      }

      const suffix = format === 'poster' ? 'poster' : format === 'tent' ? 'tent' : 'grid'
      doc.save(`QR-Mese-${suffix}-${restaurant.name.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`)
      toast('PDF descărcat')
    } catch (e) {
      toast('Eroare PDF: ' + (e instanceof Error ? e.message : 'unknown'), 'error')
    }
    setDownloading(null)
  }

  // Închide dropdown-ul de export la click în afara lui.
  useEffect(() => {
    if (!pdfMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (pdfMenuRef.current && !pdfMenuRef.current.contains(e.target as Node))
        setPdfMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pdfMenuOpen])

  // Opțiunile de export PDF (etichete comerciale în RO).
  const pdfFormats: { id: PdfFormat; label: string; hint: string }[] = [
    { id: 'grid', label: 'Grilă — 6 / pagină', hint: 'Pentru lipit pe mese' },
    { id: 'tent', label: 'Carduri pliabile', hint: '4 / pagină, tip cort' },
    { id: 'poster', label: 'Poster A4', hint: '1 QR mare / pagină' },
  ]

  // Zone unice pentru filtru + lista filtrată după căutare/zonă.
  const zoneOptions = Array.from(
    new Set(tables.map((t) => t.zone).filter(Boolean) as string[]),
  ).sort((a, b) => a.localeCompare(b, 'ro'))
  const q = search.trim().toLowerCase()
  const visibleTables = tables.filter(
    (t) =>
      (q === '' || t.name.toLowerCase().includes(q)) &&
      (zoneFilter === '' || t.zone === zoneFilter),
  )
  // Bara de căutare/filtru apare doar când lista devine greu de scanat vizual.
  const showFilters = tables.length > 8

  // Grupare pe zonă: activă doar când lista e mare ȘI nu e deja restrânsă la o
  // singură zonă prin filtru (altfel antetele ar fi redundante). Sub prag = listă plată.
  const NO_ZONE = 'Fără zonă'
  const groupByZone = tables.length > 12 && zoneFilter === ''
  // Grupuri derivate din visibleTables (nu din zoneOptions) ca să reflecte căutarea
  // curentă: zone reale sortate `ro`, plus „Fără zonă" mereu la final, fără grupuri goale.
  const zoneGroups: { zone: string; items: TableRow[] }[] = (() => {
    if (!groupByZone) return []
    const map = new Map<string, TableRow[]>()
    for (const t of visibleTables) {
      const key = t.zone ?? NO_ZONE
      const arr = map.get(key)
      if (arr) arr.push(t)
      else map.set(key, [t])
    }
    const named = Array.from(map.keys())
      .filter((k) => k !== NO_ZONE)
      .sort((a, b) => a.localeCompare(b, 'ro'))
    const ordered = [...named, ...(map.has(NO_ZONE) ? [NO_ZONE] : [])]
    return ordered.map((zone) => ({ zone, items: map.get(zone) as TableRow[] }))
  })()
  // Sursa unică de randare: grupuri reale SAU un singur pseudo-grup (listă plată, fără antet).
  // Astfel rândul de card rămâne o singură dată în JSX, doar învelit.
  const groups: { zone: string; items: TableRow[] }[] = groupByZone
    ? zoneGroups
    : [{ zone: '', items: visibleTables }]

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
            Mese & QR
          </h2>
          <p style={{ color: D.t2, fontSize: '0.78rem', marginTop: 3 }}>
            {tables.filter((t) => t.is_active).length} active · {tables.length} total
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tables.length > 0 && (
            <div ref={pdfMenuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setPdfMenuOpen((o) => !o)}
                disabled={downloading !== null}
                aria-haspopup="menu"
                aria-expanded={pdfMenuOpen}
                title="Descarcă QR-urile în format PDF pentru print"
                style={btn({
                  background: D.s3,
                  color: D.t1,
                  border: `1px solid ${D.border}`,
                  opacity: downloading !== null ? 0.7 : 1,
                })}
              >
                <Icon name="download" size={16} />
                {downloading !== null ? 'Se descarcă...' : 'Descarcă QR-uri'}
                <Icon name="chevronDown" size={14} />
              </button>
              {pdfMenuOpen && (
                <div
                  role="menu"
                  aria-label="Formate de descărcare QR"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    zIndex: 50,
                    minWidth: 240,
                    background: D.s2,
                    border: `1px solid ${D.border}`,
                    borderRadius: 12,
                    padding: 6,
                    boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  {pdfFormats.map((f) => (
                    <button
                      key={f.id}
                      role="menuitem"
                      // Spinner-ul apare doar pe opțiunea apăsată; meniul se închide la final.
                      onClick={() => {
                        void (async () => {
                          await downloadPdf(f.id)
                          setPdfMenuOpen(false)
                        })()
                      }}
                      disabled={downloading !== null}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        textAlign: 'left',
                        minHeight: 44,
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: 'transparent',
                        border: 'none',
                        color: D.t1,
                        cursor: downloading !== null ? 'default' : 'pointer',
                        fontFamily: 'DM Sans,sans-serif',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = D.s3)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <Icon name={downloading === f.id ? 'refresh' : 'download'} size={16} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span
                          style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500 }}
                        >
                          {downloading === f.id ? 'Se descarcă...' : f.label}
                        </span>
                        <span style={{ display: 'block', fontSize: '0.7rem', color: D.t2 }}>
                          {f.hint}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => setModal('add')}
            style={btn({ background: D.gold, color: '#000' })}
          >
            <Icon name="plus" size={16} />
            Adaugă masă
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
            <Icon name="alert" size={18} color="#E8A020" />
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

      {/* Generare rapidă: fluxul principal pentru patron — fără termeni tehnici */}
      {!loading && !loadError && (
        <div
          style={{
            background: D.s2,
            border: `1px solid ${D.border}`,
            borderRadius: 14,
            padding: '20px 22px',
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.05rem',
              color: D.t1,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            {tables.length === 0
              ? 'Nu ai mese configurate încă'
              : 'Generează QR-urile pentru mese'}
          </div>
          <p style={{ color: D.t2, fontSize: '0.8rem', marginBottom: 14, lineHeight: 1.5 }}>
            {tables.length === 0
              ? 'Adaugă numărul de mese, iar Menuvia îți generează automat QR-urile.'
              : 'Spune-ne câte mese ai, iar Menuvia creează automat QR-urile pentru fiecare masă.'}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="number"
              min={1}
              value={bulkCount}
              onChange={(e) => {
                setBulkCount(e.target.value)
                setLimitMsg(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && void bulkGenerate()}
              placeholder="Câte mese? ex. 80"
              style={{
                background: D.s3,
                border: `1px solid ${D.border}`,
                borderRadius: 9,
                padding: '10px 14px',
                color: D.t1,
                fontSize: '0.9rem',
                fontFamily: 'DM Sans,sans-serif',
                width: 220,
              }}
            />
            <button
              onClick={() => void bulkGenerate()}
              disabled={bulkBusy}
              style={btn({
                background: D.gold,
                color: '#000',
                opacity: bulkBusy ? 0.7 : 1,
              })}
            >
              {bulkBusy
                ? 'Se generează...'
                : tables.length === 0
                  ? 'Generează mese și QR-uri'
                  : 'Generează QR-uri'}
            </button>
          </div>
          {limitMsg && (
            <div
              style={{
                marginTop: 10,
                background: 'rgba(232,160,32,0.1)',
                border: '1px solid rgba(232,160,32,0.25)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#E8A020',
                fontSize: '0.78rem',
              }}
            >
              {limitMsg}
            </div>
          )}
          <p style={{ color: D.t2, fontSize: '0.72rem', marginTop: 10 }}>
            Poți edita, dezactiva sau regenera orice QR mai târziu.
          </p>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Skeleton variant="card" count={4} height={72} />
        </div>
      ) : loadError ? (
        <EmptyState
          icon="alert"
          title="Nu s-au putut încărca mesele"
          description={loadError}
          action={
            <button
              onClick={load}
              style={btn({ background: D.s2, color: D.gold, border: `1px solid ${D.border}` })}
            >
              <Icon name="refresh" size={16} />
              Reîncearcă
            </button>
          }
        />
      ) : tables.length === 0 ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Căutare + filtru pe zonă — utile la zeci de mese. Grupare pe zonă = follow-up. */}
          {showFilters && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                alignItems: 'center',
                marginBottom: 4,
              }}
            >
              <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: D.t3,
                    pointerEvents: 'none',
                    display: 'inline-flex',
                  }}
                >
                  <Icon name="search" size={16} />
                </span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Caută după nume..."
                  aria-label="Caută masă după nume"
                  style={{ ...inp, paddingLeft: 38 }}
                  onFocus={(e) => (e.target.style.borderColor = D.gold)}
                  onBlur={(e) => (e.target.style.borderColor = D.border)}
                />
              </div>
              {zoneOptions.length > 0 && (
                <select
                  value={zoneFilter}
                  onChange={(e) => setZoneFilter(e.target.value)}
                  aria-label="Filtrează după zonă"
                  style={{ ...inp, width: 'auto', minWidth: 150, cursor: 'pointer' }}
                >
                  <option value="">Toate zonele</option>
                  {zoneOptions.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {visibleTables.length === 0 ? (
            <p style={{ color: D.t2, fontSize: '0.85rem', padding: '12px 2px' }}>
              Nicio masă nu corespunde căutării.
            </p>
          ) : null}
          {groups.map((g) => (
            <div
              key={g.zone || '__flat'}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              {/* Antet de secțiune pe zonă (mic, uppercase, D.t3) + numărul de mese */}
              {groupByZone && (
                <div
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: D.t3,
                    padding: '6px 2px 0',
                  }}
                >
                  {g.zone} · {g.items.length}
                </div>
              )}
              {g.items.map((t) => (
            <div
              key={t.id}
              style={{
                background: D.s2,
                border: `1px solid ${D.border}`,
                borderRadius: 12,
                padding: '14px 16px',
                // Coloană: rândul info (icon + nume + QR) sus, rândul de acțiuni jos.
                // Evită overflow-ul orizontal care tăia butoanele pe 375px.
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                opacity: t.is_active ? 1 : 0.6,
              }}
            >
              {/* Rând info: icon + nume/status (flexibil) + QR pe dreapta */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: D.s3,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  color: D.t2,
                }}
              >
                <Icon name="table" size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: D.t1 }}>{t.name}</span>
                  {t.seats && (
                    <span style={{ fontSize: '0.72rem', color: D.t3 }}>{t.seats} locuri</span>
                  )}
                  {t.zone && (
                    <span
                      style={{
                        fontSize: '0.65rem',
                        background: D.goldA,
                        color: D.gold,
                        padding: '1px 7px',
                        borderRadius: 4,
                        letterSpacing: '0.02em',
                      }}
                    >
                      {t.zone}
                    </span>
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
                <div
                  style={{
                    fontSize: '0.72rem',
                    marginTop: 2,
                    color: t.active_token && t.is_active ? D.green : D.t2,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  {!t.active_token ? (
                    <>
                      <Icon name="alert" size={13} color={D.t2} />
                      Fără QR — apasă „Generează QR"
                    </>
                  ) : t.is_active ? (
                    <>
                      <Icon name="check" size={13} color={D.green} />
                      QR activ
                    </>
                  ) : (
                    'QR dezactivat'
                  )}
                </div>
              </div>
              {/* FIX: QRImage generates locally — no api.qrserver.com */}
              {t.active_token && (
                <div style={{ background: '#F8F3EB', borderRadius: 8, padding: 4, flexShrink: 0 }}>
                  <QRImage token={t.active_token.token} size={48} />
                </div>
              )}
              </div>
              {/* Rând acțiuni: wrap pe mai multe rânduri ca să nu se taie butoanele pe mobil */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {t.active_token && (
                  <button
                    onClick={() => void downloadPng(t)}
                    title="Descarcă QR (PNG)"
                    aria-label="Descarcă QR (PNG)"
                    style={{
                      width: 44,
                      height: 44,
                      minWidth: 44,
                      minHeight: 44,
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
                    <Icon name="download" size={16} />
                  </button>
                )}
                {t.active_token && (
                  <button
                    onClick={() => copyLink(t)}
                    title="Copiază link"
                    aria-label="Copiază link"
                    style={{
                      width: 44,
                      height: 44,
                      minWidth: 44,
                      minHeight: 44,
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
                    <Icon name="link" size={16} />
                  </button>
                )}
                <button
                  onClick={() => {
                    // Fără QR existent nu e nimic de invalidat — generăm direct.
                    if (!t.active_token) void rotateToken(t)
                    else setRotateTarget(t)
                  }}
                  disabled={rotating === t.id}
                  title={t.active_token ? 'Regenerează QR' : 'Generează QR'}
                  aria-label={t.active_token ? 'Regenerează QR' : 'Generează QR'}
                  style={{
                    width: 44,
                    height: 44,
                    minWidth: 44,
                    minHeight: 44,
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
                  <Icon name="refresh" size={16} />
                </button>
                <button
                  onClick={() => toggleActive(t)}
                  title={t.is_active ? 'Dezactivează' : 'Activează'}
                  aria-label={t.is_active ? 'Dezactivează masă' : 'Activează masă'}
                  style={{
                    width: 44,
                    height: 44,
                    minWidth: 44,
                    minHeight: 44,
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
                  {/* Iconul diferă per stare (nu doar culoarea): bifă = activă, X = inactivă. */}
                  <Icon name={t.is_active ? 'check' : 'close'} size={16} />
                </button>
                <button
                  onClick={() => setModal(t)}
                  title="Editează masă"
                  aria-label="Editează masă"
                  style={{
                    width: 44,
                    height: 44,
                    minWidth: 44,
                    minHeight: 44,
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
                  <Icon name="edit" size={16} />
                </button>
                <button
                  onClick={() => setDelId(t.id)}
                  title="Șterge masă"
                  aria-label="Șterge masă"
                  style={{
                    width: 44,
                    height: 44,
                    minWidth: 44,
                    minHeight: 44,
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
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </div>
              ))}
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
      {rotateTarget && (
        <div
          onClick={() => setRotateTarget(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setRotateTarget(null)
          }}
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
            role="dialog"
            aria-modal="true"
            aria-label={`Regenerează QR pentru ${rotateTarget.name}`}
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 16,
              padding: 24,
              maxWidth: 380,
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
              Regenerează QR — {rotateTarget.name}
            </div>
            <p style={{ color: D.t2, marginBottom: 22, fontSize: '0.875rem', lineHeight: 1.55 }}>
              QR-ul vechi nu va mai funcționa. Vrei să generezi unul nou pentru această masă?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                autoFocus
                onClick={() => setRotateTarget(null)}
                style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
              >
                Anulează
              </button>
              <button
                onClick={() => {
                  const t = rotateTarget
                  setRotateTarget(null)
                  void rotateToken(t)
                }}
                style={btn({ background: D.gold, color: '#000' })}
              >
                Regenerează
              </button>
            </div>
          </div>
        </div>
      )}
      {delId && (
        <div
          onClick={() => setDelId(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDelId(null)
          }}
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
            role="dialog"
            aria-modal="true"
            aria-label="Șterge masă"
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
                autoFocus
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
