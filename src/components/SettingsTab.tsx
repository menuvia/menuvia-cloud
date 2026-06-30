import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { changeRestaurantSlug } from '../lib/restaurants'
import { D, PLAN_LABELS, AMENITIES, type AmenityId } from '../lib/constants'
import { THEMES } from '../lib/themes'
import VatRatesEditor from './VatRatesEditor'
import type { Restaurant } from '../hooks/useData'
import type { useRestaurantModules } from '../hooks/useRestaurantModules'
import { btn, useToast, Toast, Inp, Toggle } from './_dashboard/sharedUI'
import { useIsMobile } from '../hooks/useIsMobile'
import { Icon } from './ui/Icon'

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
  const [form, setForm] = useState({ ...restaurant })
  const [saving, setSaving] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const { toasts, toast } = useToast()
  const upd = (k: keyof Restaurant, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  // Re-sincronizează formularul când prop-ul restaurant se schimbă (ex. după salvarea
  // slug-ului prin RPC, care întoarce slug-ul normalizat) — altfel form-ul rămâne stale.
  useEffect(() => {
    setForm({ ...restaurant })
  }, [restaurant])

  async function uploadImage(file: File, kind: 'cover' | 'logo'): Promise<string | null> {
    if (!user) return null
    const setBusy = kind === 'cover' ? setUploadingCover : setUploadingLogo
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
      const maxW = kind === 'cover' ? 1600 : 400
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

  function updHours(day: WeekDayKey, patch: Partial<DayHoursForm>) {
    const current = (form.hours_structured ?? {}) as Record<string, DayHoursForm>
    const today = current[day] ?? { open: '08:00', close: '23:00', closed: false }
    upd('hours_structured', { ...current, [day]: { ...today, ...patch } })
  }

  function copyMondayToAll() {
    const current = (form.hours_structured ?? {}) as Record<string, DayHoursForm>
    const mon = current.mon ?? { open: '08:00', close: '23:00', closed: false }
    const next: Record<string, DayHoursForm> = {}
    for (const d of WEEK_DAY_KEYS) next[d] = { ...mon }
    upd('hours_structured', next)
  }
  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  const COLORS = ['#C8963C', '#E05555', '#4CAF6E', '#5B8DEF', '#9B72CF', '#E07B45', '#3ABFBF']

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

  return (
    <div>
      <Toast toasts={toasts} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 22,
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
            Setări
          </h2>
          <p style={{ color: D.t2, fontSize: '0.78rem', marginTop: 3 }}>
            Informații afișate pe meniul public
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
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
        <div
          style={{
            background: D.s2,
            border: `1px solid ${D.border}`,
            borderRadius: 14,
            padding: 22,
          }}
        >
          <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 16 }}>
            Informații principale
          </div>
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
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: 22,
            }}
          >
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 14 }}>
              URL meniu
            </div>
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
                onChange={(v) => upd('slug', slugify(v))}
                placeholder="slug-url"
              />
            </div>
          </div>
          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: 22,
            }}
          >
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 14 }}>
              Culoare accent
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => upd('primary_color', c)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: c,
                    border: `3px solid ${form.primary_color === c ? '#fff' : 'transparent'}`,
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          </div>
          {/* Theme picker — 8 preset themes for QR menu */}
          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: 22,
            }}
          >
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 6 }}>
              Tema meniului QR
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t2, marginBottom: 14, lineHeight: 1.5 }}>
              Alege stilul vizual pentru meniul tău. Se aplică instant pe pagina pe care o văd
              clienții.
            </div>
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
                      upd('theme_settings', {
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
          </div>

          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: 22,
            }}
          >
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 12 }}>
              Plan curent
            </div>
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
          </div>

          {/* COVER IMAGE — afișată în hero-ul meniului public */}
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
                fontSize: '0.875rem',
                fontWeight: 500,
                color: D.t1,
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="image" size={16} color={D.t2} />
              Imagine cover
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t2, marginBottom: 14, lineHeight: 1.5 }}>
              Afișată în hero-ul meniului public. Recomandat: format 16:9, &gt;1200px lățime. Dacă
              lipsește, folosim un gradient generat din tema ta.
            </div>
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
          </div>

          {/* LOGO upload — square */}
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
                fontSize: '0.875rem',
                fontWeight: 500,
                color: D.t1,
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="tag" size={16} color={D.t2} />
              Logo
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t2, marginBottom: 14, lineHeight: 1.5 }}>
              Logo pătrat. Opțional, folosit ca avatar / favicon viitor.
            </div>
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
          </div>

          {/* PROGRAM DETALIAT — hours_structured per zi */}
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
                marginBottom: 6,
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
                <Icon name="clock" size={16} color={D.t2} />
                Program detaliat
              </div>
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
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t2, marginBottom: 12, lineHeight: 1.5 }}>
              Folosit pentru indicatorul "DESCHIS ACUM" și textul "Astăzi 08:00–23:00" din meniul
              public.
            </div>
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
                    <input
                      type="time"
                      disabled={cur.closed}
                      value={cur.open}
                      onChange={(e) => updHours(day, { open: e.target.value })}
                      style={{
                        background: D.s3,
                        border: `1px solid ${D.border}`,
                        color: D.t1,
                        padding: '6px 8px',
                        borderRadius: 6,
                        fontSize: '0.78rem',
                        opacity: cur.closed ? 0.4 : 1,
                      }}
                    />
                    <input
                      type="time"
                      disabled={cur.closed}
                      value={cur.close}
                      onChange={(e) => updHours(day, { close: e.target.value })}
                      style={{
                        background: D.s3,
                        border: `1px solid ${D.border}`,
                        color: D.t1,
                        padding: '6px 8px',
                        borderRadius: 6,
                        fontSize: '0.78rem',
                        opacity: cur.closed ? 0.4 : 1,
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          {/* MODULES toggles — Gate D */}
          {modulesState && (
            <div
              style={{
                background: D.s2,
                border: `1px solid ${D.border}`,
                borderRadius: 14,
                padding: 22,
              }}
            >
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 6 }}>
                🧩 Module opționale
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t2, marginBottom: 16, lineHeight: 1.5 }}>
                Activează doar ce ai nevoie. Modulele dezactivate sunt blocate server-side — nici
                clienții, nici angajații nu pot crea date pe ele.
              </div>
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
            </div>
          )}

          {/* AMENITIES toggles */}
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
                fontSize: '0.875rem',
                fontWeight: 500,
                color: D.t1,
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="sparkle" size={16} color={D.t2} />
              Facilități
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t2, marginBottom: 12, lineHeight: 1.5 }}>
              Afișate ca pills în hero-ul meniului public.
            </div>
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
          </div>

          {/* WiFi password */}
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
                fontSize: '0.875rem',
                fontWeight: 500,
                color: D.t1,
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="wifi" size={16} color={D.t2} />
              Parolă WiFi (opțional)
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t2, marginBottom: 12, lineHeight: 1.5 }}>
              Afișată în meniu sub formă vizibilă. Lasă gol dacă nu vrei să publici.
            </div>
            <Inp
              value={form.wifi_password ?? ''}
              onChange={(v) => upd('wifi_password', v.trim() || null)}
              placeholder="ex: tinctura2024"
            />
          </div>

          {/* Social media */}
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
                fontSize: '0.875rem',
                fontWeight: 500,
                color: D.t1,
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="link" size={16} color={D.t2} />
              Social media
            </div>
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
          </div>

          {/* VAT rates configuration */}
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
                fontSize: '0.875rem',
                fontWeight: 500,
                color: D.t1,
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="receipt" size={16} color={D.t2} />
              Cote TVA
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t2, lineHeight: 1.5, marginBottom: 14 }}>
              Cele 4 grupe de TVA folosite în restaurantul tău. Modifică procentul când statul
              schimbă cotele — produsele își păstrează automat grupa.
            </div>
            <VatRatesEditor restaurantId={restaurant.id} />
          </div>

          {/* Google Review CTA settings */}
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
                fontSize: '0.875rem',
                fontWeight: 500,
                color: D.t1,
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="star" size={16} color={D.t2} />
              Google Reviews (recenzii automate)
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t2, lineHeight: 1.5, marginBottom: 12 }}>
              După ce clientul finalizează plata și dă feedback pozitiv (rating ≥ 4), îi vom afișa
              un buton "Scrie o recenzie pe Google" care îl duce direct la pagina ta de business.
              Cel mai rapid mod să crești numărul de recenzii.
            </div>

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
          </div>

          {/* Checkout suggestion settings */}
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
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1 }}>
                Sugestii la coș
              </div>
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
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t2, lineHeight: 1.5, marginBottom: 8 }}>
              Sugerează automat produse din categorii lipsă din coș (ex: client a luat fel principal
              dar n-a luat desert).
            </div>
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
          </div>

          {/* Pickup ordering settings */}
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
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
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
                <Icon name="box" size={16} color={D.t2} />
                Comenzi pentru ridicare (click-and-collect)
              </div>
              <Toggle
                value={form.pickup_settings?.enabled ?? false}
                onChange={(v) =>
                  upd('pickup_settings', {
                    ...(form.pickup_settings ?? {
                      min_lead_time_minutes: 20,
                      slot_interval_minutes: 15,
                      open_hours: { start: '09:00', end: '21:00' },
                      instructions: null,
                    }),
                    enabled: v,
                  })
                }
              />
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t2, lineHeight: 1.5, marginBottom: 8 }}>
              Activează pagina ta publică{' '}
              <span style={{ color: D.gold }}>menuvia.ro/r/{form.slug || 'slug'}</span>. Clienții
              pot comanda fără să scaneze QR și ridică direct de la restaurant. Plata cash la
              ridicare.
            </div>
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
                        if (!isNaN(n) && n >= 5 && n <= 240)
                          upd('pickup_settings', {
                            ...(form.pickup_settings ?? {
                              enabled: true,
                              slot_interval_minutes: 15,
                              open_hours: { start: '09:00', end: '21:00' },
                              instructions: null,
                            }),
                            min_lead_time_minutes: n,
                          })
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
                        if (!isNaN(n) && n >= 5 && n <= 60)
                          upd('pickup_settings', {
                            ...(form.pickup_settings ?? {
                              enabled: true,
                              min_lead_time_minutes: 20,
                              open_hours: { start: '09:00', end: '21:00' },
                              instructions: null,
                            }),
                            slot_interval_minutes: n,
                          })
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
                        upd('pickup_settings', {
                          ...(form.pickup_settings ?? {
                            enabled: true,
                            min_lead_time_minutes: 20,
                            slot_interval_minutes: 15,
                            open_hours: { start: '09:00', end: '21:00' },
                            instructions: null,
                          }),
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
                        upd('pickup_settings', {
                          ...(form.pickup_settings ?? {
                            enabled: true,
                            min_lead_time_minutes: 20,
                            slot_interval_minutes: 15,
                            open_hours: { start: '09:00', end: '21:00' },
                            instructions: null,
                          }),
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
                      upd('pickup_settings', {
                        ...(form.pickup_settings ?? {
                          enabled: true,
                          min_lead_time_minutes: 20,
                          slot_interval_minutes: 15,
                          open_hours: { start: '09:00', end: '21:00' },
                          instructions: null,
                        }),
                        instructions: v.length > 0 ? v : null,
                      })
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
          </div>

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
        </div>
      </div>
    </div>
  )
}
