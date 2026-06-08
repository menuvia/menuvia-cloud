import React, { useEffect, useState, useRef, Suspense, lazy } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { RestaurantProvider, useRestaurantCtx } from './contexts/RestaurantContext'
import { supabase, SUPABASE_CONFIGURED } from './lib/supabase'
import { queryClient } from './lib/queryClient'
import { useRestaurants } from './hooks/useData'
import { PageSpinner, ConfigError, ErrorBoundary, QueryError } from './components/PageLoader'
import CookieBanner from './components/CookieBanner'
import LegalFooter from './components/LegalFooter'
import { ToastProvider } from './components/ui/Toast'
import { ConfirmRoot } from './components/ui/ConfirmDialog'
import type { MemberRole } from './lib/constants'
import { D } from './lib/constants'

// ── Eager: tiny, always-needed pages ─────────────────────────
import AuthPage from './pages/AuthPage'
import OnboardingPage from './pages/OnboardingPage'

// ── Lazy: heavy pages loaded on demand ───────────────────────
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const QrMenuPage = lazy(() => import('./pages/QrMenuPage'))
const KitchenPage = lazy(() => import('./pages/KitchenPage'))
const WaiterPage = lazy(() => import('./pages/WaiterPage'))
const PublicMenuPage = lazy(() => import('./pages/PublicMenuPage'))
const InviteAcceptPage = lazy(() => import('./pages/InviteAcceptPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const DemoPage = lazy(() => import('./pages/DemoPage'))
const RecrutarePage = lazy(() => import('./pages/RecrutarePage'))
const LegalPage = lazy(() => import('./pages/LegalPage'))
const PWAPrompt = lazy(() => import('./components/PWAPrompt'))

type View =
  | 'landing'
  | 'auth'
  | 'onboarding'
  | 'dashboard'
  | 'menu'
  | 'qr'
  | 'kitchen'
  | 'waiter'
  | 'invite'
  | 'pricing'
  | 'reset-password'
  | 'demo'
  | 'recrutare'
  | 'legal-terms'
  | 'legal-privacy'
  | 'legal-cookies'
  | 'legal-dpa'
  | 'notfound'

interface RouteState {
  view: View
  slug?: string
  token?: string
}

// VITE_WHATSAPP_NUMBER e numărul fondatorului (format internațional fără +,
// ex: 40751234567). Lipsa env var → întoarce null → CTA-urile WhatsApp sunt
// ascunse complet (fail-safe pentru preview/staging unde nu vrem să trimitem
// trafic real către un număr de prod).
function whatsappUrl(prefilledText: string): string | null {
  const number = import.meta.env.VITE_WHATSAPP_NUMBER
  if (!number || typeof number !== 'string' || !number.trim()) return null
  return `https://wa.me/${number.trim()}?text=${encodeURIComponent(prefilledText)}`
}

function parsePath(): RouteState {
  const p = window.location.pathname
  const qrMatch = p.match(/^\/q\/(.+)$/)
  const menuMatch = p.match(/^\/m\/(.+)$/)
  const inviteMatch = p.match(/^\/invite\/(.+)$/)
  if (qrMatch) return { view: 'qr', token: qrMatch[1] }
  if (menuMatch) return { view: 'menu', slug: menuMatch[1] }
  if (inviteMatch) return { view: 'invite', token: inviteMatch[1] }
  if (p === '/kitchen') return { view: 'kitchen' }
  if (p === '/waiter') return { view: 'waiter' }
  if (p === '/auth') return { view: 'auth' }
  if (p === '/reset-password') return { view: 'reset-password' }
  if (p === '/demo') return { view: 'demo' }
  if (p === '/recrutare' || p === '/pilot') return { view: 'recrutare' }
  if (p === '/dashboard') return { view: 'dashboard' }
  if (p === '/pricing') return { view: 'pricing' }
  if (p === '/termeni' || p === '/terms') return { view: 'legal-terms' }
  if (p === '/confidentialitate' || p === '/privacy') return { view: 'legal-privacy' }
  if (p === '/cookies') return { view: 'legal-cookies' }
  if (p === '/dpa') return { view: 'legal-dpa' }
  if (p === '/') return { view: 'landing' }
  return { view: 'notfound' }
}

async function getUserRoles(userId: string): Promise<MemberRole[]> {
  const { data } = await supabase
    .from('restaurant_memberships')
    .select('role')
    .eq('user_id', userId)
  return (data ?? []).map((r) => r.role as MemberRole)
}

// ── Landing page (unauthenticated visitors) ──────────────────
function LandingPage({
  onLogin,
  onPricing,
  onDemo,
}: {
  onLogin: () => void
  onPricing: () => void
  onDemo: () => void
}) {
  const features = [
    {
      icon: '📱',
      title: 'Meniu QR digital',
      desc: 'Clientul scanează, vede meniul și comandă direct de pe telefon.',
    },
    {
      icon: '👨‍🍳',
      title: 'Dashboard bucătărie',
      desc: 'Comenzile apar instant pe ecranul din bucătărie. Zero hârtie.',
    },
    {
      icon: '📊',
      title: 'Analytics & rapoarte',
      desc: 'Revenue, ore de vârf, top produse — totul într-un singur loc.',
    },
    {
      icon: '👥',
      title: 'Echipă & roluri',
      desc: 'Invită ospătar, bucătar, manager. Fiecare vede doar ce trebuie.',
    },
  ]
  const steps = [
    { n: '1', title: 'Creează cont', desc: '30 de secunde, gratuit.' },
    { n: '2', title: 'Adaugă meniul', desc: 'Manual sau cu AI din poză.' },
    { n: '3', title: 'Printează QR-urile', desc: 'PDF gata de tipar, pe fiecare masă.' },
  ]
  return (
    <div style={{ minHeight: '100vh', background: D.bg, fontFamily: 'DM Sans,sans-serif' }}>
      {/* Hero */}
      <div
        style={{ maxWidth: 800, margin: '0 auto', padding: '80px 24px 60px', textAlign: 'center' }}
      >
        <div
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: 52,
            color: D.gold,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            marginBottom: 16,
          }}
        >
          Menuvia
        </div>
        <h1
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: 28,
            color: D.t1,
            fontWeight: 700,
            lineHeight: 1.3,
            marginBottom: 16,
          }}
        >
          Meniu digital, comenzi QR și dashboard complet pentru restaurantul tău
        </h1>
        <p
          style={{
            color: D.t2,
            fontSize: 16,
            maxWidth: 500,
            margin: '0 auto 32px',
            lineHeight: 1.7,
          }}
        >
          Clienții comandă de pe telefon. Bucătăria primește instant. Tu vezi totul în timp real.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={onLogin}
            style={{
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 10,
              padding: '14px 32px',
              fontWeight: 700,
              fontSize: 15,
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
            }}
          >
            Începe gratuit
          </button>
          <button
            onClick={onDemo}
            style={{
              background: 'transparent',
              color: D.t1,
              border: `1px solid ${D.border}`,
              borderRadius: 10,
              padding: '14px 32px',
              fontWeight: 600,
              fontSize: 15,
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
            }}
          >
            Vezi demo
          </button>
        </div>
      </div>
      {/* Features */}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px 60px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
            gap: 16,
          }}
        >
          {features.map((f) => (
            <div
              key={f.title}
              style={{
                background: D.s1,
                border: `1px solid ${D.border}`,
                borderRadius: 14,
                padding: '24px 20px',
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
              <div
                style={{
                  fontFamily: 'Fraunces,serif',
                  fontSize: 16,
                  color: D.t1,
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                {f.title}
              </div>
              <div style={{ color: D.t2, fontSize: 13, lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Steps */}
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '0 24px 60px', textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: 22,
            color: D.t1,
            fontWeight: 700,
            marginBottom: 32,
          }}
        >
          Cum funcționează
        </div>
        <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
          {steps.map((s) => (
            <div key={s.n} style={{ flex: '1 1 150px', maxWidth: 180 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: D.goldA,
                  color: D.gold,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  fontWeight: 700,
                  margin: '0 auto 12px',
                  border: `1px solid ${D.gold}44`,
                }}
              >
                {s.n}
              </div>
              <div style={{ fontWeight: 600, color: D.t1, fontSize: 14, marginBottom: 4 }}>
                {s.title}
              </div>
              <div style={{ color: D.t3, fontSize: 13 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
      {/* CTA */}
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '0 24px 60px', textAlign: 'center' }}>
        <div
          style={{
            background: D.s1,
            border: `1px solid ${D.gold}33`,
            borderRadius: 18,
            padding: '40px 24px',
          }}
        >
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 24,
              color: D.t1,
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            Gratuit pentru început
          </div>
          <p style={{ color: D.t2, fontSize: 14, marginBottom: 20 }}>
            Plan gratuit cu până la 15 produse. Planuri plătite de la 99 lei/lună.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={onLogin}
              style={{
                background: D.gold,
                color: '#000',
                border: 'none',
                borderRadius: 10,
                padding: '14px 28px',
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
              }}
            >
              Creează cont
            </button>
            <button
              onClick={onPricing}
              style={{
                background: 'transparent',
                color: D.t2,
                border: `1px solid ${D.border}`,
                borderRadius: 10,
                padding: '14px 28px',
                fontWeight: 600,
                fontSize: 15,
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
              }}
            >
              Planuri și prețuri
            </button>
          </div>
        </div>
      </div>
      <LegalFooter />
    </div>
  )
}
function PricingPage({
  onBack,
  onLogin,
  onCheckout,
}: {
  onBack: () => void
  onLogin: () => void
  onCheckout: (plan: string) => void
}) {
  const [yearly, setYearly] = React.useState(false)
  const [loadingPlan, setLoadingPlan] = React.useState<string | null>(null)
  const [openFaq, setOpenFaq] = React.useState<number | null>(null)

  // ── Light palette — pricing page is marketing, not dashboard ──
  const L = {
    bg: '#FAF9F6', // off-white warm — NOT pure white, easier on eyes
    surface: '#FFFFFF', // cards pure white
    surface2: '#F5F1EA', // subtle differentiation for sections
    text: '#1A1208', // near-black warm
    text2: '#5C4A2A', // body text
    text3: '#9A8C7A', // muted text
    border: '#E8E0D2', // subtle warm border
    accent: '#C8963C', // gold — RESERVED for primary CTA only
    accentSoft: '#FAF3E5', // accent background (for badges)
    success: '#2D8659',
    successSoft: '#E8F2EC',
  }

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
  }> = [
    {
      id: 'starter',
      name: 'Starter',
      emoji: '🌱',
      price: 99,
      priceYearly: 83,
      badge: null,
      desc: 'Meniu digital QR pentru cafenele și locații mici.',
      features: [
        { t: 'Meniu QR digital', ok: true },
        { t: 'Până la 30 produse', ok: true },
        { t: 'Până la 5 mese', ok: true },
        { t: 'Imagini la produse', ok: true },
        { t: 'Alergeni + dietetic', ok: true },
        { t: 'Comenzi prin QR', ok: false },
        { t: 'Dashboard bucătărie', ok: false },
      ],
      cta: 'Începe 30 zile gratuit',
      ctaFn: onLogin,
      highlight: false,
    },
    {
      id: 'growth',
      name: 'Growth',
      emoji: '🚀',
      price: 249,
      priceYearly: 208,
      badge: 'Recomandat',
      desc: 'Pentru bistro-uri și restaurante care vor comenzi prin QR.',
      features: [
        { t: 'Produse și mese nelimitate', ok: true },
        { t: 'Comenzi prin QR', ok: true },
        { t: 'Cheamă ospătar / Cere nota', ok: true },
        { t: 'Dashboard bucătărie', ok: true },
        { t: 'Comenzi manuale ospătar', ok: true },
        { t: 'Plăți: cash, card la POS', ok: true },
        { t: 'Modifiers + Extras + Pereche', ok: true },
        { t: 'Echipă: până la 5 membri', ok: true },
        { t: 'Mod offline pentru ospătari', ok: true },
        { t: 'Rapoarte zilnice + săptămânale', ok: true },
        { t: 'Multilingv RO/EN inclus', ok: true },
        { t: 'Fără branding Menuvia', ok: true },
      ],
      cta: 'Începe 30 zile gratuit',
      ctaFn: () => onCheckout('growth'),
      highlight: true,
    },
    {
      id: 'pro',
      name: 'Pro',
      emoji: '💎',
      price: 499,
      priceYearly: 415,
      badge: null,
      desc: 'Pentru restaurante mari, lanțuri 1-2 locații.',
      features: [
        { t: 'Tot din Growth +', ok: true },
        { t: 'Echipă nelimitată', ok: true },
        { t: 'Alocare mese pe ospătari (ture)', ok: true },
        { t: 'Floor plan vizual', ok: true },
        { t: 'Rapoarte avansate (custom range)', ok: true },
        { t: 'Analytics ore de vârf', ok: true },
        { t: 'Import meniu cu AI (din poză)', ok: true },
        { t: 'Split bill', ok: true },
        { t: 'Sugestii la coș configurabile', ok: true },
        { t: 'Suport prioritar (răspuns 4h)', ok: true },
      ],
      cta: 'Începe 30 zile gratuit',
      ctaFn: () => onCheckout('pro'),
      highlight: false,
    },
  ]

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
      plans: 'Growth, Pro',
      desc: 'Clientul va plăti direct cu cardul, bacșiș integrat. În dezvoltare — momentan plata se face cash sau card la POS.',
    },
    {
      icon: '🔌',
      title: 'Integrare casă de marcat (pilot)',
      price: '+99 lei/lună',
      plans: 'Pro doar',
      desc: 'Conectare cu Datecs / Activa / Tremol prin FiscalNet. În pilot — disponibil pe bază de cerere, nu activat automat.',
    },
  ]

  const BONUSES = [
    { icon: '🔄', title: 'Migrare gratuită', desc: 'Vă mutăm meniul de la alt sistem.' },
    { icon: '💰', title: '30 zile garanție', desc: 'Bani înapoi integrali. Fără întrebări.' },
    { icon: '📄', title: 'QR-uri PDF nelimitate', desc: 'Generați câte vreți, oricând.' },
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
      a: 'Starter dacă vrei doar meniu digital citibil. Growth dacă vrei ca clienții să comande singuri prin QR — cel mai popular. Pro dacă ai 20+ mese, lanț cu 1-2 locații sau ai nevoie de integrare cu casa de marcat.',
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
      a: 'În pilot, ca extras pe planul Pro (+99 lei/lună). Suportăm Datecs, Activa și Tremol prin protocolul FiscalNet. Disponibil pe bază de cerere — ne asigurăm împreună că emiterea bonurilor funcționează corect pe casa ta înainte de activare.',
    },
    {
      q: 'Sunteți pe piață de mult?',
      a: 'Suntem o echipă mică din România, construim Menuvia full-time. Pentru primii patroni avem program pilot extins (60 zile gratis) și suport direct WhatsApp cu Radu, fondatorul.',
    },
  ]

  return (
    <div
      style={{
        minHeight: '100vh',
        background: L.bg,
        fontFamily: 'DM Sans,sans-serif',
        color: L.text,
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
              color: L.text2,
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
              color: L.text,
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
              color: L.text2,
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontFamily: 'DM Sans,sans-serif',
            }}
          >
            Autentificare
          </button>
        </div>

        {/* Hero */}
        <div style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto 56px' }}>
          <h1
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 'clamp(2.2rem, 6vw, 3.4rem)',
              color: L.text,
              fontWeight: 600,
              marginBottom: 16,
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
            }}
          >
            Prețuri simple,
            <br />
            fără surprize
          </h1>
          <p
            style={{
              color: L.text2,
              fontSize: '1.1rem',
              marginBottom: 32,
              lineHeight: 1.6,
              fontWeight: 400,
            }}
          >
            30 de zile gratuite pe orice plan. Fără card. Anulezi oricând.
          </p>

          {/* Yearly toggle */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 14,
              background: L.surface,
              border: `1px solid ${L.border}`,
              borderRadius: 100,
              padding: '7px 18px',
              boxShadow: '0 1px 3px rgba(26,18,8,0.04)',
            }}
          >
            <span
              style={{
                fontSize: '0.9rem',
                color: yearly ? L.text3 : L.text,
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
                background: yearly ? L.accent : L.border,
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
                  color: yearly ? L.text : L.text3,
                  fontWeight: yearly ? 600 : 400,
                  transition: 'all 0.2s',
                }}
              >
                Anual
              </span>
              <span
                style={{
                  fontSize: '0.7rem',
                  background: L.successSoft,
                  color: L.success,
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
            background: L.accentSoft,
            border: `1px solid ${L.accent}`,
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
                color: L.text,
                fontWeight: 600,
                marginBottom: 3,
              }}
            >
              Program Pilot — 60 de zile gratis
            </div>
            <div style={{ fontSize: '0.85rem', color: L.text2, lineHeight: 1.5 }}>
              Primii 10 patroni primesc setup personal cu Radu și 60 zile gratis pe Growth. Locuri
              rămase: limitate.
            </div>
          </div>
          {(() => {
            const url = whatsappUrl('Salut Radu, m-ar interesa programul pilot Menuvia')
            if (!url) return null
            return (
          <button
            onClick={() => window.open(url, '_blank')}
            style={{
              background: L.accent,
              color: '#fff',
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
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 18,
            marginBottom: 24,
          }}
        >
          {PLANS.map((p) => {
            const price = yearly ? p.priceYearly : p.price
            const isContact = p.price === null
            const isHighlight = p.highlight
            return (
              <div
                key={p.id}
                style={{
                  background: L.surface,
                  borderRadius: 18,
                  padding: '32px 26px',
                  border: `1px solid ${isHighlight ? L.accent : L.border}`,
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  boxShadow: isHighlight
                    ? '0 8px 32px rgba(200,150,60,0.18), 0 2px 8px rgba(26,18,8,0.05)'
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
                      background: L.accent,
                      color: '#fff',
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
                      color: L.text,
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
                        color: L.text,
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
                          color: L.text,
                          fontWeight: 600,
                          letterSpacing: '-0.03em',
                          lineHeight: 1,
                        }}
                      >
                        {price}
                      </span>
                      <span
                        style={{
                          color: L.text3,
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
                      color: L.success,
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
                    color: L.text2,
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
                        color: f.ok ? L.text : L.text3,
                        opacity: f.ok ? 1 : 0.55,
                      }}
                    >
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: f.ok ? L.successSoft : 'transparent',
                          border: `1.5px solid ${f.ok ? L.success : L.border}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.7rem',
                          color: f.ok ? L.success : L.text3,
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
                    border: isHighlight ? 'none' : `1.5px solid ${L.border}`,
                    background: isHighlight ? L.accent : L.surface,
                    color: isHighlight ? '#fff' : L.text,
                    opacity: loadingPlan === p.id ? 0.6 : 1,
                    boxShadow: isHighlight ? '0 4px 14px rgba(200,150,60,0.3)' : 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  {loadingPlan === p.id ? 'Se procesează...' : p.cta}
                </button>
              </div>
            )
          })}
        </div>

        {/* Trust line */}
        <div
          style={{
            textAlign: 'center',
            color: L.text3,
            fontSize: '0.88rem',
            marginBottom: 16,
            fontWeight: 400,
          }}
        >
          Toate planurile includ migrare gratuită din alt sistem și 30 zile garanție bani înapoi.
        </div>

        {/* Custom / Enterprise inquiry */}
        {(() => {
          const url = whatsappUrl('Salut Radu, avem 3+ locații și am vrea o ofertă custom')
          if (!url) return null
          return (
        <div style={{ textAlign: 'center', marginBottom: 80, fontSize: '0.88rem', color: L.text2 }}>
          Ai 3+ locații sau nevoi custom?{' '}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: L.accent, textDecoration: 'underline', fontWeight: 500 }}
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
          background: L.surface2,
          padding: '60px 20px',
          borderTop: `1px solid ${L.border}`,
          borderBottom: `1px solid ${L.border}`,
        }}
      >
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: 'clamp(1.6rem, 4vw, 2.2rem)',
                color: L.text,
                fontWeight: 600,
                marginBottom: 10,
                letterSpacing: '-0.02em',
              }}
            >
              Extras pentru toate planurile
            </h2>
            <p style={{ color: L.text2, fontSize: '1rem', lineHeight: 1.6 }}>
              Adaugă funcționalități suplimentare oricând, anulezi oricând.
            </p>
          </div>

          {/* One-time */}
          <div
            style={{
              marginBottom: 14,
              fontSize: '0.78rem',
              fontWeight: 700,
              color: L.text3,
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
                  background: L.surface,
                  border: `1px solid ${L.border}`,
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
                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: L.text }}>
                      {e.title}
                    </span>
                    <span
                      style={{
                        fontSize: '0.92rem',
                        fontWeight: 700,
                        color: L.accent,
                        whiteSpace: 'nowrap',
                        fontFamily: 'Fraunces,serif',
                      }}
                    >
                      {e.price}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: L.text2, lineHeight: 1.55 }}>
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
              color: L.text3,
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
                  background: L.surface,
                  border: `1px solid ${L.border}`,
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
                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: L.text }}>
                      {e.title}
                    </span>
                    <span
                      style={{
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        color: L.accent,
                        whiteSpace: 'nowrap',
                        fontFamily: 'Fraunces,serif',
                      }}
                    >
                      {e.price}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: L.text3, marginBottom: 6 }}>
                    📌 Disponibil pe: {e.plans}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: L.text2, lineHeight: 1.55 }}>
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
                color: L.text,
                fontWeight: 600,
                marginBottom: 10,
                letterSpacing: '-0.02em',
              }}
            >
              🎁 Bonusuri incluse, gratuit
            </h2>
            <p style={{ color: L.text2, fontSize: '1rem', lineHeight: 1.6 }}>
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
                  background: L.surface,
                  border: `1px solid ${L.border}`,
                  borderRadius: 12,
                }}
              >
                <span style={{ fontSize: '1.4rem', flexShrink: 0 }}>{b.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{ fontSize: '0.92rem', fontWeight: 600, color: L.text, marginBottom: 3 }}
                  >
                    {b.title}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: L.text2, lineHeight: 1.55 }}>
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
        style={{ background: L.surface2, padding: '60px 20px', borderTop: `1px solid ${L.border}` }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 'clamp(1.6rem, 4vw, 2.2rem)',
              color: L.text,
              textAlign: 'center',
              marginBottom: 36,
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            Întrebări frecvente
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FAQ.map((item, i) => (
              <div
                key={i}
                style={{
                  background: L.surface,
                  border: `1px solid ${L.border}`,
                  borderRadius: 12,
                  overflow: 'hidden',
                }}
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
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
                  <span style={{ fontSize: '0.95rem', color: L.text, fontWeight: 600 }}>
                    {item.q}
                  </span>
                  <span
                    style={{
                      color: L.text3,
                      fontSize: '1.1rem',
                      transition: 'transform .2s',
                      transform: openFaq === i ? 'rotate(45deg)' : 'none',
                      flexShrink: 0,
                      fontWeight: 300,
                    }}
                  >
                    +
                  </span>
                </button>
                {openFaq === i && (
                  <div
                    style={{
                      padding: '0 20px 18px',
                      fontSize: '0.9rem',
                      color: L.text2,
                      lineHeight: 1.7,
                    }}
                  >
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Final CTA */}
      <div style={{ padding: '60px 20px 80px', textAlign: 'center', background: L.bg }}>
        <h3
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: 'clamp(1.5rem, 3vw, 2rem)',
            color: L.text,
            fontWeight: 600,
            marginBottom: 14,
            letterSpacing: '-0.02em',
          }}
        >
          Gata să începi?
        </h3>
        <p style={{ color: L.text2, fontSize: '1rem', marginBottom: 28, lineHeight: 1.6 }}>
          30 zile gratuite, fără card. Setup în 10 minute.
        </p>
        <button
          onClick={() => onCheckout('growth')}
          style={{
            background: L.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            padding: '16px 36px',
            fontSize: '1rem',
            fontWeight: 700,
            fontFamily: 'DM Sans,sans-serif',
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(200,150,60,0.3)',
          }}
        >
          Începe gratuit Growth →
        </button>
      </div>
    </div>
  )
}

function NotFoundPage({ navigate }: { navigate: (p: string) => void }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: D.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'DM Sans,sans-serif',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <div>
        <div style={{ fontFamily: 'Fraunces,serif', fontSize: 72, color: D.s3, fontWeight: 700 }}>
          404
        </div>
        <div style={{ color: D.t2, fontSize: 16, marginBottom: 24 }}>Pagina nu a fost găsită.</div>
        <button
          onClick={() => navigate('/')}
          style={{
            background: D.gold,
            color: '#000',
            border: 'none',
            borderRadius: 10,
            padding: '12px 28px',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            fontFamily: 'DM Sans,sans-serif',
          }}
        >
          Acasă
        </button>
      </div>
    </div>
  )
}

function ProtectedRoute({
  roles,
  children,
  navigate,
}: {
  roles: MemberRole[]
  children: React.ReactNode
  navigate: (p: string) => void
}) {
  const { user, loading: authLoading } = useAuth()
  // FIX: Folosim activeRole din RestaurantContext în loc de getUserRoles() (DB call extra)
  const { activeRole, loading: ctxLoading } = useRestaurantCtx()

  useEffect(() => {
    if (authLoading || ctxLoading) return
    if (!user) {
      navigate('/auth')
      return
    }
  }, [user, authLoading, ctxLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || ctxLoading) return <PageSpinner />
  if (!user) return <PageSpinner />

  // activeRole poate fi null dacă userul nu e member (nu are restaurant)
  const allowed = activeRole != null && roles.includes(activeRole)
  if (!allowed)
    return (
      <div
        style={{
          minHeight: '100vh',
          background: D.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <QueryError
          message="Nu ai acces la această pagină. Contactează managerul restaurantului."
          onRetry={() => navigate('/dashboard')}
        />
      </div>
    )
  return <>{children}</>
}

function AppRouter() {
  const { user, loading, signOut } = useAuth()
  const { restaurants, loading: rLoading, refetch } = useRestaurants()
  const [state, setState] = useState<RouteState>(parsePath)

  // FE-001 FIX: separate navigate (push) from replace (no history entry).
  // Redirects after auth use replace → back button doesn't return to /auth → no infinite loop.
  const navigate = (path: string) => {
    window.history.pushState({}, '', path)
    setState(parsePath())
  }
  const replace = (path: string) => {
    window.history.replaceState({}, '', path)
    setState(parsePath())
  }

  useEffect(() => {
    const h = () => setState(parsePath())
    window.addEventListener('popstate', h)
    return () => window.removeEventListener('popstate', h)
  }, [])

  // Track if we've already auto-redirected this user this session.
  // Prevents redirect loop when user clicks back after login.
  const autoRedirectedRef = useRef(false)

  useEffect(() => {
    if (loading || !user || state.view !== 'auth') return
    if (autoRedirectedRef.current) return // FE-001: don't re-redirect
    autoRedirectedRef.current = true
    getUserRoles(user.id)
      .then((roles) => {
        if (roles.length === 0) {
          replace('/dashboard')
          return
        }
        const isOnlyKitchen = roles.every((r) => r === 'kitchen')
        const isOnlyWaiter = roles.every((r) => r === 'waiter')
        if (isOnlyKitchen) {
          replace('/kitchen')
          return
        }
        if (isOnlyWaiter) {
          replace('/waiter')
          return
        }
        replace('/dashboard')
      })
      .catch(() => {
        replace('/dashboard')
      })
  }, [user, loading, state.view])

  // Reset auto-redirect flag when user signs out
  useEffect(() => {
    if (!user) autoRedirectedRef.current = false
  }, [user])

  if (
    loading ||
    (user &&
      rLoading &&
      ![
        'qr',
        'menu',
        'invite',
        'kitchen',
        'waiter',
        'pricing',
        'reset-password',
        'demo',
        'notfound',
        'landing',
      ].includes(state.view))
  )
    return <PageSpinner />

  // ── Public routes (no auth needed) ─────────────────────────
  if (state.view === 'qr' && state.token)
    return (
      <Suspense fallback={<PageSpinner />}>
        <QrMenuPage token={state.token} />
      </Suspense>
    )
  if (state.view === 'menu' && state.slug)
    return (
      <Suspense fallback={<PageSpinner />}>
        <PublicMenuPage slug={state.slug} onBack={() => navigate(user ? '/dashboard' : '/')} />
      </Suspense>
    )
  if (state.view === 'invite' && state.token)
    return (
      <Suspense fallback={<PageSpinner />}>
        <InviteAcceptPage token={state.token} navigate={navigate} />
      </Suspense>
    )
  if (state.view === 'reset-password')
    return (
      <Suspense fallback={<PageSpinner />}>
        <ResetPasswordPage navigate={navigate} />
      </Suspense>
    )
  if (state.view === 'demo')
    return (
      <Suspense fallback={<PageSpinner />}>
        <DemoPage onBack={() => navigate('/')} />
      </Suspense>
    )
  if (state.view === 'recrutare')
    return (
      <Suspense fallback={<PageSpinner />}>
        <RecrutarePage navigate={navigate} />
      </Suspense>
    )
  if (state.view === 'legal-terms')
    return (
      <Suspense fallback={<PageSpinner />}>
        <LegalPage doc="terms" />
      </Suspense>
    )
  if (state.view === 'legal-privacy')
    return (
      <Suspense fallback={<PageSpinner />}>
        <LegalPage doc="privacy" />
      </Suspense>
    )
  if (state.view === 'legal-cookies')
    return (
      <Suspense fallback={<PageSpinner />}>
        <LegalPage doc="cookies" />
      </Suspense>
    )
  if (state.view === 'legal-dpa')
    return (
      <Suspense fallback={<PageSpinner />}>
        <LegalPage doc="dpa" />
      </Suspense>
    )
  if (state.view === 'pricing')
    return (
      <PricingPage
        onBack={() => navigate('/')}
        onLogin={() => navigate('/auth')}
        onCheckout={async (plan) => {
          if (!user) {
            navigate('/auth')
            return
          }
          try {
            const {
              data: { session: s },
            } = await supabase.auth.getSession()
            const res = await fetch('/.netlify/functions/stripe-checkout', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (s?.access_token || ''),
              },
              body: JSON.stringify({ plan }),
            })
            const d = await res.json()
            if (d.url) window.location.href = d.url
            else if (d.error === 'Stripe not configured') navigate('/dashboard')
          } catch {
            navigate('/dashboard')
          }
        }}
      />
    )
  if (state.view === 'notfound') return <NotFoundPage navigate={navigate} />

  // ── Role-protected routes ──────────────────────────────────
  if (state.view === 'kitchen')
    return (
      <ProtectedRoute roles={['owner', 'manager', 'kitchen']} navigate={navigate}>
        <Suspense fallback={<PageSpinner />}>
          <KitchenPage />
        </Suspense>
      </ProtectedRoute>
    )
  if (state.view === 'waiter')
    return (
      <ProtectedRoute roles={['owner', 'manager', 'waiter']} navigate={navigate}>
        <Suspense fallback={<PageSpinner />}>
          <WaiterPage />
        </Suspense>
      </ProtectedRoute>
    )

  // ── Landing (unauthenticated) ──────────────────────────────
  if (state.view === 'landing' && !user)
    return (
      <LandingPage
        onLogin={() => navigate('/auth')}
        onPricing={() => navigate('/pricing')}
        onDemo={() => navigate('/demo')}
      />
    )

  // ── Auth ───────────────────────────────────────────────────
  if (state.view === 'auth' || !user) return <AuthPage onSuccess={() => navigate('/dashboard')} />

  // ── Authenticated: landing redirects to dashboard ──────────
  if (state.view === 'landing') {
    navigate('/dashboard')
    return <PageSpinner />
  }

  if (restaurants.length === 0 && !rLoading)
    return (
      <OnboardingPage
        onComplete={() => {
          refetch()
          navigate('/dashboard')
        }}
      />
    )

  return (
    <Suspense fallback={<PageSpinner />}>
      <DashboardPage
        onViewMenu={(slug) => navigate(`/m/${slug}`)}
        onViewWaiter={() => navigate('/waiter')}
        onPricing={() => navigate('/pricing')}
        onSignOut={async () => {
          await signOut()
          navigate('/')
        }}
      />
    </Suspense>
  )
}

export default function App() {
  // Gate: if Supabase env vars are missing, show config screen
  // instead of crashing at runtime
  if (!SUPABASE_CONFIGURED) return <ConfigError />

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RestaurantProvider>
            <ToastProvider>
              <AppRouter />
              <Suspense fallback={null}>
                <PWAPrompt />
              </Suspense>
              <CookieBanner />
              <ConfirmRoot />
            </ToastProvider>
          </RestaurantProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
