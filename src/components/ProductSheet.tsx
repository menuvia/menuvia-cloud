// ─────────────────────────────────────────────────────────────
// ProductSheet — Product detail modal (redesigned for telefon-first)
//
// Design principles:
//   • Spațiu generos, nu îngustat
//   • Decizia ușoară (modifiers vizibili, butonul mare)
//   • Detalii (alergeni, dietetic) colapsabile — secundar
//   • Sticky bottom CTA cu prețul actualizat live
// ─────────────────────────────────────────────────────────────
import { useState } from 'react'
import type { Product } from '../lib/qr'
import type { CartItem, SelectedModifier } from '../lib/orders'
import { ALLERGENS, DIETARY_TAGS } from '../lib/constants'
import type { MenuTheme } from '../lib/themes'

type Selections = Record<string, string | Set<string> | null>

function isSet(val: string | Set<string> | null): val is Set<string> {
  return val instanceof Set
}

interface ProductSheetProps {
  product: Product
  accent: string
  theme: MenuTheme
  onAdd: (item: CartItem) => void
  onClose: () => void
}

function ProductSheet({ product, accent, theme, onAdd, onClose }: ProductSheetProps) {
  const PUB = {
    bg: theme.colors.bg,
    surface: theme.colors.surface,
    text: theme.colors.text,
    text2: theme.colors.text2,
    textMuted: theme.colors.text3,
    border: theme.colors.border,
    borderStrong: theme.colors.borderStrong,
  }
  const accentGradient = theme.colors.accentGradient
  const [selections, setSelections] = useState<Selections>({})
  const [qty, setQty] = useState(1)
  const [notes, setNotes] = useState('')
  const [selectedExtras, setSelectedExtras] = useState<Set<string>>(new Set())
  const [moreInfoOpen, setMoreInfoOpen] = useState(false)

  const groups = product.modifier_groups

  const canAdd = groups
    .filter((g) => g.is_required)
    .every((g) => {
      const sel = selections[g.id]
      if (sel == null) return false
      if (isSet(sel)) return sel.size > 0
      return sel.length > 0
    })

  function modDelta(): number {
    return groups.reduce((sum, g) => {
      const sel = selections[g.id]
      if (sel == null) return sum
      if (g.selection_type === 'single' && !isSet(sel)) {
        const opt = g.modifier_options.find((o) => o.id === sel)
        return sum + (opt?.price_delta ?? 0)
      }
      if (isSet(sel)) {
        return (
          sum +
          g.modifier_options.filter((o) => sel.has(o.id)).reduce((s, o) => s + o.price_delta, 0)
        )
      }
      return sum
    }, 0)
  }

  function buildModifiers(): SelectedModifier[] {
    return groups.flatMap((g): SelectedModifier[] => {
      const sel = selections[g.id]
      if (sel == null) return []
      if (g.selection_type === 'single' && !isSet(sel)) {
        const opt = g.modifier_options.find((o) => o.id === sel)
        if (opt == null) return []
        return [
          {
            group_id: g.id,
            group_name: g.name,
            option_id: opt.id,
            option_name: opt.name,
            price_delta: opt.price_delta,
          },
        ]
      }
      if (isSet(sel)) {
        return g.modifier_options
          .filter((o) => sel.has(o.id))
          .map(
            (o): SelectedModifier => ({
              group_id: g.id,
              group_name: g.name,
              option_id: o.id,
              option_name: o.name,
              price_delta: o.price_delta,
            }),
          )
      }
      return []
    })
  }

  function toggleSingle(gid: string, oid: string): void {
    setSelections((prev) => ({ ...prev, [gid]: oid }))
  }

  function toggleMultiple(gid: string, oid: string): void {
    setSelections((prev) => {
      const existing = prev[gid]
      const s = isSet(existing) ? new Set(existing) : new Set<string>()
      s.has(oid) ? s.delete(oid) : s.add(oid)
      return { ...prev, [gid]: s }
    })
  }

  function extrasDelta(): number {
    return (product.extras ?? [])
      .filter((e) => selectedExtras.has(e.id))
      .reduce((s, e) => s + Number(e.price), 0)
  }

  function toggleExtra(id: string): void {
    setSelectedExtras((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const unitTotal = product.price + modDelta() + extrasDelta()
  const totalPrice = unitTotal * qty

  // Top compact badges (priority: special > diet > prep time > portion > allergens)
  const topBadges: { emoji: string; label: string; color: string }[] = []
  if (product.is_daily_special)
    topBadges.push({ emoji: '⭐', label: 'Specialitate', color: accent })
  if (product.dietary_tags?.includes('vegan'))
    topBadges.push({ emoji: '🌱', label: 'Vegan', color: '#388E3C' })
  else if (product.dietary_tags?.includes('vegetarian'))
    topBadges.push({ emoji: '🥗', label: 'Vegetarian', color: '#4CAF6E' })
  // Prep time: doar dacă e setat
  if (product.prep_time_minutes && product.prep_time_minutes > 0) {
    topBadges.push({ emoji: '⏱️', label: `~${product.prep_time_minutes} min`, color: '#5A8DBA' })
  }
  // Porție: text liber dacă e setat
  if (product.portion_size && product.portion_size.length > 0) {
    topBadges.push({ emoji: '📏', label: product.portion_size, color: '#7A6A52' })
  }
  if (product.allergens && product.allergens.length > 0) {
    topBadges.push({ emoji: '⚠️', label: 'Alergeni', color: '#8B6914' })
  }

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
        zIndex: 200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: PUB.bg,
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
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
            margin: '10px auto 0',
            flexShrink: 0,
          }}
        />

        {/* Buton de închidere — X clar (cerere UX: înapoi la meniu).
            Backdrop-ul + drag handle rămân; ăsta e afordanța vizibilă. */}
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

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {/* Hero image / emoji fallback — 16:9 */}
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              loading="lazy"
              decoding="async"
              style={{
                width: '100%',
                aspectRatio: '16/9',
                objectFit: 'cover',
                marginTop: 12,
                background: PUB.surface,
              }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                aspectRatio: '16/9',
                marginTop: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 80,
                background: accentGradient,
              }}
            >
              🍽️
            </div>
          )}

          <div
            style={{ padding: '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}
          >
            {/* Identity block: name + price */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2
                style={{
                  margin: 0,
                  fontFamily: 'Fraunces, Georgia, serif',
                  fontSize: 24,
                  fontWeight: 600,
                  color: PUB.text,
                  lineHeight: 1.2,
                  letterSpacing: '-0.015em',
                }}
              >
                {product.name}
              </h2>

              <div
                style={{
                  fontFamily: 'Fraunces, Georgia, serif',
                  fontSize: 22,
                  fontWeight: 700,
                  color: accent,
                  letterSpacing: '-0.01em',
                }}
              >
                {product.price.toFixed(2)}{' '}
                <span style={{ fontSize: 15, fontFamily: 'DM Sans, sans-serif', fontWeight: 600 }}>
                  lei
                </span>
              </div>
            </div>

            {/* Description */}
            {product.description && product.description.length > 0 && (
              <p
                style={{
                  margin: 0,
                  fontSize: 15,
                  color: PUB.text2,
                  lineHeight: 1.55,
                  fontFamily: 'DM Sans, sans-serif',
                }}
              >
                {product.description}
              </p>
            )}

            {/* Quick info card — chips for at-a-glance info */}
            {topBadges.length > 0 && (
              <div
                style={{
                  background: PUB.surface,
                  border: `1px solid ${PUB.border}`,
                  borderRadius: 12,
                  padding: '11px 14px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                {topBadges.map((b) => (
                  <span
                    key={b.label}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: b.color,
                      fontFamily: 'DM Sans, sans-serif',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span>{b.emoji}</span>
                    <span>{b.label}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Modifier groups — clear required/optional labeling */}
            {groups.map((g) => {
              const sel = selections[g.id]
              const hasSelection =
                g.selection_type === 'single'
                  ? sel != null && !isSet(sel)
                  : isSet(sel) && sel.size > 0

              return (
                <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: PUB.text,
                        fontFamily: 'DM Sans, sans-serif',
                        letterSpacing: '0.01em',
                      }}
                    >
                      {g.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: g.is_required
                          ? hasSelection
                            ? '#4CAF6E'
                            : '#c0392b'
                          : PUB.textMuted,
                        fontFamily: 'DM Sans, sans-serif',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {g.is_required ? (hasSelection ? '✓ ales' : 'Obligatoriu') : 'Opțional'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {g.modifier_options.map((opt) => {
                      const isSel =
                        g.selection_type === 'single'
                          ? !isSet(sel) && sel === opt.id
                          : isSet(sel) && sel.has(opt.id)

                      return (
                        <button
                          key={opt.id}
                          onClick={() =>
                            g.selection_type === 'single'
                              ? toggleSingle(g.id, opt.id)
                              : toggleMultiple(g.id, opt.id)
                          }
                          style={{
                            background: isSel ? `${accent}14` : PUB.surface,
                            border: `1.5px solid ${isSel ? accent : PUB.border}`,
                            borderRadius: 10,
                            padding: '13px 16px',
                            color: PUB.text,
                            fontFamily: 'DM Sans, sans-serif',
                            fontSize: 14,
                            fontWeight: isSel ? 600 : 500,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            textAlign: 'left',
                            minHeight: 44,
                            transition: 'border-color 0.15s, background 0.15s',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              flex: 1,
                              minWidth: 0,
                            }}
                          >
                            {/* Visual indicator — radio or checkbox style */}
                            <span
                              style={{
                                width: 18,
                                height: 18,
                                flexShrink: 0,
                                borderRadius: g.selection_type === 'single' ? '50%' : 4,
                                border: `2px solid ${isSel ? accent : PUB.borderStrong}`,
                                background: isSel ? accent : 'transparent',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s',
                              }}
                            >
                              {isSel &&
                                (g.selection_type === 'single' ? (
                                  <span
                                    style={{
                                      width: 6,
                                      height: 6,
                                      borderRadius: '50%',
                                      background: '#fff',
                                    }}
                                  />
                                ) : (
                                  <span
                                    style={{
                                      color: '#fff',
                                      fontSize: 11,
                                      fontWeight: 700,
                                      lineHeight: 1,
                                    }}
                                  >
                                    ✓
                                  </span>
                                ))}
                            </span>
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {opt.name}
                            </span>
                          </div>
                          {opt.price_delta > 0 && (
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: accent,
                                fontFamily: 'Fraunces, Georgia, serif',
                                flexShrink: 0,
                              }}
                            >
                              +{opt.price_delta.toFixed(2)} lei
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {/* Extras (add-ons opționale plătite) */}
            {(product.extras ?? []).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: PUB.text,
                      fontFamily: 'DM Sans, sans-serif',
                      letterSpacing: '0.01em',
                    }}
                  >
                    Adaugă extra
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: PUB.textMuted,
                      fontFamily: 'DM Sans, sans-serif',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Opțional
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {product.extras.map((extra) => {
                    const isSel = selectedExtras.has(extra.id)
                    return (
                      <button
                        key={extra.id}
                        onClick={() => toggleExtra(extra.id)}
                        style={{
                          background: isSel ? `${accent}14` : PUB.surface,
                          border: `1.5px solid ${isSel ? accent : PUB.border}`,
                          borderRadius: 10,
                          padding: '13px 16px',
                          color: PUB.text,
                          fontFamily: 'DM Sans, sans-serif',
                          fontSize: 14,
                          fontWeight: isSel ? 600 : 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          textAlign: 'left',
                          minHeight: 44,
                          transition: 'border-color 0.15s, background 0.15s',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <span
                            style={{
                              width: 18,
                              height: 18,
                              flexShrink: 0,
                              borderRadius: 4,
                              border: `2px solid ${isSel ? accent : PUB.borderStrong}`,
                              background: isSel ? accent : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.15s',
                            }}
                          >
                            {isSel && (
                              <span
                                style={{
                                  color: '#fff',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  lineHeight: 1,
                                }}
                              >
                                ✓
                              </span>
                            )}
                          </span>
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {extra.emoji && <span style={{ marginRight: 6 }}>{extra.emoji}</span>}
                            {extra.name}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: accent,
                            fontFamily: 'Fraunces, Georgia, serif',
                            flexShrink: 0,
                          }}
                        >
                          +{Number(extra.price).toFixed(2)} lei
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Quantity stepper */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                background: PUB.surface,
                border: `1px solid ${PUB.border}`,
                borderRadius: 12,
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: PUB.text,
                  fontFamily: 'DM Sans, sans-serif',
                }}
              >
                Cantitate
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <button
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={qty === 1}
                  aria-label="Scade cantitatea"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: qty === 1 ? PUB.border : '#fff',
                    border: `1.5px solid ${qty === 1 ? PUB.border : PUB.borderStrong}`,
                    color: qty === 1 ? PUB.textMuted : PUB.text,
                    fontSize: 18,
                    lineHeight: 1,
                    paddingBottom: 2,
                    cursor: qty === 1 ? 'not-allowed' : 'pointer',
                    fontFamily: 'DM Sans, sans-serif',
                  }}
                >
                  −
                </button>
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: PUB.text,
                    fontFamily: 'Fraunces, Georgia, serif',
                    minWidth: 24,
                    textAlign: 'center',
                  }}
                >
                  {qty}
                </span>
                <button
                  onClick={() => setQty((q) => q + 1)}
                  aria-label="Crește cantitatea"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: '#fff',
                    border: `1.5px solid ${PUB.borderStrong}`,
                    color: PUB.text,
                    fontSize: 20,
                    lineHeight: 1,
                    paddingBottom: 2,
                    cursor: 'pointer',
                    fontFamily: 'DM Sans, sans-serif',
                  }}
                >
                  +
                </button>
              </div>
            </div>

            {/* Optional notes */}
            <textarea
              placeholder="Mențiuni speciale (opțional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{
                background: PUB.surface,
                border: `1px solid ${PUB.border}`,
                borderRadius: 10,
                color: PUB.text,
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 14,
                lineHeight: 1.45,
                padding: '12px 14px',
                resize: 'none',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />

            {/* "Mai multe info" — collapsible details */}
            {(product.allergens?.length > 0 || product.dietary_tags?.length > 0) && (
              <div
                style={{
                  border: `1px solid ${PUB.border}`,
                  borderRadius: 12,
                  background: PUB.surface,
                  overflow: 'hidden',
                }}
              >
                <button
                  onClick={() => setMoreInfoOpen((v) => !v)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    padding: '13px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    fontFamily: 'DM Sans, sans-serif',
                    fontSize: 14,
                    fontWeight: 600,
                    color: PUB.text,
                  }}
                >
                  <span>Mai multe info</span>
                  <span
                    style={{
                      fontSize: 16,
                      color: PUB.textMuted,
                      transform: moreInfoOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s',
                    }}
                  >
                    ▾
                  </span>
                </button>

                {moreInfoOpen && (
                  <div
                    style={{
                      padding: '0 16px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 14,
                    }}
                  >
                    {/* Dietary tags expanded */}
                    {product.dietary_tags && product.dietary_tags.length > 0 && (
                      <div>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: PUB.textMuted,
                            textTransform: 'uppercase',
                            letterSpacing: '0.07em',
                            marginBottom: 8,
                          }}
                        >
                          Etichete dietetice
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {product.dietary_tags.map((id) => {
                            const tag = DIETARY_TAGS.find((t) => t.id === id)
                            if (!tag) return null
                            return (
                              <span
                                key={id}
                                style={{
                                  fontSize: 12,
                                  fontWeight: 600,
                                  padding: '5px 11px',
                                  borderRadius: 100,
                                  background: tag.color + '22',
                                  color: tag.color,
                                  border: `1px solid ${tag.color}44`,
                                  fontFamily: 'DM Sans, sans-serif',
                                }}
                              >
                                {tag.emoji} {tag.label}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Allergens expanded */}
                    {product.allergens && product.allergens.length > 0 && (
                      <div>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#8B6914',
                            textTransform: 'uppercase',
                            letterSpacing: '0.07em',
                            marginBottom: 8,
                          }}
                        >
                          ⚠️ Alergeni
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {product.allergens.map((id) => {
                            const a = ALLERGENS.find((x) => x.id === id)
                            if (!a) return null
                            return (
                              <span
                                key={id}
                                title={a.desc}
                                style={{
                                  fontSize: 12,
                                  fontWeight: 500,
                                  padding: '4px 10px',
                                  borderRadius: 8,
                                  background: 'rgba(139,105,20,0.12)',
                                  color: '#6B4E10',
                                  border: '1px solid rgba(139,105,20,0.2)',
                                  fontFamily: 'DM Sans, sans-serif',
                                }}
                              >
                                {a.emoji} {a.label}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sticky bottom CTA */}
        <div
          style={{
            padding: '14px 22px 22px',
            background: PUB.bg,
            borderTop: `1px solid ${PUB.border}`,
            flexShrink: 0,
          }}
        >
          <button
            disabled={!canAdd}
            onClick={() => {
              const extrasForCart = (product.extras ?? [])
                .filter((e) => selectedExtras.has(e.id))
                .map((e) => ({ id: e.id, name: e.name, price: Number(e.price) }))
              onAdd({
                _key: crypto.randomUUID(),
                product_id: product.id,
                product_name_snapshot: product.name,
                unit_price_snapshot: product.price,
                quantity: qty,
                selected_modifiers: buildModifiers(),
                notes: notes.length > 0 ? notes : null,
                selected_extras: extrasForCart.length > 0 ? extrasForCart : undefined,
              })
              onClose()
            }}
            style={{
              background: canAdd ? accent : PUB.borderStrong,
              color: canAdd ? '#fff' : '#8C7A60',
              border: 'none',
              borderRadius: 14,
              padding: '15px 20px',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '0.01em',
              cursor: canAdd ? 'pointer' : 'not-allowed',
              width: '100%',
              minHeight: 52,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              transition: 'background 0.15s',
              boxShadow: canAdd ? '0 4px 14px rgba(200,150,60,0.35)' : 'none',
            }}
          >
            <span>{canAdd ? 'Adaugă în coș' : 'Selectează opțiunile obligatorii'}</span>
            {canAdd && <span style={{ fontFamily: 'Fraunces, Georgia, serif' }}>·</span>}
            {canAdd && (
              <span style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
                {totalPrice.toFixed(2)} lei
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProductSheet
