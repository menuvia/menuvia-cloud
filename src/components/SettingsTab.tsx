// src/components/SettingsTab.tsx
// ─────────────────────────────────────────────────────────────────
// Tab "Setări" în DashboardPage — extras din fișierul monolit pentru
// a fi lazy-loaded. Doar owner-ii intră aici (admin-only) și
// majoritatea utilizatorilor o deschid rareori, deci e candidat
// ideal pentru deferral.
//
// Helper-urile vizuale (Inp/Toggle/btn/inp + Toast) sunt duplicate
// din DashboardPage ca să păstrăm extragerea self-contained, fără
// să atingem alte componente. Aceeași strategie ca ProductModal.
// ─────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react'
import React from 'react'
import { D, PLAN_LABELS } from '../lib/constants'
import { THEMES } from '../lib/themes'
import VatRatesEditor from './VatRatesEditor'
import type { Restaurant } from '../hooks/useData'

// ── Helpers vizuale (duplicate din DashboardPage) ─────────────────
const btn = (e: React.CSSProperties = {}): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '0 18px',
  height: 44,
  borderRadius: 10,
  fontSize: '0.9rem',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  ...e,
})

const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '11px 14px',
  fontSize: '0.9rem',
  color: D.t1,
  outline: 'none',
  height: 44,
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}

function Inp({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={inp}
      onFocus={(e) => (e.target.style.borderColor = D.gold)}
      onBlur={(e) => (e.target.style.borderColor = D.border)}
    />
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        background: value ? D.gold : D.s4,
        border: `1px solid ${value ? D.gold : D.border}`,
        position: 'relative',
        transition: 'all .2s',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 3,
          left: value ? 20 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left .2s',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
        }}
      />
    </button>
  )
}

function useToast() {
  const [toasts, setToasts] = useState<{ id: string; msg: string; type: string }[]>([])
  const toast = useCallback((msg: string, type = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
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
            padding: '12px 16px',
            fontSize: '0.875rem',
            color: D.t1,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            minWidth: 220,
            maxWidth: 320,
          }}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// ── Settings Tab (default export) ─────────────────────────────────
export default function SettingsTab({
  restaurant,
  onUpdate,
  plan,
  onSignOut,
}: {
  restaurant: Restaurant
  onUpdate: (id: string, f: Partial<Restaurant>) => Promise<{ error: Error | null }>
  plan: string
  onSignOut: () => void
}) {
  const [form, setForm] = useState({ ...restaurant })
  const [saving, setSaving] = useState(false)
  const { toasts, toast } = useToast()
  const upd = (k: keyof Restaurant, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  const COLORS = ['#C8963C', '#E05555', '#4CAF6E', '#5B8DEF', '#9B72CF', '#E07B45', '#3ABFBF']

  const handleSave = async () => {
    setSaving(true)
    const { error } = await onUpdate(restaurant.id, form)
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
          <p style={{ color: D.t3, fontSize: '0.78rem', marginTop: 3 }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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
            <div style={{ fontSize: '0.72rem', color: D.t3, marginBottom: 14, lineHeight: 1.5 }}>
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

          {/* VAT rates configuration */}
          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: 22,
            }}
          >
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 6 }}>
              🧾 Cote TVA
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t3, lineHeight: 1.5, marginBottom: 14 }}>
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
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 6 }}>
              ⭐ Google Reviews (recenzii automate)
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t3, lineHeight: 1.5, marginBottom: 12 }}>
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
            <div style={{ fontSize: '0.7rem', color: D.t3, marginTop: 6, lineHeight: 1.5 }}>
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
                <div style={{ color: '#4CAF6E', marginBottom: 4 }}>✓ Configurat</div>
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
            <div style={{ fontSize: '0.72rem', color: D.t3, lineHeight: 1.5, marginBottom: 8 }}>
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
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1 }}>
                📦 Comenzi pentru ridicare (click-and-collect)
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
            <div style={{ fontSize: '0.72rem', color: D.t3, lineHeight: 1.5, marginBottom: 8 }}>
              Activează pagina ta publică{' '}
              <span style={{ color: D.gold }}>menuvia.ro/r/{form.slug || 'slug'}</span>. Clienții
              pot comanda fără să scaneze QR și ridică direct de la restaurant. Plata cash la
              ridicare.
            </div>
            {form.pickup_settings?.enabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
