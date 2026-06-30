// QrCartSheet — coșul la masă (QR flow), redesign „Masa ta".
// Extras din QrMenuPage pentru code-splitting; lazy-loaded.
// Vizual aliniat la mockup: header „Masa ta", secțiune ÎN COȘ · DE TRIMIS cu
// thumbnail-uri, RECOMANDATE ALĂTURI pe orizontală, CTA cu prețul în buton.
// Folosește tokens-urile temei (PUB/accent) — fără hex hardcodat. Motion prin
// clasele din animations.css (reduced-motion respectat global).
import { useMemo, type CSSProperties } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import type { CartItem, OrderConfirmationPayload } from '../lib/orders'
import type { Category, Product } from '../lib/qr'

interface PUBColors {
  bg: string
  surface: string
  text: string
  text2: string
  text3: string
  border: string
  borderStrong: string
}

export interface QrCartSheetProps {
  cart: CartItem[]
  cartTotal: number
  notes: string
  submitting: boolean
  submitError: string | null
  categories: Category[]
  checkoutSuggestionSettings:
    | {
        enabled: boolean
        max_suggestions?: number
        message?: string
      }
    | null
    | undefined
  PUB: PUBColors
  accent: string
  accentGradient: string
  onClose: () => void
  onNotesChange: (v: string) => void
  onUpdateQty: (key: string, delta: number) => void
  onRemove: (key: string) => void
  onLineTotal: (item: CartItem) => number
  onSubmit: () => void
  onOpenProduct: (product: Product) => void
  onAddToCart: (item: CartItem) => void
  // Opțional — modul „Masa ta" complet: comenzi deja trimise (La bucătărie) +
  // plata mesei. Dacă lipsesc, sheet-ul rămâne coș simplu (backward-compatible).
  sentOrders?: OrderConfirmationPayload[]
  tableTotal?: number
  onPayTable?: () => void
  payDisabled?: boolean
  payLabel?: string
}

// Eyebrow mic, all-caps, cu tracking — etichetă de secțiune.
function sectionLabelStyle(color: string): CSSProperties {
  return {
    fontFamily: 'DM Sans, sans-serif',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color,
  }
}

export default function QrCartSheet({
  cart,
  cartTotal,
  notes,
  submitting,
  submitError,
  categories,
  checkoutSuggestionSettings,
  PUB,
  accent,
  accentGradient,
  onClose,
  onNotesChange,
  onUpdateQty,
  onRemove,
  onLineTotal,
  onSubmit,
  onOpenProduct,
  onAddToCart,
  sentOrders,
  tableTotal,
  onPayTable,
  payDisabled = false,
  payLabel = 'Plătește masa',
}: QrCartSheetProps) {
  const hasSent = (sentOrders?.length ?? 0) > 0
  // Index produs → pentru thumbnail-uri în rândurile de coș.
  useBodyScrollLock(true)
  const productById = useMemo(() => {
    const map = new Map<string, Product>()
    for (const c of categories) {
      for (const p of c.products ?? []) map.set(p.id, p)
    }
    return map
  }, [categories])

  // Recomandate alături — produse din categorii neacoperite de coș.
  const suggestions = useMemo<Product[]>(() => {
    if (!(checkoutSuggestionSettings?.enabled ?? false)) return []
    const maxSugg = checkoutSuggestionSettings?.max_suggestions ?? 4
    const cartProductIds = new Set(cart.map((c) => c.product_id))
    const cartCategoryIds = new Set(
      cart.map((item) => productById.get(item.product_id)?.category_id).filter(Boolean),
    )
    const out: Product[] = []
    for (const cat of categories) {
      if (cartCategoryIds.has(cat.id)) continue
      for (const prod of cat.products ?? []) {
        if (out.length >= maxSugg) break
        if (prod.is_sold_out || cartProductIds.has(prod.id)) continue
        out.push(prod)
      }
      if (out.length >= maxSugg) break
    }
    return out
  }, [categories, cart, checkoutSuggestionSettings, productById])

  const suggestionMsg =
    checkoutSuggestionSettings?.message ?? 'Ai vrea ceva în plus înainte să trimiți?'

  function handleAddSuggestion(s: Product): void {
    const hasRequired = (s.modifier_groups ?? []).some((g) => g.is_required)
    if (hasRequired) {
      onClose()
      onOpenProduct(s)
      return
    }
    onAddToCart({
      _key: crypto.randomUUID(),
      product_id: s.id,
      product_name_snapshot: s.name,
      unit_price_snapshot: s.price,
      quantity: 1,
      selected_modifiers: [],
      notes: null,
      upsell_source: 'checkout_suggestion',
    })
  }

  const canSubmit = cart.length > 0 && !submitting

  return (
    <div
      onClick={onClose}
      className="animate-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,18,8,0.45)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet"
        style={{
          background: PUB.bg,
          borderRadius: '22px 22px 0 0',
          width: '100%',
          maxWidth: 480,
          maxHeight: '88vh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '8px 20px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          position: 'relative',
          boxShadow: '0 -10px 40px rgba(26,18,8,0.18)',
        }}
      >
        {/* Drag handle */}
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: PUB.borderStrong,
            margin: '8px auto 0',
            flexShrink: 0,
          }}
        />

        {/* X close — afordanță explicită (cerere UX) */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Închide"
          className="pressable"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: `1px solid ${accent}`,
            background: PUB.bg,
            color: PUB.text,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 3,
            boxShadow: '0 2px 8px rgba(26,18,8,0.18)',
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {/* Header — „Masa ta" */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
          <h2
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 28,
              fontWeight: 600,
              color: PUB.text,
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            Masa ta
          </h2>
          <div
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontStyle: 'italic',
              fontSize: 14,
              color: PUB.text2,
            }}
          >
            Adaugă oricând, plătești când vrei.
          </div>
        </div>

        {/* Secțiune: LA BUCĂTĂRIE (comenzi deja trimise în sesiune) */}
        {hasSent && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={sectionLabelStyle(PUB.text3)}>La bucătărie · {sentOrders?.length}</div>
            {sentOrders?.map((o) => (
              <div
                key={o.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  background: PUB.surface,
                  border: `1px solid ${PUB.border}`,
                  borderRadius: 12,
                  padding: '10px 14px',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span
                    style={{
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      color: PUB.text2,
                    }}
                  >
                    #{o.short_id} ·{' '}
                    {new Date(o.created_at).toLocaleTimeString('ro-RO', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span style={{ fontSize: 12, color: PUB.text3, fontStyle: 'italic' }}>
                    Trimisă la bucătărie
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: 'Fraunces, Georgia, serif',
                    fontWeight: 600,
                    color: PUB.text,
                    flexShrink: 0,
                  }}
                >
                  {o.total.toFixed(2)} lei
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Secțiune: ÎN COȘ · DE TRIMIS */}
        {cart.length > 0 && <div style={sectionLabelStyle(accent)}>În coș · de trimis</div>}

        {cart.length === 0 && (
          <div style={{ fontSize: 13, color: PUB.text3, padding: '8px 0 4px', lineHeight: 1.5 }}>
            {hasSent
              ? 'Coșul e gol. Atinge un produs din meniu ca să mai comanzi.'
              : 'Coșul e gol. Atinge un produs din meniu ca să-l adaugi aici.'}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {cart.map((item) => {
            const prod = productById.get(item.product_id)
            return (
              <div
                key={item._key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  borderBottom: `1px solid ${PUB.border}`,
                  padding: '12px 0',
                }}
              >
                {prod?.image_url ? (
                  <img
                    src={prod.image_url}
                    alt={item.product_name_snapshot}
                    loading="lazy"
                    decoding="async"
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 12,
                      objectFit: 'cover',
                      flexShrink: 0,
                      background: PUB.surface,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 12,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 24,
                      background: accentGradient,
                    }}
                  >
                    🍽️
                  </div>
                )}

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'Fraunces, Georgia, serif',
                      color: PUB.text,
                      fontSize: 16,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.product_name_snapshot}
                  </div>
                  <div style={{ color: PUB.text2, fontSize: 13, fontStyle: 'italic' }}>
                    {onLineTotal(item).toFixed(2)} lei
                  </div>
                </div>

                {/* Stepper pill */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    background: PUB.surface,
                    border: `1px solid ${PUB.border}`,
                    borderRadius: 999,
                    padding: '3px 4px',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onUpdateQty(item._key, -1)}
                    aria-label="Scade cantitatea"
                    className="pressable"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: PUB.text,
                      borderRadius: '50%',
                      width: 30,
                      height: 30,
                      fontSize: 18,
                      cursor: 'pointer',
                    }}
                  >
                    −
                  </button>
                  <span
                    style={{
                      color: PUB.text,
                      minWidth: 20,
                      textAlign: 'center',
                      fontWeight: 600,
                      fontSize: 14,
                    }}
                  >
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateQty(item._key, 1)}
                    aria-label="Crește cantitatea"
                    className="pressable"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: PUB.text,
                      borderRadius: '50%',
                      width: 30,
                      height: 30,
                      fontSize: 18,
                      cursor: 'pointer',
                    }}
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onRemove(item._key)}
                  aria-label={`Elimină ${item.product_name_snapshot}`}
                  className="pressable"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: PUB.text3,
                    fontSize: 18,
                    cursor: 'pointer',
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>

        {/* Notă pentru bucătărie */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={sectionLabelStyle(PUB.text3)}>Notă pentru bucătărie</div>
          <textarea
            placeholder="Fără ceapă, vă rog..."
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={2}
            style={{
              background: PUB.surface,
              border: `1px solid ${PUB.border}`,
              borderRadius: 14,
              color: PUB.text,
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              padding: '12px 14px',
              resize: 'none',
              width: '100%',
            }}
          />
        </div>

        {/* Recomandate alături — carusel orizontal */}
        {suggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Eticheta de secțiune (eyebrow) + mesajul de upsell lizibil:
                mesajul e nudge de conversie → contrast/dimensiune de body,
                nu stilul mic-tracked de etichetă. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={sectionLabelStyle(PUB.text3)}>Recomandate alături</div>
              <div
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 600,
                  color: PUB.text2,
                }}
              >
                {suggestionMsg}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 12,
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                paddingBottom: 4,
                margin: '0 -20px',
                paddingInline: 20,
              }}
            >
              {suggestions.map((s) => (
                <div
                  key={s.id}
                  style={{
                    width: 150,
                    flexShrink: 0,
                    background: PUB.surface,
                    border: `1px solid ${PUB.border}`,
                    borderRadius: 16,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {s.image_url ? (
                    <img
                      src={s.image_url}
                      alt={s.name}
                      loading="lazy"
                      decoding="async"
                      style={{ width: '100%', height: 96, objectFit: 'cover' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: 96,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 30,
                        background: accentGradient,
                      }}
                    >
                      🍽️
                    </div>
                  )}
                  <div
                    style={{
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      flex: 1,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'Fraunces, Georgia, serif',
                        fontSize: 14,
                        fontWeight: 600,
                        color: PUB.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.name}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: 'auto',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'Fraunces, Georgia, serif',
                          fontSize: 14,
                          fontWeight: 600,
                          color: accent,
                        }}
                      >
                        {s.price.toFixed(2)} lei
                      </span>
                      <button
                        type="button"
                        onClick={() => handleAddSuggestion(s)}
                        aria-label={`Adaugă ${s.name}`}
                        className="pressable"
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          background: accent,
                          color: '#fff',
                          border: 'none',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                          lineHeight: 1,
                          paddingBottom: 2,
                          flexShrink: 0,
                        }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Total */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            borderTop: `1px solid ${PUB.border}`,
            paddingTop: 14,
          }}
        >
          <span
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 18,
              fontWeight: 600,
              color: PUB.text,
            }}
          >
            Total
          </span>
          <span
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 26,
              fontWeight: 600,
              color: PUB.text,
            }}
          >
            {cartTotal.toFixed(2)} <span style={{ fontSize: 14, color: PUB.text2 }}>lei</span>
          </span>
        </div>
        <div style={{ fontSize: 11, color: PUB.text3, textAlign: 'right', marginTop: -8 }}>
          Totalul final este confirmat de restaurant.
        </div>

        {submitError != null && (
          <div
            style={{
              background: 'rgba(192,57,43,0.1)',
              border: '1px solid rgba(192,57,43,0.25)',
              borderRadius: 12,
              padding: '12px 14px',
              textAlign: 'center',
            }}
          >
            <div style={{ color: '#c0392b', fontSize: 13, lineHeight: 1.5, marginBottom: 8 }}>
              {submitError}
            </div>
            <button
              type="button"
              onClick={onSubmit}
              className="pressable"
              style={{
                background: 'rgba(192,57,43,0.15)',
                border: '1px solid rgba(192,57,43,0.3)',
                borderRadius: 8,
                color: '#c0392b',
                padding: '6px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Reîncearcă
            </button>
          </div>
        )}

        {/* CTA primar — prețul în buton (stil mockup) */}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className={canSubmit ? 'pressable' : ''}
          style={{
            background: accent,
            color: '#fff',
            border: 'none',
            borderRadius: 16,
            padding: '16px 0',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 16,
            fontWeight: 700,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            opacity: submitting ? 0.7 : 1,
            boxShadow: canSubmit ? '0 6px 18px rgba(26,18,8,0.18)' : 'none',
          }}
        >
          {submitting
            ? 'Se trimite...'
            : `${hasSent ? 'Trimite și restul' : 'Trimite comanda'} · ${cartTotal.toFixed(2)} lei`}
        </button>

        {/* CTA secundar — Plătește masa (cere nota; doar când există comenzi trimise) */}
        {onPayTable && (
          <button
            type="button"
            onClick={onPayTable}
            disabled={payDisabled}
            className={payDisabled ? '' : 'pressable'}
            style={{
              background: 'transparent',
              color: PUB.text,
              border: `1px solid ${PUB.borderStrong}`,
              borderRadius: 16,
              padding: '14px 0',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 15,
              fontWeight: 600,
              cursor: payDisabled ? 'default' : 'pointer',
              opacity: payDisabled ? 0.6 : 1,
            }}
          >
            {payLabel}
            {typeof tableTotal === 'number' ? ` · ${tableTotal.toFixed(2)} lei` : ''}
          </button>
        )}
      </div>
    </div>
  )
}
