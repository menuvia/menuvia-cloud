// =============================================================
// CaseDeMarcatPage — /case-de-marcat (SEO programatic v1, EXPANSION E2)
//
// Ținta de căutare: „meniu digital + casa de marcat {Datecs/Activa/Tremol}"
// — intenție comercială mare, concurență mică. Mesajul e diferențiatorul
// central Menuvia („păstrezi casa ta"), cu compatibilitatea prin puntea
// FiscalNet prezentată ONEST ca pilot (regula de copy din CLAUDE.md).
// Important: Menuvia funcționează cu ORICE casă și FĂRĂ punte — bonul se
// dă de pe casă ca până acum; puntea automată e opțiunea premium.
// Stil: paleta MKT + MarketingHeader/Footer, ca VerticalPage/Comparatie.
// =============================================================
import { useEffect } from 'react'
import { MKT } from '../lib/marketing'
import { RevealItem } from '../components/marketing/Reveal'
import MarketingHeader from '../components/marketing/MarketingHeader'
import MarketingFooter from '../components/marketing/MarketingFooter'
import { Icon } from '../components/ui/Icon'

interface Props {
  navigate: (path: string) => void
}

// Casele acoperite de puntea FiscalNet (docs/BRIDGE_FISCALNET_ARCHITECTURE.md).
// NU adăuga mărci neverificate — pagina promite doar ce acoperă puntea.
const REGISTERS: { brand: string; note: string }[] = [
  { brand: 'Datecs', note: 'gama fiscală curentă, prin FiscalNet' },
  { brand: 'Activa', note: 'modelele cu FiscalNet', },
  { brand: 'Tremol', note: 'modelele cu FiscalNet' },
  { brand: 'Custom (Q3X)', note: 'prin FiscalNet' },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Trebuie să-mi schimb casa de marcat ca să folosesc Menuvia?',
    a: 'Nu. Menuvia funcționează cu orice casă de marcat: comenzile vin din telefonul clientului în bucătărie, iar bonul îl dai de pe casa ta, exact ca până acum. Puntea automată (bonul iese singur din comandă) e un pas opțional, pentru planul Fiscalizare.',
  },
  {
    q: 'Ce este FiscalNet?',
    a: 'Un software de fiscalizare de la EconMedia, folosit de integratori din toată țara: primește comanda ca fișier și o trimite casei de marcat. Menuvia scrie exact în formatul FiscalNet — de aceea aceeași integrare acoperă mai multe mărci de case.',
  },
  {
    q: 'Am altă marcă de casă. Rămân pe dinafară?',
    a: 'Deloc — folosești Menuvia complet (meniu, comenzi, rapoarte), doar bonul rămâne manual, pe casa ta. Iar dacă localul tău folosește deja FiscalNet cu altă casă, scrie-ne: puntea lucrează cu formatul FiscalNet, nu cu o marcă anume.',
  },
  {
    q: 'În ce stadiu e integrarea?',
    a: 'Puntea de fiscalizare e în pilot — o pornim împreună cu primele localuri, cu suport direct de la fondator. Restul platformei (meniu QR, comenzi, rapoarte) e live și nu depinde de punte.',
  },
]

export default function CaseDeMarcatPage({ navigate }: Props) {
  useEffect(() => {
    const prev = document.title
    document.title =
      'Meniu digital compatibil cu casa ta de marcat — Datecs, Activa, Tremol | Menuvia'
    return () => {
      document.title = prev
    }
  }, [])

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
        cta={{ label: 'Începe gratuit', onClick: () => navigate('/auth?lang=ro') }}
      />

      {/* ── Hero ─────────────────────────────────────────────── */}
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
              borderRadius: 999,
              marginBottom: 20,
            }}
          >
            Compatibilitate case de marcat
          </div>
          <h1
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 'clamp(30px, 6vw, 52px)',
              lineHeight: 1.08,
              fontWeight: 600,
              margin: '0 0 18px',
              letterSpacing: '-0.02em',
            }}
          >
            Merge cu casa de marcat pe care o ai deja
          </h1>
          <p
            style={{
              fontSize: 'clamp(16px, 2.4vw, 19px)',
              lineHeight: 1.55,
              color: MKT.text2,
              margin: '0 auto 28px',
              maxWidth: 640,
            }}
          >
            Menuvia nu îți cere să schimbi nimic: comenzile din meniul QR ajung în bucătărie,
            iar bonul iese pe casa ta. Pentru casele de mai jos pregătim și puntea automată
            (pilot FiscalNet) — bonul fiscal direct din comandă.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => navigate('/auth?lang=ro')}
              className="pressable"
              style={{
                background: MKT.accent,
                color: MKT.onAccent,
                border: 'none',
                borderRadius: 12,
                padding: '14px 26px',
                fontSize: 16,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Începe gratuit 30 de zile
            </button>
            <button
              onClick={() => navigate('/comparatie')}
              className="pressable"
              style={{
                background: 'transparent',
                color: MKT.text,
                border: `1px solid ${MKT.border}`,
                borderRadius: 12,
                padding: '14px 26px',
                fontSize: 16,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              De ce Menuvia
            </button>
          </div>
        </div>
      </section>

      {/* ── Grila de compatibilitate ─────────────────────────── */}
      <section style={{ padding: '24px 20px 40px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 14,
            }}
          >
            {REGISTERS.map((r, i) => (
              <RevealItem key={r.brand} delay={i * 60}>
                <div
                  style={{
                    background: MKT.surface,
                    border: `1px solid ${MKT.border}`,
                    borderRadius: 14,
                    padding: '18px 16px',
                    textAlign: 'center',
                    height: '100%',
                    boxSizing: 'border-box',
                  }}
                >
                  <div
                    style={{
                      display: 'inline-flex',
                      width: 42,
                      height: 42,
                      borderRadius: 11,
                      background: MKT.accentSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 10,
                    }}
                  >
                    <Icon name="printer" size={20} color={MKT.accentInk} />
                  </div>
                  <div
                    style={{
                      fontFamily: 'Fraunces, serif',
                      fontWeight: 600,
                      fontSize: 18,
                      marginBottom: 4,
                    }}
                  >
                    {r.brand}
                  </div>
                  <div style={{ fontSize: 13, color: MKT.text2 }}>{r.note}</div>
                  <div
                    style={{
                      display: 'inline-block',
                      marginTop: 10,
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: MKT.accentInk,
                      background: MKT.accentSoft,
                      padding: '4px 10px',
                      borderRadius: 999,
                    }}
                  >
                    Punte în pilot
                  </div>
                </div>
              </RevealItem>
            ))}
          </div>
          <p
            style={{
              fontSize: 13,
              color: MKT.text3,
              textAlign: 'center',
              marginTop: 14,
              lineHeight: 1.5,
            }}
          >
            Altă marcă? Menuvia funcționează complet și fără punte — bonul îl dai de pe casa
            ta, ca până acum.
          </p>
        </div>
      </section>

      {/* ── Cum funcționează puntea ──────────────────────────── */}
      <section style={{ padding: '48px 20px', background: MKT.surface2 }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 'clamp(24px, 4vw, 34px)',
              fontWeight: 600,
              margin: '0 0 28px',
              textAlign: 'center',
              letterSpacing: '-0.01em',
            }}
          >
            Cum ajunge comanda pe bonul fiscal
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              {
                t: 'Clientul comandă din meniul QR',
                d: 'Comanda apare instant pe ecranul bucătăriei și al ospătarului — fără aparatură nouă.',
              },
              {
                t: 'La plată, Menuvia trimite comanda către FiscalNet',
                d: 'Puntea rulează pe calculatorul unde stă deja FiscalNet — nu instalezi nimic pe casă.',
              },
              {
                t: 'Bonul iese pe casa TA de marcat',
                d: 'Aceleași cote de TVA, același jurnal fiscal — doar fără retastat comanda de mână.',
              },
            ].map((s, i) => (
              <RevealItem key={s.t} delay={i * 60}>
                <div
                  style={{
                    display: 'flex',
                    gap: 16,
                    alignItems: 'flex-start',
                    background: MKT.surface,
                    border: `1px solid ${MKT.border}`,
                    borderRadius: 14,
                    padding: '18px 16px',
                  }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      width: 34,
                      height: 34,
                      borderRadius: '50%',
                      background: MKT.accentSoft,
                      color: MKT.accentInk,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: 15,
                      fontFamily: 'Fraunces, serif',
                    }}
                  >
                    {i + 1}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{s.t}</div>
                    <div style={{ fontSize: 14, color: MKT.text2, lineHeight: 1.5 }}>{s.d}</div>
                  </div>
                </div>
              </RevealItem>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section style={{ padding: '48px 20px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 'clamp(22px, 3.4vw, 30px)',
              fontWeight: 600,
              margin: '0 0 24px',
              textAlign: 'center',
            }}
          >
            Întrebări frecvente
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {FAQ.map((f) => (
              <div
                key={f.q}
                style={{
                  background: MKT.surface,
                  border: `1px solid ${MKT.border}`,
                  borderRadius: 14,
                  padding: '16px 18px',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{f.q}</div>
                <div style={{ fontSize: 14, color: MKT.text2, lineHeight: 1.55 }}>{f.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA final ────────────────────────────────────────── */}
      <section style={{ padding: '40px 20px 64px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 'clamp(24px, 4vw, 34px)',
              fontWeight: 600,
              margin: '0 0 14px',
            }}
          >
            Păstrează casa. Modernizează restul.
          </h2>
          <p style={{ fontSize: 16, color: MKT.text2, margin: '0 0 24px', lineHeight: 1.55 }}>
            30 de zile gratuit, anulezi oricând. Pentru punte, alege planul Fiscalizare și
            discutăm direct.
          </p>
          <button
            onClick={() => navigate('/auth?lang=ro')}
            className="pressable"
            style={{
              background: MKT.accent,
              color: MKT.onAccent,
              border: 'none',
              borderRadius: 12,
              padding: '15px 30px',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            Începe gratuit
          </button>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
