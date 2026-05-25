// =============================================================
// RecrutarePage — landing recrutare clienți pilot
//
// Audiență: patroni cafenele/baruri din România, 25-50 ani.
// Tonul: cald, profesional, direct. Fără jargon "SaaS B2B".
// Stil: editorial cu tipografie strong, asimetric, dark cu accent gold.
// =============================================================
import { useState } from 'react'
import { D } from '../lib/constants'

interface Props {
  navigate: (path: string) => void
}

export default function RecrutarePage({ navigate }: Props) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0A0908',
        color: D.t1,
        fontFamily: 'DM Sans, sans-serif',
        // Texture: subtle noise for depth
        backgroundImage: `
        radial-gradient(ellipse at top left, rgba(200,150,60,0.08), transparent 50%),
        radial-gradient(ellipse at bottom right, rgba(200,150,60,0.04), transparent 50%)
      `,
      }}
    >
      <NavBar navigate={navigate} />
      <Hero />
      <Problem />
      <Features />
      <Differentiators />
      <PilotOffer />
      <ContactForm />
      <Footer />
    </div>
  )
}

// ── NavBar ───────────────────────────────────────────────────
function NavBar({ navigate }: { navigate: (p: string) => void }) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'rgba(10,9,8,0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        padding: '14px 0',
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'Fraunces, serif',
            fontSize: 22,
            fontWeight: 700,
            color: D.t1,
            letterSpacing: '-0.02em',
          }}
        >
          Menuvia<span style={{ color: D.gold }}>.</span>
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => navigate('/pricing')}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              color: D.t2,
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Prețuri normale
          </button>
          <button
            onClick={() => navigate('/auth')}
            style={{
              background: D.gold,
              color: '#0A0908',
              border: 'none',
              padding: '8px 18px',
              borderRadius: 8,
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Cont existent →
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Hero ─────────────────────────────────────────────────────
function Hero() {
  return (
    <section
      style={{ maxWidth: 1180, margin: '0 auto', padding: '80px 24px 60px', position: 'relative' }}
    >
      {/* Eyebrow */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 14px',
          borderRadius: 99,
          background: 'rgba(200,150,60,0.1)',
          border: '1px solid rgba(200,150,60,0.3)',
          fontSize: 12,
          color: D.gold,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontWeight: 600,
          marginBottom: 28,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            background: D.gold,
            boxShadow: `0 0 8px ${D.gold}`,
          }}
        />
        Program pilot — 10 locații
      </div>

      {/* Big serif headline */}
      <h1
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 'clamp(40px, 7vw, 78px)',
          fontWeight: 600,
          lineHeight: 1.02,
          letterSpacing: '-0.03em',
          color: D.t1,
          margin: 0,
          maxWidth: 920,
        }}
      >
        Sistemul POS gândit
        <br />
        de un român, pentru
        <br />
        <span
          style={{
            color: D.gold,
            fontStyle: 'italic',
            fontFamily: 'Fraunces, serif',
          }}
        >
          cafenelele tale.
        </span>
      </h1>

      {/* Subhead */}
      <p
        style={{
          fontSize: 19,
          lineHeight: 1.55,
          color: D.t2,
          maxWidth: 580,
          marginTop: 32,
        }}
      >
        Comenzi prin QR, gestiune stocuri, raport Z fiscal, închidere zi cu un click. Toate într-un
        singur loc, fără SmartBill peste. <strong style={{ color: D.t1 }}>3 luni gratuit</strong>{' '}
        pentru primele 10 cafenele care intră în program.
      </p>

      {/* CTA row */}
      <div style={{ display: 'flex', gap: 12, marginTop: 36, flexWrap: 'wrap' }}>
        <a
          href="#contact"
          style={{
            background: D.gold,
            color: '#0A0908',
            padding: '14px 28px',
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 600,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            transition: 'transform .15s',
          }}
          onMouseOver={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
          onMouseOut={(e) => (e.currentTarget.style.transform = '')}
        >
          Programează demo → 30 min
        </a>
        <a
          href="#features"
          style={{
            background: 'transparent',
            color: D.t1,
            padding: '14px 28px',
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 500,
            textDecoration: 'none',
            border: '1px solid rgba(255,255,255,0.15)',
          }}
        >
          Vezi ce face
        </a>
      </div>

      {/* Trust line */}
      <div
        style={{
          marginTop: 48,
          display: 'flex',
          gap: 28,
          flexWrap: 'wrap',
          fontSize: 13,
          color: D.t3,
        }}
      >
        <span>✓ Bridge FiscalNet (Datecs / Activa / Tremol)</span>
        <span>✓ Date pe servere UE (Frankfurt)</span>
        <span>✓ Suport WhatsApp în română</span>
      </div>
    </section>
  )
}

// ── Problem ──────────────────────────────────────────────────
function Problem() {
  return (
    <section
      style={{
        borderTop: '1px solid rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        padding: '70px 0',
        background: 'rgba(255,255,255,0.015)',
      }}
    >
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 24px' }}>
        <div
          style={{
            fontSize: 12,
            color: D.gold,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          01 — Problema
        </div>

        <h2
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 'clamp(28px, 4.5vw, 44px)',
            fontWeight: 500,
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            color: D.t1,
            margin: 0,
            maxWidth: 820,
          }}
        >
          Acum jonglezi între <em style={{ color: D.gold, fontStyle: 'italic' }}>3-4 softuri</em>{' '}
          care nu se vorbesc între ele.
        </h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 24,
            marginTop: 40,
          }}
        >
          {[
            {
              i: '✕',
              t: 'POS rece',
              d: 'Software vechi cu UI din 2010, conceput pentru hipermarketuri.',
            },
            {
              i: '✕',
              t: 'SmartBill separat',
              d: 'Plătești încă o subscripție lunară pentru emitere bonuri.',
            },
            { i: '✕', t: 'Gestiune în Excel', d: 'Tracking stocuri manual, cu erori și uitări.' },
            {
              i: '✕',
              t: 'Zero report-uri',
              d: 'Nu știi ce vinde mai bine, când e peak, cine vinde cât.',
            },
          ].map((x, i) => (
            <div
              key={i}
              style={{
                padding: 20,
                borderLeft: `2px solid ${D.red}`,
                background: 'rgba(224,85,85,0.03)',
              }}
            >
              <div style={{ color: D.red, fontSize: 18, marginBottom: 8 }}>{x.i}</div>
              <div
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontSize: 18,
                  fontWeight: 600,
                  color: D.t1,
                  marginBottom: 6,
                }}
              >
                {x.t}
              </div>
              <div style={{ fontSize: 14, color: D.t2, lineHeight: 1.5 }}>{x.d}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Features ─────────────────────────────────────────────────
function Features() {
  const items = [
    {
      n: '01',
      emoji: '☕',
      t: 'Meniu cu QR',
      d: 'Clientul scanează codul de pe masă și comandă direct. Comenzile apar pe ecranul tău și al bucătăriei în timp real. Reduce timpul de așteptare cu 40%.',
    },
    {
      n: '02',
      emoji: '🧾',
      t: 'Bridge FiscalNet',
      d: 'Conectare directă la casa de marcat (Datecs, Activa, Tremol). Tipărește bon fiscal automat la plată. Raport Z cu un click la închidere.',
    },
    {
      n: '03',
      emoji: '📦',
      t: 'Gestiune stocuri',
      d: 'Adaugi rețete (50ml lapte + 7g espresso = cappuccino). Stocurile se decontează automat la vânzare. Alerte când rămâi fără.',
    },
    {
      n: '04',
      emoji: '📊',
      t: 'Rapoarte cu sens',
      d: 'Vânzări pe oră, pe ospătar, pe categorie. Top 10 produse. Export PDF/CSV pentru contabil. Tot ce înseamnă "cifre" într-un singur loc.',
    },
    {
      n: '05',
      emoji: '💰',
      t: 'Casă & închidere zi',
      d: 'Fond inițial, mișcări (cheltuieli, depuneri), numărare seara cu diferență automată. Z fiscal generat și trimis prin Bridge.',
    },
    {
      n: '06',
      emoji: '🎉',
      t: 'Happy Hour automat',
      d: 'Setezi reguli ("17-19 reducere 20% pe tot"). Sistemul îți sugerează aplicarea la plată. Zero greșeli manuale.',
    },
  ]

  return (
    <section id="features" style={{ maxWidth: 1180, margin: '0 auto', padding: '90px 24px' }}>
      <div
        style={{
          fontSize: 12,
          color: D.gold,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          fontWeight: 600,
          marginBottom: 16,
        }}
      >
        02 — Soluția
      </div>

      <h2
        style={{
          fontFamily: 'Fraunces, serif',
          fontSize: 'clamp(28px, 4.5vw, 44px)',
          fontWeight: 500,
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
          color: D.t1,
          margin: 0,
          maxWidth: 820,
          marginBottom: 16,
        }}
      >
        Tot ce-ți trebuie să operezi{' '}
        <em style={{ color: D.gold, fontStyle: 'italic' }}>o cafenea modernă</em>, într-un singur
        tablou de bord.
      </h2>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 1,
          marginTop: 48,
          border: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.06)',
        }}
      >
        {items.map((x) => (
          <div
            key={x.n}
            style={{
              padding: 28,
              background: '#0A0908',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 240,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                marginBottom: 18,
              }}
            >
              <span style={{ fontSize: 32 }}>{x.emoji}</span>
              <span
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontSize: 14,
                  color: D.gold,
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                }}
              >
                {x.n}
              </span>
            </div>
            <div
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: 22,
                fontWeight: 600,
                color: D.t1,
                marginBottom: 10,
                letterSpacing: '-0.01em',
              }}
            >
              {x.t}
            </div>
            <div style={{ fontSize: 14, color: D.t2, lineHeight: 1.55 }}>{x.d}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Differentiators ──────────────────────────────────────────
function Differentiators() {
  return (
    <section
      style={{
        borderTop: '1px solid rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        padding: '80px 0',
        background: 'rgba(200,150,60,0.025)',
      }}
    >
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 24px' }}>
        <div
          style={{
            fontSize: 12,
            color: D.gold,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          03 — De ce noi
        </div>

        <h2
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 'clamp(28px, 4.5vw, 44px)',
            fontWeight: 500,
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            color: D.t1,
            margin: 0,
            maxWidth: 820,
          }}
        >
          Vs. soluțiile existente din România:
        </h2>

        <div style={{ marginTop: 40, display: 'grid', gap: 14 }}>
          {[
            {
              k: 'Preț',
              us: '49–99 RON/lună',
              them: 'SmartBill 39 RON + POS 200 RON + Octopus 80 RON = 319 RON/lună',
            },
            {
              k: 'TVA flexibil',
              us: '9% / 19% / 5% pe fiecare produs, raport automat',
              them: 'Manual, prin Excel sau contabil extern',
            },
            {
              k: 'Casa de marcat',
              us: 'Bridge universal (Datecs/Activa/Tremol)',
              them: 'Cuplaj manual cu un singur producător',
            },
            {
              k: 'Limba',
              us: 'Tot în română, suport pe WhatsApp',
              them: 'UI parțial tradus, ticketing prin email',
            },
            {
              k: 'Onboarding',
              us: 'Setup Asistent: 3 min de la cont la prima comandă',
              them: 'Zile de configurare manuală',
            },
          ].map((x, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr 1fr',
                gap: 24,
                padding: '18px 0',
                borderBottom: i < 4 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                alignItems: 'baseline',
              }}
            >
              <div
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontSize: 16,
                  fontWeight: 600,
                  color: D.gold,
                  minWidth: 100,
                }}
              >
                {x.k}
              </div>
              <div style={{ fontSize: 15, color: D.t1, lineHeight: 1.5 }}>
                <span style={{ color: D.green, fontWeight: 600 }}>✓ Menuvia: </span>
                {x.us}
              </div>
              <div style={{ fontSize: 14, color: D.t3, lineHeight: 1.5 }}>
                <span style={{ color: D.t3 }}>✕ Restul: </span>
                {x.them}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Pilot Offer ──────────────────────────────────────────────
function PilotOffer() {
  return (
    <section style={{ maxWidth: 1180, margin: '0 auto', padding: '90px 24px' }}>
      <div
        style={{
          fontSize: 12,
          color: D.gold,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          fontWeight: 600,
          marginBottom: 16,
        }}
      >
        04 — Oferta pilot
      </div>

      <div
        style={{
          marginTop: 20,
          background:
            'linear-gradient(135deg, rgba(200,150,60,0.12) 0%, rgba(200,150,60,0.04) 100%)',
          border: '1px solid rgba(200,150,60,0.3)',
          borderRadius: 16,
          padding: 'clamp(28px, 5vw, 48px)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative serif * */}
        <div
          style={{
            position: 'absolute',
            top: -40,
            right: -20,
            fontFamily: 'Fraunces, serif',
            fontSize: 240,
            color: 'rgba(200,150,60,0.08)',
            lineHeight: 1,
            pointerEvents: 'none',
          }}
        >
          *
        </div>

        <h2
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 'clamp(28px, 4.5vw, 44px)',
            fontWeight: 500,
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            color: D.t1,
            margin: 0,
            maxWidth: 720,
            position: 'relative',
          }}
        >
          Primele <em style={{ color: D.gold, fontStyle: 'italic' }}>10 cafenele</em> primesc 3 luni
          gratuit.
        </h2>

        <div
          style={{
            marginTop: 28,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 28,
            position: 'relative',
          }}
        >
          {[
            { n: '3 luni', d: 'Plan complet, fără limită produse/comenzi' },
            { n: 'Onboarding', d: 'Te ajut personal: import meniu, setup TVA, conectare casă' },
            { n: 'Sprijin direct', d: 'WhatsApp meu, răspund în max 2 ore' },
            { n: 'Feedback = features', d: 'Tot ce ceri în pilot se construiește' },
          ].map((x, i) => (
            <div key={i}>
              <div
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontSize: 28,
                  fontWeight: 600,
                  color: D.gold,
                  marginBottom: 6,
                  letterSpacing: '-0.01em',
                }}
              >
                {x.n}
              </div>
              <div style={{ fontSize: 14, color: D.t2, lineHeight: 1.5 }}>{x.d}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 36, position: 'relative' }}>
          <a
            href="#contact"
            style={{
              background: D.gold,
              color: '#0A0908',
              padding: '14px 32px',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            Aplică pentru pilot →
          </a>
        </div>
      </div>
    </section>
  )
}

// ── Contact Form ─────────────────────────────────────────────
function ContactForm() {
  const [name, setName] = useState('')
  const [cafe, setCafe] = useState('')
  const [city, setCity] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !cafe.trim() || !email.trim() || !phone.trim()) {
      setErr('Toate câmpurile marcate cu * sunt obligatorii')
      return
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setErr('Email invalid')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/.netlify/functions/recrutare-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cafe, city, phone, email, message }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setDone(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare la trimitere')
    } finally {
      setBusy(false)
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: '12px 14px',
    fontSize: 15,
    color: D.t1,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: D.t2,
    fontWeight: 500,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  }

  return (
    <section
      id="contact"
      style={{
        borderTop: '1px solid rgba(255,255,255,0.05)',
        padding: '90px 0',
        background: 'rgba(255,255,255,0.015)',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px' }}>
        <div
          style={{
            fontSize: 12,
            color: D.gold,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          05 — Aplică
        </div>

        <h2
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 'clamp(28px, 4.5vw, 44px)',
            fontWeight: 500,
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            color: D.t1,
            margin: 0,
            marginBottom: 16,
          }}
        >
          Programează un demo de <em style={{ color: D.gold, fontStyle: 'italic' }}>30 min</em>.
        </h2>
        <p style={{ fontSize: 17, color: D.t2, lineHeight: 1.55, maxWidth: 580, marginBottom: 36 }}>
          Te sun eu, îți arăt aplicația și răspund la întrebări. Fără presiune să cumperi.
        </p>

        {done ? (
          <div
            style={{
              padding: 32,
              borderRadius: 12,
              background: 'rgba(76,175,110,0.08)',
              border: '1px solid rgba(76,175,110,0.3)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 14 }}>✓</div>
            <div
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: 22,
                color: D.t1,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Cererea ta a ajuns la mine.
            </div>
            <div style={{ fontSize: 15, color: D.t2 }}>Te sun în maximum 24 ore. Răbdare!</div>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 18,
              }}
            >
              <div>
                <label style={labelStyle}>Numele tău *</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={fieldStyle}
                  placeholder="Andrei Popescu"
                />
              </div>
              <div>
                <label style={labelStyle}>Cafenea / local *</label>
                <input
                  value={cafe}
                  onChange={(e) => setCafe(e.target.value)}
                  style={fieldStyle}
                  placeholder="Cafenea Eclipse"
                />
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 18,
              }}
            >
              <div>
                <label style={labelStyle}>Oraș</label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  style={fieldStyle}
                  placeholder="București / Cluj / Iași..."
                />
              </div>
              <div>
                <label style={labelStyle}>Telefon *</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={fieldStyle}
                  placeholder="07XX XXX XXX"
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={fieldStyle}
                placeholder="andrei@cafenea.ro"
              />
            </div>

            <div>
              <label style={labelStyle}>Spune-mi pe scurt despre local (opțional)</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                style={{
                  ...fieldStyle,
                  resize: 'vertical',
                  minHeight: 80,
                  fontFamily: 'DM Sans, sans-serif',
                }}
                placeholder="Câte mese, ce vinzi cel mai mult, ce ești frustrat de softul actual..."
              />
            </div>

            {err && (
              <div
                style={{
                  padding: 12,
                  background: 'rgba(224,85,85,0.1)',
                  color: D.red,
                  borderRadius: 8,
                  fontSize: 14,
                }}
              >
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                background: D.gold,
                color: '#0A0908',
                border: 'none',
                padding: '16px 24px',
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: busy ? 'wait' : 'pointer',
                fontFamily: 'DM Sans, sans-serif',
                opacity: busy ? 0.6 : 1,
                marginTop: 8,
              }}
            >
              {busy ? 'Se trimite...' : 'Trimite cererea →'}
            </button>

            <div style={{ fontSize: 12, color: D.t3, lineHeight: 1.5 }}>
              Datele tale rămân între noi. Nu le partajăm cu nimeni. Te contactez doar pentru a
              programa demo-ul.
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

// ── Footer ───────────────────────────────────────────────────
function Footer() {
  return (
    <footer
      style={{
        borderTop: '1px solid rgba(255,255,255,0.05)',
        padding: '40px 24px',
        textAlign: 'center',
        fontSize: 13,
        color: D.t3,
      }}
    >
      <div style={{ fontFamily: 'Fraunces, serif', fontSize: 16, color: D.t2, marginBottom: 6 }}>
        Menuvia<span style={{ color: D.gold }}>.</span>
      </div>
      <div>Făcut în România · Date pe servere UE · 2026</div>
    </footer>
  )
}
