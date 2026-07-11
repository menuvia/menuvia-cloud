import { useState, useEffect, type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { changeRestaurantSlug } from '../lib/restaurants'
import { D, PLAN_LABELS, AMENITIES, type AmenityId } from '../lib/constants'
import { THEMES, FLIPBOOK_MAX_PAGES } from '../lib/themes'
import { MENU_LANGS } from '../lib/i18nMenu'
import { MENU_CURRENCIES, resolveMenuCurrency } from '../lib/currency'
import { planTier } from '../lib/features'
import VatRatesEditor from './VatRatesEditor'
import OnlinePaymentsCard from './OnlinePaymentsCard'
import MenuPreview from './menu/MenuPreview'
import type { Restaurant } from '../hooks/useData'
import type { useRestaurantModules } from '../hooks/useRestaurantModules'
import { btn, useToast, Toast, Inp, Toggle } from './_dashboard/sharedUI'
import { useIsMobile } from '../hooks/useIsMobile'
import { Icon, type IconName } from './ui/Icon'
import { confirm } from './ui/confirm'

// ── Constants for hours_structured editor ──

type WeekDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

interface DayHoursForm {
  open: string
  close: string
  closed: boolean
}

const WEEK_DAY_KEYS: WeekDayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

const WEEK_DAY_LABELS: Record<WeekDayKey, string> = {
  mon: 'Luni',
  tue: 'Marți',
  wed: 'Miercuri',
  thu: 'Joi',
  fri: 'Vineri',
  sat: 'Sâmbătă',
  sun: 'Duminică',
}

// Valorile implicite pentru pickup_settings — baza peste care se aplică
// valoarea curentă din form + patch-ul editat (vezi updPickup din componentă).
const PICKUP_DEFAULTS: NonNullable<Restaurant['pickup_settings']> = {
  enabled: false,
  min_lead_time_minutes: 20,
  slot_interval_minutes: 15,
  open_hours: { start: '09:00', end: '21:00' },
  instructions: null,
}

// ── Secțiuni de setări — navigabile (ca la FounderPage), nu un scroll unic.
// Fiecare secțiune grupează cardurile înrudite; randăm doar secțiunea activă
// (mai puțin DOM montat = pagina se simte mai rapidă și mai clară). ──

type SettingsSectionId = 'restaurant' | 'menu' | 'orders' | 'account'

const SETTINGS_SECTIONS: { id: SettingsSectionId; label: string; icon: IconName }[] = [
  { id: 'restaurant', label: 'Restaurant', icon: 'utensils' },
  { id: 'menu', label: 'Meniu & aspect', icon: 'menu' },
  { id: 'orders', label: 'Comenzi & plăți', icon: 'orders' },
  { id: 'account', label: 'Cont', icon: 'settings' },
]

// Card cu chrome consistent (surface + border + header cu icon/titlu/descriere).
// Înlocuiește cele ~18 div-uri hand-rolled identice — un singur stil premium,
// ușor de întreținut. `right` ține un buton sau un Toggle în antet.
function SettingsCard({
  icon,
  title,
  desc,
  right,
  children,
}: {
  icon?: IconName
  title: string
  desc?: ReactNode
  right?: ReactNode
  children?: ReactNode
}) {
  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 14,
        padding: 22,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: desc != null ? 6 : 14,
        }}
      >
        <div
          style={{
            fontSize: '0.875rem',
            fontWeight: 500,
            color: D.t1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {icon && <Icon name={icon} size={16} color={D.t2} />}
          {title}
        </div>
        {right}
      </div>
      {desc != null && (
        <div style={{ fontSize: '0.72rem', color: D.t2, marginBottom: 14, lineHeight: 1.5 }}>
          {desc}
        </div>
      )}
      {children}
    </div>
  )
}

// ── SettingsTab — lifted from DashboardPage.tsx (identical behavior) ──

export default function SettingsTab({
  restaurant,
  onUpdate,
  plan,
  onSignOut,
  modulesState,
}: {
  restaurant: Restaurant
  onUpdate: (id: string, f: Partial<Restaurant>) => Promise<{ error: Error | null }>
  plan: string
  onSignOut: () => void
  modulesState?: ReturnType<typeof useRestaurantModules>
}) {
  const { user } = useAuth()
  // Mobile-first: pe telefon stivuim coloanele (altfel layout-ul 2-col se taie lateral).
  const isMobile = useIsMobile()
  const [section, setSection] = useState<SettingsSectionId>('restaurant')
  const [form, setForm] = useState({ ...restaurant })
  const [saving, setSaving] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingPages, setUploadingPages] = useState(false)
  const { toasts, toast } = useToast()
  const upd = (k: keyof Restaurant, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  // Merge order: DEFAULTS → valoarea curentă din form → patch. Identic cu
  // spread-urile inline anterioare; patch-ul are mereu ultimul cuvânt.
  const updPickup = (patch: Partial<NonNullable<Restaurant['pickup_settings']>>) =>
    upd('pickup_settings', { ...PICKUP_DEFAULTS, ...(form.pickup_settings ?? {}), ...patch })
  // Păstrează cheile existente + garantează preset_id (fallback 'cafe'); patch
  // suprascrie. Oglindește spread-urile theme_settings folosite anterior.
  const updTheme = (patch: Partial<NonNullable<Restaurant['theme_settings']>>) =>
    upd('theme_settings', {
      ...(form.theme_settings ?? {}),
      preset_id: form.theme_settings?.preset_id ?? 'cafe',
      ...patch,
    })
  // Re-sincronizează formularul când prop-ul restaurant se schimbă (ex. după salvarea
  // slug-ului prin RPC, care întoarce slug-ul normalizat) — altfel form-ul rămâne stale.
  useEffect(() => {
    setForm({ ...restaurant })
  }, [restaurant])

  async function uploadImage(
    file: File,
    kind: 'cover' | 'logo' | 'menu-pages',
  ): Promise<string | null> {
    if (!user) return null
    const setBusy =
      kind === 'cover' ? setUploadingCover : kind === 'logo' ? setUploadingLogo : setUploadingPages
    setBusy(true)
    try {
      const canvas = document.createElement('canvas')
      const ctx2d = canvas.getContext('2d')
      if (!ctx2d) throw new Error('canvas ctx unavailable')
      const img = new Image()
      const url = URL.createObjectURL(file)
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('image load failed'))
        img.src = url
      })
      // Paginile de meniu au text mic → aceeași lățime maximă ca la cover.
      const maxW = kind === 'logo' ? 400 : 1600
      const scale = img.width > maxW ? maxW / img.width : 1
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob((b) => res(b), 'image/webp', 0.85),
      )
      if (!blob) throw new Error('blob create failed')
      const path = user.id + '/' + restaurant.id + '/' + kind + '/' + crypto.randomUUID() + '.webp'
      const { error } = await supabase.storage
        .from('product-images')
        .upload(path, blob, { contentType: 'image/webp' })
      if (error) throw error
      const { data } = supabase.storage.from('product-images').getPublicUrl(path)
      return data.publicUrl
    } catch (e) {
      console.error(`${kind} upload failed`, e)
      toast('Upload eșuat', 'error')
      return null
    } finally {
      setBusy(false)
    }
  }

  function toggleAmenity(id: AmenityId) {
    const current = (form.amenities ?? []) as string[]
    const next = current.includes(id) ? current.filter((a) => a !== id) : [...current, id]
    upd('amenities', next)
  }

  // Limbile în care clientul poate vedea meniul (fără 'ro', care e mereu baza).
  function toggleMenuLang(code: string) {
    const current = (form.menu_languages ?? []) as string[]
    const next = current.includes(code)
      ? current.filter((c) => c !== code)
      : [...current, code]
    upd('menu_languages', next)
  }

  // ── Flipbook: pagini de meniu ca imagini (theme_settings.flipbook_pages) ──
  // Salvate prin ACELAȘI flux de save al formularului (theme_settings e în
  // whitelist-ul RESTAURANT_UPDATE_FIELDS) — fără migrații, fără RPC nou.
  const flipbookPages: string[] = form.theme_settings?.flipbook_pages ?? []

  function setFlipbookPages(pages: string[]) {
    updTheme({ flipbook_pages: pages })
  }

  function moveFlipbookPage(idx: number, delta: -1 | 1) {
    const j = idx + delta
    if (j < 0 || j >= flipbookPages.length) return
    const next = [...flipbookPages]
    const a = next[idx]
    const b = next[j]
    if (a === undefined || b === undefined) return
    next[idx] = b
    next[j] = a
    setFlipbookPages(next)
  }

  function removeFlipbookPage(idx: number) {
    setFlipbookPages(flipbookPages.filter((_, i) => i !== idx))
  }

  async function uploadFlipbookPages(files: File[]) {
    if (files.length === 0) return
    const room = FLIPBOOK_MAX_PAGES - flipbookPages.length
    if (room <= 0) {
      toast(`Maxim ${FLIPBOOK_MAX_PAGES} pagini — șterge una ca să adaugi alta`, 'error')
      return
    }
    if (files.length > room) {
      toast(`Maxim ${FLIPBOOK_MAX_PAGES} pagini — încarc doar primele ${room}`, 'error')
    }
    const urls: string[] = []
    // Secvențial (nu Promise.all): canvas-ul redimensionează pe rând, iar
    // ordinea paginilor rezultate rămâne ordinea de selecție a fișierelor.
    for (const f of files.slice(0, room)) {
      const url = await uploadImage(f, 'menu-pages')
      if (url) urls.push(url)
    }
    if (urls.length > 0) {
      setFlipbookPages([...flipbookPages, ...urls])
      toast(`${urls.length} ${urls.length === 1 ? 'pagină adăugată' : 'pagini adăugate'} — nu uita să salvezi`)
    }
  }

  function updHours(day: WeekDayKey, patch: Partial<DayHoursForm>) {
    const current = (form.hours_structured ?? {}) as Record<string, DayHoursForm>
    const today = current[day] ?? { open: '08:00', close: '23:00', closed: false }
    upd('hours_structured', { ...current, [day]: { ...today, ...patch } })
  }

  async function copyMondayToAll() {
    // Acțiune distructivă: suprascrie orarul personalizat din Marți–Duminică.
    // Cerem confirmare explicită înainte, ca un click accidental să nu piardă datele.
    const ok = await confirm({
      title: 'Suprascrii orarul din Marți–Duminică cu cel de Luni?',
      description: 'Nu poți anula această acțiune.',
      confirmLabel: 'Suprascrie',
      destructive: true,
    })
    if (!ok) return
    const current = (form.hours_structured ?? {}) as Record<string, DayHoursForm>
    const mon = current.mon ?? { open: '08:00', close: '23:00', closed: false }
    const next: Record<string, DayHoursForm> = {}
    for (const d of WEEK_DAY_KEYS) next[d] = { ...mon }
    upd('hours_structured', next)
  }
  // La TASTARE: normalizare lejeră FĂRĂ strip de cratime la capete — slugify-ul
  // complet aplicat pe fiecare keystroke ștergea separatorul imediat ce era tastat
  // („pizza-" → „pizza"), deci un slug cu cratimă era imposibil de scris manual.
  // Curățarea capetelor o face RPC-ul change_restaurant_slug la salvare.
  const slugifyWhileTyping = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  const COLORS = ['#C8963C', '#E05555', '#4CAF6E', '#5B8DEF', '#9B72CF', '#E07B45', '#3ABFBF']
  // Nume RO pentru fiecare accent — folosite ca aria-label (screen reader) și
  // ca indicator ne-cromatic pentru utilizatorii care nu disting culorile.
  const COLOR_NAMES: Record<string, string> = {
    '#C8963C': 'Auriu',
    '#E05555': 'Roșu',
    '#4CAF6E': 'Verde',
    '#5B8DEF': 'Albastru',
    '#9B72CF': 'Mov',
    '#E07B45': 'Portocaliu',
    '#3ABFBF': 'Turcoaz',
  }

  const handleSave = async () => {
    setSaving(true)
    // Slug-ul are flux separat (RPC change_restaurant_slug — PR 1B 096B revocă
    // UPDATE column-level pe restaurants.slug). Rulăm slug-ul ÎNAINTE: dacă
    // eșuează (slug ocupat), abortăm și nu mai trimitem celelalte câmpuri.
    const slugChanged =
      typeof form.slug === 'string' && form.slug.trim() !== '' && form.slug !== restaurant.slug
    if (slugChanged) {
      try {
        const r = await changeRestaurantSlug({
          restaurantId: restaurant.id,
          newSlug: form.slug as string,
        })
        if (!r.ok) {
          toast(`Slug indisponibil: "${r.slug}" e deja folosit`, 'error')
          setSaving(false)
          return
        }
      } catch (e) {
        toast('Eroare la schimbarea slug-ului: ' + (e as Error).message, 'error')
        setSaving(false)
        return
      }
    }

    // Restul câmpurilor (fără slug) prin .update() — gated de RLS + column-level GRANT.
    const { slug: _slug, ...rest } = form
    void _slug
    const { error } = await onUpdate(restaurant.id, rest)
    if (error) toast('Eroare: ' + error.message, 'error')
    else toast('Salvat')
    setSaving(false)
  }

  // Formular „murdar": s-a schimbat ceva față de restaurantul salvat. Ordinea
  // cheilor e stabilă (form pornește ca {...restaurant}), deci comparația JSON
  // e suficientă pentru a decide dacă arătăm bara de salvare de jos.
  const dirty = JSON.stringify(form) !== JSON.stringify(restaurant)

  return (
    <div>
      <Toast toasts={toasts} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 18,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          {/* h1 ca la celelalte taburi din dashboard (fiecare tab = o pagină cu un h1). */}
          <h1
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.5rem',
              fontWeight: 600,
              color: D.t1,
              letterSpacing: '-0.02em',
            }}
          >
            Setări
          </h1>
          <p style={{ color: D.t2, fontSize: '0.78rem', marginTop: 3 }}>
            Configurează restaurantul, meniul și comenzile — organizat pe secțiuni.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.7 : 1 })}
        >
          {saving ? 'Se salvează...' : 'Salvează'}
        </button>
      </div>

      {/* Navigare pe secțiuni — pastile scrollabile orizontal (pattern FounderPage).
          Un click schimbă doar ce e vizibil; formularul rămâne același state, deci
          nu pierzi modificări nesalvate când treci dintr-o secțiune în alta. */}
      <div
        role="tablist"
        aria-label="Secțiuni setări"
        style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          paddingBottom: 4,
          marginBottom: 20,
        }}
      >
        {SETTINGS_SECTIONS.map((s) => {
          const active = section === s.id
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSection(s.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '9px 16px',
                minHeight: 44,
                borderRadius: 100,
                border: `1px solid ${active ? D.gold + '55' : D.border}`,
                background: active ? D.goldA : D.s2,
                color: active ? D.goldL : D.t2,
                fontSize: '0.82rem',
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <Icon name={s.icon} size={16} color={active ? D.goldL : D.t2} />
              {s.label}
            </button>
          )
        })}
      </div>

      {/* Conținutul secțiunii active — o singură coloană lizibilă (pattern premium
          de setări: mai ușor de scanat decât 2 coloane pe lat). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>
        {section === 'restaurant' && (
          <>
            <SettingsCard icon="info" title="Informații principale">
              {(
                [
                  ['name', 'Nume restaurant *', 'La Bella Trattoria'],
                  ['tagline', 'Tagline', 'Bucătărie autentică'],
                  ['city', 'Oraș', 'Sibiu'],
                  ['phone', 'Telefon', '07xx xxx xxx'],
                  ['hours', 'Program', 'Lun–Dum: 12:00–23:00'],
                  ['description', 'Descriere', 'Despre restaurant...'],
                ] as [keyof Restaurant, string, string][]
              ).map(([k, label, ph]) => (
                <div key={k} style={{ marginBottom: 13 }}>
                  <label
                    style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}
                  >
                    {label}
                  </label>
                  <Inp value={String(form[k] || '')} onChange={(v) => upd(k, v)} placeholder={ph} />
                </div>
              ))}
            </SettingsCard>

            {/* PROGRAM DETALIAT — hours_structured per zi */}
            <SettingsCard
              icon="clock"
              title="Program detaliat"
              desc={`Folosit pentru indicatorul "DESCHIS ACUM" și textul "Astăzi 08:00–23:00" din meniul public.`}
              right={
                <button
                  onClick={copyMondayToAll}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${D.border}`,
                    borderRadius: 6,
                    color: D.t2,
                    fontSize: '0.7rem',
                    padding: '4px 10px',
                    cursor: 'pointer',
                  }}
                >
                  Copiază luni → toate
                </button>
              }
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {WEEK_DAY_KEYS.map((day) => {
                  const cur = ((form.hours_structured ?? {}) as Record<string, DayHoursForm>)[
                    day
                  ] ?? {
                    open: '08:00',
                    close: '23:00',
                    closed: false,
                  }
                  return (
                    <div
                      key={day}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? '1fr' : '80px 1fr 88px 88px',
                        gap: 8,
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: '0.78rem', color: D.t1 }}>{WEEK_DAY_LABELS[day]}</span>
                      <label
                        style={{
                          fontSize: '0.72rem',
                          color: D.t2,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!cur.closed}
                          onChange={(e) => updHours(day, { closed: !e.target.checked })}
                        />
                        Deschis
                      </label>
                      {/* Pe mobil (1 coloană) inputurile de oră stau stivuite fără
                          antet de coloană → mici label-uri „Deschide"/„Închide"
                          deasupra. Pe desktop antetul e implicit; păstrăm doar
                          aria-label pentru screen reader. */}
                      <div>
                        {isMobile && (
                          <label style={{ display: 'block', fontSize: '0.68rem', color: D.t3, marginBottom: 3 }}>
                            Deschide
                          </label>
                        )}
                        <input
                          type="time"
                          disabled={cur.closed}
                          value={cur.open}
                          onChange={(e) => updHours(day, { open: e.target.value })}
                          aria-label={`${WEEK_DAY_LABELS[day]} deschidere`}
                          style={{
                            background: D.s3,
                            border: `1px solid ${D.border}`,
                            color: D.t1,
                            padding: '6px 8px',
                            borderRadius: 6,
                            fontSize: '0.78rem',
                            opacity: cur.closed ? 0.4 : 1,
                            width: isMobile ? '100%' : undefined,
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                      <div>
                        {isMobile && (
                          <label style={{ display: 'block', fontSize: '0.68rem', color: D.t3, marginBottom: 3 }}>
                            Închide
                          </label>
                        )}
                        <input
                          type="time"
                          disabled={cur.closed}
                          value={cur.close}
                          onChange={(e) => updHours(day, { close: e.target.value })}
                          aria-label={`${WEEK_DAY_LABELS[day]} închidere`}
                          style={{
                            background: D.s3,
                            border: `1px solid ${D.border}`,
                            color: D.t1,
                            padding: '6px 8px',
                            borderRadius: 6,
                            fontSize: '0.78rem',
                            opacity: cur.closed ? 0.4 : 1,
                            width: isMobile ? '100%' : undefined,
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </SettingsCard>

            {/* LOGO upload — square */}
            <SettingsCard
              icon="tag"
              title="Logo"
              desc="Logo pătrat. Opțional, folosit ca avatar / favicon viitor."
            >
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                {form.logo_url ? (
                  <div style={{ position: 'relative' }}>
                    <img
                      src={form.logo_url}
                      alt="Logo"
                      style={{
                        width: 80,
                        height: 80,
                        objectFit: 'cover',
                        borderRadius: 12,
                        border: `1px solid ${D.border}`,
                        background: D.s3,
                      }}
                    />
                    <button
                      onClick={() => upd('logo_url', null)}
                      aria-label="Șterge logo"
                      style={{
                        position: 'absolute',
                        top: -6,
                        right: -6,
                        width: 22,
                        height: 22,
                        background: D.s2,
                        color: D.t2,
                        border: `1px solid ${D.border}`,
                        borderRadius: '50%',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                      }}
                    >
                      <Icon name="close" size={12} color={D.t2} />
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: 12,
                      border: `1px dashed ${D.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: D.t3,
                      fontSize: '0.7rem',
                    }}
                  >
                    N/A
                  </div>
                )}
                <label
                  style={{
                    ...btn({ background: D.s3, color: D.t1, border: `1px solid ${D.border}` }),
                    cursor: uploadingLogo ? 'wait' : 'pointer',
                    display: 'inline-block',
                    opacity: uploadingLogo ? 0.6 : 1,
                  }}
                >
                  {uploadingLogo ? 'Se încarcă...' : 'Încarcă logo'}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      const url = await uploadImage(f, 'logo')
                      if (url) upd('logo_url', url)
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
            </SettingsCard>

            {/* COVER IMAGE — afișată în hero-ul meniului public */}
            <SettingsCard
              icon="image"
              title="Imagine cover"
              desc={
                <>
                  Afișată în hero-ul meniului public. Recomandat: format 16:9, &gt;1200px lățime.
                  Dacă lipsește, folosim un gradient generat din tema ta.
                </>
              }
            >
              {form.cover_url ? (
                <div style={{ position: 'relative', marginBottom: 10 }}>
                  <img
                    src={form.cover_url}
                    alt="Cover"
                    style={{
                      width: '100%',
                      aspectRatio: '16 / 9',
                      objectFit: 'cover',
                      borderRadius: 10,
                      border: `1px solid ${D.border}`,
                    }}
                  />
                  <button
                    onClick={() => upd('cover_url', null)}
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      background: 'rgba(0,0,0,0.65)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 100,
                      padding: '4px 10px',
                      fontSize: '0.7rem',
                      cursor: 'pointer',
                    }}
                  >
                    Șterge
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '16 / 9',
                    borderRadius: 10,
                    border: `1px dashed ${D.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: D.t3,
                    fontSize: '0.78rem',
                    marginBottom: 10,
                  }}
                >
                  Fără imagine — gradient temă activă
                </div>
              )}
              <label
                style={{
                  ...btn({ background: D.s3, color: D.t1, border: `1px solid ${D.border}` }),
                  cursor: uploadingCover ? 'wait' : 'pointer',
                  display: 'inline-block',
                  opacity: uploadingCover ? 0.6 : 1,
                }}
              >
                {uploadingCover ? 'Se încarcă...' : 'Încarcă imagine'}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    const url = await uploadImage(f, 'cover')
                    if (url) upd('cover_url', url)
                    e.target.value = ''
                  }}
                />
              </label>
            </SettingsCard>

            {/* AMENITIES toggles */}
            <SettingsCard
              icon="sparkle"
              title="Facilități"
              desc="Afișate ca pills în hero-ul meniului public."
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {AMENITIES.map((a) => {
                  const active = (form.amenities ?? []).includes(a.id)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleAmenity(a.id)}
                      style={{
                        background: active ? D.goldA : D.s3,
                        border: `1px solid ${active ? D.gold : D.border}`,
                        color: active ? D.goldL : D.t2,
                        padding: '6px 12px',
                        borderRadius: 100,
                        fontSize: '0.78rem',
                        fontWeight: active ? 600 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {a.labelRo}
                    </button>
                  )
                })}
              </div>
            </SettingsCard>

            {/* WiFi password */}
            <SettingsCard
              icon="wifi"
              title="Parolă WiFi (opțional)"
              desc="Afișată în meniu sub formă vizibilă. Lasă gol dacă nu vrei să publici."
            >
              <Inp
                value={form.wifi_password ?? ''}
                onChange={(v) => upd('wifi_password', v.trim() || null)}
                placeholder="ex: tinctura2024"
              />
            </SettingsCard>

            {/* Social media */}
            <SettingsCard icon="link" title="Social media">
              {(
                [
                  ['instagram', 'Instagram', '@tinctura.cafe'],
                  ['facebook', 'Facebook', 'facebook.com/tinctura'],
                  ['tiktok', 'TikTok', '@tinctura'],
                  ['website', 'Website', 'https://tinctura.ro'],
                ] as const
              ).map(([k, label, ph]) => {
                const socials = (form.socials ?? {}) as Record<string, string | null | undefined>
                return (
                  <div key={k} style={{ marginBottom: 10 }}>
                    <label
                      style={{ display: 'block', fontSize: '0.74rem', color: D.t2, marginBottom: 5 }}
                    >
                      {label}
                    </label>
                    <Inp
                      value={socials[k] ?? ''}
                      onChange={(v) =>
                        upd('socials', {
                          ...socials,
                          [k]: v.trim() || null,
                        })
                      }
                      placeholder={ph}
                    />
                  </div>
                )
              })}
            </SettingsCard>

            {/* Google Review CTA settings */}
            <SettingsCard
              icon="star"
              title="Google Reviews (recenzii automate)"
              desc={`După ce clientul finalizează plata și dă feedback pozitiv (rating ≥ 4), îi vom afișa un buton "Scrie o recenzie pe Google" care îl duce direct la pagina ta de business. Cel mai rapid mod să crești numărul de recenzii.`}
            >
              <label style={{ display: 'block', fontSize: '0.74rem', color: D.t2, marginBottom: 5 }}>
                Google Place ID
              </label>
              <Inp
                value={form.google_place_id ?? ''}
                onChange={(v) => upd('google_place_id', v.trim() || null)}
                placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
              />
              <div style={{ fontSize: '0.7rem', color: D.t2, marginTop: 6, lineHeight: 1.5 }}>
                Găsești Place ID-ul aici:{' '}
                <a
                  href="https://developers.google.com/maps/documentation/places/web-service/place-id"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: D.gold }}
                >
                  Place ID Finder
                </a>
                . Caută numele localului tău, copiază ID-ul (începe cu "ChIJ...").
              </div>

              {form.google_place_id && (
                <div
                  style={{
                    marginTop: 14,
                    padding: '10px 14px',
                    background: D.s3,
                    borderRadius: 8,
                    fontSize: '0.72rem',
                    color: D.t2,
                  }}
                >
                  <div
                    style={{
                      color: '#4CAF6E',
                      marginBottom: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Icon name="check" size={13} color="#4CAF6E" />
                    Configurat
                  </div>
                  <div>
                    URL preview:{' '}
                    <a
                      href={`https://search.google.com/local/writereview?placeid=${form.google_place_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: D.gold, wordBreak: 'break-all' }}
                    >
                      search.google.com/local/writereview?placeid={form.google_place_id.slice(0, 12)}
                      ...
                    </a>
                  </div>
                </div>
              )}
            </SettingsCard>
          </>
        )}

        {section === 'menu' && (
          <>
            {/* Previzualizare live — se actualizează instant la orice schimbare de
                temă / layout / elemente (form.theme_settings e state React). O punem
                prima ca userul să vadă efectul modificărilor din secțiune imediat. */}
            <SettingsCard
              icon="eye"
              title="Previzualizare"
              desc="Așa arată meniul clienților — se actualizează pe măsură ce schimbi."
            >
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <MenuPreview
                  themeSettings={form.theme_settings}
                  restaurantName={form.name}
                  // Moneda din STAREA formularului — preview-ul reflectă LIVE
                  // alegerea din selectorul „Moneda meniului", nu valoarea salvată.
                  currency={resolveMenuCurrency(form.currency)}
                />
              </div>
            </SettingsCard>

            <SettingsCard icon="qr" title="URL meniu">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: D.s3,
                  border: `1px solid ${D.border}`,
                  borderRadius: 9,
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    padding: '0 10px',
                    fontSize: '0.75rem',
                    color: D.t3,
                    borderRight: `1px solid ${D.border}`,
                    height: 44,
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  menuvia.ro/m/
                </span>
                <Inp
                  value={form.slug || ''}
                  onChange={(v) => upd('slug', slugifyWhileTyping(v))}
                  placeholder="slug-url"
                />
              </div>
            </SettingsCard>

            <SettingsCard icon="sparkle" title="Culoare accent">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {COLORS.map((c) => {
                  const selected = form.primary_color === c
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => upd('primary_color', c)}
                      aria-label={`Culoare accent ${COLOR_NAMES[c] ?? c}`}
                      aria-pressed={selected}
                      title={COLOR_NAMES[c] ?? c}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: c,
                        border: `3px solid ${selected ? '#fff' : 'transparent'}`,
                        cursor: 'pointer',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {/* Bifă ne-cromatică: arată selecția independent de culoare. */}
                      {selected && <Icon name="check" size={18} color="#fff" />}
                    </button>
                  )
                })}
              </div>
            </SettingsCard>

            {/* Theme picker — 8 preset themes for QR menu */}
            <SettingsCard
              icon="image"
              title="Tema meniului QR"
              desc="Alege stilul vizual pentru meniul tău. Se aplică instant pe pagina pe care o văd clienții."
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
                  gap: 8,
                }}
              >
                {THEMES.map((t) => {
                  const isSelected = (form.theme_settings?.preset_id ?? 'cafe') === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        // Păstrăm restul cheilor (menu_layout) când schimbăm tema.
                        updTheme({
                          preset_id: t.id,
                          accent_override: form.theme_settings?.accent_override ?? null,
                        })
                      }
                      style={{
                        padding: '12px 10px',
                        border: `2px solid ${isSelected ? D.gold : D.border}`,
                        background: isSelected ? D.goldA : D.s3,
                        borderRadius: 10,
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: '1.1rem' }}>{t.emoji}</span>
                        <span
                          style={{
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            color: isSelected ? D.gold : D.t1,
                          }}
                        >
                          {t.name}
                        </span>
                      </div>
                      {/* Color preview */}
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <div
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            background: t.colors.bg,
                            border: `1px solid ${D.border}`,
                          }}
                          title="Background"
                        />
                        <div
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            background: t.colors.accent,
                          }}
                          title="Accent"
                        />
                        <div
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            background: t.colors.surface,
                            border: `1px solid ${D.border}`,
                          }}
                          title="Surface"
                        />
                      </div>
                      <div
                        style={{ fontSize: '0.65rem', color: D.t3, lineHeight: 1.3, marginTop: 4 }}
                      >
                        {t.description}
                      </div>
                    </button>
                  )
                })}
              </div>
              <div
                style={{
                  fontSize: '0.7rem',
                  color: D.t3,
                  marginTop: 12,
                  padding: '8px 10px',
                  background: D.s3,
                  borderRadius: 7,
                  lineHeight: 1.5,
                }}
              >
                💡 După salvare, clienții vor vedea noua temă instant la următoarea încărcare a
                meniului.
              </div>
            </SettingsCard>

            {/* Layout picker — aspectul listei de produse (separat de temă/culori) */}
            <SettingsCard
              icon="menu"
              title="Layout meniu"
              desc="Cum sunt aranjate produsele pe pagina pe care o văd clienții. Se aplică pe meniul digital și pe meniul QR."
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
                  gap: 8,
                }}
              >
                {(
                  [
                    {
                      id: 'list',
                      emoji: '☰',
                      name: 'Listă',
                      desc: 'Poză mică + text. Clasic și compact.',
                    },
                    {
                      id: 'grid',
                      emoji: '▦',
                      name: 'Galerie foto',
                      desc: 'Poze mari, 2 coloane. Cel mai vizual.',
                    },
                    {
                      id: 'minimal',
                      emoji: '≡',
                      name: 'Minimal elegant',
                      desc: 'Text, fără poze. Aer editorial, clasic și rapid.',
                    },
                    {
                      id: 'photo',
                      emoji: '🖼',
                      name: 'Foto-first',
                      desc: 'Poze mari cu numele și prețul pe poză. Atinge poza pentru detalii și opțiuni.',
                    },
                    {
                      id: 'flipbook',
                      emoji: '📖',
                      name: 'Flipbook (PDF/pagini)',
                      desc: 'Paginile meniului ca imagini, răsfoibile ca o carte.',
                    },
                  ] as const
                ).map((l) => {
                  const isSelected = (form.theme_settings?.menu_layout ?? 'list') === l.id
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() =>
                        // Păstrăm tema/accentul; schimbăm doar layout-ul.
                        updTheme({ menu_layout: l.id })
                      }
                      style={{
                        padding: '14px 12px',
                        border: `2px solid ${isSelected ? D.gold : D.border}`,
                        background: isSelected ? D.goldA : D.s3,
                        borderRadius: 10,
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '1.1rem' }}>{l.emoji}</span>
                        <span
                          style={{
                            fontSize: '0.82rem',
                            fontWeight: 600,
                            color: isSelected ? D.gold : D.t1,
                          }}
                        >
                          {l.name}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.68rem', color: D.t3, lineHeight: 1.3 }}>{l.desc}</div>
                    </button>
                  )
                })}
              </div>

              {/* Uploader pagini flipbook — vizibil doar când layout-ul e 'flipbook'.
                  Paginile stau în theme_settings.flipbook_pages și se salvează prin
                  butonul „Salvează" al formularului (fluxul existent). */}
              {(form.theme_settings?.menu_layout ?? 'list') === 'flipbook' && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: D.t1, marginBottom: 6 }}>
                    Paginile meniului ({flipbookPages.length}/{FLIPBOOK_MAX_PAGES})
                  </div>
                  <div style={{ fontSize: '0.72rem', color: D.t2, marginBottom: 12, lineHeight: 1.5 }}>
                    Ai meniul ca PDF? Exportă paginile ca imagini (sau pozează-le) și încarcă-le aici
                    — ori folosește Importul AI din Produse ca să-l transformi în meniu interactiv.
                  </div>

                  {/* Lista de pagini: thumbnail + reordonare ↑↓ + ștergere. */}
                  {flipbookPages.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                      {flipbookPages.map((url, idx) => (
                        <div
                          key={`${idx}-${url}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '6px 8px',
                            background: D.s3,
                            border: `1px solid ${D.border}`,
                            borderRadius: 8,
                          }}
                        >
                          <span style={{ fontSize: '0.72rem', color: D.t3, width: 20, flexShrink: 0 }}>
                            {idx + 1}
                          </span>
                          <img
                            src={url}
                            alt={`Pagina ${idx + 1}`}
                            loading="lazy"
                            style={{
                              width: 56,
                              height: 42,
                              objectFit: 'cover',
                              borderRadius: 5,
                              border: `1px solid ${D.border}`,
                              background: D.s2,
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ flex: 1 }} />
                          <button
                            type="button"
                            onClick={() => moveFlipbookPage(idx, -1)}
                            disabled={idx === 0}
                            aria-label={`Mută pagina ${idx + 1} mai sus`}
                            style={{
                              background: 'transparent',
                              border: `1px solid ${D.border}`,
                              borderRadius: 6,
                              color: idx === 0 ? D.t3 : D.t1,
                              width: 30,
                              height: 30,
                              cursor: idx === 0 ? 'default' : 'pointer',
                              opacity: idx === 0 ? 0.4 : 1,
                            }}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveFlipbookPage(idx, 1)}
                            disabled={idx === flipbookPages.length - 1}
                            aria-label={`Mută pagina ${idx + 1} mai jos`}
                            style={{
                              background: 'transparent',
                              border: `1px solid ${D.border}`,
                              borderRadius: 6,
                              color: idx === flipbookPages.length - 1 ? D.t3 : D.t1,
                              width: 30,
                              height: 30,
                              cursor: idx === flipbookPages.length - 1 ? 'default' : 'pointer',
                              opacity: idx === flipbookPages.length - 1 ? 0.4 : 1,
                            }}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFlipbookPage(idx)}
                            aria-label={`Șterge pagina ${idx + 1}`}
                            style={{
                              background: 'transparent',
                              border: `1px solid ${D.border}`,
                              borderRadius: 6,
                              color: D.t2,
                              fontSize: '0.7rem',
                              padding: '0 10px',
                              height: 30,
                              cursor: 'pointer',
                            }}
                          >
                            Șterge
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {flipbookPages.length === 0 && (
                    <div
                      style={{
                        border: `1px dashed ${D.border}`,
                        borderRadius: 8,
                        padding: '16px 12px',
                        textAlign: 'center',
                        fontSize: '0.74rem',
                        color: D.t3,
                        marginBottom: 12,
                        lineHeight: 1.5,
                      }}
                    >
                      Nicio pagină încă. Până încarci pagini, clienții văd meniul pe stilul „Listă".
                    </div>
                  )}

                  <label
                    style={{
                      ...btn({ background: D.s3, color: D.t1, border: `1px solid ${D.border}` }),
                      cursor: uploadingPages ? 'wait' : 'pointer',
                      display: 'inline-block',
                      opacity: uploadingPages ? 0.6 : 1,
                    }}
                  >
                    {uploadingPages ? 'Se încarcă...' : 'Încarcă pagini (poți selecta mai multe)'}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        const files = Array.from(e.target.files ?? [])
                        e.target.value = ''
                        await uploadFlipbookPages(files)
                      }}
                    />
                  </label>

                  {/* Comanda din meniu nu are carduri pe flipbook — spunem explicit
                      localurilor care AU comenzi active (plan cu comenzi sau pickup). */}
                  {(planTier(plan) >= 2 || (form.pickup_settings?.enabled ?? false)) && (
                    <div
                      style={{
                        fontSize: '0.7rem',
                        color: D.t3,
                        marginTop: 12,
                        padding: '8px 10px',
                        background: D.s3,
                        borderRadius: 7,
                        lineHeight: 1.5,
                      }}
                    >
                      💡 Cu flipbook, clienții văd meniul ca pe o carte — comanda din meniu nu e
                      disponibilă pe acest stil; chemarea ospătarului rămâne.
                    </div>
                  )}
                </div>
              )}
            </SettingsCard>

            {/* Elemente meniu — ce se vede pe hero-ul clienților. Toate ON implicit. */}
            <SettingsCard
              icon="settings"
              title="Elemente meniu"
              desc="Alege ce se vede pe meniul clienților. Toate sunt pornite implicit."
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(
                  [
                    {
                      key: 'cover',
                      name: 'Copertă',
                      desc: 'Imaginea de copertă din partea de sus. Dezactivată, se afișează un gradient.',
                    },
                    {
                      key: 'tagline',
                      name: 'Slogan',
                      desc: 'Sloganul restaurantului afișat sub nume.',
                    },
                    {
                      key: 'status',
                      name: 'Status deschis / închis',
                      desc: 'Pastila care arată dacă restaurantul e deschis acum.',
                    },
                    {
                      key: 'amenities',
                      name: 'WiFi & Vegan',
                      desc: 'Pile cu facilitățile WiFi și opțiuni vegan.',
                    },
                    {
                      key: 'social',
                      name: 'Social',
                      desc: 'Pile cu link-uri Instagram, TikTok, Facebook și website.',
                    },
                  ] as const
                ).map((el) => {
                  const value = form.theme_settings?.elements?.[el.key] ?? true
                  return (
                    <div
                      key={el.key}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 500, color: D.t1 }}>
                          {el.name}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 2 }}>{el.desc}</div>
                      </div>
                      <Toggle
                        value={value}
                        onChange={(v) =>
                          // Păstrăm tema/accentul/layout-ul; schimbăm doar un element.
                          updTheme({
                            elements: { ...(form.theme_settings?.elements ?? {}), [el.key]: v },
                          })
                        }
                      />
                    </div>
                  )
                })}
              </div>
            </SettingsCard>

            {/* Limbi meniu — limbile suplimentare oferite clientului (fără 'ro'). */}
            <SettingsCard
              icon="info"
              title="Limbi meniu"
              desc="Limbi în care clientul poate vedea meniul. Româna e mereu disponibilă."
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {MENU_LANGS.filter((l) => l.code !== 'ro').map((l) => {
                  const active = (form.menu_languages ?? []).includes(l.code)
                  return (
                    <button
                      key={l.code}
                      type="button"
                      onClick={() => toggleMenuLang(l.code)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: active ? D.goldA : D.s3,
                        border: `1px solid ${active ? D.gold : D.border}`,
                        color: active ? D.goldL : D.t2,
                        padding: '6px 12px',
                        borderRadius: 100,
                        fontSize: '0.78rem',
                        fontWeight: active ? 600 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      <span>{l.flag}</span>
                      {l.label}
                    </button>
                  )
                })}
              </div>
            </SettingsCard>

            {/* Moneda meniului (mig 205) — pista internațională, planurile 1-2. */}
            <SettingsCard
              icon="info"
              title="Moneda meniului"
              desc="Moneda în care se afișează prețurile în meniul public și QR. Abonamentul Menuvia și fiscalizarea nu sunt afectate."
              right={
                <select
                  aria-label="Moneda meniului"
                  value={(form.currency as string) ?? 'RON'}
                  onChange={(e) => upd('currency', e.target.value)}
                  style={{
                    background: D.s3,
                    border: `1px solid ${D.border}`,
                    borderRadius: 8,
                    color: D.t1,
                    fontFamily: 'DM Sans, sans-serif',
                    fontSize: 14,
                    padding: '10px 12px',
                    minHeight: 44,
                    cursor: 'pointer',
                  }}
                >
                  {MENU_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c === 'RON' ? 'RON (lei)' : c}
                    </option>
                  ))}
                </select>
              }
            />
          </>
        )}

        {section === 'orders' && (
          <>
            {/* MODULES toggles — Gate D */}
            {modulesState && (
              <SettingsCard
                icon="sparkle"
                title="Module opționale"
                desc="Activează doar ce ai nevoie. Modulele dezactivate sunt blocate server-side — nici clienții, nici angajații nu pot crea date pe ele."
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          fontWeight: 500,
                          color: D.t1,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <Icon name="calendar" size={15} color={D.t2} />
                        Rezervări
                      </div>
                      <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 2 }}>
                        Permite clienților să rezerve mese din meniul public. Vei avea tabul Rezervări
                        în dashboard pentru gestionare.
                      </div>
                    </div>
                    <Toggle
                      value={modulesState.isEnabled('reservations')}
                      onChange={(v) => {
                        modulesState
                          .setModule('reservations', v)
                          .then(() =>
                            toast(v ? 'Modulul Rezervări activat' : 'Modulul Rezervări dezactivat'),
                          )
                          .catch((err) =>
                            toast(err instanceof Error ? err.message : 'Eroare la salvare'),
                          )
                      }}
                    />
                  </div>
                </div>
              </SettingsCard>
            )}

            {/* Plăți online la masă — Etapa 1 (docs/ONLINE_PAYMENT.md) */}
            {modulesState && (
              <OnlinePaymentsCard
                restaurantId={restaurant.id}
                plan={plan}
                modulesState={modulesState}
                toast={toast}
              />
            )}

            {/* Pickup ordering settings */}
            <SettingsCard
              icon="box"
              title="Comenzi pentru ridicare (click-and-collect)"
              desc={
                <>
                  Activează pagina ta publică{' '}
                  <span style={{ color: D.gold }}>menuvia.ro/r/{form.slug || 'slug'}</span>. Clienții
                  pot comanda fără să scaneze QR și ridică direct de la restaurant. Plata cash la
                  ridicare.
                </>
              }
              right={
                <Toggle
                  value={form.pickup_settings?.enabled ?? false}
                  onChange={(v) => updPickup({ enabled: v })}
                />
              }
            >
              {form.pickup_settings?.enabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '0.74rem',
                          color: D.t2,
                          marginBottom: 5,
                        }}
                      >
                        Pregătire minim (min)
                      </label>
                      <Inp
                        value={String(form.pickup_settings?.min_lead_time_minutes ?? 20)}
                        onChange={(v) => {
                          const n = parseInt(v)
                          if (!isNaN(n) && n >= 5 && n <= 240) updPickup({ min_lead_time_minutes: n })
                        }}
                        type="number"
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '0.74rem',
                          color: D.t2,
                          marginBottom: 5,
                        }}
                      >
                        Interval slot (min)
                      </label>
                      <Inp
                        value={String(form.pickup_settings?.slot_interval_minutes ?? 15)}
                        onChange={(v) => {
                          const n = parseInt(v)
                          if (!isNaN(n) && n >= 5 && n <= 60) updPickup({ slot_interval_minutes: n })
                        }}
                        type="number"
                      />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '0.74rem',
                          color: D.t2,
                          marginBottom: 5,
                        }}
                      >
                        Deschidere
                      </label>
                      <Inp
                        value={form.pickup_settings?.open_hours?.start ?? '09:00'}
                        onChange={(v) =>
                          updPickup({
                            open_hours: {
                              start: v,
                              end: form.pickup_settings?.open_hours?.end ?? '21:00',
                            },
                          })
                        }
                        placeholder="09:00"
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '0.74rem',
                          color: D.t2,
                          marginBottom: 5,
                        }}
                      >
                        Închidere
                      </label>
                      <Inp
                        value={form.pickup_settings?.open_hours?.end ?? '21:00'}
                        onChange={(v) =>
                          updPickup({
                            open_hours: {
                              start: form.pickup_settings?.open_hours?.start ?? '09:00',
                              end: v,
                            },
                          })
                        }
                        placeholder="21:00"
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      style={{ display: 'block', fontSize: '0.74rem', color: D.t2, marginBottom: 5 }}
                    >
                      Instrucțiuni client (opțional)
                    </label>
                    <Inp
                      value={form.pickup_settings?.instructions ?? ''}
                      onChange={(v) =>
                        updPickup({ instructions: v.length > 0 ? v : null })
                      }
                      placeholder="Ex: Sună la sosire, intrarea pe lateral"
                    />
                  </div>
                  <div
                    style={{
                      fontSize: '0.7rem',
                      color: D.t3,
                      padding: '8px 10px',
                      background: D.s3,
                      borderRadius: 7,
                      lineHeight: 1.5,
                    }}
                  >
                    💡 Comenzile pickup apar în KitchenPage cu badge{' '}
                    <strong style={{ color: D.gold }}>📦 Pickup</strong>. Numele clientului și ora
                    ridicării sunt vizibile.
                  </div>
                </div>
              )}
            </SettingsCard>

            {/* Checkout suggestion settings */}
            <SettingsCard
              icon="orders"
              title="Sugestii la coș"
              desc="Sugerează automat produse din categorii lipsă din coș (ex: client a luat fel principal dar n-a luat desert)."
              right={
                <Toggle
                  value={form.checkout_suggestion_settings?.enabled ?? false}
                  onChange={(v) =>
                    upd('checkout_suggestion_settings', {
                      ...(form.checkout_suggestion_settings ?? {
                        categories: [],
                        max_suggestions: 2,
                        message: '🍰 Înainte să trimiți... ai vrea ceva în plus?',
                      }),
                      enabled: v,
                    })
                  }
                />
              }
            >
              {form.checkout_suggestion_settings?.enabled && (
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.74rem',
                      color: D.t2,
                      marginBottom: 5,
                      marginTop: 8,
                    }}
                  >
                    Mesaj afișat
                  </label>
                  <Inp
                    value={form.checkout_suggestion_settings?.message ?? ''}
                    onChange={(v) =>
                      upd('checkout_suggestion_settings', {
                        ...(form.checkout_suggestion_settings ?? {
                          enabled: true,
                          categories: [],
                          max_suggestions: 2,
                          message: '',
                        }),
                        message: v,
                      })
                    }
                    placeholder="🍰 Înainte să trimiți... ai vrea ceva în plus?"
                  />
                </div>
              )}
            </SettingsCard>

            {/* VAT rates configuration */}
            <SettingsCard
              icon="receipt"
              title="Cote TVA"
              desc="Cele 4 grupe de TVA folosite în restaurantul tău. Modifică procentul când statul schimbă cotele — produsele își păstrează automat grupa."
            >
              <VatRatesEditor restaurantId={restaurant.id} />
            </SettingsCard>
          </>
        )}

        {section === 'account' && (
          <>
            <SettingsCard icon="star" title="Plan curent">
              <span
                style={{
                  padding: '4px 10px',
                  background: D.goldA,
                  border: `1px solid ${D.gold}44`,
                  borderRadius: 6,
                  fontSize: '0.78rem',
                  color: D.goldL,
                  fontWeight: 600,
                }}
              >
                {PLAN_LABELS[plan] || plan}
              </span>
            </SettingsCard>

            <button
              onClick={onSignOut}
              style={btn({
                background: D.s2,
                color: D.t2,
                border: `1px solid ${D.border}`,
                width: '100%',
                justifyContent: 'center',
              })}
            >
              Deconectare
            </button>
          </>
        )}
      </div>

      {/* Bară de salvare sticky jos — formularul e lung, iar butonul „Salvează"
          de sus iese din ecran. Apare doar când ai modificări nesalvate și
          folosește ACELAȘI handleSave (fără logică duplicată). safe-area pentru
          notch-ul de jos pe mobil. */}
      {dirty && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            marginTop: 16,
            background: D.s1,
            borderTop: `1px solid ${D.border}`,
            padding: '12px 0',
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            zIndex: 10,
            boxShadow: '0 -6px 20px rgba(0,0,0,0.25)',
          }}
        >
          <span style={{ color: D.t2, fontSize: '0.78rem', marginRight: 'auto' }}>
            Ai modificări nesalvate
          </span>
          <button
            onClick={handleSave}
            disabled={saving}
            style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.7 : 1 })}
          >
            {saving ? 'Se salvează...' : 'Salvează'}
          </button>
        </div>
      )}
    </div>
  )
}
