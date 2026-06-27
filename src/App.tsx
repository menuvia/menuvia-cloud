import React, { useEffect, useState, useRef, Suspense, lazy } from 'react'
// React Query a fost scos (mig 094 P2): instalat dar 0 useQuery/useMutation
// în codebase. Greutate de bundle + semnal arhitectural fals.
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { RestaurantProvider, useRestaurantCtx } from './contexts/RestaurantContext'
import { supabase, SUPABASE_CONFIGURED } from './lib/supabase'
import { getStoredReferral } from './lib/affiliate'
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
import { PLANS as COMMERCIAL_PLANS, TRUST_SIGNALS, getPlanByInternalId } from './lib/plans'
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

// ── Marketing palette (landing + pricing) — cald, premium, NU dashboard ──
const M = {
  bg: '#FAF9F6',
  surface: '#FFFFFF',
  surface2: '#F5F1EA',
  text: '#1A1208',
  text2: '#5C4A2A',
  text3: '#9A8C7A',
  border: '#E8E0D2',
  accent: '#C8963C',
  accentSoft: '#FAF3E5',
  success: '#2D8659',
}

// Plan intent: păstrat în sessionStorage înainte de /auth, consumat după
// login de usePlanIntentAutoCheckout (vezi mai jos). Folosit de Landing ȘI
// de Pricing — de-asta e la nivel de modul.
function pushPlanIntent(planId: string): void {
  try {
    sessionStorage.setItem('menuvia.plan_intent', planId)
  } catch {
    /* ignore (private mode) */
  }
}

// ── Landing page (unauthenticated visitors) ──────────────────
// Obiectiv: vizitatorul înțelege în 10 secunde ce e Menuvia, pentru cine e,
// de ce Meniu + Comenzi e planul recomandat și cât de simplu e setup-ul.
// Vinde FLOW-ul (Adaugi meniul → Generezi QR → Primești comenzi), nu module.
function LandingPage({
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
    background: M.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    padding: '15px 30px',
    fontWeight: 700,
    fontSize: 16,
    cursor: 'pointer',
    fontFamily: 'DM Sans,sans-serif',
    boxShadow: '0 4px 14px rgba(200,150,60,0.3)',
  }
  const ghostBtn: React.CSSProperties = {
    background: 'transparent',
    color: M.text,
    border: `1.5px solid ${M.border}`,
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
    <div style={{ minHeight: '100vh', background: M.bg, fontFamily: 'DM Sans,sans-serif' }}>
      {/* Header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(250,249,246,0.92)',
          backdropFilter: 'blur(10px)',
          borderBottom: `1px solid ${M.border}`,
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
              color: M.accent,
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
                  color: M.text2,
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
                color: M.text2,
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
                background: M.accent,
                color: '#fff',
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
            fontSize: 'clamp(2rem, 5.5vw, 3.2rem)',
            color: M.text,
            fontWeight: 700,
            lineHeight: 1.12,
            letterSpacing: '-0.03em',
            marginBottom: 18,
          }}
        >
          Meniu QR și comenzi de la masă pentru restaurante moderne
        </h1>
        <p
          style={{
            color: M.text2,
            fontSize: 'clamp(1rem, 2.4vw, 1.2rem)',
            maxWidth: 560,
            margin: '0 auto 30px',
            lineHeight: 1.65,
          }}
        >
          Clienții scanează codul QR, comandă de pe telefon, iar bucătăria primește instant.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => onStartPlan('growth')} style={ctaBtn}>
            Începe cu Meniu + Comenzi
          </button>
          <button onClick={() => scrollTo('cum-functioneaza')} style={ghostBtn}>
            Vezi cum funcționează
          </button>
        </div>
        <div style={{ color: M.text3, fontSize: 13, marginTop: 16 }}>
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
          style={{
            background: M.surface,
            border: `1px solid ${M.border}`,
            borderRadius: 26,
            padding: 16,
            width: 230,
            boxShadow: '0 12px 32px rgba(26,18,8,0.08)',
          }}
        >
          <div style={{ fontSize: 11, color: M.text3, textAlign: 'center', marginBottom: 10 }}>
            📱 Meniul pe telefonul clientului
          </div>
          <div
            style={{
              background: M.accentSoft,
              borderRadius: 14,
              padding: '8px 10px',
              fontSize: 12,
              fontWeight: 700,
              color: M.accent,
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
                borderBottom: `1px solid ${M.surface2}`,
                fontSize: 12.5,
              }}
            >
              <span style={{ color: M.text, fontWeight: 600 }}>{it.n}</span>
              <span style={{ color: M.text2 }}>{it.p}</span>
            </div>
          ))}
          <div
            style={{
              marginTop: 12,
              background: M.accent,
              color: '#fff',
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
          style={{
            background: M.surface,
            border: `1px solid ${M.border}`,
            borderRadius: 18,
            padding: 18,
            width: 250,
            alignSelf: 'center',
            boxShadow: '0 8px 24px rgba(26,18,8,0.06)',
          }}
        >
          <div style={{ fontSize: 11, color: M.text3, marginBottom: 10 }}>
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
            <span style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, color: M.text }}>
              Masa 12
            </span>
            <span
              style={{
                background: M.accentSoft,
                color: M.accent,
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 6,
                padding: '3px 9px',
              }}
            >
              NOUĂ · acum
            </span>
          </div>
          <div style={{ fontSize: 13, color: M.text2, lineHeight: 1.7 }}>
            1 × Pizza Margherita
            <br />2 × Limonadă cu mentă
          </div>
          <div
            style={{
              marginTop: 12,
              background: M.success,
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
          style={{
            background: M.surface,
            border: `1px solid ${M.border}`,
            borderRadius: 18,
            padding: 18,
            width: 170,
            alignSelf: 'center',
            textAlign: 'center',
            boxShadow: '0 8px 24px rgba(26,18,8,0.06)',
          }}
        >
          <div style={{ fontSize: 11, color: M.text3, marginBottom: 10 }}>🔲 QR-ul de pe masă</div>
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
          <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, color: M.text, fontSize: 15 }}>
            Masa 12
          </div>
          <div style={{ fontSize: 11, color: M.text3, marginTop: 4 }}>Scanează pentru a comanda</div>
        </div>
      </div>

      {/* Benefits */}
      <div id="functii" style={{ background: M.surface2, padding: '64px 24px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 'clamp(1.5rem, 3.5vw, 2.1rem)',
              color: M.text,
              fontWeight: 700,
              textAlign: 'center',
              marginBottom: 36,
              letterSpacing: '-0.02em',
            }}
          >
            Tot ce are nevoie un restaurant. Nimic în plus.
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 16,
            }}
          >
            {BENEFITS.map((b) => (
              <div
                key={b.title}
                style={{
                  background: M.surface,
                  border: `1px solid ${M.border}`,
                  borderRadius: 16,
                  padding: '22px 22px',
                }}
              >
                <div style={{ fontSize: 26, marginBottom: 10 }}>{b.icon}</div>
                <div style={{ color: M.text, fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
                  {b.title}
                </div>
                <div style={{ color: M.text2, fontSize: 14, lineHeight: 1.6 }}>{b.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* How it works */}
      <div id="cum-functioneaza" style={{ maxWidth: 880, margin: '0 auto', padding: '72px 24px' }}>
        <h2
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: 'clamp(1.5rem, 3.5vw, 2.1rem)',
            color: M.text,
            fontWeight: 700,
            textAlign: 'center',
            marginBottom: 40,
            letterSpacing: '-0.02em',
          }}
        >
          Pornești în 3 pași
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 18,
          }}
        >
          {STEPS.map((st) => (
            <div key={st.n} style={{ textAlign: 'center', padding: '0 8px' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: M.accentSoft,
                  color: M.accent,
                  fontFamily: 'Fraunces,serif',
                  fontSize: 22,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 14px',
                }}
              >
                {st.n}
              </div>
              <div style={{ color: M.text, fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
                {st.title}
              </div>
              <div style={{ color: M.text2, fontSize: 14, lineHeight: 1.6 }}>{st.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 36 }}>
          <button onClick={onDemo} style={ghostBtn}>
            Vezi demo live
          </button>
        </div>
      </div>

      {/* Plan highlight — Meniu + Comenzi e vedeta */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 24px 72px' }}>
        <div
          style={{
            background: M.surface,
            border: `1.5px solid ${M.accent}`,
            borderRadius: 20,
            padding: '32px 28px',
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(200,150,60,0.14)',
          }}
        >
          <div
            style={{
              display: 'inline-block',
              background: M.accent,
              color: '#fff',
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
              color: M.text,
              fontWeight: 700,
              marginBottom: 10,
            }}
          >
            🛎 Meniu + Comenzi
          </div>
          <p
            style={{
              color: M.text2,
              fontSize: 15,
              lineHeight: 1.65,
              maxWidth: 480,
              margin: '0 auto 22px',
            }}
          >
            Alegerea potrivită pentru restaurantele care vor să reducă timpul pierdut cu preluarea
            comenzilor. Plata și bonul rămân pe casa ta actuală.
          </p>
          <button onClick={onPricing} style={ctaBtn}>
            Vezi planurile
          </button>
        </div>
      </div>

      {/* FAQ light */}
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 24px 72px' }}>
        <h2
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.5rem',
            color: M.text,
            fontWeight: 700,
            textAlign: 'center',
            marginBottom: 24,
          }}
        >
          Întrebări frecvente
        </h2>
        {FAQ.map((f, i) => (
          <div
            key={f.q}
            style={{
              background: M.surface,
              border: `1px solid ${M.border}`,
              borderRadius: 12,
              marginBottom: 8,
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => setOpenFaq(openFaq === i ? null : i)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                padding: '15px 18px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
                fontSize: 14.5,
                fontWeight: 600,
                color: M.text,
                textAlign: 'left',
                gap: 12,
              }}
            >
              {f.q}
              <span style={{ color: M.text3, flexShrink: 0 }}>{openFaq === i ? '−' : '+'}</span>
            </button>
            {openFaq === i && (
              <div
                style={{
                  padding: '0 18px 15px',
                  color: M.text2,
                  fontSize: 14,
                  lineHeight: 1.65,
                }}
              >
                {f.a}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Final CTA */}
      <div
        style={{
          background: M.surface2,
          padding: '64px 24px',
          textAlign: 'center',
        }}
      >
        <h3
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.7rem',
            color: M.text,
            fontWeight: 700,
            marginBottom: 10,
          }}
        >
          Gata să începi?
        </h3>
        <p style={{ color: M.text2, fontSize: 15, marginBottom: 26 }}>
          30 de zile gratuite. Setup în 10 minute. Anulezi oricând.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => onStartPlan('growth')} style={ctaBtn}>
            Începe cu Meniu + Comenzi
          </button>
          <button onClick={onPricing} style={ghostBtn}>
            Vezi prețurile
          </button>
        </div>
      </div>
      <LegalFooter />
    </div>
  )
}
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

function PricingPage({
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
      pushPlanIntent(p.id)
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
          background: L.bg,
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
            border: `3px solid ${L.border}`,
            borderTopColor: L.accent,
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>
        <div style={{ color: L.text, fontSize: '1.05rem', fontWeight: 600 }}>
          Se pregătește checkout-ul pentru {targetName}...
        </div>
        <div style={{ color: L.text3, fontSize: '0.88rem' }}>
          Te redirecționăm către plata securizată.
        </div>
      </div>
    )
  }

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
            Prețuri simple pentru restaurante care vor meniu QR și comenzi la masă
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
            30 de zile gratuite pe orice plan. Anulezi cu un click, fără penalizări.
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
                background: L.surface,
                border: `1px solid ${L.border}`,
                borderRadius: 12,
                padding: '14px 16px',
                fontFamily: 'DM Sans,sans-serif',
              }}
            >
              <div style={{ fontSize: '1.4rem', marginBottom: 6 }}>{t.icon}</div>
              <div style={{ color: L.text, fontSize: '0.88rem', fontWeight: 600 }}>{t.label}</div>
              <div style={{ color: L.text3, fontSize: '0.78rem', marginTop: 3, lineHeight: 1.45 }}>
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
            background: L.surface,
            border: `1px solid ${L.border}`,
            borderRadius: 18,
            padding: '28px 28px',
          }}
        >
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.25rem',
              color: L.text,
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
              <p style={{ color: L.text2, fontSize: '0.95rem', lineHeight: 1.6 }}>
                Alege <strong style={{ color: L.text }}>Meniu Digital</strong> dacă vrei doar să
                înlocuiești meniul fizic cu un meniu QR modern.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>🛎</span>
              <p style={{ color: L.text2, fontSize: '0.95rem', lineHeight: 1.6 }}>
                Alege <strong style={{ color: L.text }}>Meniu + Comenzi</strong> dacă vrei ca
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
              style={{ textAlign: 'center', marginBottom: 80, fontSize: '0.88rem', color: L.text2 }}
            >
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
          30 zile gratuite. Setup în 10 minute.
        </p>
        <button
          onClick={() => {
            pushPlanIntent('growth')
            void onCheckout('growth')
          }}
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
          Începe gratuit Meniu + Comenzi →
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
            // Păstrăm planul în sessionStorage ÎNAINTE de navigate, ca să-l
            // recuperăm după login (vezi AuthPage onSuccess). URL-ul primește
            // și el ?plan= pentru cazurile cu sessionStorage blocat.
            try {
              sessionStorage.setItem('menuvia.plan_intent', plan)
            } catch {
              /* ignore */
            }
            navigate('/auth?plan=' + encodeURIComponent(plan))
            return
          }
          try {
            const {
              data: { session: s },
            } = await supabase.auth.getSession()
            // Cod de referral din cookie-ul de afiliere (dacă vizitatorul a
            // venit de pe un link /r/:cod). Trimis la checkout pentru atribuire.
            const referralCode = getStoredReferral()
            const res = await fetch('/.netlify/functions/stripe-checkout', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (s?.access_token || ''),
              },
              body: JSON.stringify({ plan, ...(referralCode ? { referral_code: referralCode } : {}) }),
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
        onStartPlan={(p) => {
          pushPlanIntent(p)
          navigate('/auth?plan=' + p)
        }}
        onLogin={() => navigate('/auth')}
        onPricing={() => navigate('/pricing')}
        onDemo={() => navigate('/demo')}
      />
    )

  // ── Auth ───────────────────────────────────────────────────
  if (state.view === 'auth' || !user) {
    return (
      <AuthPage
        onSuccess={() => {
          // Dacă userul a venit din pricing cu un plan ales, îl ducem direct
          // înapoi la pricing — onCheckout va detecta că e logat și va sări
          // la Stripe. Fără intent, mergem la dashboard ca până acum.
          let intent: string | null = null
          try {
            intent = sessionStorage.getItem('menuvia.plan_intent')
          } catch {
            /* ignore (private mode) */
          }
          if (intent === 'starter' || intent === 'growth' || intent === 'pro') {
            navigate('/pricing')
            return
          }
          navigate('/dashboard')
        }}
      />
    )
  }

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
        onViewKitchen={() => navigate('/kitchen')}
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
    </ErrorBoundary>
  )
}
