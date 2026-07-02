import React from 'react'
import { useAuth } from '../contexts/AuthContext'
import { PLANS as COMMERCIAL_PLANS, TRUST_SIGNALS, getPlanByInternalId } from '../lib/plans'
import { MKT, whatsappUrl } from '../lib/marketing'
import { writePlanIntent } from '../lib/planIntent'
import { MOTION } from '../lib/motion'
import { RevealItem } from '../components/marketing/Reveal'

// Auto-trigger checkout după login: dacă userul ajunge pe /pricing logat și
// avem plan_intent în sessionStorage (setat înainte de /auth), pornim imediat
// Stripe Checkout pe planul țintă. Asta închide bucla pricing→auth→checkout.
//
// Întoarce planul în curs de checkout (sau null) — PricingPage îl folosește
// ca FLASH GUARD: cât timp e non-null, randează un loader centrat în locul
// card-urilor, ca userul să nu vadă pricing-ul o fracțiune de secundă
// înainte de redirect-ul Stripe. Intent-ul e citit SINCRON la inițializarea
// state-ului (înaintea primului paint), nu într-un effect — de-asta nu
// există flash. 'pro' (Fiscalizare) e pilot → niciodată auto-checkout.
function usePlanIntentAutoCheckout(
  user: { id: string } | null,
  onCheckout: (plan: string) => void | Promise<void>,
): string | null {
  const [pendingPlan, setPendingPlan] = React.useState<string | null>(() => {
    try {
      const i = sessionStorage.getItem('menuvia.plan_intent')
      return i === 'starter' || i === 'growth' ? i : null
    } catch {
      return null
    }
  })

  React.useEffect(() => {
    if (!user || pendingPlan == null) return
    try {
      sessionStorage.removeItem('menuvia.plan_intent')
    } catch {
      /* ignore */
    }
    let alive = true
    // Dacă checkout-ul reușește, pagina navighează la Stripe și cleanup-ul
    // nu mai contează. Dacă eșuează (sau Stripe nu e configurat), curățăm
    // guard-ul ca pricing-ul să se afișeze normal.
    Promise.resolve(onCheckout(pendingPlan))
      .catch(() => undefined)
      .then(() => {
        if (alive) setPendingPlan(null)
      })
    return () => {
      alive = false
    }
  }, [user, pendingPlan, onCheckout])

  // Guard activ doar pentru useri logați — anonimii văd pricing-ul normal
  // chiar dacă au un intent vechi în session (îl vor consuma după login).
  return user ? pendingPlan : null
}

export default function PricingPage({
  onBack,
  onLogin,
  onCheckout,
}: {
  onBack: () => void
  onLogin: () => void
  onCheckout: (plan: string) => void
}) {
  const { user } = useAuth()
  const checkingOutPlan = usePlanIntentAutoCheckout(user, onCheckout)
  const [yearly, setYearly] = React.useState(false)
  const [loadingPlan, setLoadingPlan] = React.useState<string | null>(null)
  const [openFaq, setOpenFaq] = React.useState<number | null>(null)

  // Single source of truth pentru pricing: src/lib/plans.ts.
  // Adapter local — păstrăm shape-ul renderului existent (features {t,ok})
  // ca diff-ul să fie minim. CTA-urile injectează planul-țintă în
  // sessionStorage înainte de /auth, ca user-ul să fie dus direct la
  // checkout-ul corect după login.
  const PLANS: Array<{
    id: string
    name: string
    emoji: string
    price: number | null
    priceYearly: number | null
    badge: string | null
    desc: string
    features: { t: string; ok: boolean }[]
    cta: string
    ctaFn: () => void | Promise<void>
    highlight: boolean
  }> = COMMERCIAL_PLANS.map((p) => ({
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    price: p.priceMonthly,
    priceYearly: p.priceYearly,
    badge: p.badge,
    desc: p.tagline,
    features: [
      ...p.included.map((t) => ({ t, ok: true })),
      ...p.notIncluded.map((t) => ({ t, ok: false })),
    ],
    cta: p.ctaLabel,
    ctaFn: () => {
      if (p.id === 'pro') {
        // Fiscalizarea e pilot — WhatsApp dacă e configurat, altfel checkout.
        const url = whatsappUrl('Salut Radu, mă interesează planul Fiscalizare (pilot)')
        if (url) window.open(url, '_blank')
        else void onCheckout('pro')
        return
      }
      writePlanIntent(p.id)
      // Tier 1+2: dacă userul nu e logat, mergem la auth (cu ?plan=) — App
      // intercepta deja onCheckout pentru anon. Logat: direct la Stripe.
      void onCheckout(p.id)
    },
    highlight: p.highlight,
  }))

  const EXTRAS_ONETIME = [
    {
      icon: '🎯',
      title: 'Setup Concierge',
      price: '300 lei',
      desc: 'Vine Radu personal: configurare restaurant, meniu, QR, training echipă. O zi.',
    },
    {
      icon: '📸',
      title: 'Import meniu profesional',
      price: '150 lei',
      desc: 'Trimiți pozele meniului vechi. Îl adăugăm noi în 24h.',
    },
    {
      icon: '🎨',
      title: 'Design personalizat',
      price: '300 lei',
      desc: 'Culori, logo, fonturi adaptate brandului tău.',
    },
    {
      icon: '📦',
      title: 'QR-uri printate premium',
      price: '100 lei',
      desc: '30 QR-uri laminate + suporți plastic. Livrare gratuită Sibiu/Focșani.',
    },
  ]

  const EXTRAS_MONTHLY = [
    {
      icon: '💳',
      title: 'Plăți online prin QR (în curând)',
      price: 'În curând',
      plans: 'Meniu + Comenzi, Fiscalizare',
      desc: 'Clientul va plăti direct cu cardul, bacșiș integrat. În dezvoltare — momentan plata se face cash sau card la POS.',
    },
    {
      icon: '🔌',
      title: 'Integrare casă de marcat (pilot)',
      price: '+99 lei/lună',
      plans: 'Doar Fiscalizare',
      desc: 'Conectare cu Datecs / Activa / Tremol prin FiscalNet. În pilot — disponibil pe bază de cerere, nu activat automat.',
    },
  ]

  const BONUSES = [
    { icon: '🔄', title: 'Migrare gratuită', desc: 'Vă mutăm meniul de la alt sistem.' },
    { icon: '💰', title: '30 zile garanție', desc: 'Bani înapoi integrali. Fără întrebări.' },
    { icon: '📄', title: 'QR-uri PDF', desc: 'Regenerați PDF-urile oricând, gratis.' },
    { icon: '🔁', title: 'Schimb plan oricând', desc: 'Upgrade/downgrade fără penalizări.' },
    { icon: '💾', title: 'Backup automat zilnic', desc: 'Nu pierdeți niciodată date.' },
    { icon: '🔒', title: 'GDPR + securitate', desc: 'HTTPS, RLS, conformitate completă.' },
    {
      icon: '🎁',
      title: 'Refferal: 1 lună gratis',
      desc: 'Recomandă un restaurant, primiți amândoi.',
    },
    { icon: '📞', title: 'Suport WhatsApp direct', desc: 'Cu Radu personal, răspuns în 24h.' },
  ]

  const FAQ = [
    {
      q: 'Ce se întâmplă după cele 30 de zile gratuite?',
      a: 'Dacă nu ești mulțumit, anulezi cu un click. Fără penalizări. Datele tale sunt disponibile pentru export 30 de zile după anulare.',
    },
    {
      q: 'Care plan e potrivit pentru mine?',
      a: 'Meniu Digital dacă vrei doar un meniu citibil pe telefon. Meniu + Comenzi dacă vrei ca clienții să comande singuri prin QR (plata rămâne pe casa ta) — cel mai popular. Fiscalizare dacă vrei plăți și bon fiscal direct din aplicație — disponibil în pilot.',
    },
    {
      q: 'Pot schimba planul oricând?',
      a: 'Da. Upgrade sau downgrade instant. Diferența se calculează proporțional pe factura următoare.',
    },
    {
      q: 'Plătesc per restaurant sau cont?',
      a: 'Per restaurant. Fiecare locație are abonamentul propriu. Pentru lanțuri cu 3+ locații, scrie-ne — facem ofertă custom.',
    },
    {
      q: 'Este necesar hardware special?',
      a: 'Nu. Funcționează pe orice telefon sau tabletă. Pentru bucătărie merge orice ecran.',
    },
    {
      q: 'Cum se generează QR-urile?',
      a: 'Automat din dashboard. PDF gata de printat în 30 de secunde.',
    },
    {
      q: 'Garantați prețul?',
      a: 'Pentru clienții actuali, prețul rămâne fix pe perioada planului. Modificările de preț se aplică doar la noi clienți.',
    },
    {
      q: 'Aveți integrare cu casă de marcat?',
      a: 'În pilot, pe planul Fiscalizare (+99 lei/lună). Suportăm Datecs, Activa și Tremol prin protocolul FiscalNet. Disponibil pe bază de cerere — ne asigurăm împreună că emiterea bonurilor funcționează corect pe casa ta înainte de activare.',
    },
    {
      q: 'Sunteți pe piață de mult?',
      a: 'Suntem o echipă mică din România, construim Menuvia full-time. Pentru primii patroni avem program pilot extins (60 zile gratis) și suport direct WhatsApp cu Radu, fondatorul.',
    },
  ]

  // Flash guard: user logat cu plan intent activ → loader, nu card-urile.
  if (checkingOutPlan != null) {
    const targetName = getPlanByInternalId(checkingOutPlan).name
    return (
      <div
        style={{
          minHeight: '100vh',
          background: MKT.bg,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          fontFamily: 'DM Sans,sans-serif',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            border: `3px solid ${MKT.border}`,
            borderTopColor: MKT.accent,
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>
        <div style={{ color: MKT.text, fontSize: '1.05rem', fontWeight: 600 }}>
          Se pregătește checkout-ul pentru {targetName}...
        </div>
        <div style={{ color: MKT.text3, fontSize: '0.88rem' }}>
          Te redirecționăm către plata securizată.
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: MKT.bg,
        fontFamily: 'DM Sans,sans-serif',
        color: MKT.text,
      }}
    >
      {/* Header */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 0' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 64,
          }}
        >
          <button
            onClick={onBack}
            style={{
              background: 'none',
              border: 'none',
              color: MKT.text2,
              cursor: 'pointer',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'DM Sans,sans-serif',
            }}
          >
            ← Înapoi
          </button>
          <span
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.2rem',
              color: MKT.text,
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            Menuvia
          </span>
          <button
            onClick={onLogin}
            style={{
              background: 'none',
              border: 'none',
              color: MKT.text2,
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontFamily: 'DM Sans,sans-serif',
            }}
          >
            Autentificare
          </button>
        </div>

        {/* Hero */}
        <div style={{ textAlign: 'center', maxWidth: 700, margin: '0 auto 56px' }}>
          <h1
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 'clamp(2.1rem, 5.5vw, 3.4rem)',
              color: MKT.text,
              fontWeight: 700,
              marginBottom: 16,
              letterSpacing: '-0.03em',
              lineHeight: 1.08,
              textWrap: 'balance',
            }}
          >
            Prețuri simple pentru restaurante care vor meniu QR și comenzi la masă
          </h1>
          <p
            style={{
              color: MKT.text2,
              fontSize: '1.1rem',
              marginBottom: 32,
              lineHeight: 1.6,
              fontWeight: 400,
              textWrap: 'balance',
            }}
          >
            30 de zile gratuite pe orice plan. Anulezi cu un click, fără penalizări.
          </p>

          {/* Yearly toggle */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 14,
              background: MKT.surface,
              border: `1px solid ${MKT.border}`,
              borderRadius: 100,
              padding: '7px 18px',
              boxShadow: '0 1px 3px rgba(26,18,8,0.04)',
            }}
          >
            <span
              style={{
                fontSize: '0.9rem',
                color: yearly ? MKT.text3 : MKT.text,
                fontWeight: yearly ? 400 : 600,
                transition: 'all 0.2s',
              }}
            >
              Lunar
            </span>
            <button
              onClick={() => setYearly((y) => !y)}
              aria-label="Schimbă între facturare lunară și anuală"
              style={{
                width: 48,
                height: 26,
                borderRadius: 13,
                background: yearly ? MKT.accent : MKT.border,
                border: 'none',
                position: 'relative',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 3,
                  left: yearly ? 25 : 3,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                }}
              />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span
                style={{
                  fontSize: '0.9rem',
                  color: yearly ? MKT.text : MKT.text3,
                  fontWeight: yearly ? 600 : 400,
                  transition: 'all 0.2s',
                }}
              >
                Anual
              </span>
              <span
                style={{
                  fontSize: '0.7rem',
                  background: MKT.successSoft,
                  color: MKT.success,
                  padding: '2px 9px',
                  borderRadius: 100,
                  fontWeight: 700,
                }}
              >
                −17%
              </span>
            </div>
          </div>
        </div>

        {/* Pilot Program banner */}
        <div
          style={{
            maxWidth: 720,
            margin: '0 auto 32px',
            padding: '18px 22px',
            background: MKT.accentSoft,
            border: `1px solid ${MKT.accent}`,
            borderRadius: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 28, lineHeight: 1 }}>🎁</span>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: '1.05rem',
                color: MKT.text,
                fontWeight: 600,
                marginBottom: 3,
              }}
            >
              Program Pilot — 60 de zile gratis
            </div>
            <div style={{ fontSize: '0.85rem', color: MKT.text2, lineHeight: 1.5 }}>
              Primii 10 patroni primesc setup personal cu Radu și 60 zile gratis pe Meniu + Comenzi. Locuri
              rămase: limitate.
            </div>
          </div>
          {(() => {
            const url = whatsappUrl('Salut Radu, m-ar interesa programul pilot Menuvia')
            if (!url) return null
            return (
              <button
                onClick={() => window.open(url, '_blank')}
                className="pressable"
                style={{
                  background: MKT.accent,
                  color: MKT.onAccent,
                  border: 'none',
                  borderRadius: 100,
                  padding: '10px 18px',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'DM Sans,sans-serif',
                  whiteSpace: 'nowrap',
                }}
              >
                Vorbește cu Radu →
              </button>
            )
          })()}
        </div>

        {/* Plans grid */}
        <RevealItem
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 18,
            marginBottom: 24,
          }}
        >
          {PLANS.map((p, idx) => {
            const price = yearly ? p.priceYearly : p.price
            const isContact = p.price === null
            const isHighlight = p.highlight
            // Tier 1 (primul plan, ne-highlight): tratament demn — bordură și
            // umbră mai prezente decât un card secundar oarecare, ca să nu
            // pară dezactivat lângă „Recomandat".
            const isTierOne = idx === 0 && !isHighlight
            return (
              <div
                key={p.id}
                className="hover-lift"
                style={{
                  background: MKT.surface,
                  borderRadius: 18,
                  padding: '32px 26px',
                  border: `1px solid ${isHighlight ? MKT.accent : isTierOne ? MKT.text3 : MKT.border}`,
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  boxShadow: isHighlight
                    ? '0 8px 32px rgba(200,150,60,0.18), 0 2px 8px rgba(26,18,8,0.05)'
                    : isTierOne
                      ? '0 4px 16px rgba(26,18,8,0.07)'
                      : '0 1px 3px rgba(26,18,8,0.04)',
                  transform: isHighlight ? 'translateY(-8px)' : 'none',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                }}
              >
                {p.badge && (
                  <div
                    style={{
                      position: 'absolute',
                      top: -13,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: MKT.accent,
                      color: MKT.onAccent,
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '5px 16px',
                      borderRadius: 100,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      whiteSpace: 'nowrap',
                      fontFamily: 'DM Sans,sans-serif',
                    }}
                  >
                    {p.badge}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: '1.4rem' }}>{p.emoji}</span>
                  <span
                    style={{
                      fontSize: '0.92rem',
                      fontWeight: 700,
                      color: MKT.text,
                      fontFamily: 'DM Sans,sans-serif',
                      letterSpacing: '0.01em',
                    }}
                  >
                    {p.name}
                  </span>
                </div>

                <div
                  style={{
                    marginBottom: 8,
                    minHeight: 64,
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 4,
                  }}
                >
                  {isContact ? (
                    <span
                      style={{
                        fontFamily: 'Fraunces,serif',
                        fontSize: '2.6rem',
                        color: MKT.text,
                        fontWeight: 600,
                        letterSpacing: '-0.02em',
                      }}
                    >
                      Contact
                    </span>
                  ) : (
                    <>
                      <span
                        style={{
                          fontFamily: 'Fraunces,serif',
                          fontSize: '3.2rem',
                          color: MKT.text,
                          fontWeight: 600,
                          letterSpacing: '-0.03em',
                          lineHeight: 1,
                        }}
                      >
                        {price}
                      </span>
                      <span
                        style={{
                          color: MKT.text3,
                          fontSize: '0.95rem',
                          fontFamily: 'DM Sans,sans-serif',
                        }}
                      >
                        lei/lună
                      </span>
                    </>
                  )}
                </div>

                {!isContact && yearly && p.price !== null && p.priceYearly !== null && (
                  <div
                    style={{
                      fontSize: '0.78rem',
                      color: MKT.success,
                      marginBottom: 8,
                      fontWeight: 500,
                    }}
                  >
                    Facturat anual — economisești {(p.price - p.priceYearly) * 12} lei/an
                  </div>
                )}

                <p
                  style={{
                    fontSize: '0.92rem',
                    color: MKT.text2,
                    lineHeight: 1.55,
                    marginBottom: 28,
                    minHeight: 50,
                  }}
                >
                  {p.desc}
                </p>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 11,
                    marginBottom: 28,
                    flex: 1,
                  }}
                >
                  {p.features.map((f) => (
                    <div
                      key={f.t}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 11,
                        fontSize: '0.92rem',
                        color: f.ok ? MKT.text : MKT.text3,
                        opacity: f.ok ? 1 : 0.55,
                      }}
                    >
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: f.ok ? MKT.successSoft : 'transparent',
                          border: `1.5px solid ${f.ok ? MKT.success : MKT.border}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.7rem',
                          color: f.ok ? MKT.success : MKT.text3,
                          flexShrink: 0,
                          marginTop: 2,
                          fontWeight: 700,
                        }}
                      >
                        {f.ok ? '✓' : '−'}
                      </span>
                      <span style={{ lineHeight: 1.5 }}>{f.t}</span>
                    </div>
                  ))}
                </div>

                <button
                  className="pressable"
                  disabled={loadingPlan === p.id}
                  onClick={async () => {
                    setLoadingPlan(p.id)
                    await p.ctaFn()
                    setLoadingPlan(null)
                  }}
                  style={{
                    width: '100%',
                    borderRadius: 12,
                    padding: '15px 0',
                    fontFamily: 'DM Sans,sans-serif',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    border: isHighlight
                      ? 'none'
                      : isTierOne
                        ? `1.5px solid ${MKT.accent}`
                        : `1.5px solid ${MKT.border}`,
                    background: isHighlight ? MKT.accent : isTierOne ? MKT.accentSoft : MKT.surface,
                    color: isHighlight ? '#fff' : isTierOne ? MKT.accent : MKT.text,
                    opacity: loadingPlan === p.id ? 0.6 : 1,
                    boxShadow: isHighlight
                      ? 'var(--shadow-gold-soft, 0 4px 14px rgba(200,150,60,0.3))'
                      : 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  {loadingPlan === p.id ? 'Se procesează...' : p.cta}
                </button>
              </div>
            )
          })}
        </RevealItem>

        {/* Trust signals — adevăruri verificabile, fără promisiuni vagi */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
            gap: 12,
            marginBottom: 22,
          }}
        >
          {TRUST_SIGNALS.map((t) => (
            <div
              key={t.label}
              style={{
                background: MKT.surface,
                border: `1px solid ${MKT.border}`,
                borderRadius: 12,
                padding: '14px 16px',
                fontFamily: 'DM Sans,sans-serif',
              }}
            >
              <div style={{ fontSize: '1.4rem', marginBottom: 6 }}>{t.icon}</div>
              <div style={{ color: MKT.text, fontSize: '0.88rem', fontWeight: 600 }}>{t.label}</div>
              <div style={{ color: MKT.text3, fontSize: '0.78rem', marginTop: 3, lineHeight: 1.45 }}>
                {t.desc}
              </div>
            </div>
          ))}
        </div>

        {/* Ghid de alegere: primele 2 planuri, în limbaj de patron */}
        <div
          style={{
            maxWidth: 720,
            margin: '0 auto 56px',
            background: MKT.surface,
            border: `1px solid ${MKT.border}`,
            borderRadius: 18,
            padding: '28px 28px',
          }}
        >
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.25rem',
              color: MKT.text,
              fontWeight: 700,
              marginBottom: 16,
              textAlign: 'center',
            }}
          >
            Nu știi ce să alegi?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>📖</span>
              <p style={{ color: MKT.text2, fontSize: '0.95rem', lineHeight: 1.6 }}>
                Alege <strong style={{ color: MKT.text }}>Meniu Digital</strong> dacă vrei doar să
                înlocuiești meniul fizic cu un meniu QR modern.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>🛎</span>
              <p style={{ color: MKT.text2, fontSize: '0.95rem', lineHeight: 1.6 }}>
                Alege <strong style={{ color: MKT.text }}>Meniu + Comenzi</strong> dacă vrei ca
                oamenii să poată comanda direct de la masă, iar bucătăria și ospătarii să vadă
                comenzile instant.
              </p>
            </div>
          </div>
        </div>

        {/* Custom / Enterprise inquiry */}
        {(() => {
          const url = whatsappUrl('Salut Radu, avem 3+ locații și am vrea o ofertă custom')
          if (!url) return null
          return (
            <div
              style={{ textAlign: 'center', marginBottom: 80, fontSize: '0.88rem', color: MKT.text2 }}
            >
              Ai 3+ locații sau nevoi custom?{' '}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: MKT.accent, textDecoration: 'underline', fontWeight: 500 }}
              >
                Scrie-ne pentru ofertă personalizată →
              </a>
            </div>
          )
        })()}
      </div>

      {/* Extras section — separated with light grey background */}
      <div
        style={{
          background: MKT.surface2,
          padding: '60px 20px',
          borderTop: `1px solid ${MKT.border}`,
          borderBottom: `1px solid ${MKT.border}`,
        }}
      >
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: 'clamp(1.6rem, 4vw, 2.2rem)',
                color: MKT.text,
                fontWeight: 600,
                marginBottom: 10,
                letterSpacing: '-0.02em',
              }}
            >
              Extras pentru toate planurile
            </h2>
            <p style={{ color: MKT.text2, fontSize: '1rem', lineHeight: 1.6 }}>
              Adaugă funcționalități suplimentare oricând, anulezi oricând.
            </p>
          </div>

          {/* One-time */}
          <div
            style={{
              marginBottom: 14,
              fontSize: '0.78rem',
              fontWeight: 700,
              color: MKT.text3,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              textAlign: 'center',
            }}
          >
            Plată unică
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 14,
              marginBottom: 56,
            }}
          >
            {EXTRAS_ONETIME.map((e) => (
              <div
                key={e.title}
                style={{
                  background: MKT.surface,
                  border: `1px solid ${MKT.border}`,
                  borderRadius: 14,
                  padding: '18px 20px',
                  display: 'flex',
                  gap: 14,
                  alignItems: 'flex-start',
                  boxShadow: '0 1px 3px rgba(26,18,8,0.03)',
                }}
              >
                <span style={{ fontSize: '1.6rem', flexShrink: 0 }}>{e.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      marginBottom: 6,
                      alignItems: 'baseline',
                    }}
                  >
                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: MKT.text }}>
                      {e.title}
                    </span>
                    <span
                      style={{
                        fontSize: '0.92rem',
                        fontWeight: 700,
                        color: MKT.accent,
                        whiteSpace: 'nowrap',
                        fontFamily: 'Fraunces,serif',
                      }}
                    >
                      {e.price}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: MKT.text2, lineHeight: 1.55 }}>
                    {e.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Monthly recurring */}
          <div
            style={{
              marginBottom: 14,
              fontSize: '0.78rem',
              fontWeight: 700,
              color: MKT.text3,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              textAlign: 'center',
            }}
          >
            Lunar recurent
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 14,
            }}
          >
            {EXTRAS_MONTHLY.map((e) => (
              <div
                key={e.title}
                style={{
                  background: MKT.surface,
                  border: `1px solid ${MKT.border}`,
                  borderRadius: 14,
                  padding: '18px 20px',
                  display: 'flex',
                  gap: 14,
                  alignItems: 'flex-start',
                  boxShadow: '0 1px 3px rgba(26,18,8,0.03)',
                }}
              >
                <span style={{ fontSize: '1.6rem', flexShrink: 0 }}>{e.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      marginBottom: 4,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: MKT.text }}>
                      {e.title}
                    </span>
                    <span
                      style={{
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        color: MKT.accent,
                        whiteSpace: 'nowrap',
                        fontFamily: 'Fraunces,serif',
                      }}
                    >
                      {e.price}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: MKT.text3, marginBottom: 6 }}>
                    📌 Disponibil pe: {e.plans}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: MKT.text2, lineHeight: 1.55 }}>
                    {e.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bonuses section */}
      <div style={{ padding: '60px 20px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h2
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: 'clamp(1.6rem, 4vw, 2.2rem)',
                color: MKT.text,
                fontWeight: 600,
                marginBottom: 10,
                letterSpacing: '-0.02em',
              }}
            >
              🎁 Bonusuri incluse, gratuit
            </h2>
            <p style={{ color: MKT.text2, fontSize: '1rem', lineHeight: 1.6 }}>
              Pentru toți clienții, ca să te simți răsfățat de la prima zi.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 14,
            }}
          >
            {BONUSES.map((b) => (
              <div
                key={b.title}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  padding: '16px 18px',
                  background: MKT.surface,
                  border: `1px solid ${MKT.border}`,
                  borderRadius: 12,
                }}
              >
                <span style={{ fontSize: '1.4rem', flexShrink: 0 }}>{b.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{ fontSize: '0.92rem', fontWeight: 600, color: MKT.text, marginBottom: 3 }}
                  >
                    {b.title}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: MKT.text2, lineHeight: 1.55 }}>
                    {b.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div
        style={{ background: MKT.surface2, padding: '60px 20px', borderTop: `1px solid ${MKT.border}` }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 'clamp(1.6rem, 4vw, 2.2rem)',
              color: MKT.text,
              textAlign: 'center',
              marginBottom: 36,
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            Întrebări frecvente
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FAQ.map((item, i) => {
              const isOpen = openFaq === i
              return (
                <div
                  key={i}
                  style={{
                    background: MKT.surface,
                    border: `1px solid ${isOpen ? MKT.accent : MKT.border}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    transition: `border-color ${MOTION.normal}ms ${MOTION.easeOut}`,
                  }}
                >
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    style={{
                      width: '100%',
                      padding: '17px 20px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 14,
                      textAlign: 'left',
                      fontFamily: 'DM Sans,sans-serif',
                    }}
                  >
                    <span style={{ fontSize: '0.95rem', color: MKT.text, fontWeight: 600 }}>
                      {item.q}
                    </span>
                    <span
                      style={{
                        color: isOpen ? MKT.accent : MKT.text3,
                        fontSize: '1.1rem',
                        transition: `transform ${MOTION.normal}ms ${MOTION.easeOut}, color ${MOTION.normal}ms ${MOTION.easeOut}`,
                        transform: isOpen ? 'rotate(45deg)' : 'none',
                        flexShrink: 0,
                        fontWeight: 300,
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
                          padding: '0 20px 18px',
                          fontSize: '0.9rem',
                          color: MKT.text2,
                          lineHeight: 1.7,
                        }}
                      >
                        {item.a}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Final CTA */}
      <div style={{ padding: '64px 20px 88px', textAlign: 'center', background: MKT.bg }}>
        <RevealItem>
          <h3
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 'clamp(1.5rem, 3vw, 2rem)',
              color: MKT.text,
              fontWeight: 700,
              marginBottom: 14,
              letterSpacing: '-0.02em',
              textWrap: 'balance',
            }}
          >
            Gata să începi?
          </h3>
          <p style={{ color: MKT.text2, fontSize: '1rem', marginBottom: 28, lineHeight: 1.6 }}>
            30 zile gratuite. Setup în 10 minute.
          </p>
          <button
            onClick={() => {
              writePlanIntent('growth')
              void onCheckout('growth')
            }}
            className="pressable"
            style={{
              background: MKT.accent,
              color: MKT.onAccent,
              border: 'none',
              borderRadius: 12,
              padding: '16px 36px',
              fontSize: '1rem',
              fontWeight: 700,
              fontFamily: 'DM Sans,sans-serif',
              cursor: 'pointer',
              boxShadow: 'var(--shadow-gold-soft, 0 4px 14px rgba(200,150,60,0.3))',
            }}
          >
            Începe gratuit Meniu + Comenzi →
          </button>
        </RevealItem>
      </div>
    </div>
  )
}
