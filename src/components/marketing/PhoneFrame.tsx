import { useState, type CSSProperties } from 'react'
import { getTheme, DEFAULT_THEME_ID } from '../../lib/themes'
import type { Product } from '../../lib/qr'
import MenuHeader from '../menu/MenuHeader'
import CategoryTabs from '../menu/CategoryTabs'
import ProductCard from '../menu/ProductCard'

// ─────────────────────────────────────────────────────────────
// PhoneFrame — ramă de telefon desenată în CSS care randează ÎNĂUNTRU
// meniul REAL al produsului (MenuHeader + CategoryTabs + ProductCard),
// cu date mostră. Folosit pe landing ca „demo viu": vizitatorul vede
// exact componentele pe care le va vedea clientul lui la masă.
// Pur prezentațional — zero fetch, handlers no-op.
// ─────────────────────────────────────────────────────────────

// Tema default a produsului — aceeași pe care o primește un restaurant nou.
const theme = getTheme(DEFAULT_THEME_ID)

// Paleta publică (subsetul PublicPalette cerut de componentele de meniu).
const PUB = {
  bg: theme.colors.bg,
  surface: theme.colors.surface,
  text: theme.colors.text,
  text2: theme.colors.text2,
  text3: theme.colors.text3,
  border: theme.colors.border,
  borderStrong: theme.colors.borderStrong,
}
const accent = theme.colors.accent

// Culoarea ramei (bezel) — near-black cald, aliniat cu paleta MKT.
const BEZEL = '#1C140C'

// Produs mostră complet: completează TOATE câmpurile obligatorii din tipul
// Product, ca ProductCard să primească exact forma de producție.
function sampleProduct(
  overrides: Pick<Product, 'id' | 'category_id' | 'name' | 'price'> & Partial<Product>,
): Product {
  return {
    restaurant_id: 'demo',
    description: null,
    // image_url null → cade pe fallback-ul monogramă pe gradient (existent).
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
    vat_group: 9,
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    ai_generated_fields: [],
    extras: [],
    pairings: [],
    ...overrides,
  }
}

// 3 categorii mostră cu 2–3 produse fiecare (nume scurte ca să nu trunchieze
// pe lățimea de telefon; prețuri realiste în lei; descrieri scurte în română).
const CATEGORIES = [
  { id: 'antipasti', name: 'Antipasti' },
  { id: 'paste', name: 'Paste' },
  { id: 'desert', name: 'Desert' },
]

const PRODUCTS: Record<string, Product[]> = {
  antipasti: [
    sampleProduct({
      id: 'a1',
      category_id: 'antipasti',
      name: 'Bruschette',
      price: 18,
      description: 'Pâine prăjită, roșii cherry, busuioc proaspăt',
    }),
    sampleProduct({
      id: 'a2',
      category_id: 'antipasti',
      name: 'Burrata',
      price: 32,
      description: 'Burrata cremoasă, pesto de busuioc, rucola',
    }),
    sampleProduct({
      id: 'a3',
      category_id: 'antipasti',
      name: 'Carpaccio',
      price: 38,
      description: 'Felii fine de vită, parmezan, lămâie',
    }),
  ],
  paste: [
    sampleProduct({
      id: 'p1',
      category_id: 'paste',
      name: 'Carbonara',
      price: 36,
      description: 'Guanciale, ou, pecorino romano, piper negru',
    }),
    sampleProduct({
      id: 'p2',
      category_id: 'paste',
      name: 'Tagliatelle',
      price: 42,
      description: 'Ciuperci porcini, smântână, parmezan',
    }),
    sampleProduct({
      id: 'p3',
      category_id: 'paste',
      name: 'Arrabbiata',
      price: 29,
      description: 'Sos de roșii picant, usturoi, pătrunjel',
    }),
  ],
  desert: [
    sampleProduct({
      id: 'd1',
      category_id: 'desert',
      name: 'Tiramisu',
      price: 22,
      description: 'Rețeta clasică, cu mascarpone și cafea',
    }),
    sampleProduct({
      id: 'd2',
      category_id: 'desert',
      name: 'Panna cotta',
      price: 19,
      description: 'Cu sos de fructe de pădure',
    }),
  ],
}

// Handlers no-op pentru cardurile demo (nu deschidem sheet-uri pe landing).
const noop = () => undefined

export default function PhoneFrame({ style }: { style?: CSSProperties }) {
  // Tab activ — interactiv: vizitatorul poate schimba categoria chiar pe landing.
  const [activeCat, setActiveCat] = useState<string>(CATEGORIES[0].id)
  const products = PRODUCTS[activeCat] ?? []

  return (
    <div
      style={{
        width: 320,
        maxWidth: '100%',
        borderRadius: 40,
        background: BEZEL,
        padding: 10,
        boxShadow: '0 32px 64px rgba(26,18,8,0.28), 0 12px 24px rgba(26,18,8,0.16)',
        ...style,
      }}
    >
      {/* Ecranul telefonului */}
      <div
        style={{
          position: 'relative',
          borderRadius: 32,
          overflow: 'hidden',
          background: PUB.bg,
        }}
      >
        {/* Notch */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 94,
            height: 22,
            borderRadius: 12,
            background: BEZEL,
            zIndex: 30,
          }}
        />

        {/* Bară de status — face loc notch-ului, ca pe un telefon real. */}
        <div
          aria-hidden
          style={{
            height: 34,
            display: 'flex',
            alignItems: 'center',
            padding: '0 18px',
            background: PUB.bg,
            color: PUB.text2,
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'DM Sans, sans-serif',
          }}
        >
          12:30
        </div>

        {/* Meniul real, cu scroll intern și scrollbar ascuns. */}
        <div
          className="scrollbar-hidden"
          style={{
            maxHeight: 520,
            overflowY: 'auto',
            scrollbarWidth: 'none',
          }}
        >
          <MenuHeader
            variant="compact"
            restaurantName="Trattoria Verde"
            badge="Masa 12"
            isOpen
            accent={accent}
            PUB={PUB}
            theme={theme}
          />
          <CategoryTabs
            items={CATEGORIES.map((c) => ({
              id: c.id,
              name: c.name,
              count: PRODUCTS[c.id]?.length,
            }))}
            activeId={activeCat}
            onSelect={setActiveCat}
            accent={accent}
            PUB={PUB}
            theme={theme}
          />
          <div style={{ padding: '0 14px 18px' }}>
            {products.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onOpen={noop}
                onQuickAdd={noop}
                canAdd
                accent={accent}
                PUB={PUB}
                theme={theme}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
