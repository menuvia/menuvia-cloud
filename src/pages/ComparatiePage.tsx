// =============================================================
// ComparatiePage — „De ce Menuvia" (pagină de comparație + poziționare)
//
// Mesajul central, pe care nimeni din piață nu-l spune la fel:
//   „Păstrezi casa de marcat și POS-ul pe care le ai."
//
// Comparația e pe CATEGORII de soluții (meniu digital simplu / self-order·POS
// nou), NU pe nume de competitori cu bife lipsă — o pagină publică care
// afirmă că un competitor anume „nu are" X e reclamă comparativă cu risc
// legal (RO/UE cer ca fiecare afirmație să fie verificabilă). Cadrul pe
// categorii păstrează forța poziționării, rămâne onest și fără expunere.
//
// Stil: paleta MKT (marketing, cald) + MarketingHeader/Footer, ca Landing/
// Pricing. Tabel responsive: pe mobil scroll orizontal cu prima coloană
// sticky (pattern din PricingPage).
// =============================================================
import { MKT } from '../lib/marketing'
import { RevealItem } from '../components/marketing/Reveal'
import MarketingHeader from '../components/marketing/MarketingHeader'
import MarketingFooter from '../components/marketing/MarketingFooter'
import { Icon } from '../components/ui/Icon'

interface Props {
  navigate: (path: string) => void
}

// Valoare de celulă: boolean → bifă verde / liniuță gri; string → text scurt
// (ex. „Pilot", „Variabil") acolo unde un boolean ar supra-promite.
function Cell({ value }: { value: string | boolean }) {
  if (typeof value === 'boolean') {
    return value ? (
      <Icon name="check" size={18} color={MKT.success} label="Da" />
    ) : (
      <Icon name="minus" size={18} color={MKT.text3} label="Nu" />
    )
  }
  return <span style={{ fontSize: 13, color: MKT.text2, fontWeight: 600 }}>{value}</span>
}

// Coloanele de comparație — categorii de soluții, nu branduri.
const COLUMNS = ['Menuvia', 'Meniu digital simplu', 'Self-order / POS nou'] as const

// Rândurile: caracteristică + valoarea pe fiecare categorie. Onest —
// fiscalizarea Menuvia e „Pilot" (FiscalNet), nu o bifă plină.
const ROWS: { feature: string; values: [string | boolean, string | boolean, string | boolean] }[] = [
  { feature: 'Meniu digital cu QR', values: [true, true, true] },
  { feature: 'Comenzi de la masă, în timp real', values: [true, false, true] },
  { feature: 'Fără comision per comandă', values: [true, true, 'Variabil'] },
  { feature: 'Fără hardware nou (nici tabletă, nici terminal)', values: [true, true, false] },
  { feature: 'Păstrezi casa de marcat și POS-ul actual', values: ['Pilot FiscalNet', '—', false] },
  { feature: 'Preț public, pornești singur (self-serve)', values: [true, 'Variabil', false] },
  { feature: 'Rezervări + hartă sală + pre-comandă', values: [true, false, 'Uneori'] },
  { feature: 'AI: meniu din poze, recomandări, nutriție', values: [true, false, 'Rar'] },
  { feature: 'Suport în română, direct de la fondator', values: [true, 'Variabil', 'Variabil'] },
  { feature: 'Program de parteneriat (recomanzi, câștigi)', values: [true, '—', '—'] },
]

export default function ComparatiePage({ navigate }: Props) {
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
        cta={{ label: 'Începe gratuit', onClick: () => navigate('/auth') }}
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
            De ce Menuvia
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
            Păstrezi casa de marcat și POS-ul pe care le ai.
          </h1>
          <p
            style={{
              fontSize: 'clamp(16px, 2.4vw, 19px)',
              lineHeight: 1.55,
              color: MKT.text2,
              margin: '0 auto 28px',
              maxWidth: 620,
            }}
          >
            Meniu QR + comenzi direct la masă, fără să schimbi nimic din ce funcționează
            deja în local. Fără terminal nou, fără comision per comandă, cu preț public și
            pornire în câteva minute.
          </p>
          <div
            style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={() => navigate('/auth')}
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
              onClick={() => navigate('/pricing')}
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
              Vezi prețurile
            </button>
          </div>
        </div>
      </section>

      {/* ── Tabel comparativ ─────────────────────────────────── */}
      <section style={{ padding: '20px 20px 56px' }}>
        <div style={{ maxWidth: 920, margin: '0 auto' }}>
          <RevealItem>
            <div
              style={{
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                border: `1px solid ${MKT.border}`,
                borderRadius: 16,
                background: MKT.surface,
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  minWidth: 560,
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        position: 'sticky',
                        left: 0,
                        background: MKT.surface,
                        textAlign: 'left',
                        padding: '16px 14px',
                        fontSize: 13,
                        fontWeight: 700,
                        color: MKT.text3,
                        borderBottom: `1px solid ${MKT.border}`,
                        minWidth: 210,
                      }}
                    >
                      Caracteristică
                    </th>
                    {COLUMNS.map((col, i) => (
                      <th
                        key={col}
                        style={{
                          padding: '16px 14px',
                          fontSize: 14,
                          fontWeight: i === 0 ? 800 : 600,
                          color: i === 0 ? MKT.accentInk : MKT.text2,
                          textAlign: 'center',
                          borderBottom: `1px solid ${MKT.border}`,
                          background: i === 0 ? MKT.accentSoft : MKT.surface,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row, ri) => {
                    const isLast = ri === ROWS.length - 1
                    return (
                      <tr key={row.feature}>
                        <td
                          style={{
                            position: 'sticky',
                            left: 0,
                            background: MKT.surface,
                            padding: '14px',
                            fontSize: 14,
                            color: MKT.text,
                            fontWeight: 500,
                            borderBottom: isLast ? 'none' : `1px solid ${MKT.border}`,
                          }}
                        >
                          {row.feature}
                        </td>
                        {row.values.map((v, ci) => (
                          <td
                            key={ci}
                            style={{
                              padding: '14px',
                              textAlign: 'center',
                              borderBottom: isLast ? 'none' : `1px solid ${MKT.border}`,
                              background: ci === 0 ? MKT.accentSoft : MKT.surface,
                            }}
                          >
                            <Cell value={v} />
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </RevealItem>
          <p
            style={{
              fontSize: 12,
              color: MKT.text3,
              marginTop: 12,
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            Comparație pe categorii de soluții, nu pe furnizori anume. Fiscalizarea prin
            casa ta rulează în pilot (punte FiscalNet).
          </p>
        </div>
      </section>

      {/* ── „Păstrezi casa de marcat" — explicație ───────────── */}
      <section style={{ padding: '48px 20px', background: MKT.surface2 }}>
        <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 'clamp(24px, 4vw, 34px)',
              fontWeight: 600,
              margin: '0 0 16px',
              letterSpacing: '-0.01em',
            }}
          >
            Nu-ți cerem să arunci nimic
          </h2>
          <p style={{ fontSize: 17, lineHeight: 1.6, color: MKT.text2, margin: '0 0 28px' }}>
            Multe soluții „inteligente" vin cu un terminal nou, un POS nou sau o casă de
            marcat nouă. Menuvia stă peste ce ai deja: comanda pleacă din telefonul
            clientului direct în bucătărie, iar bonul iese pe casa ta prin puntea FiscalNet
            (în pilot). Zero echipament în plus, zero recalificat personalul.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 16,
              textAlign: 'left',
            }}
          >
            {[
              {
                t: 'Casa ta rămâne casa ta',
                d: 'Punte software către FiscalNet — nu înlocuim casa de marcat, o alimentăm.',
              },
              {
                t: 'POS-ul actual rămâne',
                d: 'Menuvia e stratul de comandă de la masă, nu un POS care cere migrare.',
              },
              {
                t: 'Pornești singur',
                d: 'Cont, meniu, cod QR — în câteva minute, fără vânzător și fără instalare.',
              },
            ].map((c) => (
              <div
                key={c.t}
                style={{
                  background: MKT.surface,
                  border: `1px solid ${MKT.border}`,
                  borderRadius: 14,
                  padding: '18px 16px',
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: MKT.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 12,
                  }}
                >
                  <Icon name="check" size={20} color={MKT.accentInk} />
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{c.t}</div>
                <div style={{ fontSize: 14, color: MKT.text2, lineHeight: 1.5 }}>{c.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA final ────────────────────────────────────────── */}
      <section style={{ padding: '56px 20px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 'clamp(24px, 4vw, 34px)',
              fontWeight: 600,
              margin: '0 0 14px',
            }}
          >
            Vezi singur, fără risc
          </h2>
          <p style={{ fontSize: 16, color: MKT.text2, margin: '0 0 24px', lineHeight: 1.55 }}>
            30 de zile gratuit, anulezi oricând. Fără card la înscriere.
          </p>
          <button
            onClick={() => navigate('/auth')}
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
