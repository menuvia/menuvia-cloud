import { useState } from 'react'
import { MKT } from '../lib/marketing'
import { MOTION } from '../lib/motion'
import { RevealItem } from '../components/marketing/Reveal'
import LegalFooter from '../components/LegalFooter'

// ── Landing page (unauthenticated visitors) ──────────────────
// Obiectiv: vizitatorul înțelege în 10 secunde ce e Menuvia, pentru cine e,
// de ce Meniu + Comenzi e planul recomandat și cât de simplu e setup-ul.
// Vinde FLOW-ul (Adaugi meniul → Generezi QR → Primești comenzi), nu module.
export default function LandingPage({
  onStartPlan,
  onLogin,
  onPricing,
  onDemo,
}: {
  onStartPlan: (plan: 'starter' | 'growth') => void
  onLogin: () => void
  onPricing: () => void
  onDemo: () => void
}) {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const BENEFITS = [
    { icon: '📝', title: 'Meniu actualizabil oricând', desc: 'Schimbi prețuri și produse pe loc — fără re-printat meniuri.' },
    { icon: '🛎', title: 'Comenzi direct de la masă', desc: 'Clientul scanează, alege și trimite. Fără așteptat după ospătar.' },
    { icon: '🚶', title: 'Mai puține drumuri pentru ospătari', desc: 'Chemarea ospătarului și nota de plată — direct din telefonul clientului.' },
    { icon: '👨‍🍳', title: 'Bucătărie organizată', desc: 'Comenzile apar instant pe ecran, în ordinea corectă. Zero hârtii.' },
    { icon: '🔲', title: 'QR-uri generate automat', desc: 'Spui câte mese ai — primești QR-urile gata de printat, în PDF.' },
    { icon: '📊', title: 'Rapoarte simple', desc: 'Ce s-a comandat azi și săptămâna asta — fără să sapi prin meniuri.' },
  ]

  const STEPS = [
    { n: '1', title: 'Adaugi meniul', desc: 'Manual sau importat cu AI dintr-o poză. Gata în câteva minute.' },
    { n: '2', title: 'Generezi QR-urile pentru mese', desc: 'Spui câte mese ai. PDF-ul de printat e gata în 30 de secunde.' },
    { n: '3', title: 'Primești comenzi instant', desc: 'Clienții comandă de pe telefon, bucătăria vede totul live.' },
  ]

  const FAQ = [
    {
      q: 'Am nevoie de hardware special?',
      a: 'Nu. Funcționează pe orice telefon sau tabletă. Pentru bucătărie merge orice ecran cu browser.',
    },
    {
      q: 'Cum știe sistemul de la ce masă vine comanda?',
      a: 'Fiecare masă are QR-ul ei. Când clientul scanează și comandă, comanda ajunge automat cu masa atașată — ospătarul nu mai întreabă nimic.',
    },
    {
      q: 'Plata se face prin aplicație?',
      a: 'Pe planurile Meniu Digital și Meniu + Comenzi, plata și bonul rămân pe casa ta de marcat, exact ca până acum. Plățile în aplicație există pe planul Fiscalizare, disponibil în pilot.',
    },
    {
      q: 'Pot începe doar cu meniul digital?',
      a: 'Da. Planul Meniu Digital îți dă meniul QR modern, fără comenzi. Poți activa comenzile oricând, dintr-un click.',
    },
  ]

  const ctaBtn: React.CSSProperties = {
    background: MKT.accent,
    color: MKT.onAccent,
    border: 'none',
    borderRadius: 12,
    padding: '15px 30px',
    fontWeight: 700,
    fontSize: 16,
    cursor: 'pointer',
    fontFamily: 'DM Sans,sans-serif',
    boxShadow: 'var(--shadow-gold-soft, 0 4px 14px rgba(200,150,60,0.3))',
  }
  const ghostBtn: React.CSSProperties = {
    background: MKT.surface,
    color: MKT.text,
    border: `1.5px solid ${MKT.border}`,
    borderRadius: 12,
    padding: '15px 30px',
    fontWeight: 600,
    fontSize: 16,
    cursor: 'pointer',
    fontFamily: 'DM Sans,sans-serif',
  }
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div style={{ minHeight: '100vh', background: MKT.bg, fontFamily: 'DM Sans,sans-serif' }}>
      {/* Header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(250,249,246,0.92)',
          backdropFilter: 'blur(10px)',
          borderBottom: `1px solid ${MKT.border}`,
        }}
      >
        <div
          style={{
            maxWidth: 1040,
            margin: '0 auto',
            padding: '14px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 24,
              color: MKT.accent,
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            Menuvia
          </div>
          <nav style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {[
              { label: 'Funcții', id: 'functii' },
              { label: 'Cum funcționează', id: 'cum-functioneaza' },
            ].map((l) => (
              <button
                key={l.id}
                onClick={() => scrollTo(l.id)}
                className="lp-nav-link"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: MKT.text2,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: '8px 10px',
                  fontFamily: 'DM Sans,sans-serif',
                }}
              >
                {l.label}
              </button>
            ))}
            <button
              onClick={onPricing}
              className="lp-nav-link"
              style={{
                background: 'transparent',
                border: 'none',
                color: MKT.text2,
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                padding: '8px 10px',
                fontFamily: 'DM Sans,sans-serif',
              }}
            >
              Prețuri
            </button>
            <button
              onClick={onLogin}
              style={{
                background: MKT.accent,
                color: MKT.onAccent,
                border: 'none',
                borderRadius: 10,
                padding: '9px 18px',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
                marginLeft: 6,
              }}
            >
              Începe gratuit
            </button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <div
        style={{
          maxWidth: 820,
          margin: '0 auto',
          padding: '72px 24px 48px',
          textAlign: 'center',
        }}
      >
        <h1
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: 'clamp(2rem, 5.2vw, 3.4rem)',
            color: MKT.text,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
            marginBottom: 20,
            textWrap: 'balance',
          }}
        >
          Meniu QR și comenzi de la masă pentru restaurante moderne
        </h1>
        <p
          style={{
            color: MKT.text2,
            fontSize: 'clamp(1.05rem, 2.2vw, 1.2rem)',
            maxWidth: 540,
            margin: '0 auto 32px',
            lineHeight: 1.65,
            textWrap: 'balance',
          }}
        >
          Clienții scanează codul QR, comandă de pe telefon, iar bucătăria primește instant.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => onStartPlan('growth')} className="pressable" style={ctaBtn}>
            Începe cu Meniu + Comenzi
          </button>
          <button
            onClick={() => scrollTo('cum-functioneaza')}
            className="pressable"
            style={ghostBtn}
          >
            Vezi cum funcționează
          </button>
        </div>
        <div style={{ color: MKT.text3, fontSize: 13, marginTop: 16 }}>
          30 de zile gratuite. Anulezi oricând.
        </div>
      </div>

      {/* Product preview — mock CSS, nu imagini */}
      <div
        style={{
          maxWidth: 1040,
          margin: '0 auto',
          padding: '0 24px 72px',
          display: 'flex',
          gap: 18,
          justifyContent: 'center',
          flexWrap: 'wrap',
          alignItems: 'stretch',
        }}
      >
        {/* Telefon: meniul QR */}
        <div
          className="hover-lift"
          style={{
            background: MKT.surface,
            border: `1px solid ${MKT.border}`,
            borderRadius: 26,
            padding: 16,
            width: 230,
            boxShadow: '0 12px 32px rgba(26,18,8,0.08)',
          }}
        >
          <div style={{ fontSize: 11, color: MKT.text3, textAlign: 'center', marginBottom: 10 }}>
            📱 Meniul pe telefonul clientului
          </div>
          <div
            style={{
              background: MKT.accentSoft,
              borderRadius: 14,
              padding: '8px 10px',
              fontSize: 12,
              fontWeight: 700,
              color: MKT.accent,
              textAlign: 'center',
              marginBottom: 10,
            }}
          >
            Masa 12
          </div>
          {[
            { n: 'Pizza Margherita', p: '32 lei' },
            { n: 'Limonadă cu mentă', p: '14 lei' },
          ].map((it) => (
            <div
              key={it.n}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '9px 4px',
                borderBottom: `1px solid ${MKT.surface2}`,
                fontSize: 12.5,
              }}
            >
              <span style={{ color: MKT.text, fontWeight: 600 }}>{it.n}</span>
              <span style={{ color: MKT.text2 }}>{it.p}</span>
            </div>
          ))}
          <div
            style={{
              marginTop: 12,
              background: MKT.accent,
              color: MKT.onAccent,
              borderRadius: 10,
              padding: '10px 0',
              fontSize: 13,
              fontWeight: 700,
              textAlign: 'center',
            }}
          >
            Trimite comanda · 46 lei
          </div>
        </div>

        {/* Card comandă bucătărie */}
        <div
          className="hover-lift"
          style={{
            background: MKT.surface,
            border: `1px solid ${MKT.border}`,
            borderRadius: 18,
            padding: 18,
            width: 250,
            alignSelf: 'center',
            boxShadow: '0 8px 24px rgba(26,18,8,0.06)',
          }}
        >
          <div style={{ fontSize: 11, color: MKT.text3, marginBottom: 10 }}>
            👨‍🍳 Ecranul din bucătărie
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <span style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, color: MKT.text }}>
              Masa 12
            </span>
            <span
              style={{
                background: MKT.accentSoft,
                color: MKT.accent,
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 6,
                padding: '3px 9px',
              }}
            >
              NOUĂ · acum
            </span>
          </div>
          <div style={{ fontSize: 13, color: MKT.text2, lineHeight: 1.7 }}>
            1 × Pizza Margherita
            <br />2 × Limonadă cu mentă
          </div>
          <div
            style={{
              marginTop: 12,
              background: MKT.success,
              color: '#fff',
              borderRadius: 9,
              padding: '9px 0',
              fontSize: 12.5,
              fontWeight: 700,
              textAlign: 'center',
            }}
          >
            ✓ Confirmă
          </div>
        </div>

        {/* Card QR pe masă */}
        <div
          className="hover-lift"
          style={{
            background: MKT.surface,
            border: `1px solid ${MKT.border}`,
            borderRadius: 18,
            padding: 18,
            width: 170,
            alignSelf: 'center',
            textAlign: 'center',
            boxShadow: '0 8px 24px rgba(26,18,8,0.06)',
          }}
        >
          <div style={{ fontSize: 11, color: MKT.text3, marginBottom: 10 }}>🔲 QR-ul de pe masă</div>
          <div
            style={{
              fontSize: 64,
              lineHeight: 1,
              marginBottom: 8,
              filter: 'contrast(1.1)',
            }}
          >
            ▦
          </div>
          <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, color: MKT.text, fontSize: 15 }}>
            Masa 12
          </div>
          <div style={{ fontSize: 11, color: MKT.text3, marginTop: 4 }}>Scanează pentru a comanda</div>
        </div>
      </div>

      {/* Benefits */}
      <div id="functii" style={{ background: MKT.surface2, padding: '72px 24px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <RevealItem>
            <h2
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: 'clamp(1.6rem, 3.4vw, 2.1rem)',
                color: MKT.text,
                fontWeight: 700,
                textAlign: 'center',
                marginBottom: 40,
                letterSpacing: '-0.02em',
                textWrap: 'balance',
              }}
            >
              Tot ce are nevoie un restaurant. Nimic în plus.
            </h2>
          </RevealItem>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 16,
            }}
          >
            {BENEFITS.map((b, i) => (
              <RevealItem key={b.title} delay={(i % 3) * 70}>
                <div
                  className="hover-lift"
                  style={{
                    background: MKT.surface,
                    border: `1px solid ${MKT.border}`,
                    borderRadius: 16,
                    padding: '24px 22px',
                    height: '100%',
                    boxShadow: '0 1px 3px rgba(26,18,8,0.03)',
                  }}
                >
                  <div style={{ fontSize: 26, marginBottom: 12 }}>{b.icon}</div>
                  <div style={{ color: MKT.text, fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
                    {b.title}
                  </div>
                  <div style={{ color: MKT.text2, fontSize: 14, lineHeight: 1.6 }}>{b.desc}</div>
                </div>
              </RevealItem>
            ))}
          </div>
        </div>
      </div>

      {/* How it works */}
      <div id="cum-functioneaza" style={{ maxWidth: 880, margin: '0 auto', padding: '80px 24px' }}>
        <RevealItem>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 'clamp(1.6rem, 3.4vw, 2.1rem)',
              color: MKT.text,
              fontWeight: 700,
              textAlign: 'center',
              marginBottom: 44,
              letterSpacing: '-0.02em',
              textWrap: 'balance',
            }}
          >
            Pornești în 3 pași
          </h2>
        </RevealItem>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 18,
          }}
        >
          {STEPS.map((st, i) => (
            <RevealItem key={st.n} delay={i * 90}>
              <div style={{ textAlign: 'center', padding: '0 8px' }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: '50%',
                    background: MKT.accentSoft,
                    color: MKT.accent,
                    fontFamily: 'Fraunces,serif',
                    fontSize: 23,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px',
                    border: `1px solid ${MKT.border}`,
                  }}
                >
                  {st.n}
                </div>
                <div style={{ color: MKT.text, fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
                  {st.title}
                </div>
                <div style={{ color: MKT.text2, fontSize: 14, lineHeight: 1.6 }}>{st.desc}</div>
              </div>
            </RevealItem>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <button onClick={onDemo} className="pressable" style={ghostBtn}>
            Vezi demo live
          </button>
        </div>
      </div>

      {/* Plan highlight — Meniu + Comenzi e vedeta */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 24px 80px' }}>
        <RevealItem>
        <div
          className="hover-lift"
          style={{
            background: MKT.surface,
            border: `1.5px solid ${MKT.accent}`,
            borderRadius: 20,
            padding: '36px 28px',
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(200,150,60,0.14)',
          }}
        >
          <div
            style={{
              display: 'inline-block',
              background: MKT.accent,
              color: MKT.onAccent,
              fontSize: 11,
              fontWeight: 700,
              padding: '5px 14px',
              borderRadius: 100,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 14,
            }}
          >
            Recomandat
          </div>
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.4rem',
              color: MKT.text,
              fontWeight: 700,
              marginBottom: 10,
            }}
          >
            🛎 Meniu + Comenzi
          </div>
          <p
            style={{
              color: MKT.text2,
              fontSize: 15,
              lineHeight: 1.65,
              maxWidth: 480,
              margin: '0 auto 22px',
            }}
          >
            Alegerea potrivită pentru restaurantele care vor să reducă timpul pierdut cu preluarea
            comenzilor. Plata și bonul rămân pe casa ta actuală.
          </p>
          <button onClick={onPricing} className="pressable" style={ctaBtn}>
            Vezi planurile
          </button>
        </div>
        </RevealItem>
      </div>

      {/* FAQ light */}
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 24px 80px' }}>
        <RevealItem>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 'clamp(1.4rem, 3vw, 1.6rem)',
              color: MKT.text,
              fontWeight: 700,
              textAlign: 'center',
              marginBottom: 28,
              textWrap: 'balance',
            }}
          >
            Întrebări frecvente
          </h2>
        </RevealItem>
        {FAQ.map((f, i) => {
          const isOpen = openFaq === i
          return (
            <div
              key={f.q}
              style={{
                background: MKT.surface,
                border: `1px solid ${isOpen ? MKT.accent : MKT.border}`,
                borderRadius: 12,
                marginBottom: 8,
                overflow: 'hidden',
                transition: `border-color ${MOTION.normal}ms ${MOTION.easeOut}`,
              }}
            >
              <button
                onClick={() => setOpenFaq(isOpen ? null : i)}
                aria-expanded={isOpen}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                  padding: '16px 18px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'DM Sans,sans-serif',
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: MKT.text,
                  textAlign: 'left',
                  gap: 12,
                }}
              >
                {f.q}
                <span
                  style={{
                    color: isOpen ? MKT.accent : MKT.text3,
                    flexShrink: 0,
                    fontSize: 18,
                    fontWeight: 300,
                    transition: `transform ${MOTION.normal}ms ${MOTION.easeOut}, color ${MOTION.normal}ms ${MOTION.easeOut}`,
                    transform: isOpen ? 'rotate(45deg)' : 'none',
                    lineHeight: 1,
                  }}
                >
                  +
                </span>
              </button>
              <div
                style={{
                  display: 'grid',
                  gridTemplateRows: isOpen ? '1fr' : '0fr',
                  opacity: isOpen ? 1 : 0,
                  transition: `grid-template-rows ${MOTION.normal}ms ${MOTION.easeOut}, opacity ${MOTION.normal}ms ${MOTION.easeOut}`,
                }}
              >
                <div style={{ overflow: 'hidden' }}>
                  <div
                    style={{
                      padding: '0 18px 16px',
                      color: MKT.text2,
                      fontSize: 14,
                      lineHeight: 1.65,
                    }}
                  >
                    {f.a}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Final CTA */}
      <div
        style={{
          background: MKT.surface2,
          padding: '72px 24px',
          textAlign: 'center',
        }}
      >
        <RevealItem>
          <h3
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 'clamp(1.5rem, 3vw, 1.9rem)',
              color: MKT.text,
              fontWeight: 700,
              marginBottom: 12,
              textWrap: 'balance',
            }}
          >
            Gata să începi?
          </h3>
          <p style={{ color: MKT.text2, fontSize: 15, marginBottom: 28 }}>
            30 de zile gratuite. Setup în 10 minute. Anulezi oricând.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => onStartPlan('growth')} className="pressable" style={ctaBtn}>
              Începe cu Meniu + Comenzi
            </button>
            <button onClick={onPricing} className="pressable" style={ghostBtn}>
              Vezi prețurile
            </button>
          </div>
        </RevealItem>
      </div>
      <LegalFooter />
    </div>
  )
}
