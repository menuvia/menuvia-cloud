// =============================================================
// RezervariPage — landing-ul produsului „Menuvia Rezervări" (/rezervari).
//
// Wedge-ul de achiziție: rezervări automate pentru restaurante care NU vor
// (încă) meniu digital. Două fețe COMERCIALE (regula: numele comerciale
// trăiesc doar în UI; intern rămân free/starter — niciun plan intern nou):
//   • Rezervări Start    = free + modulul reservations ON → 0 lei, nelimitat
//   • Rezervări Automate = starter (99 lei) → + SMS confirmare/reminder
// Pitch-ul central: 0% comision per cuvert (anti-TheFork). Copy onest — toate
// funcțiile menționate EXISTĂ (hartă „ca la cinema", auto-confirmare mig 222,
// no-show automat mig 234, remindere mig 215/233).
//
// CTA-ul setează presetul de onboarding (localStorage, supraviețuiește
// redirectului de auth) → OnboardingPage activează modulul + auto_confirm.
// =============================================================
import { useEffect } from 'react'
import { MKT } from '../lib/marketing'
import { RevealItem } from '../components/marketing/Reveal'
import MarketingHeader from '../components/marketing/MarketingHeader'
import MarketingFooter from '../components/marketing/MarketingFooter'
import { Icon } from '../components/ui/Icon'
import type { IconName } from '../components/ui/Icon'
import { setOnboardingPreset } from '../lib/onboardingPreset'

const BENEFITS: { icon: IconName; t: string; d: string }[] = [
  {
    icon: 'calendar',
    t: 'Rezervare online, confirmată pe loc',
    d: 'Clientul alege data, ora și chiar masa pe harta sălii — „ca la cinema". Cu auto-confirmarea pornită, primește confirmarea instant, fără niciun telefon.',
  },
  {
    icon: 'qr',
    t: 'Buton de rezervare pe profilul tău Google',
    d: 'Primești un link stabil (menuvia.ro/rezervare/restaurantul-tău) pe care îl pui în Google Business Profile: cine te caută pe Google rezervă direct, fără să te sune.',
  },
  {
    icon: 'bell',
    t: 'Remindere automate — mai puține no-show-uri',
    d: 'Fiecare rezervare confirmată primește reminder înainte de ora rezervării (email gratuit; SMS pe planul Automate). Neprezentările se marchează automat.',
  },
  {
    icon: 'chart',
    t: 'Vezi tot dintr-un singur loc',
    d: 'Toate rezervările pe zi/săptămână, recidiviștii de no-show semnalați, programul și regulile (avans minim, durată, mese) setate de tine.',
  },
]

const STEPS = [
  { t: 'Creezi contul gratuit', d: '2 minute: numele localului și atât. Rezervările se activează automat.' },
  { t: 'Îți pui linkul pe Google', d: 'Copiezi linkul tău de rezervare din dashboard și îl adaugi în Google Business Profile (îți arătăm pașii).' },
  { t: 'Clienții rezervă singuri', d: 'Confirmare instant, reminder automat, no-show marcat singur. Tu doar vezi lista.' },
]

export default function RezervariPage({ navigate }: { navigate: (p: string) => void }) {
  useEffect(() => {
    const prev = document.title
    document.title = 'Menuvia Rezervări — rezervări online cu 0% comision'
    return () => {
      document.title = prev
    }
  }, [])

  const startCta = () => {
    // Intenția supraviețuiește redirectului de auth → OnboardingPage o consumă.
    setOnboardingPreset('rezervari')
    navigate('/auth?lang=ro')
  }

  const card: React.CSSProperties = {
    background: MKT.surface,
    border: `1px solid ${MKT.border}`,
    borderRadius: 16,
    padding: '24px 22px',
    textAlign: 'left',
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: MKT.bg,
        color: MKT.text,
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      <MarketingHeader
        onBack={() => navigate('/')}
        cta={{ label: 'Începe gratuit', onClick: startCta }}
      />

      {/* Hero */}
      <section style={{ padding: '64px 20px 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <div
            style={{
              display: 'inline-block',
              background: MKT.accentSoft,
              color: MKT.accentInk,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '6px 12px',
              borderRadius: 100,
              marginBottom: 20,
            }}
          >
            Menuvia Rezervări
          </div>
          <h1
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 'clamp(32px, 5.5vw, 54px)',
              fontWeight: 500,
              lineHeight: 1.12,
              letterSpacing: '-0.02em',
              margin: '0 0 18px',
            }}
          >
            Rezervări automate.{' '}
            <em style={{ color: MKT.accent, fontStyle: 'italic' }}>0% comision.</em>
          </h1>
          <p
            style={{
              fontSize: 18,
              color: MKT.text2,
              lineHeight: 1.6,
              maxWidth: 640,
              margin: '0 auto 12px',
            }}
          >
            Clienții te găsesc pe Google și rezervă singuri — cu confirmare instant, reminder
            automat și harta sălii. Tu nu plătești niciun leu per cuvert, indiferent câte
            rezervări primești.
          </p>
          <p style={{ fontSize: 14, color: MKT.text3, margin: '0 auto 28px', maxWidth: 560 }}>
            Platformele cu comision iau 8–10 lei pe cuvert: la 150 de rezervări pe lună a câte
            2–3 persoane, asta înseamnă peste 2.500 lei. La Menuvia: 0 lei pe planul gratuit,
            99 lei flat pe cel cu SMS-uri.
          </p>
          <button
            onClick={startCta}
            style={{
              background: MKT.accent,
              color: MKT.onAccent,
              border: 'none',
              borderRadius: 12,
              padding: '16px 36px',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            Începe gratuit — fără card →
          </button>
        </div>
      </section>

      {/* Beneficii */}
      <section style={{ padding: '40px 20px', background: MKT.surface2 }}>
        <div
          style={{
            maxWidth: 960,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {BENEFITS.map((b, i) => (
            <RevealItem key={b.t} delay={i * 60}>
              <div style={card}>
                <Icon name={b.icon} size={22} color={MKT.accent} />
                <div style={{ fontWeight: 700, fontSize: 16, margin: '12px 0 6px' }}>{b.t}</div>
                <div style={{ fontSize: 14, color: MKT.text2, lineHeight: 1.6 }}>{b.d}</div>
              </div>
            </RevealItem>
          ))}
        </div>
      </section>

      {/* Prețuri — două fețe, fără comision */}
      <section style={{ padding: '56px 20px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', textAlign: 'center' }}>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 'clamp(26px, 4vw, 38px)',
              fontWeight: 500,
              letterSpacing: '-0.02em',
              margin: '0 0 8px',
            }}
          >
            Două variante. Zero comision.
          </h2>
          <p style={{ fontSize: 15, color: MKT.text2, marginBottom: 32 }}>
            Fără taxe per cuvert, fără contracte — anulezi oricând.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 16,
              textAlign: 'left',
            }}
          >
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 2 }}>Rezervări Start</div>
              <div
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontSize: 34,
                  color: MKT.text,
                  marginBottom: 12,
                }}
              >
                0 lei
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, color: MKT.text2, fontSize: 14, lineHeight: 1.9 }}>
                <li>Rezervări online NELIMITATE</li>
                <li>Pagina ta publică de rezervare + link pentru Google</li>
                <li>Harta sălii — clientul își alege masa</li>
                <li>Confirmare automată + remindere pe email</li>
                <li>No-show marcat automat</li>
              </ul>
            </div>
            <div style={{ ...card, border: `2px solid ${MKT.accent}` }}>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 2 }}>
                Rezervări Automate
              </div>
              <div
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontSize: 34,
                  color: MKT.text,
                  marginBottom: 12,
                }}
              >
                99 lei<span style={{ fontSize: 15, color: MKT.text3 }}>/lună</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, color: MKT.text2, fontSize: 14, lineHeight: 1.9 }}>
                <li>Tot ce e în Start, plus:</li>
                <li>
                  <b>Confirmări și remindere pe SMS</b> (100 SMS/lună) — clienții chiar le văd
                </li>
                <li>Meniul digital QR inclus (planul Meniu Digital)</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Pași */}
      <section style={{ padding: '24px 20px 64px' }}>
        <div
          style={{
            maxWidth: 960,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
          }}
        >
          {STEPS.map((s, i) => (
            <div key={s.t} style={card}>
              <div
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontSize: 20,
                  color: MKT.accent,
                  marginBottom: 8,
                }}
              >
                {i + 1}. {s.t}
              </div>
              <div style={{ fontSize: 14, color: MKT.text2, lineHeight: 1.6 }}>{s.d}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 36 }}>
          <button
            onClick={startCta}
            style={{
              background: MKT.accent,
              color: MKT.onAccent,
              border: 'none',
              borderRadius: 12,
              padding: '16px 36px',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            Activează rezervările gratuit →
          </button>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
