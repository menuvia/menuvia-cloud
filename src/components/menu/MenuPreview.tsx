import type { CSSProperties } from 'react'
import type { Product } from '../../lib/qr'
import type { MenuCurrency } from '../../lib/currency'
import type { MenuTheme, ThemeSettings } from '../../lib/themes'
import {
  resolveTheme,
  resolveMenuLayout,
  resolveMenuElements,
  resolveFlipbookPages,
} from '../../lib/themes'
import ProductCard from './ProductCard'
import ProductGridCard from './ProductGridCard'
import ProductMinimalRow from './ProductMinimalRow'
import ProductPhotoCard from './ProductPhotoCard'
import FlipbookViewer from './FlipbookViewer'

// ─────────────────────────────────────────────────────────────
// MenuPreview — previzualizare LIVE, NON-interactivă, a meniului clientului,
// afișată în dashboard (Setări → Aspect). Se re-randează instant la orice
// schimbare de temă / layout / elemente, fiindcă `themeSettings` vine din
// state-ul React al formularului.
//
// Reutilizează exact aceleași helper-uri (`resolveTheme` / `resolveMenuLayout`
// / `resolveMenuElements`) și aceleași carduri comune (ProductCard /
// ProductGridCard / ProductMinimalRow) ca meniul real — nu redesenăm nimic.
// Pur vizual: fără fetch/RPC, callback-urile de card sunt funcții goale.
// ─────────────────────────────────────────────────────────────

interface MenuPreviewProps {
  themeSettings: ThemeSettings | null | undefined
  restaurantName?: string
  // Moneda meniului (mig 205) — vine din starea formularului de setări, ca
  // preview-ul să reflecte LIVE alegerea din selector, nu valoarea salvată.
  currency?: MenuCurrency
}

// Paleta „publică" pe care o așteaptă cardurile comune (subset din theme.colors).
interface PublicColors {
  bg: string
  surface: string
  text: string
  text2: string
  text3: string
  border: string
  borderStrong: string
}

// Callback-uri goale: preview-ul e doar vizual, nimic nu se întâmplă la click.
const noop = (): void => {}

// Construiește un produs-mostră complet (toate câmpurile obligatorii ale tipului
// `Product` prezente; array-urile goale unde nu contează pentru preview).
function sampleProduct(
  id: string,
  name: string,
  description: string,
  price: number,
): Product {
  return {
    id,
    restaurant_id: 'preview',
    category_id: 'preview',
    name,
    description,
    price,
    image_url: null,
    is_sold_out: false,
    is_draft: false,
    is_daily_special: false,
    display_order: 0,
    modifier_groups: [],
    allergens: [],
    dietary_tags: [],
    prep_time_minutes: null,
    portion_size: null,
    vat_group: 0,
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    ai_generated_fields: [],
    extras: [],
    pairings: [],
  }
}

// Cele 3 produse-mostră afișate în preview.
const SAMPLE_PRODUCTS: Product[] = [
  sampleProduct('p1', 'Bruschette', 'Roșii coapte, busuioc, ulei de măsline extravirgin', 24),
  sampleProduct('p2', 'Risotto cu ciuperci', 'Orez carnaroli, ciuperci de pădure, parmezan', 46),
  sampleProduct('p3', 'Tiramisu', 'Mascarpone, cafea espresso, cacao', 22),
]

// Imagine-mostră inline (SVG data-URI, o plajă de culoare) pentru layout-ul
// „Foto-first" — fără niciun request de rețea în dashboard.
const sampleImage = (hex: string): string =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect width='400' height='300' fill='%23${hex}'/%3E%3C/svg%3E`

// Pentru „Foto-first": primele două produse au poză (carduri mari cu nume/preț
// pe poză), al treilea NU are — ilustrează fallback-ul pe rând compact.
const PHOTO_SAMPLE_PRODUCTS: Product[] = [
  {
    ...sampleProduct('p1', 'Bruschette', 'Roșii coapte, busuioc, ulei de măsline extravirgin', 24),
    image_url: sampleImage('C9B08C'),
  },
  {
    ...sampleProduct('p2', 'Risotto cu ciuperci', 'Orez carnaroli, ciuperci de pădure, parmezan', 46),
    image_url: sampleImage('8FA98F'),
  },
  sampleProduct('p3', 'Tiramisu', 'Mascarpone, cafea espresso, cacao', 22),
]

// ── Mini-hero: oglindește logica din hero-ul real (respectă `elements`) ──────
function MiniHero({
  theme,
  restaurantName,
  showCover,
  showStatus,
  showTagline,
  showAmenities,
  showSocial,
}: {
  theme: MenuTheme
  restaurantName: string
  showCover: boolean
  showStatus: boolean
  showTagline: boolean
  showAmenities: boolean
  showSocial: boolean
}) {
  // Fără imagine reală în preview: cover → bandă mai înaltă cu scrim,
  // altfel doar gradientul de accent, mai scurt.
  const heroHeight = showCover ? 120 : 80
  const heroBase: CSSProperties = {
    position: 'relative',
    height: heroHeight,
    background: theme.colors.accentGradient,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    gap: 6,
    padding: 14,
  }

  return (
    <div style={heroBase}>
      {/* Scrim doar când simulăm coperta, ca textul alb să rămână lizibil. */}
      {showCover && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.45) 100%)',
          }}
        />
      )}

      {/* Status: pastilă „Deschis acum". Oglindește StatusPill-ul real (glass
          întunecat + text alb + punct verde), NU alb-pe-verde: verzii de success
          ai temei sunt mid-tone, iar albul la 10px pică AA pe unele teme
          (cafe/fine-dining/mexican/healthy). */}
      {showStatus && (
        <span
          style={{
            position: 'relative',
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: theme.fonts.body,
            fontSize: 10,
            fontWeight: 600,
            color: '#fff',
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.22)',
            padding: '3px 9px',
            borderRadius: 100,
            letterSpacing: '0.04em',
          }}
        >
          <span
            aria-hidden
            style={{ width: 6, height: 6, borderRadius: '50%', background: theme.colors.success }}
          />
          Deschis acum
        </span>
      )}

      {/* Numele restaurantului, alb peste hero, în fontul de titlu al temei. */}
      <span
        style={{
          position: 'relative',
          fontFamily: theme.fonts.heading,
          fontSize: 22,
          fontWeight: 600,
          color: '#fff',
          lineHeight: 1.1,
          textShadow: '0 1px 6px rgba(0,0,0,0.35)',
        }}
      >
        {restaurantName}
      </span>

      {/* Tagline: slogan mostră italic. */}
      {showTagline && (
        <span
          style={{
            position: 'relative',
            fontFamily: theme.fonts.heading,
            fontStyle: 'italic',
            fontSize: 12,
            color: '#fff',
            opacity: 0.92,
            textShadow: '0 1px 4px rgba(0,0,0,0.35)',
          }}
        >
          Bucătărie de sezon
        </span>
      )}

      {/* Amenities + social: pile mici sub hero. */}
      {(showAmenities || showSocial) && (
        <div
          style={{
            position: 'relative',
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginTop: 2,
          }}
        >
          {showAmenities && <HeroPill fonts={theme.fonts} label="WiFi" />}
          {showAmenities && <HeroPill fonts={theme.fonts} label="Vegan" />}
          {showSocial && <HeroPill fonts={theme.fonts} label="Instagram" />}
        </div>
      )}
    </div>
  )
}

// Pilă mică albă semi-transparentă pentru amenities/social în hero.
function HeroPill({ fonts, label }: { fonts: MenuTheme['fonts']; label: string }) {
  return (
    <span
      style={{
        fontFamily: fonts.body,
        fontSize: 9,
        fontWeight: 600,
        color: '#fff',
        background: 'rgba(255,255,255,0.22)',
        border: '1px solid rgba(255,255,255,0.35)',
        padding: '2px 8px',
        borderRadius: 100,
        letterSpacing: '0.03em',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

export default function MenuPreview({
  themeSettings,
  restaurantName,
  currency = 'RON',
}: MenuPreviewProps) {
  const theme = resolveTheme(themeSettings)
  const layout = resolveMenuLayout(themeSettings)
  const elements = resolveMenuElements(themeSettings)
  const accent = theme.colors.accent

  const PUB: PublicColors = {
    bg: theme.colors.bg,
    surface: theme.colors.surface,
    text: theme.colors.text,
    text2: theme.colors.text2,
    text3: theme.colors.text3,
    border: theme.colors.border,
    borderStrong: theme.colors.borderStrong,
  }

  const name = restaurantName || 'Bistro Exemplu'

  // Props comune pasate fiecărui card (identice pentru toate layout-urile).
  const cardProps = {
    canAdd: true,
    happyHourPct: 0,
    onOpen: noop,
    onQuickAdd: noop,
    accent,
    PUB,
    theme,
    currency,
  }

  return (
    <div
      aria-hidden
      // `inert`: cardurile reale (ProductCard/etc.) conțin <button>-uri focusabile.
      // `aria-hidden` singur NU le scoate din tab-order → un user cu tastatura ar
      // tabula prin ~3-6 butoane moarte (onClick=noop) în dashboard. `inert` le
      // scoate din tab-order ȘI din arborele de accesibilitate. React 18 nu
      // tipizează prop-ul `inert`, iar boolean-ul `true` e ignorat; forma `""`
      // (string gol) randează atributul corect. Baseline în browsere moderne.
      {...({ inert: '' } as Record<string, string>)}
      style={{
        maxWidth: 340,
        border: `1px solid ${PUB.borderStrong}`,
        borderRadius: 20,
        overflow: 'hidden',
        background: PUB.bg,
        boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
        fontFamily: theme.fonts.body,
        // Evită ca badge-urile albe/text pe accent să pară „active" la hover
        // în dashboard — preview-ul nu e interactiv.
        pointerEvents: 'none',
      }}
    >
      <MiniHero
        theme={theme}
        restaurantName={name}
        showCover={elements.cover}
        showStatus={elements.status}
        showTagline={elements.tagline}
        showAmenities={elements.amenities}
        showSocial={elements.social}
      />

      {/* Lista de produse, randată cu componenta potrivită după layout. */}
      {layout === 'flipbook' ? (
        // Flipbook: preview LIVE cu paginile deja încărcate în formular (dacă
        // există) — altfel starea goală prietenoasă a viewer-ului.
        <div style={{ padding: 12 }}>
          <FlipbookViewer
            pages={resolveFlipbookPages(themeSettings)}
            theme={theme}
            PUB={PUB}
            pageHeight={300}
          />
        </div>
      ) : layout === 'photo' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12 }}>
          {PHOTO_SAMPLE_PRODUCTS.map((p) => (
            <ProductPhotoCard key={p.id} product={p} {...cardProps} />
          ))}
        </div>
      ) : layout === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: 12 }}>
          {SAMPLE_PRODUCTS.map((p) => (
            <ProductGridCard key={p.id} product={p} {...cardProps} />
          ))}
        </div>
      ) : layout === 'minimal' ? (
        <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 14px 12px' }}>
          {SAMPLE_PRODUCTS.map((p) => (
            <ProductMinimalRow key={p.id} product={p} {...cardProps} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 14px 12px' }}>
          {SAMPLE_PRODUCTS.map((p) => (
            <ProductCard key={p.id} product={p} {...cardProps} />
          ))}
        </div>
      )}
    </div>
  )
}
