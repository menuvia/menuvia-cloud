import { memo, type CSSProperties } from 'react'
import type { Product } from '../../lib/qr'
import { hasMandatoryModifierGroups } from '../../lib/qr'
import type { MenuTheme } from '../../lib/themes'
import { readableTextOn } from '../../lib/themes'
import { menuType } from '../../lib/menuType'
import { fmtPrice, currencyLabel, currencyDecimals, type MenuCurrency } from '../../lib/currency'
import { BlurImage } from '../ui/BlurImage'
import { DIETARY_TAGS } from '../../lib/constants'

// ─────────────────────────────────────────────────────────────
// ProductGridCard — card de produs FOTO-FORWARD pentru layout-ul „Galerie foto".
// Aceeași interfață și aceeași logică de preț/happy-hour/sold-out ca ProductCard
// (cardul de listă), dar aranjament vertical: poză mare sus (4:3, blur-up) +
// nume/descriere/preț/badge-uri dedesubt. Quick-add-ul circular 44px e suprapus
// în colțul din dreapta-jos al pozei (ca în referințe).
//
// Pur prezentațional: primește produsul + callback-uri, fără fetch/RPC/logică de
// business. Se randează într-un CSS grid de 2 coloane (vezi consumatorii).
//
// A11y: zona poză+text e un `<button>` real; quick-add-ul e un `<button>` SEPARAT
// (frate, poziționat absolut peste poză) — fără buton nested. Blocul de preț are
// `aria-label`, fragmentele vizuale sunt `aria-hidden`. Text pe accent calculat
// cu `readableTextOn` (alb pică AA pe accente deschise).
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

interface ProductGridCardProps {
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
const FS_PRICE = 20

function ProductGridCard({
  product,
  onOpen,
  onQuickAdd,
  canAdd,
  happyHourPct = 0,
  accent,
  PUB,
  theme,
  currency = 'RON',
}: ProductGridCardProps) {
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
  // Cifrele prețului din bani întregi (rotunjiți), nu din float brut: pe un
  // float ca 19.999999999999996, Math.floor ar pierde granița de întreg
  // (afișa 19.00 în loc de 20.00). Identic cu ProductCard.
  const cents = Math.round(effectivePrice * 100)
  const priceInt = Math.floor(cents / 100)
  const priceFrac = String(cents % 100).padStart(2, '0')

  const priceMain = hasDiscount ? theme.colors.success : accent
  const priceUnit = PUB.text
  const metaColor = PUB.text2

  const priceLabel = hasDiscount
    ? `Preț redus ${fmtPrice(effectivePrice, currency)}, de la ${fmtPrice(basePrice, currency)}`
    : `${hasRequiredMods ? 'De la ' : ''}${fmtPrice(effectivePrice, currency)}`

  return (
    <div
      data-testid="product-grid-card"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: Math.min(theme.radius, 16),
        overflow: 'hidden',
        background: PUB.surface,
        border: `1px solid ${PUB.border}`,
        opacity: isSoldOut ? 0.6 : 1,
      }}
    >
      {/* Buton real „deschide produs" pe TOT cardul (poză + nume/descriere/preț)
          — tap oriunde pe card deschide fișa, nu doar pe poză. Quick-add-ul
          rămâne buton SEPARAT (frate, mai jos) — fără buton nested. */}
      <button
        type="button"
        className={isSoldOut ? undefined : 'pressable'}
        disabled={isSoldOut}
        onClick={() => {
          if (!isSoldOut) onOpen(product)
        }}
        aria-label={`Vezi detalii ${product.name}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          padding: 0,
          margin: 0,
          border: 'none',
          background: 'none',
          textAlign: 'left',
          cursor: isSoldOut ? 'default' : 'pointer',
        }}
      >
        {/* Zona poză (4:3) — wrapper relativ pentru overlay-ul „Epuizat".
            span (nu div): în interiorul unui <button> e permis doar phrasing
            content în HTML valid. */}
        <span style={{ position: 'relative', display: 'block', width: '100%' }}>
          <GridThumbnail product={product} theme={theme} PUB={PUB} />
          {isSoldOut && (
            <span
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.35)',
              }}
            >
              <span
                style={{
                  ...t.label,
                  color: '#fff',
                  background: 'rgba(0,0,0,0.55)',
                  padding: '5px 12px',
                  borderRadius: 100,
                }}
              >
                Epuizat
              </span>
            </span>
          )}
        </span>

        {/* Conținut: nume + descriere + preț + badge-uri (în interiorul
            butonului — numele accesibil vine din aria-label; span, nu div,
            din același motiv de phrasing content). */}
        <span
          style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '12px 12px 14px' }}
        >
          <span
            style={{
              ...t.cardTitle,
              color: PUB.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {product.name}
          </span>

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

          {/* Preț */}
          <span
            aria-label={priceLabel}
            style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginTop: 2 }}
          >
            {hasRequiredMods && (
              <span
                aria-hidden
                style={{
                  fontFamily: theme.fonts.heading,
                  fontStyle: 'italic',
                  fontSize: FS_MICRO,
                  color: metaColor,
                  marginRight: 4,
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
                  fontWeight: 600,
                  color: metaColor,
                  textDecoration: 'line-through',
                  marginRight: 4,
                  lineHeight: 1,
                }}
              >
                {basePrice.toFixed(currencyDecimals(currency))}
              </span>
            )}
            <span aria-hidden style={{ ...t.price, fontSize: FS_PRICE, color: priceMain, lineHeight: 1 }}>
              {priceInt}
            </span>
            <span
              aria-hidden
              style={{
                fontFamily: theme.fonts.heading,
                fontSize: FS_SMALL,
                fontWeight: 600,
                color: priceUnit,
                lineHeight: 1,
              }}
            >
              {currencyDecimals(currency) > 0 ? `.${priceFrac}` : ''}
            </span>
            <span
              aria-hidden
              style={{
                fontFamily: theme.fonts.body,
                fontSize: FS_MICRO,
                fontWeight: 500,
                color: priceUnit,
                marginLeft: 4,
                letterSpacing: '0.04em',
              }}
            >
              {currencyLabel(currency)}
            </span>
          </span>

          {/* Badge-uri */}
          {(shownTags.length > 0 || hasDiscount || hasRequiredMods) && (
            <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
              {hasDiscount && (
                <GridBadge label={`-${Math.round(pct)}%`} color={theme.colors.success} fonts={theme.fonts} />
              )}
              {shownTags.map((tagId) => (
                <GridTagBadge key={tagId} tagId={tagId} fonts={theme.fonts} />
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
            </span>
          )}
        </span>
      </button>

      {/* Quick-add circular 44px — buton SEPARAT (frate al butonului „deschide",
          NU nested). Overlay-ul are exact forma pozei (4:3, full-width, ancorat
          sus) și e transparent la tap (pointerEvents: none) — doar butonul din
          interior primește click-uri, în colțul din dreapta-jos al pozei. */}
      {canAdd && !isSoldOut && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            aspectRatio: '4 / 3',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <button
            type="button"
            className="pressable"
            onClick={(e) => {
              // Frate (nu descendent) al butonului „deschide" — stopPropagation
              // e doar defensiv, click-ul nu are unde să bubble spre onOpen.
              e.stopPropagation()
              if (hasRequiredMods) onOpen(product)
              else onQuickAdd(product)
            }}
            aria-label={`Adaugă ${product.name}`}
            style={{
              pointerEvents: 'auto',
              position: 'absolute',
              right: 10,
              bottom: 10,
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: accent,
              color: readableTextOn(accent, PUB.text),
              border: `2px solid ${PUB.surface}`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              lineHeight: 1,
              boxShadow: `0 2px 8px rgba(0,0,0,0.25)`,
            }}
          >
            <span aria-hidden style={{ display: 'block', transform: 'translateY(-1px)' }}>
              +
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

export default memo(ProductGridCard)

// ── Thumbnail 4:3 (poză sau monogramă pe gradient) ──────────────────────
function GridThumbnail({
  product,
  theme,
  PUB,
}: {
  product: Product
  theme: MenuTheme
  PUB: PublicColors
}) {
  const base: CSSProperties = {
    width: '100%',
    aspectRatio: '4 / 3',
    background: PUB.surface,
    overflow: 'hidden',
  }

  if (product.image_url) {
    return (
      <div style={base}>
        <BlurImage src={product.image_url} alt={product.name} aspectRatio="4 / 3" skeleton />
      </div>
    )
  }

  const initial = (product.name.trim().charAt(0) || '•').toUpperCase()
  return (
    <div
      aria-hidden
      style={{
        ...base,
        background: theme.colors.accentGradient,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span
        style={{
          fontFamily: theme.fonts.heading,
          fontSize: 52,
          fontWeight: 600,
          color: PUB.text,
          opacity: 0.4,
          lineHeight: 1,
        }}
      >
        {initial}
      </span>
    </div>
  )
}

// ── Badge generic pill ──────────────────────────────────────────────────
function GridBadge({ label, color, fonts }: { label: string; color: string; fonts: MenuTheme['fonts'] }) {
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

// ── Badge dietetic (emoji + label din DIETARY_TAGS) ─────────────────────
function GridTagBadge({ tagId, fonts }: { tagId: string; fonts: MenuTheme['fonts'] }) {
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
