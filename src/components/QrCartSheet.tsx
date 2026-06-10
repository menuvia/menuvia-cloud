// QrCartSheet — coșul de cumpărături la masă (QR flow).
// Extras din QrMenuPage pentru code-splitting.
// Lazy-loaded: apare doar când clientul deschide coșul.
import type { CartItem } from '../lib/orders'
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
}: QrCartSheetProps) {
  return (
    <div
      onClick={onClose}
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
        style={{
          background: PUB.bg,
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: '8px 20px 32px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: PUB.borderStrong,
            margin: '8px auto 4px',
          }}
        />

        <div
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 20,
            fontWeight: 700,
            color: PUB.text,
          }}
        >
          Coșul tău
        </div>

        {cart.map((item) => (
          <div
            key={item._key}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              borderBottom: '1px solid #E8DFD0',
              paddingBottom: 12,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ color: PUB.text, fontSize: 14, fontWeight: 600 }}>
                {item.product_name_snapshot}
              </div>
              <div style={{ color: accent, fontSize: 13 }}>{onLineTotal(item).toFixed(2)} lei</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => onUpdateQty(item._key, -1)}
                style={{
                  background: '#EDE7D9',
                  border: 'none',
                  color: PUB.text,
                  borderRadius: '50%',
                  width: 28,
                  height: 28,
                  cursor: 'pointer',
                }}
              >
                −
              </button>
              <span style={{ color: PUB.text, minWidth: 16, textAlign: 'center' }}>
                {item.quantity}
              </span>
              <button
                onClick={() => onUpdateQty(item._key, 1)}
                style={{
                  background: '#EDE7D9',
                  border: 'none',
                  color: PUB.text,
                  borderRadius: '50%',
                  width: 28,
                  height: 28,
                  cursor: 'pointer',
                }}
              >
                +
              </button>
              <button
                onClick={() => onRemove(item._key)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#c0392b',
                  fontSize: 16,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}

        <textarea
          placeholder="Mențiuni pentru bucătărie (opțional)"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={2}
          style={{
            background: '#EDE7D9',
            border: '1px solid #D4C8B8',
            borderRadius: 8,
            color: PUB.text,
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 14,
            padding: '10px 12px',
            resize: 'none',
          }}
        />

        {/* Checkout suggestions */}
        {(checkoutSuggestionSettings?.enabled ?? false) &&
          (() => {
            const maxSugg = checkoutSuggestionSettings?.max_suggestions ?? 2
            const customMsg =
              checkoutSuggestionSettings?.message ??
              '🍰 Înainte să trimiți... ai vrea ceva în plus?'
            const cartCategoryIds = new Set(
              cart
                .map((item) => {
                  const allProds = categories.flatMap((c) => c.products)
                  return allProds.find((p) => p.id === item.product_id)?.category_id
                })
                .filter(Boolean),
            )
            const cartProductIds = new Set(cart.map((c) => c.product_id))
            const suggestions: Product[] = []
            for (const cat of categories) {
              if (cartCategoryIds.has(cat.id)) continue
              for (const prod of cat.products) {
                if (suggestions.length >= maxSugg) break
                if (prod.is_sold_out || cartProductIds.has(prod.id)) continue
                suggestions.push(prod)
              }
              if (suggestions.length >= maxSugg) break
            }
            if (suggestions.length === 0) return null

            return (
              <div
                style={{
                  background: '#FDF8F2',
                  border: `1px solid ${PUB.border}`,
                  borderRadius: 12,
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    fontFamily: 'DM Sans, sans-serif',
                    fontSize: 13,
                    fontWeight: 600,
                    color: PUB.text,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span>{customMsg}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {suggestions.map((s) => (
                    <div
                      key={s.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        background: '#fff',
                        border: `1px solid ${PUB.border}`,
                        borderRadius: 10,
                      }}
                    >
                      {s.image_url ? (
                        <img
                          src={s.image_url}
                          alt={s.name}
                          loading="lazy"
                          decoding="async"
                          style={{
                            width: 40,
                            height: 40,
                            objectFit: 'cover',
                            borderRadius: 8,
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 8,
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 22,
                            background: accentGradient,
                          }}
                        >
                          🍽️
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: 'DM Sans, sans-serif',
                            fontSize: 13,
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
                            fontSize: 12,
                            color: accent,
                            fontWeight: 600,
                            fontFamily: 'Fraunces, Georgia, serif',
                          }}
                        >
                          {s.price.toFixed(2)} lei
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const hasRequired = (s.modifier_groups ?? []).some((g) => g.is_required)
                          if (hasRequired) {
                            onClose()
                            onOpenProduct(s)
                          } else {
                            const newItem: CartItem = {
                              _key: crypto.randomUUID(),
                              product_id: s.id,
                              product_name_snapshot: s.name,
                              unit_price_snapshot: s.price,
                              quantity: 1,
                              selected_modifiers: [],
                              notes: null,
                              upsell_source: 'checkout_suggestion',
                            }
                            onAddToCart(newItem)
                          }
                        }}
                        aria-label={`Adaugă ${s.name}`}
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
                  ))}
                </div>
              </div>
            )
          })()}

        <div
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 20,
            fontWeight: 700,
            color: PUB.text,
          }}
        >
          Total: {cartTotal.toFixed(2)} lei
        </div>

        {submitError != null && (
          <div
            style={{
              background: 'rgba(192,57,43,0.1)',
              border: '1px solid rgba(192,57,43,0.25)',
              borderRadius: 10,
              padding: '12px 14px',
              textAlign: 'center',
            }}
          >
            <div style={{ color: '#c0392b', fontSize: 13, lineHeight: 1.5, marginBottom: 8 }}>
              {submitError}
            </div>
            <button
              onClick={onSubmit}
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

        <button
          disabled={cart.length === 0 || submitting}
          onClick={onSubmit}
          style={{
            background: accent,
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            padding: '14px 0',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 15,
            fontWeight: 700,
            cursor: cart.length > 0 && !submitting ? 'pointer' : 'not-allowed',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? 'Se trimite...' : 'Trimite comanda'}
        </button>
      </div>
    </div>
  )
}
