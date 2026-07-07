import { memo } from 'react'
import type { Product } from '../../lib/qr'
import { hasMandatoryModifierGroups } from '../../lib/qr'
import type { MenuTheme } from '../../lib/themes'
import { readableTextOn } from '../../lib/themes'
import { menuType } from '../../lib/menuType'
import { fmtPrice, currencyLabel, currencyDecimals, type MenuCurrency } from '../../lib/currency'
import { DIETARY_TAGS } from '../../lib/constants'

// ─────────────────────────────────────────────────────────────
// ProductMinimalRow — rând de produs MINIMAL/EDITORIAL (stil eker.ro): fără
// poză, text-forward, mult aer. Nume + preț pe un rând, descriere italic
// discretă dedesubt, badge-uri mici. Ideal pentru meniuri fără poze
// profesionale sau care vor un aer clasic/rapid.
//
// Aceeași interfață și aceeași logică de preț/happy-hour/sold-out ca celelalte
// carduri. Pur prezentațional. A11y: zona nume+descriere e un `<button>` real;
// quick-add-ul (când `canAdd`) e un `<button>` SEPARAT, frate (fără nested).
// Text pe accent prin `readableTextOn` (AA pe accente deschise).
// ─────────────────────────────────────────────────────────────

interface PublicColors {
  bg: string
  surface: string
  text: string
  text2: string
  text3: string
  border: string
  borderStrong: string
}

interface ProductMinimalRowProps {
  product: Product
  onOpen: (p: Product) => void
  onQuickAdd: (p: Product) => void
  canAdd: boolean
  happyHourPct?: number
  accent: string
  PUB: PublicColors
  theme: MenuTheme
  /** Moneda meniului (mig 205/206) — default 'RON' păstrează afișarea istorică. */
  currency?: MenuCurrency
}

const FS_MICRO = 11
const FS_SMALL = 13
const FS_PRICE = 18

function ProductMinimalRow({
  product,
  onOpen,
  onQuickAdd,
  canAdd,
  happyHourPct = 0,
  accent,
  PUB,
  theme,
  currency = 'RON',
}: ProductMinimalRowProps) {
  const t = menuType(theme.fonts)

  const isSoldOut = product.is_sold_out
  // Minim efectiv > 0 (is_required SAU min_select > 0) → quick-add interzis,
  // produsul se deschide în sheet (serverul respinge sub minim, mig 191).
  const hasRequiredMods = hasMandatoryModifierGroups(product.modifier_groups)

  const allTags = product.dietary_tags ?? []
  const shownTags = allTags.slice(0, 2)

  const pct = Number.isFinite(happyHourPct) ? Math.min(100, Math.max(0, happyHourPct)) : 0
  const basePrice = Number.isFinite(product.price) && product.price > 0 ? product.price : 0
  const hasDiscount = pct > 0 && !isSoldOut
  const effectivePrice = hasDiscount ? basePrice * (1 - pct / 100) : basePrice

  const priceMain = hasDiscount ? theme.colors.success : PUB.text
  const metaColor = PUB.text2

  const priceLabel = hasDiscount
    ? `Preț redus ${fmtPrice(effectivePrice, currency)}, de la ${fmtPrice(basePrice, currency)}`
    : `${hasRequiredMods ? 'De la ' : ''}${fmtPrice(effectivePrice, currency)}`

  return (
    <div
      data-testid="product-minimal-row"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        padding: '18px 0',
        borderBottom: `1px solid ${PUB.border}`,
        opacity: isSoldOut ? 0.55 : 1,
      }}
    >
      {/* Zona text = buton „deschide produs". */}
      <button
        type="button"
        className={isSoldOut ? undefined : 'pressable'}
        disabled={isSoldOut}
        onClick={() => {
          if (!isSoldOut) onOpen(product)
        }}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          textAlign: 'left',
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          font: 'inherit',
          color: 'inherit',
          cursor: isSoldOut ? 'default' : 'pointer',
        }}
      >
        {/* Nume + preț pe un rând (preț aliniat dreapta) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <span
            style={{
              ...t.cardTitle,
              color: PUB.text,
              // Stil editorial: literă puțin spațiată, mai aerat decât cardul de listă.
              letterSpacing: '0.01em',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {product.name}
          </span>
          <span
            aria-label={priceLabel}
            style={{ display: 'flex', alignItems: 'baseline', gap: 4, flexShrink: 0 }}
          >
            {hasRequiredMods && (
              <span
                aria-hidden
                style={{
                  fontFamily: theme.fonts.heading,
                  fontStyle: 'italic',
                  fontSize: FS_MICRO,
                  color: metaColor,
                }}
              >
                de la
              </span>
            )}
            {hasDiscount && (
              <span
                aria-hidden
                style={{
                  fontFamily: theme.fonts.heading,
                  fontSize: FS_SMALL,
                  color: metaColor,
                  textDecoration: 'line-through',
                }}
              >
                {basePrice.toFixed(currencyDecimals(currency))}
              </span>
            )}
            <span
              aria-hidden
              style={{ ...t.price, fontSize: FS_PRICE, color: priceMain, letterSpacing: '0.01em' }}
            >
              {effectivePrice.toFixed(currencyDecimals(currency))}
            </span>
            <span
              aria-hidden
              style={{
                fontFamily: theme.fonts.body,
                fontSize: FS_MICRO,
                fontWeight: 500,
                color: PUB.text,
                letterSpacing: '0.06em',
              }}
            >
              {currencyLabel(currency)}
            </span>
          </span>
        </div>

        {/* Descriere */}
        {product.description && (
          <span
            style={{
              ...t.cardDesc,
              display: '-webkit-box',
              color: PUB.text2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {product.description}
          </span>
        )}

        {/* Badge-uri */}
        {(shownTags.length > 0 || hasDiscount || hasRequiredMods || isSoldOut) && (
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
            {hasDiscount && (
              <MinBadge label={`-${Math.round(pct)}%`} color={theme.colors.success} fonts={theme.fonts} />
            )}
            {shownTags.map((tagId) => (
              <MinTagBadge key={tagId} tagId={tagId} fonts={theme.fonts} />
            ))}
            {hasRequiredMods && !isSoldOut && (
              <span
                style={{
                  fontFamily: theme.fonts.body,
                  fontSize: FS_MICRO,
                  fontWeight: 500,
                  color: metaColor,
                  letterSpacing: '0.02em',
                }}
              >
                opțiuni
              </span>
            )}
            {isSoldOut && (
              <MinBadge label="Epuizat" color={theme.colors.error} fonts={theme.fonts} />
            )}
          </span>
        )}
      </button>

      {/* Quick-add — buton SEPARAT (frate), outline discret ca să rămână minimal. */}
      {canAdd && !isSoldOut && (
        <button
          type="button"
          className="pressable"
          onClick={() => {
            if (hasRequiredMods) onOpen(product)
            else onQuickAdd(product)
          }}
          aria-label={`Adaugă ${product.name}`}
          style={{
            alignSelf: 'center',
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: accent,
            color: readableTextOn(accent, PUB.text),
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            lineHeight: 1,
          }}
        >
          <span aria-hidden style={{ display: 'block', transform: 'translateY(-1px)' }}>
            +
          </span>
        </button>
      )}
    </div>
  )
}

export default memo(ProductMinimalRow)

function MinBadge({ label, color, fonts }: { label: string; color: string; fonts: MenuTheme['fonts'] }) {
  return (
    <span
      style={{
        fontFamily: fonts.body,
        fontSize: 10,
        fontWeight: 700,
        color,
        padding: '3px 8px',
        borderRadius: 100,
        border: `1px solid ${color}55`,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

function MinTagBadge({ tagId, fonts }: { tagId: string; fonts: MenuTheme['fonts'] }) {
  const tag = DIETARY_TAGS.find((d) => d.id === tagId)
  if (!tag) return null
  return (
    <span
      style={{
        fontFamily: fonts.body,
        fontSize: 10,
        fontWeight: 600,
        color: tag.color,
        padding: '3px 8px',
        borderRadius: 100,
        border: `1px solid ${tag.color}55`,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden style={{ fontSize: 10 }}>
        {tag.emoji}
      </span>
      {tag.label}
    </span>
  )
}
