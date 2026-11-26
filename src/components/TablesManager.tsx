// =============================================================
// Menuvia — src/components/TablesManager.tsx
// QR generation: local via `qrcode` npm — no external API dependency.
// PDF generation: local via `jspdf` npm — no CDN injection.
// =============================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { FocusTrap } from './ui/FocusTrap'
import { useFeatures } from '../hooks/useFeatures'
import { getPlanByInternalId } from '../lib/plans'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { D, D_RAW } from '../lib/constants'
import { Icon } from './ui/Icon'
import { Button } from './ui/Button'
import { useToast, Toast } from './_dashboard/sharedUI'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'
import type { Restaurant } from '../hooks/useData'
import { publicBaseUrl, siteHost } from '../lib/domain'
import { downloadQrPdf, QR_PDF_NO_CARDS_HINT, type QrPdfFormat } from '../lib/qrPdf'
import { tablesMissingActiveToken } from '../lib/qrTokens'
import { bulkTableName, bulkTableNumber, bulkTableSeries, bulkTableSlug, slugifyTable } from '../lib/tableSlug'
import { sortTablesByName } from '../lib/tableSort'
import { allSelected, planQrPrint, withIds } from '../lib/tableSelection'
import { menuBaseLang } from '../lib/i18nMenu'
import { pickupCopyT, pickupFeatureState } from '../lib/pickupCopy'
import { pickupOnlyMode } from '../lib/pickupAvailability'
import { resolveEffectiveMenuLayout } from '../lib/themes'
import { zeroRowsAsDenied } from '../lib/userMessages'
import { useT } from '../i18n/useT'
import { describeStaffError } from '../i18n/staffErrors'
import { fillNodes } from '../i18n/fillNodes'
import { tablesNs } from '../i18n/ns/tables'
import { commonNs } from '../i18n/ns/common'

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

// Butoanele doar-iconiță de pe rândul mesei: pătrat de 44px (ținta tactilă),
// aceeași variantă `secondary` ca restul acțiunilor.
const ICON_BTN: React.CSSProperties = { width: 44, minWidth: 44, padding: 0 }
const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '10px 13px',
  fontSize: '0.9rem',
  color: D.t1,
  outline: 'none',
  fontFamily: D.fontBody,
  boxSizing: 'border-box',
}
// Slug-ul mesei (DATĂ, `masa`/`masa-N` în orice limbă): lib/tableSlug.ts.

// ── QR helpers — all local, no external API ─────────────────
// Baza: pe .ro EXACT ca înainte (`VITE_APP_URL || origin`); pe un host .com tot
// .ro — QR-urile nu poartă niciodată domeniul .com (publicBaseUrl, lib/domain.ts).
function appPublicBase(): string {
  return publicBaseUrl(window.location.hostname, import.meta.env.VITE_APP_URL, window.location.origin)
}

function qrUrl(token: string): string {
  return `${appPublicBase()}/q/${token}`
}

async function generateQRDataURL(token: string, size: number): Promise<string> {
  return QRCode.toDataURL(qrUrl(token), {
    width: size,
    margin: 1,
    color: { dark: D_RAW.onGold, light: D_RAW.qrPaper },
  })
}

// ── QRImage component — generates QR locally on mount ────────
function QRImage({ token, size = 80, label }: { token: string; size?: number; label?: string }) {
  // Sus, înaintea return-ului timpuriu de mai jos (lotul L6a).
  const tm = useT(tablesNs)
  const [src, setSrc] = useState('')
  // UX: eșecul de generare se distinge vizual de starea de încărcare (alertă vs pătrat gol).
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
    generateQRDataURL(token, size * 2) // 2x for sharpness
      .then(setSrc)
      .catch(() => {
        setSrc('')
        setFailed(true)
      })
  }, [token, size])
  if (!src)
    return (
      <div
        role={failed ? 'img' : undefined}
        aria-label={failed ? tm.t('qr_genFailed') : undefined}
        title={failed ? tm.t('qr_genFailed') : undefined}
        style={{
          width: size,
          height: size,
          background: D.qrPaper,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {failed && <Icon name="alert" size={Math.min(20, Math.round(size / 2))} color={D.qrMuted} />}
      </div>
    )
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={label ? tm.t('qr_alt', { label }) : tm.t('qr_altPlain')}
      style={{ display: 'block', borderRadius: 4 }}
    />
  )
}

// Toast-ul vine din sistemul unic (sharedUI → ui/useToast, lotul V): înainte
// TablesManager avea a TREIA implementare proprie, cu alt aspect și altă durată.

// ── TableModal ────────────────────────────────────────────────
type ModalError = 'modal_err_nameRequired' | 'modal_err_duplicate' | 'modal_err_save'

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
  const tm = useT(tablesNs)
  const tc = useT(commonNs)
  const [saving, setSaving] = useState(false)
  // Eroarea ca DATĂ (cheia), tradusă la randare: o schimbare de limbă cu
  // eroarea pe ecran o retraduce (lotul L6a, TQ5).
  const [error, setError] = useState<ModalError | null>(null)
  const auto = !table

  // UX: blochează scroll-ul paginii din fundal cât timp modalul e deschis.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

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
      setError('modal_err_nameRequired')
      return
    }
    setSaving(true)
    setError(null)
    const s = slug || slugifyTable(name)
    const z = zone.trim().length > 0 ? zone.trim() : null
    const payload = { name: name.trim(), slug: s, seats: seats ? parseInt(seats) : null, zone: z }
    const { error: e } = table
      ? await supabase.from('tables').update(payload).eq('id', table.id)
      : await supabase.from('tables').insert({ ...payload, restaurant_id: restaurantId })
    if (e) {
      // Copy: nu afișăm mesajul PostgREST brut (engleză) patronului — mapăm codurile
      // cunoscute pe română; detaliul tehnic rămâne în consolă pentru diagnoză.
      console.error('[TablesManager] save:', e)
      setError(e.code === '23505' ? 'modal_err_duplicate' : 'modal_err_save')
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
        background: D.overlay,
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
        aria-label={table ? tm.t('editTable') : tm.t('addTable')}
        style={{
          background: D.s2,
          border: `1px solid ${D.border}`,
          borderRadius: 16,
          width: '100%',
          maxWidth: 400,
          padding: 24,
          // Responsive: pe ecrane mici (tastatură deschisă) conținutul derulează
          // în interiorul cardului — butonul Salvează rămâne accesibil.
          maxHeight: '90dvh',
          overflowY: 'auto',
        }}
      >
        <FocusTrap />
        <div
          style={{
            fontFamily: D.fontDisplay,
            fontSize: '1.05rem',
            color: D.t1,
            marginBottom: 20,
          }}
        >
          {table ? tm.t('editTable') : tm.t('addTable')}
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}>
            {tm.t('modal_name')}
          </label>
          <input
            // A11y: focus automat pe primul câmp la deschiderea modalului.
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (auto) setSlug(slugifyTable(e.target.value))
            }}
            placeholder={tm.t('modal_namePlaceholder')}
            style={inp}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}>
            {tm.t('modal_slug')}
          </label>
          <input
            value={slug}
            onChange={(e) => setSlug(slugifyTable(e.target.value))}
            placeholder={tm.t('modal_slugPlaceholder')}
            style={inp}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
          <div style={{ fontSize: '0.7rem', color: D.t2, marginTop: 4 }}>
            {tm.t('modal_slugHint')}
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}>
            {tm.t('modal_seats')}
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
            {tm.t('modal_zone')}
          </label>
          <input
            list="table-zones"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            placeholder={tm.t('modal_zonePlaceholder')}
            style={inp}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
          {existingZones.length === 0 ? null : (
            <datalist id="table-zones">
              {existingZones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          )}
          <div style={{ fontSize: '0.7rem', color: D.t2, marginTop: 4 }}>
            {tm.t('modal_zoneHint')}
          </div>
        </div>
        {error === null ? null : (
          <div
            style={{
              background: D.redA,
              border: `1px solid ${D.redBorder}`,
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              color: D.red,
              marginBottom: 14,
            }}
          >
            {tm.t(error)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>
            {tc.t('cancel')}
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {saving ? tm.t('saving') : tc.t('save')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Zona pentru mesele selectate (lotul C5b) ─────────────────
// Înainte zona se seta doar masă cu masă, din TableModal: 20 de mese create de
// generarea rapidă = 20 de modale. Câmp gol = fără zonă. Scrierea e un singur
// UPDATE în TablesManager (`applyZoneToSelected`).
function ZoneBulkModal({
  count,
  zones,
  busy,
  onApply,
  onClose,
}: {
  count: number
  zones: string[]
  busy: boolean
  onApply: (zone: string | null) => void
  onClose: () => void
}) {
  const tm = useT(tablesNs)
  const tc = useT(commonNs)
  // Câmp necontrolat: valoarea se citește doar la aplicare.
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const apply = () => {
    const z = (inputRef.current?.value ?? '').trim()
    onApply(z.length > 0 ? z : null)
  }

  return (
    <div
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: D.overlay,
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
        aria-label={tm.tp('zoneBulk_title', count)}
        style={{
          background: D.s2,
          border: `1px solid ${D.border}`,
          borderRadius: 16,
          width: '100%',
          maxWidth: 380,
          padding: 24,
          maxHeight: '90dvh',
          overflowY: 'auto',
        }}
      >
        <FocusTrap />
        <div style={{ fontFamily: D.fontDisplay, fontSize: '1.05rem', color: D.t1, marginBottom: 16 }}>
          {tm.tp('zoneBulk_title', count)}
        </div>
        <label
          htmlFor="zone-bulk-input"
          style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}
        >
          {tm.t('zoneBulk_label')}
        </label>
        <input
          id="zone-bulk-input"
          ref={inputRef}
          autoFocus
          list="table-zones-bulk"
          defaultValue=""
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply()
          }}
          placeholder={tm.t('modal_zonePlaceholder')}
          style={inp}
          onFocus={(e) => (e.target.style.borderColor = D.gold)}
          onBlur={(e) => (e.target.style.borderColor = D.border)}
        />
        {zones.length === 0 ? null : (
          <datalist id="table-zones-bulk">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        )}
        <div style={{ fontSize: '0.7rem', color: D.t2, marginTop: 4, marginBottom: 20 }}>
          {tm.t('zoneBulk_hint')}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>
            {tc.t('cancel')}
          </Button>
          <Button variant="primary" onClick={apply} loading={busy}>
            {busy ? tm.t('saving') : tc.t('save')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── QR-ul meniului general (/m/:slug) ────────────────────────
// Link-ul public e deja indexabil (mig 217/219) — un QR descărcabil pentru
// el e util universal (vitrine, flyere), iar pentru food truck (mod „doar
// ridicare") devine QR-ul principal.
function GeneralMenuQrCard({
  restaurant,
  toast,
  pickupFeature,
  menuFlipbook,
}: {
  restaurant: Restaurant
  toast: (msg: string, type?: string) => void
  // `pickup_orders` al restaurantului, tristate (lib/pickupCopy.ts): promisiunea
  // de comenzi DOAR pe feature cunoscut activ — din mig 309 pagina publică nu
  // arată ridicarea fără el, oricât ar fi setarea pornită.
  pickupFeature: boolean | null
  // Stilul EFECTIV salvat e flipbook: pagina publică n-are coș, deci nici
  // comenzi pentru ridicare, pe niciun plan (lib/themes).
  menuFlipbook: boolean
}) {
  const tm = useT(tablesNs)
  // Textele despre ridicare, în limba personalului (în română EXACT
  // `generalMenuQrText` din lib/pickupCopy).
  const pickupTexts = pickupCopyT(tm)
  const [qr, setQr] = useState<string | null>(null)
  const menuUrl = `${appPublicBase()}/m/${restaurant.slug}`

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(menuUrl, {
      width: 480,
      margin: 1,
      color: { dark: D_RAW.onGold, light: D_RAW.qrPaper },
    })
      .then((url) => {
        if (!cancelled) setQr(url)
      })
      .catch(() => {
        /* QR-ul general e secundar — fără el, link-ul rămâne copiabil */
      })
    return () => {
      cancelled = true
    }
  }, [menuUrl])

  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
      }}
    >
      {qr === null ? null : (
        <img
          src={qr}
          alt={tm.t('general_title')}
          width={72}
          height={72}
          style={{ borderRadius: 8, flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.9rem' }}>{tm.t('general_title')}</div>
        <div style={{ color: D.t2, fontSize: '0.74rem', marginTop: 2, lineHeight: 1.5 }}>
          {fillNodes(tm.t('general_leadsTo'), {
            path: <span style={{ color: D.gold }}>/m/{restaurant.slug}</span>,
            text: pickupTexts.generalMenuQrText(pickupFeature, menuFlipbook),
          })}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          variant="secondary"
          onClick={() => {
            if (!qr) return
            const a = document.createElement('a')
            a.href = qr
            a.download = `QR-meniu-${restaurant.slug}.png`
            a.click()
          }}
          disabled={!qr}
          icon={<Icon name="download" size={15} />}
        >
          {tm.t('general_png')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            navigator.clipboard
              .writeText(menuUrl)
              .then(() => toast(tm.t('linkCopied')))
              .catch(() => toast(tm.t('general_copyFailed'), 'error'))
          }}
          icon={<Icon name="link" size={15} />}
        >
          {tm.t('copyLink')}
        </Button>
      </div>
    </div>
  )
}

// ── TablesManager ─────────────────────────────────────────────
export default function TablesManager({
  restaurant,
  canRotateQr,
}: {
  restaurant: Restaurant
  // Obligatoriu (fără implicit permisiv). Partenerul (mig 286): `rotate_qr_token`
  // verifică membership-ul real, fără escape de partener — „Regenerează QR" i-ar
  // da doar un refuz. CREAREA unui token pe o masă FĂRĂ QR îi rămâne: politica
  // de partener pe `qr_tokens` permite INSERT-ul din `ensureTokens`.
  canRotateQr: boolean
}) {
  // Traducătorii sus, înaintea oricărui return (lotul L6a). `tm`, nu `t`: `t`
  // e deja masa curentă în bucle și în handler-e.
  const tm = useT(tablesNs)
  const tc = useT(commonNs)
  const pickupTexts = pickupCopyT(tm)
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
  type PdfFormat = QrPdfFormat
  const [downloading, setDownloading] = useState<PdfFormat | null>(null)
  // Dropdown „Descarcă QR-uri" — colapsează cele 3 butoane de export într-unul.
  const [pdfMenuOpen, setPdfMenuOpen] = useState(false)
  const pdfMenuRef = useRef<HTMLDivElement>(null)
  // A11y: la Escape, focusul revine pe butonul care a deschis meniul.
  const pdfTriggerRef = useRef<HTMLButtonElement>(null)
  // Căutare + filtru pe zonă pentru lista de mese (utile la zeci de mese).
  const [search, setSearch] = useState('')
  const [zoneFilter, setZoneFilter] = useState('')
  // Eroarea de încărcare ca DATĂ (eroarea brută), tradusă la randare.
  const [loadError, setLoadError] = useState<{ err: unknown } | null>(null)
  // Generare rapidă: „Câte mese ai?" → creăm Masa 1..N dintr-un foc.
  const [bulkCount, setBulkCount] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  // Plafonul planului atins: limita (DATĂ), mesajul se compune la randare.
  const [limitMsg, setLimitMsg] = useState<number | null>(null)
  // Selecția meselor (lotul C5b): PDF-ul doar pentru mesele alese, zona și
  // activarea în lot. Ține ID-uri; mesele selectate se derivă din listă, deci
  // o masă ștearsă între timp iese singură din selecție.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [zoneBulkOpen, setZoneBulkOpen] = useState(false)
  const [selBusy, setSelBusy] = useState(false)
  // Mesele lăsate pe dinafară de ultimul PDF (NUMĂRATE, nu text): rămâne pe
  // ecran până e închis, cu scurtătura „Generează QR-urile lipsă”.
  const [skipNotice, setSkipNotice] = useState<{ noQr: number; inactive: number } | null>(null)
  const [skipBusy, setSkipBusy] = useState(false)
  // Meniul „Card PDF” al unui rând (ID-ul mesei) și descărcarea în curs.
  const [cardMenu, setCardMenu] = useState<string | null>(null)
  const [cardBusy, setCardBusy] = useState<string | null>(null)
  const cardMenuRef = useRef<HTMLDivElement>(null)

  // Limita de mese: numărul REAL din DB (get_restaurant_features, aliniat cu
  // plans.ts prin mig 089); fallback pe config-ul comercial dacă fetch-ul
  // eșuează. null = nelimitat (enterprise).
  const restaurantFeatures = useFeatures(restaurant.id)
  const maxTables: number | null = restaurantFeatures.features
    ? restaurantFeatures.limit('max_tables')
    : getPlanByInternalId('free').limits.maxTables
  // Ridicarea vizibilă oaspetelui (mig 309) — tristate, null = plan necunoscut.
  const pickupFeature = pickupFeatureState(restaurantFeatures.features)
  // Modul „doar ridicare” din ACELAȘI helper ca nav-ul din DashboardPage: pe
  // planul cunoscut fără ridicare e 'suspended' — empty state-ul spune că
  // panoul arată mesele, nu „nu ai nevoie de mese”; cu ridicarea oprită în
  // setare modul e inert ('off'), ca în nav.
  const pickupOnly = pickupOnlyMode(restaurant.pickup_settings, pickupFeature)
  // Stilul EFECTIV salvat (flipbook fără pagini = listă) — pe flipbook pagina
  // publică n-are coș, deci textele nu promit comenzi (lib/pickupCopy.ts).
  const menuFlipbook = resolveEffectiveMenuLayout(restaurant.theme_settings) === 'flipbook'

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
        const { data: tkData, error: tkErr } = await supabase
          .from('qr_tokens')
          .select('*')
          .in('table_id', ids)
          .eq('is_active', true)
        // Token-urile NECUNOSCUTE nu înseamnă „mese fără QR”: lista ar arăta
        // „Generează QR”, iar un token nou oprește QR-ul deja tipărit (mig 119).
        // Toată lista intră pe eroare, cu Reîncearcă (lib/qrTokens.ts).
        if (tkErr) throw tkErr
        for (const tk of (tkData || []) as QrTokenRow[]) tokenMap[tk.table_id] = tk
      }
      // Ordinea NATURALĂ (Masa 2 < Masa 10), nu cea de text a lui
      // `.order('name')`: lista, grupurile pe zonă și cardurile PDF-ului o
      // moștenesc de aici (lib/tableSort.ts, lotul C5b).
      setTables(
        sortTablesByName(
          (tData || []).map((t: Record<string, unknown>) => ({
            ...(t as unknown as TableRow),
            active_token: tokenMap[t.id as string] || null,
          })),
        ),
      )
    } catch (e: unknown) {
      setLoadError({ err: e })
    }
    setLoading(false)
  }, [restaurant.id])

  useEffect(() => {
    load()
  }, [load])

  // `true` = acoperirea cu token-uri a fost VERIFICATĂ (și completată unde
  // lipsea). `false` = nu se știe sau inserarea a picat: eroarea a fost deja
  // afișată, iar apelantul NU are voie să anunțe succesul („fiecare cu QR-ul
  // ei”) imediat sub ea — toast-urile se stivuiesc, deci s-ar vedea amândouă.
  const ensureTokens = async (): Promise<boolean> => {
    try {
      const { data: tData, error: tErr } = await supabase
        .from('tables')
        .select('id')
        .eq('restaurant_id', restaurant.id)
      if (tErr) throw tErr
      const ids = (tData || []).map((t: Record<string, unknown>) => t.id as string)
      if (!ids.length) return true
      const existing = await supabase
        .from('qr_tokens')
        .select('table_id')
        .in('table_id', ids)
        .eq('is_active', true)
      // Doar mesele DOVEDIT fără token activ primesc unul. Citire picată → nu
      // generăm nimic: un token nou ar opri QR-ul tipărit al mesei (mig 119).
      const missing = tablesMissingActiveToken(
        ids,
        existing as { data: Array<{ table_id: string }> | null; error: unknown },
      )
      if (missing === null) {
        toast(tm.t('toast_verifyFailed'), 'error')
        await load()
        return false
      }
      if (missing.length > 0) {
        const { error: insErr } = await supabase
          .from('qr_tokens')
          .insert(missing.map((table_id) => ({ restaurant_id: restaurant.id, table_id })))
        if (insErr) throw insErr
      }
      await load()
      return true
    } catch {
      toast(tm.t('toast_tokensFailed'), 'error')
      return false
    }
  }

  const handleSave = async () => {
    setModal(null)
    try {
      // OPT-R2: fără load() redundant înainte — ensureTokens re-interoghează
      // el însuși id-urile proaspete (inclusiv masa tocmai adăugată) și se
      // termină cu un load() complet. Un singur ciclu de reload, nu două.
      if (await ensureTokens()) toast(modal === 'add' ? tm.t('toast_added') : tm.t('toast_updated'))
    } catch {
      toast(tm.t('toast_saveFailed'), 'error')
    }
  }

  const handleDelete = async () => {
    if (!delId) return
    try {
      // `.select('id')`: un DELETE refuzat de RLS întoarce 0 rânduri FĂRĂ
      // eroare — fără numărare, „Masă ștearsă" apărea pe o masă care rămânea.
      const denied = zeroRowsAsDenied(
        await supabase.from('tables').delete().eq('id', delId).select('id'),
      )
      if (denied) {
        toast(describeStaffError(denied, tc, { fallback: tm.t('toast_deleteFailed') }), 'error')
      } else {
        toast(tm.t('toast_deleted'))
        await load()
      }
    } catch (e) {
      toast(describeStaffError(e, tc, { fallback: tm.t('toast_deleteFailed') }), 'error')
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
      toast(t.is_active ? tm.t('toast_deactivated') : tm.t('toast_activated'))
      await load()
    } catch {
      toast(tm.t('toast_updateFailed'), 'error')
    }
  }

  const rotateToken = async (t: TableRow) => {
    setRotating(t.id)
    try {
      // Rotație ATOMICĂ prin RPC (dezactivare + insert într-o singură tranzacție) — fără
      // fereastra în care masa rămânea fără token activ (mig 166).
      const { error } = await supabase.rpc('rotate_qr_token', { p_table_id: t.id })
      if (error) throw error
      toast(tm.t('toast_rotated'))
    } catch {
      toast(tm.t('toast_rotateFailed'), 'error')
    }
    await load()
    setRotating(null)
  }

  // Masa fără QR, pentru cine nu poate roti (partenerul): doar mesele DOVEDIT
  // fără token activ primesc unul (ensureTokens), deci QR-urile tipărite rămân.
  const generateMissingQr = async (t: TableRow) => {
    setRotating(t.id)
    if (await ensureTokens()) toast(tm.t('toast_rotated'))
    setRotating(null)
  }

  // „Câte mese ai?" → completăm de la Masa {existente+1} până la Masa N.
  // Idempotent prin design: rulat de două ori cu același N nu creează dubluri.
  const bulkGenerate = async () => {
    const n = parseInt(bulkCount, 10)
    setLimitMsg(null)
    if (!n || n < 1) {
      toast(tm.t('bulk_countRequired'), 'error')
      return
    }
    if (n <= tables.length) {
      toast(tm.tp('bulk_alreadyHave', tables.length))
      return
    }
    if (maxTables != null && maxTables < n) {
      setLimitMsg(maxTables)
      return
    }
    setBulkBusy(true)
    try {
      // Indici LIBERI pe baza slug-urilor existente masa-N / table-N / tisch-N (nu
      // tables.length+1) — altfel, cu goluri (ex. Masa 3 ștearsă), am genera un slug
      // care coliziează, iar după un onboarding în germană am numerota „Masa 1” lângă
      // „Tisch 1”. Creăm exact (n - tables.length) mese, sărind peste numerele deja
      // folosite în ORICARE serie, și continuăm seria localului (lib/tableSlug.ts).
      const series = bulkTableSeries(
        tables.map((t) => t.slug),
        menuBaseLang(restaurant.language),
      )
      const usedNums = new Set(
        tables
          .map((t) => bulkTableNumber(t.slug))
          .filter((x): x is number => x != null),
      )
      const rows: { restaurant_id: string; name: string; slug: string }[] = []
      let idx = 1
      while (tables.length + rows.length < n) {
        if (!usedNums.has(idx)) {
          // Numele și slug-ul mesei NOI sunt DATE: seria localului, în orice
          // limbă a personalului (numele apare pe cardul QR tipărit și în
          // meniul oaspetelui; după slug se găsesc numerele libere).
          rows.push({ restaurant_id: restaurant.id, name: bulkTableName(idx, series), slug: bulkTableSlug(idx, series) })
        }
        idx++
      }
      const { error } = await supabase.from('tables').insert(rows)
      if (error) throw error
      // OPT-R2: 3 load()-uri complete → 1. ensureTokens re-interoghează
      // id-urile proaspete (insert-ul nu le întoarce) și termină cu load().
      const tokensOk = await ensureTokens()
      setBulkCount('')
      if (tokensOk) toast(tm.tp('bulk_created', rows.length))
    } catch (e) {
      // Copy: mesaj în română pentru patron; detaliul tehnic doar în consolă.
      console.error('[TablesManager] bulkGenerate:', e)
      const code =
        typeof e === 'object' && e !== null && 'code' in e
          ? (e as { code?: string }).code
          : undefined
      toast(code === '23505' ? tm.t('bulk_duplicate') : tm.t('bulk_failed'), 'error')
    }
    setBulkBusy(false)
  }

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

  // Selecția (lotul C5b) apare de la DOUĂ mese: cu una singură, „toate” e
  // deja selecția. Sub prag o selecție rămasă (după o ștergere) nu mai
  // contează — altfel PDF-ul ar ține cont de bife care nu se mai văd.
  const selectionEnabled = tables.length >= 2
  const selectedTables = selectionEnabled ? tables.filter((t) => selected.has(t.id)) : []
  // Ce intră în PDF: selecția, altfel lista VIZIBILĂ (lib/tableSelection.ts).
  const printPlan = planQrPrint(tables, visibleTables, selected, selectionEnabled)

  // Descarcă QR-ul unei singure mese ca PNG (pentru re-print rapid).
  const downloadPng = async (t: TableRow) => {
    if (!t.active_token) return
    try {
      const dataUrl = await generateQRDataURL(t.active_token.token, 600)
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `QR-${t.name.replace(/[^a-zA-Z0-9ăâîșțĂÂÎȘȚ ]/g, '')}.png`
      a.click()
      toast(tm.t('toast_pngDownloaded', { name: t.name }))
    } catch {
      toast(tm.t('toast_downloadFailed'), 'error')
    }
  }

  const copyLink = (t: TableRow) => {
    if (!t.active_token) return
    navigator.clipboard
      .writeText(qrUrl(t.active_token.token))
      .then(() => toast(tm.t('linkCopied')))
      .catch(() => toast(tm.t('toast_copyFailed'), 'error'))
  }

  // PDF: jsPDF se încarcă la cerere (560KB), doar la export. Desenul stă în
  // lib/qrPdf.ts (același PDF îl dă și ecranul final al onboarding-ului).
  // Format: 'grid' (6/A4), 'poster' (1/A4, mare), 'tent' (4/A4, pliabil).
  // Câmpurile comune ale ORICĂRUI PDF de pe filă (lista sau cardul unei mese).
  const pdfBase = () => ({
    restaurantName: restaurant.name,
    primaryColor: restaurant.primary_color,
    // „Pentru a comanda" doar când planul permite comenzi prin QR; pe Meniu
    // Digital QR-ul deschide doar meniul (lib/qrCopy.ts). Necunoscut = fail-closed.
    canOrder: restaurantFeatures.features ? restaurantFeatures.has('order_qr') : false,
    brandHost: siteHost(),
    // Textul TIPĂRIT e pentru oaspete: limba de BAZĂ a meniului, nu a
    // personalului (lib/qrCopy.ts). Pe un meniu românesc, cardul de dinainte.
    menuLanguage: restaurant.language,
  })

  const pdfFailed = (e: unknown) => {
    // În română EXACT `toUserMessage` de dinainte (și „Niciun QR de tipărit”
    // ca atare); în altă limbă refuzul fără carduri are textul lui.
    toast(
      describeStaffError(e, tc, {
        fallback: tm.t('pdf_failed'),
        hints: tc.lang === 'ro' ? undefined : { [QR_PDF_NO_CARDS_HINT]: tm.t('pdf_noCards') },
      }),
      'error',
    )
  }

  // Domeniul vine din `printPlan` (selecția, altfel lista vizibilă). Mesele
  // fără QR sau inactive NU mai dispar tăcut: toast-ul le numără, iar
  // notița de sub antet le spune motivul, cu „Generează QR-urile lipsă”.
  const downloadPdf = async (format: PdfFormat = 'grid') => {
    const { printable, noQr, inactive } = printPlan
    const skipped = noQr.length + inactive.length
    setSkipNotice(skipped > 0 ? { noQr: noQr.length, inactive: inactive.length } : null)
    if (!printable.length) {
      toast(tm.t('pdf_noActive'), 'error')
      return
    }
    setDownloading(format)
    try {
      await downloadQrPdf({
        ...pdfBase(),
        cards: printable.map((t) => ({ label: t.name, url: qrUrl(t.active_token!.token) })),
        format,
      })
      toast(skipped > 0 ? tm.tp('pdf_donePartial', skipped) : tm.t('pdf_done'))
    } catch (e) {
      pdfFailed(e)
    }
    setDownloading(null)
  }

  // Cardul PDF al UNEI mese (pliabil sau poster), cu numele mesei, al
  // restaurantului și instrucțiunea — PNG-ul de pe rând e doar QR-ul gol.
  const downloadCardPdf = async (t: TableRow, format: 'tent' | 'poster') => {
    setCardMenu(null)
    if (!t.active_token || !t.is_active) return
    setCardBusy(t.id)
    try {
      await downloadQrPdf({
        ...pdfBase(),
        cards: [{ label: t.name, url: qrUrl(t.active_token.token) }],
        format,
        filePrefix: `QR-${t.slug}`,
      })
      toast(tm.t('toast_cardDownloaded', { name: t.name }))
    } catch (e) {
      pdfFailed(e)
    }
    setCardBusy(null)
  }

  // Scurtătura din notiță: doar mesele DOVEDIT fără token primesc unul
  // (ensureTokens) — niciun QR deja tipărit nu se schimbă. Fără rotire în lot.
  const generateSkippedQr = async () => {
    setSkipBusy(true)
    if (await ensureTokens()) {
      setSkipNotice(null)
      toast(tm.t('pdf_skipGenerated'))
    }
    setSkipBusy(false)
  }

  // ── Acțiunile pe selecție (lotul C5b) ──
  // Un singur UPDATE `.in('id', …)`, cu `.select('id')`: un UPDATE refuzat de
  // RLS răspunde 200 cu ZERO rânduri (zeroRowsAsDenied), iar unul care atinge
  // mai puține rânduri decât s-au cerut (masă ștearsă între timp) nu se anunță
  // ca succes deplin. Partenerul (mig 286) are scriere pe `tables`, deci poate
  // și el seta zona sau activa mesele; rotirea QR-urilor rămâne interzisă.
  const updateSelected = async (
    patch: { zone: string | null } | { is_active: boolean },
    success: (n: number) => string,
  ): Promise<boolean> => {
    const ids = selectedTables.map((t) => t.id)
    if (ids.length === 0) return false
    setSelBusy(true)
    let ok = false
    try {
      const res = await supabase
        .from('tables')
        .update(patch)
        .eq('restaurant_id', restaurant.id)
        .in('id', ids)
        .select('id')
      const denied = zeroRowsAsDenied(res)
      if (denied) {
        toast(describeStaffError(denied, tc, { fallback: tm.t('toast_updateFailed') }), 'error')
      } else {
        const done = res.data?.length ?? 0
        if (done < ids.length) toast(tm.t('sel_partial', { done, total: ids.length }), 'warning')
        else toast(success(done))
        ok = true
      }
    } catch (e) {
      toast(describeStaffError(e, tc, { fallback: tm.t('toast_updateFailed') }), 'error')
    }
    await load()
    setSelBusy(false)
    return ok
  }

  const applyZoneToSelected = async (zone: string | null) => {
    const ok = await updateSelected({ zone }, (n) =>
      zone === null ? tm.tp('zoneBulk_cleared', n) : tm.tp('zoneBulk_done', n),
    )
    if (ok) setZoneBulkOpen(false)
  }

  const setSelectedActive = (active: boolean) =>
    void updateSelected({ is_active: active }, (n) =>
      active ? tm.tp('sel_activated', n) : tm.tp('sel_deactivated', n),
    )

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
  // La fel pentru meniul „Card PDF” al unui rând.
  useEffect(() => {
    if (cardMenu === null) return
    const onDoc = (e: MouseEvent) => {
      if (cardMenuRef.current && !cardMenuRef.current.contains(e.target as Node)) setCardMenu(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [cardMenu])

  // Opțiunile de export PDF (etichetele în limba personalului).
  const pdfFormats: { id: PdfFormat; label: string; hint: string }[] = [
    { id: 'grid', label: tm.t('pdf_grid'), hint: tm.t('pdf_gridHint') },
    { id: 'tent', label: tm.t('pdf_tent'), hint: tm.t('pdf_tentHint') },
    { id: 'poster', label: tm.t('pdf_poster'), hint: tm.t('pdf_posterHint') },
  ]

  // Grupare pe zonă: activă doar când lista e mare ȘI nu e deja restrânsă la o
  // singură zonă prin filtru (altfel antetele ar fi redundante). Sub prag = listă plată.
  // Cheia grupului „fără zonă” e NUL-ul (Postgres nu acceptă \u0000 într-un
  // `text`, deci nicio zonă reală nu-l poate purta); antetul afișează eticheta
  // tradusă (`noZone`), nu cheia.
  const NO_ZONE = '\u0000'
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
          <p style={{ color: D.t2, fontSize: '0.78rem', marginTop: 3 }}>
            {tm.t('summary', { active: tables.filter((t) => t.is_active).length, total: tables.length })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tables.length === 0 ? null : (
            <div
              ref={pdfMenuRef}
              // A11y: Escape închide meniul de export și readuce focusul pe trigger.
              onKeyDown={(e) => {
                if (e.key === 'Escape' && pdfMenuOpen) {
                  setPdfMenuOpen(false)
                  pdfTriggerRef.current?.focus()
                }
              }}
              style={{ position: 'relative' }}
            >
              <Button
                ref={pdfTriggerRef}
                variant="secondary"
                onClick={() => setPdfMenuOpen((o) => !o)}
                // Domeniu gol (căutarea nu găsește nimic): nimic de descărcat.
                disabled={downloading !== null || printPlan.scope.length === 0}
                aria-haspopup="menu"
                aria-expanded={pdfMenuOpen}
                title={tm.t('pdf_title')}
                icon={<Icon name="download" size={16} />}
              >
                {downloading !== null
                  ? tm.t('pdf_downloading')
                  : printPlan.source === 'all'
                    ? tm.t('pdf_button')
                    : tm.tp('pdf_buttonCount', printPlan.scope.length)}
                <Icon name="chevronDown" size={14} />
              </Button>
              {pdfMenuOpen && (
                <div
                  role="menu"
                  aria-label={tm.t('pdf_menuAria')}
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
                    boxShadow: D.shadowLg,
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
                        fontFamily: D.fontBody,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = D.s3)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <Icon name={downloading === f.id ? 'refresh' : 'download'} size={16} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span
                          style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500 }}
                        >
                          {downloading === f.id ? tm.t('pdf_downloading') : f.label}
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
          <Button
            variant="primary"
            onClick={() => setModal('add')}
            icon={<Icon name="plus" size={16} />}
          >
            {tm.t('addTable')}
          </Button>
        </div>
      </div>

      {/* Mesele care n-au intrat în ultimul PDF (lotul C5b): înainte ieșeau
          tăcut. Fără QR → scurtătura „Generează QR-urile lipsă”; inactive →
          doar motivul (activarea e o decizie, nu o reparație). */}
      {skipNotice === null ? null : (
        <div
          role="status"
          style={{
            background: D.amberA,
            border: `1px solid ${D.amberBorder}`,
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <Icon name="alert" size={18} color={D.amber} />
          <div style={{ flex: 1, minWidth: 180, fontSize: '0.78rem', color: D.amber, lineHeight: 1.5 }}>
            {skipNotice.noQr > 0 && <div>{tm.tp('pdf_skippedNoQr', skipNotice.noQr)}</div>}
            {skipNotice.inactive > 0 && <div>{tm.tp('pdf_skippedInactive', skipNotice.inactive)}</div>}
          </div>
          {skipNotice.noQr > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void generateSkippedQr()}
              loading={skipBusy}
              icon={<Icon name="refresh" size={15} />}
            >
              {tm.t('pdf_skipGenerate')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSkipNotice(null)}
            title={tc.t('close')}
            aria-label={tc.t('close')}
            style={ICON_BTN}
          >
            <Icon name="close" size={15} />
          </Button>
        </div>
      )}

      {/* QR-ul meniului GENERAL (/m/:slug) — util oricui (vitrină, flyere),
          iar în modul „doar ridicare" (food truck) devine QR-ul principal. */}
      <GeneralMenuQrCard
        restaurant={restaurant}
        toast={toast}
        pickupFeature={pickupFeature}
        menuFlipbook={menuFlipbook}
      />

      {/* Empty state dedicat modului „doar ridicare" (pornit sau suspendat pe
          plan — pickupOnlyMode, sursa nav-ului din DashboardPage). */}
      {tables.length === 0 && pickupOnly !== 'off' && (
        <div
          style={{
            background: D.s2,
            border: `1px solid ${D.border}`,
            borderRadius: 12,
            padding: '14px 16px',
            marginBottom: 16,
            fontSize: '0.82rem',
            color: D.t2,
            lineHeight: 1.55,
          }}
        >
          {pickupTexts.pickupOnlyEmptyStateText(pickupFeature, menuFlipbook)}
        </div>
      )}

      {/* QR domain warning — shown when VITE_APP_URL differs from current origin or is a preview URL */}
      {(() => {
        const appUrl = import.meta.env.VITE_APP_URL || ''
        const origin = window.location.origin
        const isPreview = origin.includes('netlify.app') && !appUrl
        const mismatch = appUrl && !origin.startsWith(appUrl) && !origin.includes('localhost')
        if (!isPreview && !mismatch) return null
        return (
          <div
            // Copy: mesaj orientat pe consecință pentru patron; detaliul tehnic stă în tooltip.
            title={isPreview ? tm.t('domain_previewTitle') : tm.t('domain_mismatchTitle')}
            style={{
              background: D.amberA,
              border: `1px solid ${D.amberBorder}`,
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Icon name="alert" size={18} color={D.amber} />
            <div style={{ fontSize: '0.78rem', color: D.amber, lineHeight: 1.5 }}>
              {isPreview ? tm.t('domain_preview') : tm.t('domain_mismatch')}
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
              fontFamily: D.fontDisplay,
              fontSize: '1.05rem',
              color: D.t1,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            {tables.length === 0 ? tm.t('bulk_titleEmpty') : tm.t('bulk_title')}
          </div>
          <p style={{ color: D.t2, fontSize: '0.8rem', marginBottom: 14, lineHeight: 1.5 }}>
            {tables.length === 0 ? tm.t('bulk_descEmpty') : tm.t('bulk_desc')}
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
              placeholder={tm.t('bulk_placeholder')}
              aria-label={tm.t('bulk_aria')}
              style={{
                background: D.s3,
                border: `1px solid ${D.border}`,
                borderRadius: 9,
                padding: '10px 14px',
                color: D.t1,
                fontSize: '0.9rem',
                fontFamily: D.fontBody,
                width: 220,
              }}
            />
            <Button variant="primary" onClick={() => void bulkGenerate()} loading={bulkBusy}>
              {bulkBusy ? tm.t('bulk_busy') : tables.length === 0 ? tm.t('bulk_btnEmpty') : tm.t('bulk_btn')}
            </Button>
          </div>
          {limitMsg === null ? null : (
            <div
              style={{
                marginTop: 10,
                background: D.amberA,
                border: `1px solid ${D.amberBorder}`,
                borderRadius: 8,
                padding: '8px 12px',
                color: D.amber,
                fontSize: '0.78rem',
              }}
            >
              {tm.t('bulk_limit', { max: limitMsg })}
            </div>
          )}
          <p style={{ color: D.t2, fontSize: '0.72rem', marginTop: 10 }}>
            {tm.t('bulk_footer')}
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
          title={tm.t('load_error')}
          description={describeStaffError(loadError.err, tc, { fallback: tm.t('load_error') })}
          action={
            <Button variant="secondary" onClick={load} icon={<Icon name="refresh" size={16} />}>
              {tc.t('retry')}
            </Button>
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
                  placeholder={tm.t('search_placeholder')}
                  aria-label={tm.t('search_aria')}
                  style={{ ...inp, paddingLeft: 38 }}
                  onFocus={(e) => (e.target.style.borderColor = D.gold)}
                  onBlur={(e) => (e.target.style.borderColor = D.border)}
                />
              </div>
              {zoneOptions.length === 0 ? null : (
                <select
                  value={zoneFilter}
                  onChange={(e) => setZoneFilter(e.target.value)}
                  aria-label={tm.t('zone_filterAria')}
                  style={{ ...inp, width: 'auto', minWidth: 150, cursor: 'pointer' }}
                >
                  <option value="">{tm.t('zone_all')}</option>
                  {zoneOptions.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {/* Bara de selecție (lotul C5b, de la două mese): „tot” = lista
              VIZIBILĂ (căutare + zonă), zona = antetul grupului, plus acțiunile
              pe selecție. Fără regenerare în lot: ar opri QR-urile tipărite. */}
          {selectionEnabled && (
            <div
              role="group"
              aria-label={tm.t('sel_barAria')}
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                alignItems: 'center',
                background: D.s2,
                border: `1px solid ${D.border}`,
                borderRadius: 12,
                padding: '8px 12px',
                marginBottom: 4,
              }}
            >
              <span style={{ flex: 1, minWidth: 160, fontSize: '0.78rem', color: D.t2 }}>
                {selectedTables.length > 0
                  ? tm.tp('sel_count', selectedTables.length)
                  : tm.t('sel_hint')}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelected((cur) => withIds(cur, visibleTables.map((t) => t.id), true))}
                disabled={visibleTables.length === 0 || allSelected(selected, visibleTables)}
              >
                {tm.t('sel_all', { n: visibleTables.length })}
              </Button>
              {selectedTables.length === 0 ? null : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set<string>())}>
                    {tm.t('sel_clear')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setZoneBulkOpen(true)}
                    disabled={selBusy}
                  >
                    {tm.t('sel_setZone')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelectedActive(true)}
                    loading={selBusy}
                    aria-label={tm.t('sel_activateAria')}
                  >
                    {tm.t('sel_activate')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelectedActive(false)}
                    loading={selBusy}
                    aria-label={tm.t('sel_deactivateAria')}
                  >
                    {tm.t('sel_deactivate')}
                  </Button>
                </>
              )}
            </div>
          )}
          {visibleTables.length === 0 ? (
            <p style={{ color: D.t2, fontSize: '0.85rem', padding: '12px 2px' }}>
              {tm.t('noMatches')}
            </p>
          ) : null}
          {groups.map((g) => (
            <div
              key={g.zone || '__flat'}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              {/* Antet de secțiune pe zonă (mic, uppercase, D.t3) + numărul de mese */}
              {groupByZone && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px 0' }}>
                  <div
                    style={{
                      flex: 1,
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: D.t3,
                    }}
                  >
                    {g.zone === NO_ZONE ? tm.t('noZone') : g.zone} · {g.items.length}
                  </div>
                  {/* „Zona curentă” a selecției: toate mesele grupului (vizibile). */}
                  {(() => {
                    const on = allSelected(selected, g.items)
                    const zoneLabel = g.zone === NO_ZONE ? tm.t('noZone') : g.zone
                    return (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelected((cur) => withIds(cur, g.items.map((t) => t.id), !on))}
                        aria-pressed={on}
                        aria-label={tm.t(on ? 'sel_zoneOffAria' : 'sel_zoneAria', { zone: zoneLabel })}
                      >
                        {on ? tm.t('sel_zoneOff') : tm.t('sel_zone')}
                      </Button>
                    )
                  })()}
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
              {selectionEnabled && (
                // Eticheta învelește bifa: ținta tactilă e 44×44, nu 18×18.
                <label
                  style={{
                    width: 44,
                    height: 44,
                    margin: '-2px -10px -2px -6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    // Comutare pe starea CURENTĂ a selecției (nu pe eveniment).
                    onChange={() => setSelected((cur) => withIds(cur, [t.id], !cur.has(t.id)))}
                    aria-label={tm.t('sel_rowAria', { name: t.name })}
                    style={{ width: 18, height: 18, accentColor: D.gold, cursor: 'pointer' }}
                  />
                </label>
              )}
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
                    <span style={{ fontSize: '0.72rem', color: D.t3 }}>{tm.tp('seats', t.seats)}</span>
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
                      {tm.t('inactive')}
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
                      {tm.t('status_noQr')}
                    </>
                  ) : t.is_active ? (
                    <>
                      <Icon name="check" size={13} color={D.green} />
                      {tm.t('status_active')}
                    </>
                  ) : (
                    tm.t('status_disabled')
                  )}
                </div>
              </div>
              {/* FIX: QRImage generates locally — no api.qrserver.com */}
              {t.active_token && (
                <div style={{ background: D.qrPaper, borderRadius: 8, padding: 4, flexShrink: 0 }}>
                  <QRImage token={t.active_token.token} size={48} label={t.name} />
                </div>
              )}
              </div>
              {/* Rând acțiuni: wrap pe mai multe rânduri ca să nu se taie butoanele pe mobil */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {t.active_token && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void downloadPng(t)}
                    title={tm.t('action_png')}
                    aria-label={tm.t('action_png')}
                    style={ICON_BTN}
                  >
                    <Icon name="download" size={16} />
                  </Button>
                )}
                {t.active_token && t.is_active && (
                  // Cardul tipăribil al UNEI mese (lotul C5b): pliabil sau poster.
                  <div
                    ref={cardMenu === t.id ? cardMenuRef : undefined}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && cardMenu === t.id) setCardMenu(null)
                    }}
                    style={{ position: 'relative' }}
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setCardMenu((cur) => (cur === t.id ? null : t.id))}
                      loading={cardBusy === t.id}
                      aria-haspopup="menu"
                      aria-expanded={cardMenu === t.id}
                      title={tm.t('action_cardPdf')}
                      aria-label={tm.t('action_cardPdfAria', { name: t.name })}
                      style={ICON_BTN}
                    >
                      <Icon name="printer" size={16} />
                    </Button>
                    {cardMenu === t.id && (
                      <div
                        role="menu"
                        aria-label={tm.t('card_menuAria', { name: t.name })}
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 6px)',
                          left: 0,
                          zIndex: 50,
                          minWidth: 220,
                          background: D.s2,
                          border: `1px solid ${D.border}`,
                          borderRadius: 12,
                          padding: 6,
                          boxShadow: D.shadowLg,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                        }}
                      >
                        {(
                          [
                            { id: 'tent', label: tm.t('card_tent'), hint: tm.t('card_tentHint') },
                            { id: 'poster', label: tm.t('pdf_poster'), hint: tm.t('pdf_posterHint') },
                          ] as const
                        ).map((f) => (
                          <Button
                            key={f.id}
                            role="menuitem"
                            variant="ghost"
                            size="sm"
                            onClick={() => void downloadCardPdf(t, f.id)}
                            style={{ justifyContent: 'flex-start', textAlign: 'left', width: '100%' }}
                          >
                            <span style={{ display: 'block' }}>
                              <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500 }}>
                                {f.label}
                              </span>
                              <span style={{ display: 'block', fontSize: '0.7rem', color: D.t2 }}>
                                {f.hint}
                              </span>
                            </span>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {t.active_token && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => copyLink(t)}
                    title={tm.t('copyLink')}
                    aria-label={tm.t('copyLink')}
                    style={ICON_BTN}
                  >
                    <Icon name="link" size={16} />
                  </Button>
                )}
                {(canRotateQr || !t.active_token) && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    // Fără QR existent nu e nimic de invalidat — generăm direct.
                    // Partenerul nu poate roti, deci primește token-ul prin
                    // INSERT (ensureTokens), care nu atinge nicio masă cu QR.
                    if (!t.active_token) void (canRotateQr ? rotateToken(t) : generateMissingQr(t))
                    else setRotateTarget(t)
                  }}
                  disabled={rotating === t.id}
                  title={t.active_token ? tm.t('action_regenerate') : tm.t('action_generate')}
                  aria-label={t.active_token ? tm.t('action_regenerate') : tm.t('action_generate')}
                  // UX: fără QR, butonul are text vizibil „Generează QR" (mesajul de
                  // status trimite la el); cu QR rămâne icon-only ca celelalte acțiuni.
                  style={t.active_token ? ICON_BTN : undefined}
                  icon={<Icon name="refresh" size={16} />}
                >
                  {t.active_token ? null : tm.t('action_generate')}
                </Button>
                )}
                <button
                  onClick={() => toggleActive(t)}
                  title={t.is_active ? tm.t('action_deactivate') : tm.t('action_activate')}
                  aria-label={t.is_active ? tm.t('action_deactivateAria') : tm.t('action_activateAria')}
                  style={{
                    width: 44,
                    height: 44,
                    minWidth: 44,
                    minHeight: 44,
                    borderRadius: 7,
                    background: t.is_active ? D.greenA : D.s3,
                    border: `1px solid ${t.is_active ? D.greenBorder : D.border}`,
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setModal(t)}
                  title={tm.t('editTable')}
                  aria-label={tm.t('editTable')}
                  style={ICON_BTN}
                >
                  <Icon name="edit" size={16} />
                </Button>
                <button
                  onClick={() => setDelId(t.id)}
                  title={tm.t('action_delete')}
                  aria-label={tm.t('action_delete')}
                  style={{
                    width: 44,
                    height: 44,
                    minWidth: 44,
                    minHeight: 44,
                    borderRadius: 7,
                    background: D.redA,
                    border: `1px solid ${D.redBorder}`,
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

      {zoneBulkOpen && selectedTables.length > 0 && (
        <ZoneBulkModal
          count={selectedTables.length}
          zones={zoneOptions}
          busy={selBusy}
          onApply={(zone) => void applyZoneToSelected(zone)}
          onClose={() => setZoneBulkOpen(false)}
        />
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
            background: D.overlay,
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
            aria-label={tm.t('rotate_aria', { name: rotateTarget.name })}
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 16,
              padding: 24,
              maxWidth: 380,
              width: '100%',
            }}
          >
            <FocusTrap />
            <div
              style={{
                fontFamily: D.fontDisplay,
                fontSize: '1.05rem',
                color: D.t1,
                marginBottom: 12,
              }}
            >
              {tm.t('rotate_title', { name: rotateTarget.name })}
            </div>
            <p style={{ color: D.t2, marginBottom: 22, fontSize: '0.875rem', lineHeight: 1.55 }}>
              {tm.t('rotate_desc')}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button variant="secondary" autoFocus onClick={() => setRotateTarget(null)}>
                {tc.t('cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const t = rotateTarget
                  setRotateTarget(null)
                  void rotateToken(t)
                }}
              >
                {tm.t('rotate_confirm')}
              </Button>
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
            background: D.overlay,
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
            aria-label={tm.t('action_delete')}
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 16,
              padding: 24,
              maxWidth: 360,
              width: '100%',
            }}
          >
            <FocusTrap />
            <div
              style={{
                fontFamily: D.fontDisplay,
                fontSize: '1.05rem',
                color: D.t1,
                marginBottom: 12,
              }}
            >
              {tm.t('action_delete')}
            </div>
            <p style={{ color: D.t2, marginBottom: 22, fontSize: '0.875rem' }}>
              {tm.t('delete_desc')}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button variant="secondary" autoFocus onClick={() => setDelId(null)}>
                {tc.t('cancel')}
              </Button>
              <Button variant="danger" onClick={handleDelete}>
                {tc.t('delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
