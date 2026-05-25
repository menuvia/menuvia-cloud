import { useState } from 'react'
import { D } from '../lib/constants'

const ACCENT = '#C8963C'
const DEMO_RESTAURANT = {
  name: 'La Bella Trattoria',
  tagline: 'Buc\u0103t\u0103rie italian\u0103 autentic\u0103',
}

const DEMO_CATEGORIES = [
  { id: '1', name: 'Aperitive', emoji: '\ud83e\uddc0' },
  { id: '2', name: 'Paste', emoji: '\ud83c\udf5d' },
  { id: '3', name: 'Pizza', emoji: '\ud83c\udf55' },
  { id: '4', name: 'Deserturi', emoji: '\ud83c\udf70' },
  { id: '5', name: 'B\u0103uturi', emoji: '\ud83c\udf77' },
]

const DEMO_PRODUCTS = [
  {
    id: '1',
    cat: '1',
    name: 'Bruschette Pomodoro',
    desc: 'P\u00e2ine pr\u0103jit\u0103 cu ro\u0219ii cherry, busuioc \u0219i ulei de m\u0103sline',
    price: 24,
    special: false,
    soldOut: false,
  },
  {
    id: '2',
    cat: '1',
    name: 'Carpaccio di Manzo',
    desc: 'Carpaccio de vit\u0103 cu rucola, parmezan \u0219i l\u0103m\u00e2ie',
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
    desc: 'Sos de ro\u0219ii picant cu usturoi \u0219i p\u0103trunjel',
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
    desc: 'Sos de ro\u0219ii, mozzarella, busuioc',
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
    desc: 'Re\u021bet\u0103 clasic\u0103 cu mascarpone \u0219i cafea',
    price: 22,
    special: false,
    soldOut: false,
  },
  {
    id: '10',
    cat: '4',
    name: 'Panna Cotta',
    desc: 'Cu sos de fructe de p\u0103dure',
    price: 19,
    special: false,
    soldOut: false,
  },
  {
    id: '11',
    cat: '5',
    name: 'Limonada casei',
    desc: 'L\u0103m\u00e2ie proasp\u0103t\u0103, ment\u0103, ap\u0103 mineral\u0103',
    price: 14,
    special: false,
    soldOut: false,
  },
  {
    id: '12',
    cat: '5',
    name: 'Espresso',
    desc: 'Cafea italian\u0103 100% arabica',
    price: 8,
    special: false,
    soldOut: false,
  },
]

export default function DemoPage({ onBack }: { onBack: () => void }) {
  const [activeCat, setActiveCat] = useState('1')
  const [cartCount, setCartCount] = useState(0)
  const products = DEMO_PRODUCTS.filter((p) => p.cat === activeCat)

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
          }}
        >
          Inapoi
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
            style={{
              background: 'transparent',
              borderBottom: activeCat === cat.id ? `2px solid ${ACCENT}` : '2px solid transparent',
              border: 'none',
              padding: '10px 16px',
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
            style={{
              background: '#fff',
              border: '1px solid #E8DFD0',
              borderRadius: 14,
              padding: '14px 16px',
              cursor: p.soldOut ? 'default' : 'pointer',
              opacity: p.soldOut ? 0.6 : 1,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              textAlign: 'left',
              boxShadow: '0 1px 4px rgba(26,18,8,0.06)',
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1A1208' }}>
                {p.name}
                {p.soldOut && (
                  <span style={{ color: '#c0392b', fontSize: 12, marginLeft: 8 }}>Epuizat</span>
                )}
                {p.special && (
                  <span style={{ color: ACCENT, fontSize: 12, marginLeft: 8 }}>
                    {'\u2b50'} Specialitate
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#5C4A2A', marginTop: 3, lineHeight: 1.4 }}>
                {p.desc}
              </div>
              <div
                style={{
                  fontFamily: 'Fraunces, Georgia, serif',
                  fontSize: 16,
                  fontWeight: 700,
                  color: ACCENT,
                  marginTop: 6,
                }}
              >
                {p.price.toFixed(2)} lei
              </div>
            </div>
          </button>
        ))}
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
            padding: '12px 16px 24px',
            background: '#F8F3EB',
            borderTop: '1px solid #D4C8B8',
            zIndex: 50,
          }}
        >
          <button
            onClick={() => {
              alert('Acesta este modul demo. Creeaz\u0103 un cont pentru a trimite comenzi reale!')
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
