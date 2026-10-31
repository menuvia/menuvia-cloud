// Helpers UI partajate între DashboardPage, SettingsTab, ProductsTab,
// CategoriesTab. Extracție DRY după refactor-ul god component.
// API păstrat 1:1 cu legacy (lift-and-shift); migrare la src/components/ui/
// (Toast / useToast cu API .success/.error) e refactor separat.
//
// Fișier hibrid (components + style helpers + hook). Split în 2 fișiere e
// follow-up — pentru acum dezactivăm regula react-refresh local.
/* eslint-disable react-refresh/only-export-components */

import { useState, useCallback, useId } from 'react'
import type React from 'react'
import { createPortal } from 'react-dom'
import { D } from '../../lib/constants'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { FocusTrap } from '../ui/FocusTrap'

// ── Style helpers ──

export const btn = (e: React.CSSProperties = {}): React.CSSProperties => ({
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

export const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '11px 14px',
  fontSize: '0.9rem',
  color: D.t1,
  // Fără `outline: 'none'` (audit a11y oct 2026): stilul inline bătea regula
  // globală `:focus-visible` și câmpul rămânea fără indicator de focus la
  // tastatură. Bordura aurie de la onFocus rămâne, inelul global se adaugă.
  height: 44,
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}

// ── Toast (legacy API: toast(msg, type) + <Toast toasts={...} />) ──

export interface ToastItem {
  id: string
  msg: string
  type: string
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toast = useCallback((msg: string, type = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])
  return { toasts, toast }
}

function ToastCard({ toast }: { toast: ToastItem }) {
  return (
    <div
      style={{
        background: D.s3,
        borderLeft: `3px solid ${toast.type === 'error' ? D.red : D.green}`,
        borderRadius: 10,
        padding: '12px 16px',
        fontSize: '0.875rem',
        color: D.t1,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        minWidth: 220,
        maxWidth: 320,
      }}
    >
      {toast.msg}
    </div>
  )
}

// Notificările sunt anunțate de cititorul de ecran (audit a11y oct 2026):
// înainte erau div-uri simple, deci „Salvat" sau „Eroare: …" apăreau doar
// vizual. Două regiuni live, montate PERMANENT (o regiune care apare odată cu
// mesajul nu e anunțată de toate cititoarele): confirmările în `role="status"`
// (politicos), erorile într-o regiune `aria-live="assertive"`. Erorile NU poartă
// `role="alert"` pe regiune: o regiune goală cu acel rol ar fi un „alert"
// permanent în pagină, iar dialogurile își au propriile alerte de eroare.
export function Toast({ toasts }: { toasts: ToastItem[] }) {
  const errors = toasts.filter((t) => t.type === 'error')
  const others = toasts.filter((t) => t.type !== 'error')
  const region: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }
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
      <div role="status" aria-live="polite" style={region}>
        {others.map((t) => (
          <ToastCard key={t.id} toast={t} />
        ))}
      </div>
      <div aria-live="assertive" style={region}>
        {errors.map((t) => (
          <ToastCard key={t.id} toast={t} />
        ))}
      </div>
    </div>
  )
}

// ── Modal wrapper ──
// Dialog real (audit a11y oct 2026): `role="dialog"` + `aria-modal` + nume
// din titlu, capcană de focus (Tab nu mai pleacă în pagina de sub backdrop,
// iar la închidere focusul revine pe butonul care l-a deschis) și Escape care
// închide — doar când modalul e vârful stivei, deci o confirmare deschisă
// peste el se închide singură. Click pe backdrop închide, ca înainte.

export function Modal({
  title,
  onClose,
  children,
  width = 520,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  width?: number
}) {
  // Blocăm scroll-ul paginii cât modalul e deschis (fix #74) — hook ref-counted,
  // deci e sigur chiar dacă un caller îl mai apelează o dată în afară.
  useBodyScrollLock(true)
  const titleId = useId()
  // Portal la <body>: overlay-ul `position:fixed` e ancorat la viewport, nu la
  // containerul de scroll al tab-ului (`contentScrollRef` are overflow:auto).
  // Fără portal, un ancestor cu transform/overflow ar putea deplasa modalul în
  // afara ecranului → userul trebuia să dea scroll ca să-l vadă.
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      onClick={onClose}
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(8px)',
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
        aria-labelledby={titleId}
        style={{
          background: D.s2,
          border: `1px solid ${D.bHov}`,
          borderRadius: 18,
          width: '100%',
          maxWidth: width,
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <FocusTrap onEscape={onClose} />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '18px 22px',
            borderBottom: `1px solid ${D.border}`,
          }}
        >
          <h2
            id={titleId}
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.05rem',
              fontWeight: 400,
              color: D.t1,
              margin: 0,
            }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Închide"
            style={{
              background: 'transparent',
              border: 'none',
              color: D.t2,
              cursor: 'pointer',
              padding: 6,
              borderRadius: 8,
              fontSize: 18,
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div style={{ padding: 22 }}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ── Form controls ──
// `label` e OBLIGATORIU (audit a11y oct 2026): eticheta vizibilă de deasupra
// câmpului e un <label> fără `htmlFor` (Inp nu primea id), deci cititorul de
// ecran anunța doar „câmp de editare" / „buton". Numele ajunge acum pe control
// ca `aria-label` — același text ca eticheta vizibilă (WCAG 2.5.3) — iar un
// apel nou fără nume nu mai compilează.

export function Inp({
  value,
  onChange,
  placeholder,
  type = 'text',
  label,
  id,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  /** Numele accesibil al câmpului (textul etichetei vizibile). */
  label: string
  id?: string
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      style={inp}
      onFocus={(e) => (e.target.style.borderColor = D.gold)}
      onBlur={(e) => (e.target.style.borderColor = D.border)}
    />
  )
}

export function Sel({
  value,
  onChange,
  children,
  label,
  id,
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
  /** Numele accesibil al listei (textul etichetei vizibile). */
  label: string
  id?: string
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      style={{ ...inp, cursor: 'pointer' }}
    >
      {children}
    </select>
  )
}

// Comutator: `role="switch"` + `aria-checked` (înainte era un <button> fără
// nume și fără stare — „buton", nimic despre ce pornește sau dacă e pornit).
// `disabled` blochează schimbarea (ex. o opțiune pe care planul nu o include).
export function Toggle({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: boolean
  onChange: (v: boolean) => void
  /** Ce pornește comutatorul — anunțat de cititorul de ecran. */
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!value)
      }}
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        background: value ? D.gold : D.s4,
        border: `1px solid ${value ? D.gold : D.border}`,
        position: 'relative',
        transition: 'all .2s',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
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
