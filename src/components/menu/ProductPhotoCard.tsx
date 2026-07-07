import { memo } from 'react'
import type { Product } from '../../lib/qr'
import { hasMandatoryModifierGroups } from '../../lib/qr'
import type { MenuTheme } from '../../lib/themes'
import { readableTextOn } from '../../lib/themes'
import { menuType } from '../../lib/menuType'
import { fmtPrice, currencyLabel, currencyDecimals, type MenuCurrency } from '../../lib/currency'
import { BlurImage } from '../ui/BlurImage'
import { DIETARY_TAGS } from '../../lib/constants'
import ProductMinimalRow from './ProductMinimalRow'

// ─────────────────────────────────────────────────────────────
// ProductPhotoCard — card de produs FOTO-FIRST pentru layout-ul „Foto-first"
// (stil Eker): imagine mare full-width (4:3, blur-up), overlay gradient jos cu
// numele (serif, alb) + prețul PE poză; badge-uri (reducere/tag-uri dietetice/
// „opțiuni") ca pastile glass peste poză. Tap oriunde pe card → EXACT același
// `onOpen` ca ProductGridCard (deschide ProductSheet cu opțiunile).
//
// Produsele FĂRĂ imagine NU primesc un card gol: cad pe un rând compact tip
// listă (delegăm către ProductMinimalRow — aceeași interfață, aceeași logică
// de preț/quick-add), ca meniul mixt poze/fără-poze să rămână scanabil.
//
// Pur prezentațional: primește produsul + callback-uri, fără fetch/RPC/logică
// de business. Se randează într-o coloană full-width (vezi consumatorii).
//
// A11y: zona poză+text e un `<button>` real; quick-add-ul e un `<button>`
// SEPARAT (frate, poziționat absolut peste poză) — fără buton nested. Blocul
// de preț are `aria-label`, fragmentele vizuale sunt `aria-hidden`. Textul de
// pe overlay e alb pe scrim negru (lizibil pe orice poză); textul de pe accent
// (quick-add) e calculat cu `readableTextOn` (alb pică AA pe accente deschise).
// Fără animații proprii — doar `.pressable` (global.css respectă
// prefers-reduced-motion) și blur-up-ul din BlurImage.
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

interface ProductPhotoCardProps {
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
const FS_PRICE = 22

function ProductPhotoCard({
  product,
  onOpen,
  onQuickAdd,
  canAdd,
  happyHourPct = 0,
  accent,
  PUB,
  theme,
  currency = 'RON',
}: ProductPhotoCardProps) {
  // Fără imagine → rând compact tip listă (nu card gol). Aceeași interfață,
  // aceleași callback-uri — nimic de tradus.
  if (!product.image_url) {
    return (
      <ProductMinimalRow
        product={product}
        onOpen={onOpen}
        onQuickAdd={onQuickAdd}
        canAdd={canAdd}
        happyHourPct={happyHourPct}
        accent={accent}
        PUB={PUB}
        theme={theme}
        currency={currency}
      />
    )
  }

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
  // Cifrele prețului din bani întregi (rotunjiți), nu din float brut — identic
  // cu ProductCard/ProductGridCard (19.999... trebuie afișat 20.00, nu 19.00).
  const cents = Math.round(effectivePrice * 100)
  const priceInt = Math.floor(cents / 100)
  const priceFrac = String(cents % 100).padStart(2, '0')

  // Pe overlay-ul întunecat totul e alb (scrim-ul garantează contrastul);
  // reducerea primește verdele deschis din pastila de status a hero-ului
  // (#7BE093 — verzii „success" ai temelor sunt mid-tone și pică pe negru).
  const priceColor = hasDiscount ? '#7BE093' : '#FFFFFF'

  const priceLabel = hasDiscount
    ? `Preț redus ${fmtPrice(effectivePrice, currency)}, de la ${fmtPrice(basePrice, currency)}`
    : `${hasRequiredMods ? 'De la ' : ''}${fmtPrice(effectivePrice, currency)}`

  return (
    <div
      data-testid="product-photo-card"
      style={{
        position: 'relative',
        borderRadius: Math.min(theme.radius, 18),
        overflow: 'hidden',
        background: PUB.surface,
        border: `1px solid ${PUB.border}`,
        opacity: isSoldOut ? 0.6 : 1,
      }}
    >
      {/* Buton real „deschide produs" pe TOT cardul. Quick-add-ul rămâne buton
          SEPARAT (frate, mai jos) — fără buton nested. */}
      <button
        type="button"
        className={isSoldOut ? undefined : 'pressable'}
        disabled={isSoldOut}
        onClick={() => {
          if (!isSoldOut) onOpen(product)
        }}
        aria-label={`Vezi detalii ${product.name}`}
        style={{
          display: 'block',
          position: 'relative',
          width: '100%',
          padding: 0,
          margin: 0,
          border: 'none',
          background: 'none',
          textAlign: 'left',
          cursor: isSoldOut ? 'default' : 'pointer',
        }}
      >
        {/* Poza mare 4:3 (span, nu div: în <button> e permis doar phrasing
            content în HTML valid). */}
        <span style={{ position: 'relative', display: 'block', width: '100%' }}>
          <BlurImage src={product.image_url} alt={product.name} aspectRatio="4 / 3" skeleton />

          {/* Scrim gradient jos — garantează lizibilitatea numelui/prețului alb
              peste ORICE poză (inclusiv poze deschise). */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '62%',
              background:
                'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 42%, rgba(0,0,0,0.78) 100%)',
              pointerEvents: 'none',
            }}
          />

          {/* Nume + preț + badge-uri PE poză, ancorate jos. paddingRight lasă
              loc quick-add-ului circular din colțul din dreapta-jos. */}
          <span
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: canAdd && !isSoldOut ? '12px 68px 14px 14px' : '12px 14px 14px',
            }}
          >
            {/* Badge-uri glass peste poză (max 2 tag-uri + reducere + opțiuni). */}
            {(shownTags.length > 0 || hasDiscount || hasRequiredMods) && (
              <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                {hasDiscount && (
                  <PhotoBadge label={`-${Math.round(pct)}%`} color="#7BE093" fonts={theme.fonts} />
                )}
                {shownTags.map((tagId) => (
                  <PhotoTagBadge key={tagId} tagId={tagId} fonts={theme.fonts} />
                ))}
                {hasRequiredMods && !isSoldOut && (
                  <PhotoBadge label="opțiuni" color="#FFFFFF" fonts={theme.fonts} />
                )}
              </span>
            )}

            <span
              style={{
                ...t.cardTitle,
                fontSize: 19,
                color: '#fff',
                textShadow: '0 1px 2px rgba(0,0,0,0.55), 0 2px 12px rgba(0,0,0,0.4)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {product.name}
            </span>

            {/* Preț pe poză — split întreg/zecimale, ca pe celelalte carduri. */}
            <span
              aria-label={priceLabel}
              style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}
            >
              {hasRequiredMods && (
                <span
                  aria-hidden
                  style={{
                    fontFamily: theme.fonts.heading,
                    fontStyle: 'italic',
                    fontSize: FS_MICRO,
                    color: 'rgba(255,255,255,0.85)',
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
                    color: 'rgba(255,255,255,0.75)',
                    textDecoration: 'line-through',
                    marginRight: 4,
                    lineHeight: 1,
                  }}
                >
                  {basePrice.toFixed(currencyDecimals(currency))}
                </span>
              )}
              <span
                aria-hidden
                style={{
                  ...t.price,
                  fontSize: FS_PRICE,
                  color: priceColor,
                  lineHeight: 1,
                  textShadow: '0 1px 6px rgba(0,0,0,0.5)',
                }}
              >
                {priceInt}
              </span>
              <span
                aria-hidden
                style={{
                  fontFamily: theme.fonts.heading,
                  fontSize: FS_SMALL,
                  fontWeight: 600,
                  color: 'rgba(255,255,255,0.92)',
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
                  color: 'rgba(255,255,255,0.92)',
                  marginLeft: 4,
                  letterSpacing: '0.04em',
                }}
              >
                {currencyLabel(currency)}
              </span>
            </span>
          </span>

          {/* Overlay „Epuizat" — identic ca intenție cu ProductGridCard. */}
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
      </button>

      {/* Quick-add circular 44px — buton SEPARAT (frate al butonului „deschide",
          NU nested), în colțul din dreapta-jos al pozei. */}
      {canAdd && !isSoldOut && (
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
            position: 'absolute',
            right: 12,
            bottom: 12,
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: accent,
            color: readableTextOn(accent, PUB.text),
            border: '2px solid rgba(255,255,255,0.9)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            lineHeight: 1,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            zIndex: 2,
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

export default memo(ProductPhotoCard)

// ── Badge glass generic pe poză (text alb/colorat pe negru translucid) ──
function PhotoBadge({
  label,
  color,
  fonts,
}: {
  label: string
  color: string
  fonts: MenuTheme['fonts']
}) {
  return (
    <span
      style={{
        fontFamily: fonts.body,
        fontSize: 10,
        fontWeight: 700,
        color,
        background: 'rgba(0,0,0,0.45)',
        padding: '3px 8px',
        borderRadius: 100,
        border: '1px solid rgba(255,255,255,0.28)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

// ── Badge dietetic glass (emoji + label din DIETARY_TAGS, alb pe poză) ──
function PhotoTagBadge({ tagId, fonts }: { tagId: string; fonts: MenuTheme['fonts'] }) {
  const tag = DIETARY_TAGS.find((d) => d.id === tagId)
  if (!tag) return null
  return (
    <span
      style={{
        fontFamily: fonts.body,
        fontSize: 10,
        fontWeight: 600,
        color: '#fff',
        background: 'rgba(0,0,0,0.45)',
        padding: '3px 8px',
        borderRadius: 100,
        border: '1px solid rgba(255,255,255,0.28)',
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
