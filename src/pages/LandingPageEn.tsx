// =============================================================
// LandingPageEn — English landing page for diaspora restaurant owners
// (ES/IT/DE) and non-RO partners, served at /en.
//
// SELF-CONTAINED on purpose: its own header + footer inline, English
// copy only. Does NOT reuse MarketingHeader/MarketingFooter (those are
// Romanian-only chrome) — but does reuse the generic, language-neutral
// primitives (MKT tokens, Icon, RevealItem, useIsMobile) exactly like
// every other marketing page.
//
// Condensed vs. LandingPage.tsx: no affiliate section, no comparison
// table, no plan-highlight card — just enough to convert a diaspora
// owner in one scroll. Copy rule (same as RO pages): honest, no empty
// superlatives, no "no card required" promise (see CLAUDE.md).
// =============================================================
import { useEffect, useState, type CSSProperties } from 'react'
import { MKT } from '../lib/marketing'
import { MOTION } from '../lib/motion'
import { RevealItem } from '../components/marketing/Reveal'
import { Icon, type IconName } from '../components/ui/Icon'
import { useIsMobile } from '../hooks/useIsMobile'

const BENEFITS: { icon: IconName; title: string; desc: string }[] = [
  {
    icon: 'qr',
    title: 'QR menu, no hardware',
    desc: 'Guests scan, browse and order from their own phone. No app to install, no tablets to buy.',
  },
  {
    icon: 'utensils',
    title: 'Orders straight to the kitchen',
    desc: 'Every order lands on a live kitchen screen the moment it is placed — nothing shouted, nothing lost.',
  },
  {
    icon: 'sparkle',
    title: 'Menus in 7 languages',
    desc: 'Romanian, English, German, French, Italian, Hungarian, Spanish — write it once, guests read it in theirs.',
  },
  {
    icon: 'edit',
    title: 'Edit prices in seconds',
    desc: 'Change a price or 86 a dish from your phone — no reprinting, no waiting on a designer.',
  },
  {
    icon: 'bell',
    title: 'Call staff or ask for the bill',
    desc: 'A tap on the guest’s phone reaches your team instantly — fewer trips back and forth.',
  },
  {
    icon: 'chart',
    title: 'Simple daily reports',
    desc: 'See what sold today and this week without digging through spreadsheets.',
  },
]

const ROMANIA_POINTS: { icon: IconName; text: string }[] = [
  { icon: 'mapPin', text: 'Built in Romania, made for restaurants everywhere' },
  { icon: 'lock', text: 'EU data residency, GDPR by default' },
  { icon: 'phone', text: 'Support on WhatsApp, direct with the founder' },
]

const STEPS = [
  {
    n: '1',
    title: 'Add your menu',
    desc: 'Type it in, or import it from photos with AI. Ready in a few minutes.',
  },
  {
    n: '2',
    title: 'Generate your table QR codes',
    desc: 'Tell it how many tables you have — a print-ready PDF is ready in 30 seconds.',
  },
  {
    n: '3',
    title: 'Orders start coming in',
    desc: 'Guests order from their phone, your kitchen sees it live.',
  },
]

const FAQ = [
  {
    q: 'Do I need any special hardware?',
    a: 'No. It runs on any phone or tablet you already have. For the kitchen, any screen with a browser works.',
  },
  {
    q: 'What languages can the menu show?',
    a: 'Romanian, English, German, French, Italian, Hungarian and Spanish — you write the menu once and pick which languages to show. Guests choose their own.',
  },
  {
    q: 'What happens to my data?',
    a: 'Servers are in the European Union, GDPR by default. You can export your data anytime, and we delete it fully if you close your account.',
  },
  {
    q: 'Can I keep my current till and payment setup?',
    a: 'Yes. On the Digital Menu and Menu + Orders plans, payment and the receipt stay exactly as they are today — Menuvia sits on top, it does not replace your till.',
  },
]

export default function LandingPageEn({
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
  const stacked = useIsMobile(900)

  // Page title for SEO/share — restored on unmount (SPA: otherwise this
  // title leaks onto whatever route the visitor navigates to next).
  useEffect(() => {
    const prev = document.title
    document.title = 'Menuvia — QR menu & ordering for restaurants'
    // index.html hardcodează <html lang="ro">; pe /en conținutul e integral
    // în engleză → setăm lang='en' cât timp pagina e montată (WCAG 3.1.1 +
    // semnal corect de limbă pentru crawlere), restaurat la demontare.
    const prevLang = document.documentElement.lang
    document.documentElement.lang = 'en'
    return () => {
      document.title = prev
      document.documentElement.lang = prevLang
    }
  }, [])

  const ctaBtn: CSSProperties = {
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
  const ghostBtn: CSSProperties = {
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
  const sectionTitle: CSSProperties = {
    fontFamily: 'Fraunces,serif',
    fontSize: 'clamp(1.6rem, 3.4vw, 2.1rem)',
    color: MKT.text,
    fontWeight: 700,
    textAlign: 'center',
    letterSpacing: '-0.02em',
    textWrap: 'balance',
  }
  const navLinkStyle: CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: MKT.text2,
    fontSize: 14.5,
    fontWeight: 600,
    fontFamily: 'DM Sans,sans-serif',
    cursor: 'pointer',
    // Touch target ≥44px (WCAG 2.5.5): pe mobil butonul „Log in" e singura
    // acțiune vizibilă din header — paritate cu minHeight din MarketingHeader RO.
    minHeight: 44,
    padding: '8px 10px',
    display: 'inline-flex',
    alignItems: 'center',
  }

  return (
    <div style={{ minHeight: '100vh', background: MKT.bg, fontFamily: 'DM Sans,sans-serif' }}>
      {/* ── Header — own, inline, English-only chrome ────────── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'rgba(250,249,246,0.92)',
          backdropFilter: 'blur(8px)',
          borderBottom: `1px solid ${MKT.border}`,
        }}
      >
        <div
          style={{
            maxWidth: 1120,
            margin: '0 auto',
            padding: '14px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <a
            href="/en"
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 20,
              fontWeight: 700,
              color: MKT.text,
              textDecoration: 'none',
              letterSpacing: '-0.02em',
            }}
          >
            Menuvia
          </a>
          {!stacked && (
            <nav style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
              <a href="#features" style={navLinkStyle}>
                Features
              </a>
              <a href="#how-it-works" style={navLinkStyle}>
                How it works
              </a>
              <button onClick={onPricing} style={navLinkStyle}>
                Pricing
              </button>
              <button onClick={onDemo} style={navLinkStyle}>
                Demo
              </button>
              <button onClick={onLogin} style={navLinkStyle}>
                Log in
              </button>
            </nav>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            {/* Pe mobil nav-ul complet dispare, dar clientul existent trebuie
                să aibă o cale de login din header (paritate cu keepOnMobile
                din MarketingHeader pe landing-ul RO). */}
            {stacked && (
              <button onClick={onLogin} style={navLinkStyle}>
                Log in
              </button>
            )}
            <button
              onClick={() => onStartPlan('growth')}
              className="pressable"
              style={{
                background: MKT.accent,
                color: MKT.onAccent,
                border: 'none',
                borderRadius: 10,
                padding: '10px 18px',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
                whiteSpace: 'nowrap',
              }}
            >
              Start free
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────────── */}
      <div
        style={{
          maxWidth: 880,
          margin: '0 auto',
          padding: stacked ? '56px 24px 48px' : '88px 24px 72px',
          textAlign: 'center',
        }}
      >
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
          QR menu + ordering, built for restaurants
        </div>
        <h1
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: 'clamp(2.1rem, 5vw, 3.2rem)',
            color: MKT.text,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
            marginBottom: 20,
            textWrap: 'balance',
          }}
        >
          A QR menu and orders straight to the kitchen. No hardware, live in 10 minutes.
        </h1>
        <p
          style={{
            color: MKT.text2,
            fontSize: 'clamp(1.05rem, 2vw, 1.2rem)',
            maxWidth: 560,
            margin: '0 auto 32px',
            lineHeight: 1.65,
            textWrap: 'balance',
          }}
        >
          Guests scan a code at the table, order from their own phone, and it lands on your
          kitchen screen in real time. Set up your menu today, take your first order tonight.
        </p>
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <button onClick={() => onStartPlan('growth')} className="pressable" style={ctaBtn}>
            Start free — 30 days
          </button>
          <button onClick={onDemo} className="pressable" style={ghostBtn}>
            See live demo
          </button>
        </div>
        <div style={{ color: MKT.text3, fontSize: 13, marginTop: 18 }}>
          Live in 10 minutes · Cancel anytime · Support on WhatsApp
        </div>
      </div>

      {/* ── Band: "Built in Romania, made for restaurants everywhere" ── */}
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

      {/* ── Benefits ──────────────────────────────────────────── */}
      <div id="features" style={{ padding: '76px 24px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <RevealItem>
            <h2 style={{ ...sectionTitle, marginBottom: 40 }}>
              Everything a restaurant needs. Nothing it doesn’t.
            </h2>
          </RevealItem>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
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

      {/* ── How it works ─────────────────────────────────────── */}
      <div
        id="how-it-works"
        style={{ scrollMarginTop: 80, maxWidth: 880, margin: '0 auto', padding: '0 24px 76px' }}
      >
        <RevealItem>
          <h2 style={{ ...sectionTitle, marginBottom: 44 }}>Live in 3 steps</h2>
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
            See live demo
          </button>
        </div>
      </div>

      {/* ── Pricing teaser (honest — no "no card required") ──── */}
      <div style={{ background: MKT.surface2, padding: '72px 24px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
          <RevealItem>
            <h2 style={{ ...sectionTitle, marginBottom: 14 }}>Simple, honest pricing</h2>
            <p
              style={{
                color: MKT.text2,
                fontSize: 15,
                lineHeight: 1.65,
                marginBottom: 26,
                textWrap: 'balance',
              }}
            >
              Plans start at 99 lei/month (≈ €20). Pick the plan that fits, cancel anytime —
              no long contracts.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={onPricing} className="pressable" style={ctaBtn}>
                See pricing
              </button>
              <button onClick={() => onStartPlan('starter')} className="pressable" style={ghostBtn}>
                Start free — 30 days
              </button>
            </div>
          </RevealItem>
        </div>
      </div>

      {/* ── FAQ ───────────────────────────────────────────────── */}
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '76px 24px' }}>
        <RevealItem>
          <h2
            style={{
              ...sectionTitle,
              fontSize: 'clamp(1.4rem, 3vw, 1.6rem)',
              marginBottom: 28,
            }}
          >
            Frequently asked questions
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
              {/* aria-hidden on collapsed: the hiding is purely visual (0fr +
                  opacity) — otherwise screen readers announce "closed" answers. */}
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

      {/* ── Final CTA ─────────────────────────────────────────── */}
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
            Ready to get started?
          </h3>
          <p style={{ color: MKT.text2, fontSize: 15, marginBottom: 28 }}>
            30 days free. Live in 10 minutes. Cancel anytime.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => onStartPlan('growth')} className="pressable" style={ctaBtn}>
              Start with Menu + Orders
            </button>
            <button onClick={onPricing} className="pressable" style={ghostBtn}>
              See pricing
            </button>
          </div>
        </RevealItem>
      </div>

      {/* ── Footer — own, minimal, inline ────────────────────── */}
      <footer
        style={{
          borderTop: `1px solid ${MKT.border}`,
          background: MKT.bg,
          fontFamily: 'DM Sans,sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: 1040,
            margin: '0 auto',
            padding: '32px 24px 24px',
            display: 'flex',
            flexDirection: stacked ? 'column' : 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 18,
              justifyContent: 'center',
            }}
          >
            <a href="/" style={{ color: MKT.text2, fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>
              Română →
            </a>
            <a href="/termeni" style={{ color: MKT.text3, fontSize: 13, textDecoration: 'none' }}>
              Terms
            </a>
            <a href="/confidentialitate" style={{ color: MKT.text3, fontSize: 13, textDecoration: 'none' }}>
              Privacy
            </a>
            <a href="/cookies" style={{ color: MKT.text3, fontSize: 13, textDecoration: 'none' }}>
              Cookies
            </a>
            <a href="/dpa" style={{ color: MKT.text3, fontSize: 13, textDecoration: 'none' }}>
              DPA
            </a>
          </div>
          <div style={{ color: MKT.text3, fontSize: 12 }}>
            © {new Date().getFullYear()} MENUVIA · Made in Romania · Data hosted in the EU
          </div>
        </div>
      </footer>
    </div>
  )
}
