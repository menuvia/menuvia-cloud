import { useState, useEffect } from 'react'
import { MKT } from '../lib/marketing'
import { supabase } from '../lib/supabase'
import { getPlan } from '../lib/plans'
import { MOTION } from '../lib/motion'
import { RevealItem } from '../components/marketing/Reveal'
import MarketingHeader from '../components/marketing/MarketingHeader'
import MarketingFooter from '../components/marketing/MarketingFooter'
import PhoneFrame from '../components/marketing/PhoneFrame'
import { Icon, type IconName } from '../components/ui/Icon'
import { useIsMobile } from '../hooks/useIsMobile'

// ── Secțiunea „Recomandă și câștigă" ─────────────────────────
// Procentele programului de parteneriat vin din RPC-ul public
// get_affiliate_public_defaults (un singur call, ieftin); fallback pe
// valorile istorice din mig 097. bps/100 = procent.
interface AffiliateDefaults {
  setup_bps: number
  recurring_bps: number
  recurring_cap_months: number
}
const AFFILIATE_FALLBACK: AffiliateDefaults = {
  setup_bps: 3000,
  recurring_bps: 1000,
  recurring_cap_months: 12,
}

// ── Secțiunea de comparație — categorii, nu nume de concurenți ──
// Conținut validat de analiza de piață (docs/COMPETITIE.md): ton onest,
// fiecare rând e un fapt verificabil, inclusiv punctele forte ale celorlalți.
const COMPARE_CARDS: {
  title: string
  highlight?: boolean
  rows: { good: boolean; text: string }[]
}[] = [
  {
    title: 'Un meniu QR simplu',
    rows: [
      { good: true, text: 'Ieftin și rapid de pus în funcțiune' },
      { good: false, text: 'Comanda ajunge pe WhatsApp sau deloc — fără bucătărie, fără stări' },
      { good: false, text: 'Bonul fiscal = re-marcat manual în casă, la fiecare comandă' },
      { good: false, text: 'Fără sesiuni de masă: nota se reconstituie din memorie' },
    ],
  },
  {
    title: 'Menuvia',
    highlight: true,
    rows: [
      { good: true, text: 'Comenzi reale: bucătărie, ospătari, stări, sesiuni de masă' },
      { good: true, text: 'Plata și bonul rămân pe casa ta actuală — nu schimbi nimic' },
      { good: true, text: 'Fiscalizare direct pe casa existentă (Datecs/Activa/Tremol) — în pilot' },
      { good: true, text: 'Prețuri publice, fără comision pe comenzi, fără contract' },
    ],
  },
  {
    title: 'Un POS nou, cu kit propriu',
    rows: [
      { good: true, text: 'Fiscalizare nativă, integrată în sistemul lor' },
      { good: false, text: 'Hardware + licențe de mii de lei, plătite înainte să vinzi ceva' },
      { good: false, text: 'Migrezi tot sistemul de vânzare și înveți personalul de la zero' },
      { good: false, text: 'Instalare cu dealeri, contracte de service, prețuri „la cerere"' },
    ],
  },
]

// Paletă locală DARK pentru secțiunea de afiliere — brun închis cald,
// derivat din MKT.onAccent (#241A0A); aceeași cu hero-ul paginii /afiliat,
// ca secțiunea să iasă din pagina crem fără să devină banner țipător.
const AFF_DARK = {
  bg: `radial-gradient(circle at 85% 15%, rgba(200,150,60,0.16), transparent 55%), linear-gradient(160deg, #1C140C 0%, #241A0A 65%, #2B1F0E 100%)`,
  text: '#FAF9F6', // crem — oglinda lui MKT.bg
  text2: 'rgba(250,249,246,0.78)',
  text3: 'rgba(250,249,246,0.55)',
}

// ── Landing page (unauthenticated visitors) ──────────────────
// Obiectiv: vizitatorul înțelege în 10 secunde ce e Menuvia, pentru cine e,
// de ce Meniu + Comenzi e planul recomandat și cât de simplu e setup-ul.
// Vinde FLOW-ul (Adaugi meniul → Generezi QR → Primești comenzi), nu module.
// Hero-ul arată produsul REAL (PhoneFrame randează componentele de meniu).
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
  // Hero split doar pe desktop (≥900px); sub prag → stack.
  const stacked = useIsMobile(900)

  // Procentele reale ale programului de parteneriat (secțiunea „Recomandă
  // și câștigă"). Un singur call public la mount; fallback dacă RPC-ul tace.
  const [affiliate, setAffiliate] = useState<AffiliateDefaults>(AFFILIATE_FALLBACK)
  useEffect(() => {
    let cancelled = false
    void supabase.rpc('get_affiliate_public_defaults').then(({ data }) => {
      if (cancelled || !data) return
      const d = data as Partial<AffiliateDefaults>
      setAffiliate({
        setup_bps: d.setup_bps ?? AFFILIATE_FALLBACK.setup_bps,
        recurring_bps: d.recurring_bps ?? AFFILIATE_FALLBACK.recurring_bps,
        recurring_cap_months: d.recurring_cap_months ?? AFFILIATE_FALLBACK.recurring_cap_months,
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Sosire cu fragment (ex. „/#functii" din MarketingFooter): browserul
  // procesează hash-ul înainte ca React să fi montat secțiunea → scroll-ul
  // nativ ratează ținta. Îl refacem după mount.
  useEffect(() => {
    const hash = window.location.hash
    if (!hash) return
    document.getElementById(hash.slice(1))?.scrollIntoView()
  }, [])

  // Mini-exemplu static: 5 restaurante pe planul recomandat (Meniu + Comenzi).
  const affPct = (bps: number) => (bps / 100).toLocaleString('ro-RO') + '%'
  const affLei = (v: number) => Math.round(v).toLocaleString('ro-RO')
  const growthPlan = getPlan('growth')
  const AFF_EXAMPLE_COUNT = 5
  const affBonus = AFF_EXAMPLE_COUNT * (affiliate.setup_bps / 10000) * growthPlan.priceMonthly
  const affMonthly = AFF_EXAMPLE_COUNT * (affiliate.recurring_bps / 10000) * growthPlan.priceMonthly

  // Beneficiile păstrează copy-ul existent; emoji-urile au fost înlocuite
  // cu Icon vectorial (nume verificate în union-ul IconName).
  const BENEFITS: { icon: IconName; title: string; desc: string }[] = [
    {
      icon: 'edit',
      title: 'Meniu actualizabil oricând',
      desc: 'Schimbi prețuri și produse pe loc — fără re-printat meniuri.',
    },
    {
      icon: 'bell',
      title: 'Comenzi direct de la masă',
      desc: 'Clientul scanează, alege și trimite. Fără așteptat după ospătar.',
    },
    {
      icon: 'users',
      title: 'Mai puține drumuri pentru ospătari',
      desc: 'Chemarea ospătarului și nota de plată — direct din telefonul clientului.',
    },
    {
      icon: 'utensils',
      title: 'Bucătărie organizată',
      desc: 'Comenzile apar instant pe ecran, în ordinea corectă. Zero hârtii.',
    },
    {
      icon: 'qr',
      title: 'QR-uri generate automat',
      desc: 'Spui câte mese ai — primești QR-urile gata de printat, în PDF.',
    },
    {
      icon: 'chart',
      title: 'Rapoarte simple',
      desc: 'Ce s-a comandat azi și săptămâna asta — fără să sapi prin meniuri.',
    },
  ]

  // Bandă „Construit pentru România" — diferențiatori locali, nu feature-uri.
  const ROMANIA_POINTS: { icon: IconName; text: string }[] = [
    { icon: 'mapPin', text: 'Făcut în România, pentru restaurante românești' },
    { icon: 'lock', text: 'Date pe servere UE, conform GDPR' },
    {
      icon: 'percent',
      text: 'Cote TVA românești — le schimbi într-un minut, nu re-tipărești meniul',
    },
    { icon: 'phone', text: 'Suport pe WhatsApp, direct cu fondatorul' },
  ]

  const STEPS = [
    {
      n: '1',
      title: 'Adaugi meniul',
      desc: 'Manual sau importat cu AI dintr-o poză. Gata în câteva minute.',
    },
    {
      n: '2',
      title: 'Generezi QR-urile pentru mese',
      desc: 'Spui câte mese ai. PDF-ul de printat e gata în 30 de secunde.',
    },
    {
      n: '3',
      title: 'Primești comenzi instant',
      desc: 'Clienții comandă de pe telefon, bucătăria vede totul live.',
    },
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
    {
      q: 'Ce se întâmplă cu datele mele?',
      a: 'Serverele sunt în Uniunea Europeană, conform GDPR. Îți poți exporta datele oricând, iar la închiderea contului le ștergem complet.',
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
  const sectionTitle: React.CSSProperties = {
    fontFamily: 'Fraunces,serif',
    fontSize: 'clamp(1.6rem, 3.4vw, 2.1rem)',
    color: MKT.text,
    fontWeight: 700,
    textAlign: 'center',
    letterSpacing: '-0.02em',
    textWrap: 'balance',
  }

  return (
    <div style={{ minHeight: '100vh', background: MKT.bg, fontFamily: 'DM Sans,sans-serif' }}>
      {/* Header sticky comun */}
      <MarketingHeader
        links={[
          { label: 'Funcții', href: '#functii' },
          { label: 'Cum funcționează', href: '#cum-functioneaza' },
          { label: 'Prețuri', onClick: onPricing },
          { label: 'Demo', onClick: onDemo },
          // keepOnMobile: pe telefon (majoritatea traficului) clientul
          // existent trebuie să aibă o cale de login din header.
          { label: 'Intră în cont', onClick: onLogin, keepOnMobile: true },
        ]}
        cta={{ label: 'Începe gratuit', onClick: () => onStartPlan('growth') }}
      />

      {/* Hero split: mesaj + CTA-uri în stânga, produsul REAL în dreapta */}
      <div
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          padding: stacked ? '56px 24px 56px' : '80px 24px 88px',
          display: 'grid',
          gridTemplateColumns: stacked ? '1fr' : '1.1fr 0.9fr',
          gap: stacked ? 48 : 40,
          alignItems: 'center',
        }}
      >
        <div style={{ textAlign: stacked ? 'center' : 'left' }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: MKT.accent,
              marginBottom: 18,
            }}
          >
            Meniu QR + comenzi pentru restaurante
          </div>
          <h1
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 'clamp(2.1rem, 4.6vw, 3.4rem)',
              color: MKT.text,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: '-0.03em',
              marginBottom: 20,
              textWrap: 'balance',
            }}
          >
            Clienții comandă singuri de la masă. Tu doar servești.
          </h1>
          <p
            style={{
              color: MKT.text2,
              fontSize: 'clamp(1.05rem, 2vw, 1.2rem)',
              maxWidth: 520,
              margin: stacked ? '0 auto 32px' : '0 0 32px',
              lineHeight: 1.65,
              textWrap: 'balance',
            }}
          >
            Meniu QR premium și comenzi trimise direct în bucătărie. Fără hardware, fără instalare —
            pornești în 10 minute.
          </p>
          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              justifyContent: stacked ? 'center' : 'flex-start',
            }}
          >
            <button onClick={() => onStartPlan('growth')} className="pressable" style={ctaBtn}>
              Începe gratuit 30 de zile
            </button>
            <button onClick={onDemo} className="pressable" style={ghostBtn}>
              Vezi demo live
            </button>
          </div>
          <div style={{ color: MKT.text3, fontSize: 13, marginTop: 18 }}>
            Setup în 10 minute · Anulezi oricând · Suport pe WhatsApp
          </div>
        </div>

        {/* Telefonul cu meniul real, ușor rotit pentru un aer editorial */}
        <RevealItem
          style={{
            display: 'flex',
            justifyContent: 'center',
            // Rotația stă pe wrapper ca reveal-ul (translateY) să nu o suprascrie.
            transform: 'rotate(2deg)',
            filter: 'drop-shadow(0 24px 48px rgba(26,18,8,0.18))',
          }}
        >
          <PhoneFrame />
        </RevealItem>
      </div>

      {/* Bandă „Construit pentru România" */}
      <div style={{ background: MKT.surface2, padding: '36px 24px' }}>
        <div
          style={{
            maxWidth: 1120,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 20,
          }}
        >
          {ROMANIA_POINTS.map((p, i) => (
            <RevealItem key={p.icon} delay={i * 60}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <Icon name={p.icon} size={20} color={MKT.accent} />
                <span style={{ color: MKT.text2, fontSize: 13.5, lineHeight: 1.55 }}>{p.text}</span>
              </div>
            </RevealItem>
          ))}
        </div>
      </div>

      {/* Benefits */}
      <div id="functii" style={{ padding: '80px 24px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <RevealItem>
            <h2 style={{ ...sectionTitle, marginBottom: 40 }}>
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
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: `${MKT.accent}22`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 14,
                    }}
                  >
                    <Icon name={b.icon} size={22} color={MKT.accent} />
                  </div>
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
      <div
        id="cum-functioneaza"
        style={{ maxWidth: 880, margin: '0 auto', padding: '0 24px 80px' }}
      >
        <RevealItem>
          <h2 style={{ ...sectionTitle, marginBottom: 44 }}>Pornești în 3 pași</h2>
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
              Meniu + Comenzi
            </div>
            <p
              style={{
                color: MKT.text2,
                fontSize: 15,
                lineHeight: 1.65,
                maxWidth: 460,
                margin: '0 auto 22px',
              }}
            >
              Reduce timpul pierdut cu preluarea comenzilor. Plata și bonul rămân pe casa ta
              actuală.
            </p>
            <button onClick={onPricing} className="pressable" style={ctaBtn}>
              Vezi planurile
            </button>
          </div>
        </RevealItem>
      </div>

      {/* Comparație onestă — mesajul central: păstrezi casa de marcat.
          Fără nume de concurenți în UI (fair-play); categoriile sunt
          suficiente. Diferențiatorul validat de analiza de piață
          (docs/COMPETITIE.md): nimeni din QR-first nu închide bucla
          fiscală, iar POS-urile o închid doar cu kit nou. */}
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0 24px 80px' }}>
        <RevealItem>
          <h2 style={{ ...sectionTitle, marginBottom: 10 }}>
            Păstrezi casa de marcat și POS-ul pe care le ai
          </h2>
          <p
            style={{
              color: MKT.text2,
              fontSize: 15,
              lineHeight: 1.65,
              textAlign: 'center',
              maxWidth: 560,
              margin: '0 auto 36px',
            }}
          >
            Fără hardware nou, fără migrare, fără contracte de service. Comanda pleacă din
            telefonul clientului și ajunge exact acolo unde lucrezi deja.
          </p>
        </RevealItem>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: stacked ? '1fr' : 'repeat(3, 1fr)',
            gap: 16,
            alignItems: 'stretch',
          }}
        >
          {COMPARE_CARDS.map((card, i) => (
            <RevealItem key={card.title} delay={i * 90}>
              <div
                style={{
                  background: MKT.surface,
                  border: card.highlight ? `1.5px solid ${MKT.accent}` : `1px solid ${MKT.border}`,
                  borderRadius: 18,
                  padding: '26px 22px',
                  height: '100%',
                  boxSizing: 'border-box',
                  boxShadow: card.highlight ? '0 8px 32px rgba(200,150,60,0.14)' : undefined,
                }}
              >
                <div
                  style={{
                    fontFamily: 'Fraunces,serif',
                    fontSize: '1.05rem',
                    fontWeight: 700,
                    color: card.highlight ? MKT.accentInk : MKT.text,
                    marginBottom: 14,
                  }}
                >
                  {card.title}
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {card.rows.map((row) => (
                    <li key={row.text} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                      <span
                        aria-hidden="true"
                        style={{
                          color: row.good ? MKT.success : MKT.text3,
                          fontWeight: 700,
                          fontSize: 14,
                          lineHeight: 1.5,
                          flexShrink: 0,
                        }}
                      >
                        {row.good ? '✓' : '—'}
                      </span>
                      <span style={{ color: row.good ? MKT.text2 : MKT.text3, fontSize: 13.5, lineHeight: 1.55 }}>
                        {row.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </RevealItem>
          ))}
        </div>
        <p
          style={{
            color: MKT.text3,
            fontSize: 12.5,
            textAlign: 'center',
            marginTop: 18,
            lineHeight: 1.6,
          }}
        >
          Fiscalizarea Menuvia funcționează prin FiscalNet direct pe casele Datecs, Activa și
          Tremol — programul e în pilot, iar planurile Meniu Digital și Meniu + Comenzi nu ating
          deloc casa ta: bonul rămâne exact ca până acum.
        </p>
      </div>

      {/* FAQ light */}
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 24px 80px' }}>
        <RevealItem>
          <h2
            style={{
              ...sectionTitle,
              fontSize: 'clamp(1.4rem, 3vw, 1.6rem)',
              marginBottom: 28,
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
                  aria-hidden="true"
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
              {/* aria-hidden pe colapsat: ascunderea e doar vizuală (0fr +
                  opacity), altfel SR-ul citește răspunsuri „închise". */}
              <div
                aria-hidden={!isOpen}
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

      {/* ── Recomandă și câștigă — programul de parteneriat, pe contrast dark ── */}
      <div style={{ background: AFF_DARK.bg, padding: stacked ? '56px 24px' : '72px 24px' }}>
        <div
          style={{
            maxWidth: 1040,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: stacked ? '1fr' : '1.1fr 0.9fr',
            gap: stacked ? 36 : 56,
            alignItems: 'center',
          }}
        >
          <RevealItem>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: MKT.accent,
                  marginBottom: 14,
                }}
              >
                Recomandă și câștigă
              </div>
              <h2
                style={{
                  fontFamily: 'Fraunces,serif',
                  fontSize: 'clamp(1.6rem, 3.4vw, 2.1rem)',
                  color: AFF_DARK.text,
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.15,
                  margin: '0 0 14px',
                  textWrap: 'balance',
                }}
              >
                Cunoști restaurante? Fă bani recomandându-le Menuvia.
              </h2>
              <p style={{ color: AFF_DARK.text2, fontSize: 15, lineHeight: 1.65, margin: '0 0 22px', maxWidth: 460 }}>
                Programul de parteneriat plătește comision din fiecare local adus — o dată la
                activare, apoi lunar. Fără costuri, fără target.
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  `${affPct(affiliate.setup_bps)} din prima factură a fiecărui restaurant adus`,
                  `${affPct(affiliate.recurring_bps)} din abonament, în fiecare lună`,
                  `Comision lunar plătit ${affiliate.recurring_cap_months.toLocaleString('ro-RO')} luni per restaurant`,
                ].map((line) => (
                  <li key={line} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <Icon name="check" size={18} color={MKT.accent} />
                    <span style={{ color: AFF_DARK.text2, fontSize: 14.5, lineHeight: 1.5 }}>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </RevealItem>

          {/* Card crem cu mini-exemplu de calcul + CTA spre /afiliat */}
          <RevealItem delay={120}>
            <div
              className="hover-lift"
              style={{
                background: MKT.surface,
                borderRadius: 20,
                padding: '30px 28px',
                boxShadow: '0 20px 56px rgba(0,0,0,0.35)',
                textAlign: 'center',
              }}
            >
              <div style={{ color: MKT.text2, fontSize: 13.5, marginBottom: 14 }}>
                {AFF_EXAMPLE_COUNT.toLocaleString('ro-RO')} restaurante pe {growthPlan.name} ≈
              </div>
              <div
                style={{
                  fontFamily: 'Fraunces,serif',
                  fontSize: 'clamp(1.7rem, 3.5vw, 2.1rem)',
                  fontWeight: 700,
                  // accentInk: aurul viu pică sub 3:1 pe cardul crem (AA text mare).
                  color: MKT.accentInk,
                  lineHeight: 1.25,
                  letterSpacing: '-0.02em',
                  marginBottom: 6,
                }}
              >
                {affLei(affBonus)} lei bonus
              </div>
              <div
                style={{
                  fontFamily: 'Fraunces,serif',
                  fontSize: 'clamp(1.2rem, 2.6vw, 1.5rem)',
                  fontWeight: 700,
                  color: MKT.text,
                  marginBottom: 18,
                }}
              >
                + {affLei(affMonthly)} lei/lună
              </div>
              <a
                href="/afiliat"
                className="pressable hover-lift"
                style={{
                  display: 'inline-block',
                  background: MKT.accent,
                  color: MKT.onAccent,
                  borderRadius: 12,
                  padding: '14px 26px',
                  fontWeight: 700,
                  fontSize: 15,
                  fontFamily: 'DM Sans,sans-serif',
                  textDecoration: 'none',
                  boxShadow: '0 4px 14px rgba(200,150,60,0.3)',
                }}
              >
                Vezi programul de parteneriat →
              </a>
              <div style={{ color: MKT.text3, fontSize: 12, marginTop: 12 }}>
                Plată lunară pe factură, către firma sau PFA-ul tău.
              </div>
            </div>
          </RevealItem>
        </div>
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

      <MarketingFooter />
    </div>
  )
}
