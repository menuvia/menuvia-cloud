// AfiliatIntroPage — prezentarea PUBLICĂ a programului de parteneriat.
// Afișată vizitatorilor nelogați pe /afiliat. Redesign „premium": hero dark
// dramatic, calculator interactiv de câștig (piesa centrală), pași pe
// orizontală, bandă de încredere și FAQ. Procentele vin din
// get_affiliate_public_defaults (mig 189) — valorile REALE setate de
// fondator, cu fallback pe cele istorice (mig 097).
import { useState, useEffect } from 'react'
import { MKT } from '../lib/marketing'
import { supabase } from '../lib/supabase'
import { getPlan } from '../lib/plans'
import { MOTION, useReducedMotion } from '../lib/motion'
import { useIsMobile } from '../hooks/useIsMobile'
import MarketingHeader from '../components/marketing/MarketingHeader'
import MarketingFooter from '../components/marketing/MarketingFooter'
import { RevealItem } from '../components/marketing/Reveal'
import { Icon, type IconName } from '../components/ui/Icon'

interface PublicDefaults {
  setup_bps: number
  recurring_bps: number
  recurring_cap_months: number
}

// Fallback = valorile istorice din mig 097; suprascrise de RPC când răspunde.
const FALLBACK: PublicDefaults = { setup_bps: 3000, recurring_bps: 1000, recurring_cap_months: 12 }

// ── Paletă locală DARK — brun închis cald, derivat din MKT.onAccent (#241A0A).
// Folosită DOAR pentru secțiunile de impact (hero + CTA final); restul paginii
// rămâne pe paleta crem MKT.
const DARK = {
  // gradient subtil + „glow" auriu discret în colț — aer premium, nu banner
  bg: `radial-gradient(circle at 85% 15%, rgba(200,150,60,0.16), transparent 55%), linear-gradient(160deg, #1C140C 0%, #241A0A 65%, #2B1F0E 100%)`,
  surface: 'rgba(250,249,246,0.06)', // carduri translucide pe fundal închis
  border: 'rgba(250,249,246,0.15)',
  text: '#FAF9F6', // crem — oglinda lui MKT.bg
  text2: 'rgba(250,249,246,0.78)',
  text3: 'rgba(250,249,246,0.55)',
}

const STEPS: { title: string; text: string }[] = [
  {
    title: 'Aplici și facem cunoștință',
    text: 'Cererea durează un minut. Te sunăm pentru o discuție scurtă, apoi primești linkul tău unic de recomandare și ghidul de start.',
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

// Bandă de încredere — argumentele care conving un partener sceptic.
const TRUST_ITEMS: { icon: IconName; text: string }[] = [
  { icon: 'eye', text: 'Tracking transparent — vezi fiecare restaurant și comision în panoul tău, live' },
  { icon: 'receipt', text: 'Plată pe factură, direct în contul firmei sau PFA-ului tău' },
  {
    icon: 'lock',
    text: 'Contract clar: comisioanele au perioadă de siguranță 60/14 zile, apoi sunt garantate',
  },
  { icon: 'users', text: 'Recrutezi sub-parteneri și câștigi și din echipa ta' },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Cine se poate înscrie?',
    a: 'Oricine — nu ai nevoie de experiență în vânzări. Singura condiție: la plată emiți factură către Menuvia, de pe PFA sau SRL.',
  },
  {
    q: 'De ce e nevoie de o discuție telefonică?',
    a: 'Vrem parteneri, nu doar linkuri distribuite la întâmplare. O discuție de 10 minute ne ajută să te cunoaștem, să-ți explicăm programul și să-ți răspundem la întrebări — apoi primești acces.',
  },
  {
    q: 'Când primesc banii?',
    a: 'Comisionul de activare are o perioadă de siguranță de 60 de zile, cel lunar de 14 zile (protecție anti-fraudă). După aceea devin plătibile — emiți factura și primești banii în cont.',
  },
  {
    q: 'Ce trebuie să fac după înscriere?',
    a: 'Primești linkul tău unic de recomandare. Îl dai restaurantelor pe care le cunoști — când un local se abonează venind de pe linkul tău, atribuirea se face automat.',
  },
  {
    q: 'Pot să-mi văd câștigurile în timp real?',
    a: 'Da. În panoul tău de partener vezi live fiecare restaurant adus, fiecare comision generat și statusul plăților.',
  },
]

interface Props {
  onLogin: () => void
}

export default function AfiliatIntroPage({ onLogin }: Props) {
  const [defaults, setDefaults] = useState<PublicDefaults>(FALLBACK)
  // Calculatorul de câștig: câte restaurante recomandă vizitatorul.
  const [count, setCount] = useState(5)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const reduced = useReducedMotion()
  const stacked = useIsMobile(860)

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
  const lei = (v: number) => Math.round(v).toLocaleString('ro-RO')

  // ── Formula calculatorului — pe planul recomandat (Meniu + Comenzi) ──
  // bonus activare = n × setup% × preț (o singură dată, per restaurant)
  // venit lunar    = n × recurring% × preț
  // total primul an = bonus + min(12, cap) × venit lunar
  const growth = getPlan('growth')
  const price = growth.priceMonthly
  const setupBonus = count * (defaults.setup_bps / 10000) * price
  const monthly = count * (defaults.recurring_bps / 10000) * price
  const paidMonths = Math.min(12, defaults.recurring_cap_months)
  const firstYear = setupBonus + paidMonths * monthly

  // Umplerea track-ului sliderului (auriu până la valoarea curentă).
  const fillPct = ((count - 1) / 19) * 100

  const goldCta: React.CSSProperties = {
    background: MKT.accent,
    color: MKT.onAccent,
    border: 'none',
    borderRadius: 12,
    padding: '16px 36px',
    fontSize: '1.05rem',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'DM Sans,sans-serif',
    boxShadow: '0 6px 24px rgba(200,150,60,0.35)',
  }

  return (
    <div style={{ minHeight: '100vh', background: MKT.bg, fontFamily: 'DM Sans,sans-serif' }}>
      {/* Thumb-ul mare al sliderului nu se poate stiliza inline (pseudo-elemente)
          — singurul <style> local, scoped pe clasa .afiliat-range. Input-ul are
          44px înălțime (țintă de atingere accesibilă); track-ul VIZUAL rămâne
          subțire (8px) pe pseudo-elemente, cu umplerea aurie din --afiliat-fill
          (setată inline pe input). Thumb-ul WebKit primește margin-top negativ
          ca să rămână centrat pe track. */}
      <style>{`
        .afiliat-range { -webkit-appearance: none; appearance: none; height: 44px; background: none; outline: none; cursor: pointer; width: 100%; margin: 0; }
        .afiliat-range::-webkit-slider-runnable-track { height: 8px; border-radius: 999px; background: linear-gradient(90deg, ${MKT.accent} var(--afiliat-fill, 0%), ${MKT.border} var(--afiliat-fill, 0%)); }
        .afiliat-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 28px; height: 28px; border-radius: 50%; background: ${MKT.accent}; border: 3px solid #FFFFFF; box-shadow: 0 2px 10px rgba(36,26,10,0.35); cursor: pointer; margin-top: -10px; }
        .afiliat-range::-moz-range-track { height: 8px; border-radius: 999px; background: linear-gradient(90deg, ${MKT.accent} var(--afiliat-fill, 0%), ${MKT.border} var(--afiliat-fill, 0%)); }
        .afiliat-range::-moz-range-thumb { width: 28px; height: 28px; border-radius: 50%; background: ${MKT.accent}; border: 3px solid #FFFFFF; box-shadow: 0 2px 10px rgba(36,26,10,0.35); cursor: pointer; }
      `}</style>

      <MarketingHeader onBack={() => (window.location.href = '/')} cta={{ label: 'Înscrie-te', onClick: onLogin }} />

      {/* ── Hero DARK dramatic ── */}
      <div style={{ background: DARK.bg, padding: stacked ? '64px 20px 120px' : '88px 24px 140px' }}>
        <div
          style={{
            maxWidth: 1040,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: stacked ? '1fr' : '1.15fr 0.85fr',
            gap: stacked ? 40 : 48,
            alignItems: 'center',
          }}
        >
          <RevealItem>
            <div style={{ textAlign: stacked ? 'center' : 'left' }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: MKT.accent,
                  marginBottom: 18,
                }}
              >
                Program de parteneriat
              </div>
              <h1
                style={{
                  fontFamily: 'Fraunces, Georgia, serif',
                  fontSize: 'clamp(2.1rem, 5vw, 3.4rem)',
                  color: DARK.text,
                  fontWeight: 700,
                  margin: '0 0 18px',
                  letterSpacing: '-0.03em',
                  lineHeight: 1.1,
                  textWrap: 'balance',
                }}
              >
                Tu cunoști restaurantele. Noi împărțim veniturile.
              </h1>
              <p
                style={{
                  color: DARK.text2,
                  fontSize: 'clamp(1.02rem, 2vw, 1.15rem)',
                  lineHeight: 1.65,
                  maxWidth: 500,
                  margin: stacked ? '0 auto 30px' : '0 0 30px',
                }}
              >
                Recomanzi Menuvia localurilor pe care le știi și primești comision din fiecare
                abonament — o dată la activare, apoi în fiecare lună.
              </p>
              <button onClick={onLogin} className="pressable hover-lift" style={goldCta}>
                Înscrie-te în program →
              </button>
              <div style={{ color: DARK.text3, fontSize: 13, marginTop: 16 }}>
                Fără costuri · Fără target · Plată lunară pe factură
              </div>
            </div>
          </RevealItem>

          {/* Cifra-erou: procentul de activare, mare, auriu */}
          <RevealItem delay={120}>
            <div
              style={{
                background: DARK.surface,
                border: `1px solid ${DARK.border}`,
                borderRadius: 20,
                padding: '36px 28px',
                textAlign: 'center',
                backdropFilter: 'blur(6px)',
              }}
            >
              <div style={{ color: DARK.text3, fontSize: 13, marginBottom: 6 }}>Comision de activare</div>
              <div
                style={{
                  fontFamily: 'Fraunces, Georgia, serif',
                  fontSize: 'clamp(3.4rem, 8vw, 5rem)',
                  fontWeight: 700,
                  color: MKT.accent,
                  lineHeight: 1,
                  letterSpacing: '-0.03em',
                }}
              >
                {pct(defaults.setup_bps)}
              </div>
              <div style={{ color: DARK.text2, fontSize: 14, marginTop: 12, lineHeight: 1.55 }}>
                din prima factură a fiecărui restaurant adus
                <br />
                <span style={{ color: MKT.accent, fontWeight: 700 }}>
                  + {pct(defaults.recurring_bps)} lunar
                </span>{' '}
                <span style={{ color: DARK.text3 }}>
                  timp de {defaults.recurring_cap_months} luni
                </span>
              </div>
            </div>
          </RevealItem>
        </div>
      </div>

      <main style={{ maxWidth: 1040, margin: '0 auto', padding: '0 20px 72px' }}>
        {/* ── Calculator interactiv de câștig — suprapus peste hero ── */}
        <RevealItem style={{ position: 'relative', zIndex: 1, marginTop: -72 }}>
          <div
            style={{
              background: MKT.surface,
              border: `1px solid ${MKT.border}`,
              borderRadius: 22,
              padding: stacked ? '28px 22px' : '40px 44px',
              boxShadow: '0 24px 64px rgba(26,18,8,0.18), 0 4px 16px rgba(26,18,8,0.08)',
              maxWidth: 880,
              margin: '0 auto',
            }}
          >
            <h2
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 'clamp(1.4rem, 3vw, 1.8rem)',
                color: MKT.text,
                fontWeight: 700,
                margin: '0 0 6px',
                textAlign: 'center',
                letterSpacing: '-0.02em',
              }}
            >
              Cât poți câștiga?
            </h2>
            <p style={{ color: MKT.text2, fontSize: 14.5, textAlign: 'center', margin: '0 0 28px' }}>
              Mută sliderul și vezi pe loc, cu procentele reale din program.
            </p>

            {/* Slider */}
            <div style={{ maxWidth: 560, margin: '0 auto 30px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 12,
                  gap: 12,
                }}
              >
                <label htmlFor="afiliat-count" style={{ color: MKT.text, fontWeight: 600, fontSize: 15 }}>
                  Câte restaurante recomanzi?
                </label>
                <span
                  style={{
                    fontFamily: 'Fraunces, Georgia, serif',
                    fontSize: '2rem',
                    fontWeight: 700,
                    // accentInk: aurul viu pică sub 3:1 pe fundal deschis (AA text mare).
                    color: MKT.accentInk,
                    lineHeight: 1,
                  }}
                >
                  {count}
                </span>
              </div>
              <input
                id="afiliat-count"
                type="range"
                min={1}
                max={20}
                step={1}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="afiliat-range"
                style={
                  // Track auriu până la valoarea curentă, restul bej deschis —
                  // variabila e citită de pseudo-elementele de track din <style>.
                  { '--afiliat-fill': `${fillPct}%` } as React.CSSProperties
                }
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', color: MKT.text3, fontSize: 12, marginTop: 6 }}>
                <span>1</span>
                <span>20</span>
              </div>
            </div>

            {/* Rezultate live */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: stacked ? '1fr' : '1fr 1fr',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div style={calcRow}>
                <div style={calcLabel}>Bonus de activare (o dată)</div>
                <div style={calcValue}>{lei(setupBonus)} lei</div>
              </div>
              <div style={calcRow}>
                <div style={calcLabel}>Venit lunar recurent</div>
                <div style={calcValue}>{lei(monthly)} lei/lună</div>
              </div>
            </div>
            {/* aria-live pe containerul STABIL (nu pe copilul remontat prin
                key) — SR-ul anunță totalul recalculat la fiecare pas de slider. */}
            <div
              aria-live="polite"
              aria-atomic="true"
              style={{
                background: MKT.accentSoft,
                border: `1.5px solid ${MKT.accent}`,
                borderRadius: 16,
                padding: '22px 20px',
                textAlign: 'center',
              }}
            >
              <div style={{ color: MKT.text2, fontSize: 13.5, marginBottom: 6 }}>
                Total în primul an
              </div>
              {/* key={firstYear} remontează elementul → animația scaleIn rulează
                  la fiecare schimbare. Sub reduced-motion: fără clasă, fără remount. */}
              <div
                key={reduced ? 'static' : firstYear}
                className={reduced ? undefined : 'animate-scale'}
                style={{
                  fontFamily: 'Fraunces, Georgia, serif',
                  fontSize: 'clamp(2.4rem, 6vw, 3.4rem)',
                  fontWeight: 700,
                  color: MKT.accentInk,
                  lineHeight: 1.1,
                  letterSpacing: '-0.02em',
                }}
              >
                {lei(firstYear)} lei
              </div>
            </div>
            <div style={{ color: MKT.text3, fontSize: 12.5, textAlign: 'center', marginTop: 14, lineHeight: 1.55 }}>
              Calcul pe planul {growth.name}, {price.toLocaleString('ro-RO')} lei/lună — cu
              Fiscalizare câștigi mai mult. Comisionul lunar se plătește{' '}
              {defaults.recurring_cap_months.toLocaleString('ro-RO')} luni per restaurant
              {defaults.recurring_cap_months > 12
                ? ' (în totalul de mai sus intră doar primele 12, cât încape în primul an)'
                : ''}
              .
            </div>
          </div>
        </RevealItem>

        {/* ── Cum funcționează — 3 pași pe orizontală ── */}
        <RevealItem>
          <h2
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 'clamp(1.5rem, 3vw, 1.9rem)',
              color: MKT.text,
              fontWeight: 700,
              textAlign: 'center',
              margin: '72px 0 36px',
              letterSpacing: '-0.02em',
            }}
          >
            Cum funcționează
          </h2>
        </RevealItem>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: stacked ? '1fr' : '1fr auto 1fr auto 1fr',
            gap: stacked ? 20 : 8,
            alignItems: 'start',
            marginBottom: 72,
          }}
        >
          {STEPS.flatMap((s, i) => {
            const step = (
              <RevealItem key={s.title} delay={i * 90}>
                <div style={{ textAlign: 'center', padding: '0 10px' }}>
                  <div
                    style={{
                      fontFamily: 'Fraunces, Georgia, serif',
                      fontSize: '3rem',
                      fontWeight: 700,
                      color: MKT.accentInk,
                      lineHeight: 1,
                      marginBottom: 12,
                    }}
                  >
                    {i + 1}
                  </div>
                  <div style={{ fontWeight: 700, color: MKT.text, fontSize: 16, marginBottom: 8 }}>
                    {s.title}
                  </div>
                  <div style={{ color: MKT.text2, fontSize: 14, lineHeight: 1.6 }}>{s.text}</div>
                </div>
              </RevealItem>
            )
            // Săgeată aurie între pași, doar pe desktop (celulă separată în grid).
            if (stacked || i === STEPS.length - 1) return [step]
            return [
              step,
              <div
                key={`arrow-${i}`}
                aria-hidden
                style={{
                  color: MKT.accent,
                  fontSize: 26,
                  fontWeight: 300,
                  alignSelf: 'center',
                  opacity: 0.7,
                }}
              >
                →
              </div>,
            ]
          })}
        </div>

        {/* ── Bandă de încredere ── */}
        <RevealItem>
          <div
            style={{
              background: MKT.surface2,
              borderRadius: 18,
              padding: stacked ? '26px 22px' : '34px 36px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: 22,
              marginBottom: 72,
            }}
          >
            {TRUST_ITEMS.map((t) => (
              <div key={t.icon} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: MKT.accentSoft,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon name={t.icon} size={19} color={MKT.accent} />
                </div>
                <span style={{ color: MKT.text2, fontSize: 13.5, lineHeight: 1.6 }}>{t.text}</span>
              </div>
            ))}
          </div>
        </RevealItem>

        {/* ── FAQ scurt ── */}
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <RevealItem>
            <h2
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 'clamp(1.4rem, 3vw, 1.6rem)',
                color: MKT.text,
                fontWeight: 700,
                textAlign: 'center',
                margin: '0 0 26px',
                letterSpacing: '-0.02em',
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
                  aria-controls={`afiliat-faq-${i}`}
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
                  id={`afiliat-faq-${i}`}
                  aria-hidden={!isOpen}
                  style={{
                    display: 'grid',
                    gridTemplateRows: isOpen ? '1fr' : '0fr',
                    opacity: isOpen ? 1 : 0,
                    transition: `grid-template-rows ${MOTION.normal}ms ${MOTION.easeOut}, opacity ${MOTION.normal}ms ${MOTION.easeOut}`,
                  }}
                >
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '0 18px 16px', color: MKT.text2, fontSize: 14, lineHeight: 1.65 }}>
                      {f.a}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </main>

      {/* ── CTA final — oglinda dark a hero-ului ── */}
      <div style={{ background: DARK.bg, padding: '72px 24px', textAlign: 'center' }}>
        <RevealItem>
          <h3
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 'clamp(1.6rem, 3.4vw, 2.1rem)',
              color: DARK.text,
              fontWeight: 700,
              margin: '0 0 14px',
              letterSpacing: '-0.02em',
              textWrap: 'balance',
            }}
          >
            Prima recomandare poate fi săptămâna asta.
          </h3>
          <p style={{ color: DARK.text2, fontSize: 15, margin: '0 auto 28px', maxWidth: 480, lineHeight: 1.6 }}>
            Cont într-un minut, link unic pe loc. Restul — restaurantele pe care deja le cunoști.
          </p>
          <button onClick={onLogin} className="pressable hover-lift" style={goldCta}>
            Înscrie-te în program →
          </button>
          <div style={{ color: DARK.text3, fontSize: 13, marginTop: 14 }}>
            Fără costuri · Fără target · Plată lunară pe factură
          </div>
        </RevealItem>
      </div>

      <MarketingFooter />
    </div>
  )
}

// Stiluri reutilizate în calculator.
const calcRow: React.CSSProperties = {
  background: MKT.surface2,
  borderRadius: 14,
  padding: '16px 18px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
}

const calcLabel: React.CSSProperties = {
  color: MKT.text2,
  fontSize: 13.5,
  lineHeight: 1.4,
}

const calcValue: React.CSSProperties = {
  fontFamily: 'Fraunces, Georgia, serif',
  fontSize: '1.35rem',
  fontWeight: 700,
  color: MKT.text,
  whiteSpace: 'nowrap',
}
