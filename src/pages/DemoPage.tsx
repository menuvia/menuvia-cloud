import { useEffect, useState } from 'react'
import { D } from '../lib/constants'
import { useToast } from '../components/ui/useToast'

const ACCENT = '#C8963C'
const DEMO_RESTAURANT = {
  name: 'La Bella Trattoria',
  tagline: 'Bucătărie italiană autentică',
}

const DEMO_CATEGORIES = [
  { id: '1', name: 'Aperitive', emoji: '🧀' },
  { id: '2', name: 'Paste', emoji: '🍝' },
  { id: '3', name: 'Pizza', emoji: '🍕' },
  { id: '4', name: 'Deserturi', emoji: '🍰' },
  { id: '5', name: 'Băuturi', emoji: '🍷' },
]

const DEMO_PRODUCTS = [
  {
    id: '1',
    cat: '1',
    name: 'Bruschette Pomodoro',
    desc: 'Pâine prăjită cu roșii cherry, busuioc și ulei de măsline',
    price: 24,
    special: false,
    soldOut: false,
  },
  {
    id: '2',
    cat: '1',
    name: 'Carpaccio di Manzo',
    desc: 'Carpaccio de vită cu rucola, parmezan și lămâie',
    price: 38,
    special: true,
    soldOut: false,
  },
  {
    id: '3',
    cat: '2',
    name: 'Spaghetti Carbonara',
    desc: 'Guanciale, ou, pecorino romano, piper negru',
    price: 36,
    special: false,
    soldOut: false,
  },
  {
    id: '4',
    cat: '2',
    name: 'Penne Arrabbiata',
    desc: 'Sos de roșii picant cu usturoi și pătrunjel',
    price: 29,
    special: false,
    soldOut: false,
  },
  {
    id: '5',
    cat: '2',
    name: 'Risotto ai Funghi',
    desc: 'Ciuperci porcini, parmezan, vin alb',
    price: 42,
    special: true,
    soldOut: false,
  },
  {
    id: '6',
    cat: '3',
    name: 'Margherita',
    desc: 'Sos de roșii, mozzarella, busuioc',
    price: 28,
    special: false,
    soldOut: false,
  },
  {
    id: '7',
    cat: '3',
    name: 'Quattro Formaggi',
    desc: 'Mozzarella, gorgonzola, parmezan, fontina',
    price: 35,
    special: false,
    soldOut: false,
  },
  {
    id: '8',
    cat: '3',
    name: 'Prosciutto e Rucola',
    desc: 'Prosciutto crudo, rucola, parmezan',
    price: 38,
    special: false,
    soldOut: true,
  },
  {
    id: '9',
    cat: '4',
    name: 'Tiramisu',
    desc: 'Rețetă clasică cu mascarpone și cafea',
    price: 22,
    special: false,
    soldOut: false,
  },
  {
    id: '10',
    cat: '4',
    name: 'Panna Cotta',
    desc: 'Cu sos de fructe de pădure',
    price: 19,
    special: false,
    soldOut: false,
  },
  {
    id: '11',
    cat: '5',
    name: 'Limonada casei',
    desc: 'Lămâie proaspătă, mentă, apă minerală',
    price: 14,
    special: false,
    soldOut: false,
  },
  {
    id: '12',
    cat: '5',
    name: 'Espresso',
    desc: 'Cafea italiană 100% arabica',
    price: 8,
    special: false,
    soldOut: false,
  },
]

export default function DemoPage({ onBack, onStart }: { onBack: () => void; onStart: () => void }) {
  const toast = useToast()
  const [activeCat, setActiveCat] = useState('1')
  const [cartCount, setCartCount] = useState(0)
  const products = DEMO_PRODUCTS.filter((p) => p.cat === activeCat)

  // Titlu specific rutei (SEO/share) — /demo moștenea titlul RO de homepage.
  useEffect(() => {
    const prev = document.title
    document.title = 'Demo live — Menuvia'
    return () => {
      document.title = prev
    }
  }, [])

  return (
    <div
      style={{
        background: '#F8F3EB',
        minHeight: '100vh',
        maxWidth: 480,
        margin: '0 auto',
        fontFamily: 'DM Sans,sans-serif',
        position: 'relative',
      }}
    >
      {/* Demo banner */}
      <div
        style={{
          background: D.gold,
          color: '#000',
          textAlign: 'center',
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        Mod demo &mdash; date fictive &mdash;{' '}
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: '#000',
            textDecoration: 'underline',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            // Țintă de atingere ≥44px fără să crească înălțimea vizuală a bannerului
            padding: '13px 8px',
            margin: '-13px -8px',
          }}
        >
          ← Înapoi la Menuvia
        </button>
      </div>

      {/* Header */}
      <div style={{ padding: '20px 20px 0' }}>
        <div
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 22,
            fontWeight: 700,
            color: '#1A1208',
          }}
        >
          {DEMO_RESTAURANT.name}
        </div>
        <div style={{ color: '#5C4A2A', fontSize: 14, marginTop: 4 }}>
          {DEMO_RESTAURANT.tagline}
        </div>
        <div
          style={{
            display: 'inline-block',
            background: ACCENT + '18',
            border: `1px solid ${ACCENT}44`,
            borderRadius: 20,
            padding: '4px 12px',
            fontSize: 13,
            color: ACCENT,
            fontWeight: 600,
            marginTop: 8,
          }}
        >
          Masa 7
        </div>
      </div>

      {/* Category tabs */}
      <div
        style={{
          display: 'flex',
          overflowX: 'auto',
          padding: '16px 0 0',
          borderBottom: '1px solid #D4C8B8',
          position: 'sticky',
          top: 0,
          background: '#F8F3EB',
          zIndex: 10,
        }}
      >
        {DEMO_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCat(cat.id)}
            aria-pressed={activeCat === cat.id}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: activeCat === cat.id ? `2px solid ${ACCENT}` : '2px solid transparent',
              padding: '13px 16px',
              minHeight: 44,
              color: activeCat === cat.id ? ACCENT : '#5C4A2A',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              fontWeight: activeCat === cat.id ? 700 : 400,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {cat.emoji} {cat.name}
          </button>
        ))}
      </div>

      {/* Products */}
      <div
        style={{ padding: '12px 16px 120px', display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        {products.map((p) => (
          <button
            key={p.id}
            disabled={p.soldOut}
            onClick={() => setCartCount((c) => c + 1)}
            aria-label={
              p.soldOut ? undefined : `Adaugă ${p.name} în coș — ${p.price.toFixed(2)} lei`
            }
            style={{
              background: '#fff',
              border: '1px solid #E8DFD0',
              borderRadius: 14,
              padding: '14px 16px',
              cursor: p.soldOut ? 'default' : 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              textAlign: 'left',
              boxShadow: '0 1px 4px rgba(26,18,8,0.06)',
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1A1208' }}>
                {/* Atenuarea „epuizat" se aplică doar pe text; badge-ul Epuizat
                    rămâne la opacitate plină ca să-și păstreze contrastul. */}
                <span style={{ opacity: p.soldOut ? 0.6 : 1 }}>{p.name}</span>
                {p.soldOut && (
                  <span style={{ color: '#c0392b', fontSize: 12, marginLeft: 8 }}>Epuizat</span>
                )}
                {p.special && (
                  <span style={{ color: ACCENT, fontSize: 12, marginLeft: 8 }}>
                    {'⭐'} Specialitate
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: '#5C4A2A',
                  marginTop: 3,
                  lineHeight: 1.4,
                  opacity: p.soldOut ? 0.6 : 1,
                }}
              >
                {p.desc}
              </div>
              <div
                style={{
                  fontFamily: 'Fraunces, Georgia, serif',
                  fontSize: 16,
                  fontWeight: 700,
                  color: ACCENT,
                  marginTop: 6,
                  opacity: p.soldOut ? 0.6 : 1,
                }}
              >
                {p.price.toFixed(2)} lei
              </div>
            </div>
            {!p.soldOut && (
              <span
                aria-hidden="true"
                style={{
                  width: 44,
                  height: 44,
                  minWidth: 44,
                  borderRadius: 12,
                  background: ACCENT,
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  fontWeight: 700,
                  marginLeft: 12,
                }}
              >
                +
              </span>
            )}
          </button>
        ))}

        {/* CTA după listă: demo → cont real. Fără footer — pagina rămâne
            o simulare de meniu, nu o pagină de marketing. */}
        <div
          style={{
            background: '#fff',
            border: `1px solid ${ACCENT}44`,
            borderRadius: 14,
            padding: '22px 18px',
            textAlign: 'center',
            marginTop: 10,
            boxShadow: '0 1px 4px rgba(26,18,8,0.06)',
          }}
        >
          <div
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 17,
              fontWeight: 700,
              color: '#1A1208',
              marginBottom: 6,
            }}
          >
            Îți place? Creează-ți contul în 10 minute
          </div>
          <div style={{ fontSize: 13, color: '#5C4A2A', marginBottom: 14, lineHeight: 1.5 }}>
            Meniul tău poate arăta exact așa — cu produsele și prețurile tale.
          </div>
          <button
            onClick={onStart}
            style={{
              background: ACCENT,
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              padding: '12px 24px',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Începe gratuit →
          </button>
        </div>
      </div>

      {/* Cart bar */}
      {cartCount > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '100%',
            maxWidth: 480,
            padding: '12px 16px',
            paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
            background: '#F8F3EB',
            borderTop: '1px solid #D4C8B8',
            zIndex: 50,
          }}
        >
          <button
            onClick={() => {
              toast.info(
                'Acesta este modul demo. Creează un cont pentru a trimite comenzi reale!',
              )
              setCartCount(0)
            }}
            style={{
              background: ACCENT,
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              padding: '14px 20px',
              width: '100%',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span
              style={{
                background: 'rgba(255,255,255,0.25)',
                borderRadius: 20,
                padding: '2px 10px',
                fontSize: 13,
              }}
            >
              {cartCount} {cartCount === 1 ? 'produs' : 'produse'}
            </span>
            <span>Trimite comanda</span>
          </button>
        </div>
      )}
    </div>
  )
}
