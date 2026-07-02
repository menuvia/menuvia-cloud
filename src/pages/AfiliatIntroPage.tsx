// AfiliatIntroPage — prezentarea PUBLICĂ a programului de parteneriat.
// Afișată vizitatorilor nelogați pe /afiliat (înainte: redirect instant la
// /auth, fără nicio explicație — zid de login care pierdea orice partener
// potențial). Procentele vin din get_affiliate_public_defaults (mig 189) —
// valorile REALE setate de fondator, cu fallback pe cele istorice.
import { useState, useEffect } from 'react'
import { MKT } from '../lib/marketing'
import { supabase } from '../lib/supabase'
import MarketingHeader from '../components/marketing/MarketingHeader'
import MarketingFooter from '../components/marketing/MarketingFooter'
import { RevealItem } from '../components/marketing/Reveal'

interface PublicDefaults {
  setup_bps: number
  recurring_bps: number
  recurring_cap_months: number
}

// Fallback = valorile istorice din mig 097; suprascrise de RPC când răspunde.
const FALLBACK: PublicDefaults = { setup_bps: 3000, recurring_bps: 1000, recurring_cap_months: 12 }

const STEPS: { title: string; text: string }[] = [
  {
    title: 'Îți faci cont și primești linkul tău',
    text: 'Înscrierea durează un minut. Primești un link unic de recomandare pe care îl dai mai departe.',
  },
  {
    title: 'Recomanzi Menuvia restaurantelor',
    text: 'Un local se abonează venind de pe linkul tău — atribuirea se face automat, fără formulare.',
  },
  {
    title: 'Încasezi comision, lunar',
    text: 'Primești bani din prima factură și apoi din fiecare abonament lunar. Plata se face pe bază de factură, direct în contul tău.',
  },
]

interface Props {
  onLogin: () => void
}

export default function AfiliatIntroPage({ onLogin }: Props) {
  const [defaults, setDefaults] = useState<PublicDefaults>(FALLBACK)

  useEffect(() => {
    let cancelled = false
    void supabase
      .rpc('get_affiliate_public_defaults')
      .then(({ data }) => {
        if (cancelled || !data) return
        const d = data as Partial<PublicDefaults>
        setDefaults({
          setup_bps: d.setup_bps ?? FALLBACK.setup_bps,
          recurring_bps: d.recurring_bps ?? FALLBACK.recurring_bps,
          recurring_cap_months: d.recurring_cap_months ?? FALLBACK.recurring_cap_months,
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const pct = (bps: number) => (bps / 100).toLocaleString('ro-RO') + '%'

  return (
    <div style={{ minHeight: '100vh', background: MKT.bg, fontFamily: 'DM Sans,sans-serif' }}>
      <MarketingHeader onBack={() => (window.location.href = '/')} cta={{ label: 'Înscrie-te', onClick: onLogin }} />

      <main style={{ maxWidth: 880, margin: '0 auto', padding: '48px 20px 72px' }}>
        {/* Hero */}
        <RevealItem>
          <div style={{ textAlign: 'center', marginBottom: 44 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: MKT.accent,
                marginBottom: 14,
              }}
            >
              Program de parteneriat
            </div>
            <h1
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 'clamp(1.9rem, 4.5vw, 3rem)',
                color: MKT.text,
                margin: '0 0 14px',
                letterSpacing: '-0.02em',
                lineHeight: 1.15,
              }}
            >
              Cunoști restaurante?
              <br />
              Câștigă recomandându-le Menuvia.
            </h1>
            <p style={{ color: MKT.text2, fontSize: '1.05rem', lineHeight: 1.6, maxWidth: 560, margin: '0 auto' }}>
              Primești comision din fiecare local adus — o dată la activare, apoi lunar. Fără
              obligații, fără target, fără costuri.
            </p>
          </div>
        </RevealItem>

        {/* Procentele reale — cifrele vând, nu textul generic. */}
        <RevealItem>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 14,
              marginBottom: 48,
            }}
          >
            <div style={statCard}>
              <div style={statValue}>{pct(defaults.setup_bps)}</div>
              <div style={statLabel}>din prima factură a fiecărui restaurant adus</div>
            </div>
            <div style={statCard}>
              <div style={statValue}>{pct(defaults.recurring_bps)}</div>
              <div style={statLabel}>din abonament, în fiecare lună</div>
            </div>
            <div style={statCard}>
              <div style={statValue}>{defaults.recurring_cap_months} luni</div>
              <div style={statLabel}>durata comisionului lunar, per restaurant</div>
            </div>
          </div>
        </RevealItem>

        {/* Cum funcționează */}
        <RevealItem>
          <h2
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: '1.5rem',
              color: MKT.text,
              textAlign: 'center',
              margin: '0 0 24px',
            }}
          >
            Cum funcționează
          </h2>
        </RevealItem>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 48 }}>
          {STEPS.map((s, i) => (
            <RevealItem key={s.title}>
              <div
                style={{
                  display: 'flex',
                  gap: 16,
                  alignItems: 'flex-start',
                  background: MKT.surface,
                  border: `1px solid ${MKT.border}`,
                  borderRadius: 14,
                  padding: '18px 20px',
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    background: MKT.accentSoft,
                    color: MKT.accent,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontFamily: 'Fraunces,serif',
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: MKT.text, marginBottom: 4 }}>{s.title}</div>
                  <div style={{ color: MKT.text2, fontSize: '0.9rem', lineHeight: 1.55 }}>{s.text}</div>
                </div>
              </div>
            </RevealItem>
          ))}
        </div>

        {/* Detalii oneste — hold-uri și facturare, fără surprize la payout. */}
        <RevealItem>
          <div
            style={{
              background: MKT.surface2,
              borderRadius: 14,
              padding: '18px 20px',
              marginBottom: 48,
              color: MKT.text2,
              fontSize: '0.85rem',
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: MKT.text }}>Bine de știut:</strong> comisionul de activare are o
            perioadă de siguranță de 60 de zile, iar cel lunar de 14 zile (protecție anti-fraudă) —
            apoi devin plătibile. Plata se face pe bază de factură emisă de tine către Menuvia. Poți
            recruta și sub-parteneri, din panoul tău, după înscriere.
          </div>
        </RevealItem>

        {/* CTA final */}
        <RevealItem>
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={onLogin}
              className="pressable hover-lift"
              style={{
                background: MKT.accent,
                color: MKT.onAccent,
                border: 'none',
                borderRadius: 12,
                padding: '15px 34px',
                fontSize: '1rem',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
              }}
            >
              Înscrie-te în program →
            </button>
            <div style={{ color: MKT.text3, fontSize: '0.78rem', marginTop: 10 }}>
              Ai nevoie doar de un cont — durează un minut. Dacă ai deja cont, te autentifici și
              continui de unde ai rămas.
            </div>
          </div>
        </RevealItem>
      </main>

      <MarketingFooter />
    </div>
  )
}

const statCard: React.CSSProperties = {
  background: MKT.surface,
  border: `1px solid ${MKT.border}`,
  borderRadius: 14,
  padding: '22px 20px',
  textAlign: 'center',
}

const statValue: React.CSSProperties = {
  fontFamily: 'Fraunces, Georgia, serif',
  fontSize: '2.2rem',
  fontWeight: 600,
  color: MKT.accent,
  marginBottom: 6,
}

const statLabel: React.CSSProperties = {
  color: MKT.text2,
  fontSize: '0.82rem',
  lineHeight: 1.45,
}
