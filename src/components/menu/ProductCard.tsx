import type { CSSProperties } from 'react'
import type { Product } from '../../lib/qr'
import type { MenuTheme } from '../../lib/themes'
import { menuType } from '../../lib/menuType'
import { BlurImage } from '../ui/BlurImage'
import { DIETARY_TAGS } from '../../lib/constants'

// ─────────────────────────────────────────────────────────────
// ProductCard — card de produs editorial UNIFICAT, folosit identic pe
// meniul public și pe meniul QR. Pur prezentațional: primește produsul +
// callback-uri prin props, fără fetch/RPC/logică de business. Happy-hour-ul
// nu se calculează aici — afișăm doar pe baza `happyHourPct` primit.
//
// Layout: thumbnail pătrat (BlurImage 1/1, fallback monogramă pe gradient) +
// conținut (nume serif 1 rând, descriere italic 2 rânduri, badge-uri
// dietetice max 2 + „+N", hint „opțiuni" la modificatori obligatorii) +
// preț (split integer/zecimale; happy-hour: preț tăiat + preț verde + „-N%")
// + quick-add circular 44px afișat când `canAdd`. Sold-out → opacitate +
// badge „Epuizat", fără quick-add.
//
// A11y: zona de conținut e un `<button>` real (nu `role="button"` pe div), iar
// quick-add-ul e un `<button>` SEPARAT, frate, nu copil — ca să nu avem buton
// nested (ARIA invalid). Blocul de preț poartă un `aria-label` descriptiv, iar
// fragmentele vizuale sunt `aria-hidden` ca screen-reader-ul să nu citească
// numere lipite fără context.
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

interface ProductCardProps {
  product: Product
  onOpen: () => void
  onQuickAdd: () => void
  canAdd: boolean
  /** Procentul de reducere happy-hour deja calculat în pagină (0 = niciunul). */
  happyHourPct?: number
  accent: string
  PUB: PublicColors
  theme: MenuTheme
}

const THUMB = 88

// Trepte de dimensiune pentru fragmentele mici de preț/meta — un set restrâns,
// nu px „eyeballed". MICRO pentru unități/sufixe, SMALL pentru cifre secundare,
// HERO pentru întregul prețului.
const FS_MICRO = 11
const FS_SMALL = 13
const FS_PRICE = 20

export default function ProductCard({
  product,
  onOpen,
  onQuickAdd,
  canAdd,
  happyHourPct = 0,
  accent,
  PUB,
  theme,
}: ProductCardProps) {
  const t = menuType(theme.fonts)

  const isSoldOut = product.is_sold_out
  const hasRequiredMods = product.modifier_groups?.some((g) => g.is_required) ?? false

  const allTags = product.dietary_tags ?? []
  const shownTags = allTags.slice(0, 2)
  const extraTags = allTags.length - shownTags.length

  // Clamp defensiv: procentul vine din pagină, dar dacă e aberant (negativ sau
  // >100) prețul efectiv ar deveni negativ. Îl ținem în [0, 100].
  const pct = Number.isFinite(happyHourPct) ? Math.min(100, Math.max(0, happyHourPct)) : 0
  const basePrice = Number.isFinite(product.price) && product.price > 0 ? product.price : 0
  const hasDiscount = pct > 0 && !isSoldOut
  const effectivePrice = hasDiscount ? basePrice * (1 - pct / 100) : basePrice
  const priceInt = Math.floor(effectivePrice)
  const priceFrac = (effectivePrice - priceInt).toFixed(2).slice(2) // „50" pentru 32.50

  // Culoarea prețului: la reducere folosim verdele „succes" al temei (tunat
  // per-temă pentru contrast AA pe fundalul ei), altfel accentul. Fragmentele
  // mici (zecimale, „lei", „de la") rămân pe `PUB.text` la dimensiuni < 14px,
  // unde pragul AA e 4.5:1 și accentul nu e garantat lizibil.
  const priceMain = hasDiscount ? theme.colors.success : accent
  const priceUnit = PUB.text
  // Token „muted readable": `text3` e prea slab pentru text mic; folosim `text2`
  // pentru meta/„opțiuni"/„+N" ca să trecem pragul AA la 11–13px.
  const metaColor = PUB.text2

  // Etichetă completă pentru screen-reader: descrie prețul (și reducerea) într-o
  // singură frază, în loc de cifre lipite citite separat.
  const priceLabel = hasDiscount
    ? `Preț redus ${effectivePrice.toFixed(2)} lei, de la ${basePrice.toFixed(2)} lei`
    : `${hasRequiredMods ? 'De la ' : ''}${effectivePrice.toFixed(2)} lei`

  return (
    <div
      data-testid="product-card"
      style={{
        display: 'flex',
        gap: 16,
        alignItems: 'stretch',
        padding: '16px 0',
        borderBottom: `1px solid ${PUB.border}`,
        opacity: isSoldOut ? 0.55 : 1,
      }}
    >
      <Thumbnail product={product} theme={theme} PUB={PUB} />

      {/* Zona de conținut = buton real „deschide produs". Nu mai e `role=button`
          pe div și nu mai conține quick-add-ul ca subtree → fără buton nested. */}
      <button
        type="button"
        className={isSoldOut ? undefined : 'pressable'}
        disabled={isSoldOut}
        onClick={() => {
          if (!isSoldOut) onOpen()
        }}
        aria-label={`Vezi detalii ${product.name}`}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
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
        {/* Rând titlu + preț */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          <span
            style={{
              ...t.cardTitle,
              color: PUB.text,
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {product.name}
          </span>

          <span
            aria-label={priceLabel}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 2,
              flexShrink: 0,
            }}
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
                {basePrice.toFixed(2)}
              </span>
            )}
            <span
              aria-hidden
              style={{ ...t.price, fontSize: FS_PRICE, color: priceMain, lineHeight: 1 }}
            >
              {priceInt}
            </span>
            <span
              aria-hidden
              style={{
                fontFamily: theme.fonts.heading,
                fontSize: FS_SMALL,
                fontWeight: 600,
                color: priceMain,
                lineHeight: 1,
              }}
            >
              .{priceFrac}
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
              lei
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

        {/* Badge-uri + meta (pur informative, niciun element interactiv aici) */}
        {(shownTags.length > 0 ||
          extraTags > 0 ||
          hasRequiredMods ||
          hasDiscount ||
          isSoldOut) && (
          <span
            style={{
              display: 'flex',
              gap: 4,
              flexWrap: 'wrap',
              marginTop: 4,
              alignItems: 'center',
            }}
          >
            {hasDiscount && (
              <Badge
                label={`-${Math.round(pct)}%`}
                color={theme.colors.success}
                fonts={theme.fonts}
              />
            )}
            {shownTags.map((tagId) => (
              <TagBadge key={tagId} tagId={tagId} fonts={theme.fonts} />
            ))}
            {extraTags > 0 && (
              <Badge label={`+${extraTags}`} color={metaColor} fonts={theme.fonts} />
            )}
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
              <Badge label="Epuizat" color={theme.colors.error} fonts={theme.fonts} />
            )}
          </span>
        )}
      </button>

      {/* Quick-add circular 44px — buton SEPARAT, frate cu zona de conținut. */}
      {canAdd && !isSoldOut && (
        <button
          type="button"
          className="pressable"
          onClick={() => {
            // Cu modificatori obligatorii deschidem sheet-ul (alegere necesară);
            // altfel adăugăm direct în coș.
            if (hasRequiredMods) onOpen()
            else onQuickAdd()
          }}
          aria-label={`Adaugă ${product.name}`}
          style={{
            alignSelf: 'center',
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: accent,
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            lineHeight: 1,
            boxShadow: `0 2px 8px ${accent}55`,
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

// ── Thumbnail: imagine sau fallback monogramă pe gradient-ul temei ──────
function Thumbnail({
  product,
  theme,
  PUB,
}: {
  product: Product
  theme: MenuTheme
  PUB: PublicColors
}) {
  const base: CSSProperties = {
    width: THUMB,
    height: THUMB,
    flexShrink: 0,
    borderRadius: Math.min(theme.radius, 12),
    overflow: 'hidden',
    background: PUB.surface,
  }

  if (product.image_url) {
    return (
      <div style={base}>
        <BlurImage src={product.image_url} alt={product.name} aspectRatio="1 / 1" skeleton />
      </div>
    )
  }

  // Fallback fără imagine: monograma produsului (inițiala) pe gradient-ul temei.
  // Mai puțin „template" decât un emoji generic identic pe toate produsele.
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
          fontSize: 34,
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

// ── Badge generic pill (text scurt) ────────────────────────────────────
function Badge({
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

// ── Badge dietetic (emoji + label din DIETARY_TAGS) ────────────────────
function TagBadge({ tagId, fonts }: { tagId: string; fonts: MenuTheme['fonts'] }) {
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
