// ─────────────────────────────────────────────────────────────
// MyListSheet — foaia „Lista mea" de pe meniul digital (/m/:slug fără ridicare).
//
// Lista e LOCALĂ (localStorage, nu se trimite nicăieri): oaspetele își notează
// ce vrea și i-o arată ospătarului. Înainte, foaia avea UN SINGUR buton, care
// GOLEA lista („Golește lista" când avea produse) — reflexul „închid foaia"
// ștergea tot ce adunase oaspetele; în plus foaia n-avea X, nici Escape, nici
// semantică de dialog (ux-guest-3, a11y-focus-trap-gaps).
//
// Acum: acțiunea principală e „Închide" (doar închide); „Golește lista" e
// secundar și cere a doua atingere („Da, golește lista"). Dialog modal real:
// role="dialog" + aria-modal, capcană de focus, Escape, scroll-lock, X în colț,
// subsol peste bara de home a iPhone-ului.
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { FocusTrap } from './ui/FocusTrap'
import { Icon } from './ui/Icon'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { lineTotal, type CartItem } from '../lib/orders'
import { fmtPrice, type MenuCurrency } from '../lib/currency'
import { T } from '../lib/publicMenuStrings'
import { readableTextOn } from '../lib/themes'

interface ListPalette {
  bg: string
  surface: string
  text: string
  text2: string
  text3: string
  border: string
  borderStrong: string
}

interface MyListSheetProps {
  items: CartItem[]
  total: number
  currency: MenuCurrency
  lang: string
  accent: string
  PUB: ListPalette
  fonts: { heading: string; body: string }
  /** Stilul titlului (sectionTitle din scala meniului). */
  titleStyle: CSSProperties
  /** Culoarea de eroare a temei — pentru pasul de confirmare al golirii. */
  errorColor: string
  onRemove: (key: string) => void
  onClear: () => void
  onClose: () => void
}

export default function MyListSheet({
  items,
  total,
  currency,
  lang,
  accent,
  PUB,
  fonts,
  titleStyle,
  errorColor,
  onRemove,
  onClear,
  onClose,
}: MyListSheetProps) {
  useBodyScrollLock(true)
  // Primul tap pe „Golește lista" doar armează confirmarea; al doilea golește.
  const [confirmingClear, setConfirmingClear] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const hasItems = items.length > 0

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,18,8,0.55)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={T(lang, 'my_list')}
        style={{
          background: PUB.bg,
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          outline: 'none',
        }}
      >
        <FocusTrap />
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: PUB.borderStrong,
            margin: '10px auto 0',
          }}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label={T(lang, 'close')}
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: `1px solid ${PUB.border}`,
            background: PUB.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <Icon name="close" size={18} color={PUB.text} />
        </button>
        <div style={{ padding: '20px 22px 14px', flex: 1, overflowY: 'auto' }}>
          <div style={{ ...titleStyle, color: PUB.text, marginBottom: 14, paddingRight: 44 }}>
            {T(lang, 'my_list')}
          </div>
          <div style={{ fontSize: 13, color: PUB.text2, marginTop: -8, marginBottom: 14 }}>
            {T(lang, 'list_subtitle')}
          </div>
          {!hasItems && (
            <div
              style={{
                fontSize: 14,
                color: PUB.text3,
                padding: '18px 0',
                textAlign: 'center',
                lineHeight: 1.5,
              }}
            >
              {T(lang, 'list_empty')}
            </div>
          )}
          {items.map((item) => (
            <div
              key={item._key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 0',
                borderBottom: `1px solid ${PUB.border}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: PUB.text }}>
                  {item.quantity}× {item.product_name_snapshot}
                </div>
                {item.selected_modifiers.length > 0 && (
                  <div style={{ fontSize: 11, color: PUB.text3, marginTop: 3 }}>
                    {item.selected_modifiers.map((m) => m.option_name).join(', ')}
                  </div>
                )}
                {(item.selected_extras ?? []).length > 0 && (
                  <div style={{ fontSize: 11, color: PUB.text3, marginTop: 3 }}>
                    + {(item.selected_extras ?? []).map((e) => e.name).join(', ')}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontFamily: fonts.heading,
                    fontSize: 14,
                    fontWeight: 700,
                    color: accent,
                  }}
                >
                  {fmtPrice(lineTotal(item), currency)}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(item._key)}
                  aria-label={T(lang, 'remove')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: PUB.text3,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 44,
                    minHeight: 44,
                  }}
                >
                  <Icon name="close" size={16} color={PUB.text3} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            // Peste bara de home a iPhone-ului (ux-guest-11).
            padding: '14px 22px calc(22px + env(safe-area-inset-bottom, 0px))',
            borderTop: `1px solid ${PUB.border}`,
            background: PUB.bg,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 2,
            }}
          >
            <span style={{ fontSize: 14, color: PUB.text2 }}>{T(lang, 'total')}</span>
            <span
              style={{ fontFamily: fonts.heading, fontSize: 22, fontWeight: 700, color: PUB.text }}
            >
              {fmtPrice(total, currency)}
            </span>
          </div>
          {/* Acțiunea principală DOAR închide — lista rămâne pe telefon. */}
          <button
            type="button"
            onClick={onClose}
            style={{
              width: '100%',
              padding: '15px',
              background: accent,
              // Text pe accent ales pe contrast, nu alb fix (a11y-guest-cta-white-on-accent).
              color: readableTextOn(accent, PUB.text),
              border: 'none',
              borderRadius: 12,
              fontFamily: fonts.body,
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              minHeight: 48,
            }}
          >
            {T(lang, 'close')}
          </button>
          {hasItems && (
            <button
              type="button"
              onClick={() => {
                if (!confirmingClear) {
                  setConfirmingClear(true)
                  return
                }
                setConfirmingClear(false)
                onClear()
              }}
              style={{
                width: '100%',
                padding: '12px',
                background: 'transparent',
                color: confirmingClear ? errorColor : PUB.text2,
                border: `1px solid ${confirmingClear ? errorColor : PUB.borderStrong}`,
                borderRadius: 12,
                fontFamily: fonts.body,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              {confirmingClear ? T(lang, 'clear_list_confirm') : T(lang, 'clear_list')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
