import React, { useEffect, useState, useRef, Suspense, lazy } from 'react'
// React Query a fost scos (mig 094 P2): instalat dar 0 useQuery/useMutation
// în codebase. Greutate de bundle + semnal arhitectural fals.
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { RestaurantProvider, useRestaurantCtx } from './contexts/RestaurantContext'
import { supabase, SUPABASE_CONFIGURED } from './lib/supabase'
import { getStoredReferral, getVisitorId } from './lib/affiliate'
import { useRestaurants } from './hooks/useData'
import { PageSpinner, ConfigError, ErrorBoundary, QueryError } from './components/PageLoader'
import CookieBanner from './components/CookieBanner'
import { ToastProvider } from './components/ui/Toast'
import { ConfirmRoot } from './components/ui/ConfirmDialog'
import type { MemberRole } from './lib/constants'
import { D } from './lib/constants'
import { writePlanIntent } from './lib/planIntent'

// ── Eager: doar pagina de intrare (LCP) ──────────────────────
// LandingPage rămâne eager: e pagina de intrare (LCP) — nu o lazy-load-ăm.
import LandingPage from './pages/LandingPage'

// ── Lazy: heavy pages loaded on demand ───────────────────────
// AuthPage/OnboardingPage sunt post-navigare (nu LCP pe nicio rută), dar,
// importate static, intrau în chunk-ul entry descărcat de ORICE client —
// inclusiv anonimul de la masă pe /q/ care nu le vede niciodată. Lazy →
// ~1650 LOC + tranzitive (lib/restaurants, lib/features, lib/plans) ies din
// calea critică a meniului. Ambele randate deja în <Suspense> mai jos.
const AuthPage = lazy(() => import('./pages/AuthPage'))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const PricingPage = lazy(() => import('./pages/PricingPage'))
const QrMenuPage = lazy(() => import('./pages/QrMenuPage'))
const KitchenPage = lazy(() => import('./pages/KitchenPage'))
const WaiterPage = lazy(() => import('./pages/WaiterPage'))
const PublicMenuPage = lazy(() => import('./pages/PublicMenuPage'))
const InviteAcceptPage = lazy(() => import('./pages/InviteAcceptPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const DemoPage = lazy(() => import('./pages/DemoPage'))
const RecrutarePage = lazy(() => import('./pages/RecrutarePage'))
const ComparatiePage = lazy(() => import('./pages/ComparatiePage'))
const LegalPage = lazy(() => import('./pages/LegalPage'))
const AfiliatPage = lazy(() => import('./pages/AfiliatPage'))
const AfiliatIntroPage = lazy(() => import('./pages/AfiliatIntroPage'))
const FounderPage = lazy(() => import('./pages/FounderPage'))
const VerticalPage = lazy(() => import('./pages/VerticalPage'))
const CaseDeMarcatPage = lazy(() => import('./pages/CaseDeMarcatPage'))
const LandingPageEn = lazy(() => import('./pages/LandingPageEn'))
const PWAPrompt = lazy(() => import('./components/PWAPrompt'))

type View =
  | 'landing'
  | 'landing-en'
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
  | 'comparatie'
  | 'legal-terms'
  | 'legal-privacy'
  | 'legal-cookies'
  | 'legal-dpa'
  | 'afiliat'
  | 'founder'
  | 'vertical-hoteluri'
  | 'vertical-terase'
  | 'vertical-cafenele'
  | 'case-de-marcat'
  | 'notfound'

interface RouteState {
  view: View
  slug?: string
  token?: string
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
  if (p === '/comparatie' || p === '/de-ce-menuvia') return { view: 'comparatie' }
  if (p === '/hoteluri') return { view: 'vertical-hoteluri' }
  if (p === '/terase') return { view: 'vertical-terase' }
  if (p === '/cafenele') return { view: 'vertical-cafenele' }
  if (p === '/case-de-marcat' || p === '/compatibilitate') return { view: 'case-de-marcat' }
  if (p === '/dashboard') return { view: 'dashboard' }
  if (p === '/afiliat') return { view: 'afiliat' }
  if (p === '/founder') return { view: 'founder' }
  if (p === '/pricing') return { view: 'pricing' }
  if (p === '/termeni' || p === '/terms') return { view: 'legal-terms' }
  if (p === '/confidentialitate' || p === '/privacy') return { view: 'legal-privacy' }
  if (p === '/cookies') return { view: 'legal-cookies' }
  if (p === '/dpa') return { view: 'legal-dpa' }
  if (p === '/') return { view: 'landing' }
  if (p === '/en') return { view: 'landing-en' }
  return { view: 'notfound' }
}

async function getUserRoles(userId: string): Promise<MemberRole[]> {
  const { data } = await supabase
    .from('restaurant_memberships')
    .select('role')
    .eq('user_id', userId)
  return (data ?? []).map((r) => r.role as MemberRole)
}

function NotFoundPage({ navigate }: { navigate: (p: string) => void }) {
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'Pagina nu a fost găsită — Menuvia'
    return () => {
      document.title = prevTitle
    }
  }, [])
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
        {/* D.s3 e token de SUPRAFAȚĂ — ca text era practic invizibil pe D.bg. */}
        <div
          aria-hidden="true"
          style={{ fontFamily: 'Fraunces,serif', fontSize: 72, color: D.gold, fontWeight: 700 }}
        >
          404
        </div>
        <h1 style={{ color: D.t2, fontSize: 16, fontWeight: 400, marginBottom: 24 }}>
          Pagina nu a fost găsită.
        </h1>
        <button
          onClick={() => navigate('/')}
          style={{
            background: D.gold,
            color: '#000',
            border: 'none',
            borderRadius: 10,
            padding: '12px 28px',
            minHeight: 44,
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

// Ruta /afiliat: panoul cere user logat, dar vizitatorii NU mai lovesc un zid
// de login fără context — văd întâi pagina publică de prezentare a programului
// (procente reale, cum funcționează), cu CTA care setează intenția și duce la
// /auth; după autentificare, AuthPage onSuccess îi readuce AICI (nu la dashboard).
function AffiliateRoute({ navigate }: { navigate: (p: string) => void }) {
  const { user, loading: authLoading } = useAuth()
  if (authLoading) return <PageSpinner />
  if (!user)
    return (
      <Suspense fallback={<PageSpinner />}>
        <AfiliatIntroPage
          onLogin={() => {
            // Intenția de afiliere: după login revenim la /afiliat, nu la
            // dashboard (pattern-ul plan_intent din pricing).
            try {
              sessionStorage.setItem('menuvia.afiliat_intent', '1')
            } catch {
              /* private mode — fallback: userul ajunge la dashboard */
            }
            navigate('/auth?lang=ro')
          }}
        />
      </Suspense>
    )
  return (
    <Suspense fallback={<PageSpinner />}>
      <AfiliatPage />
    </Suspense>
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
    // Intenția de afiliere are prioritate (concurează cu onSuccess din
    // AuthPage — oricare rulează primul, destinația trebuie să fie /afiliat).
    let afiliatIntent: string | null = null
    try {
      afiliatIntent = sessionStorage.getItem('menuvia.afiliat_intent')
    } catch {
      /* ignore */
    }
    if (afiliatIntent === '1') {
      try {
        sessionStorage.removeItem('menuvia.afiliat_intent')
      } catch {
        /* ignore */
      }
      replace('/afiliat')
      return
    }
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
        'comparatie',
        'vertical-hoteluri',
        'vertical-terase',
        'vertical-cafenele',
        'case-de-marcat',
        'notfound',
        'landing',
        'landing-en',
        'afiliat',
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
        <DemoPage onBack={() => navigate('/')} onStart={() => navigate('/auth?lang=ro')} />
      </Suspense>
    )
  if (state.view === 'recrutare')
    return (
      <Suspense fallback={<PageSpinner />}>
        <RecrutarePage navigate={navigate} />
      </Suspense>
    )
  if (state.view === 'comparatie')
    return (
      <Suspense fallback={<PageSpinner />}>
        <ComparatiePage navigate={navigate} />
      </Suspense>
    )
  if (
    state.view === 'vertical-hoteluri' ||
    state.view === 'vertical-terase' ||
    state.view === 'vertical-cafenele'
  ) {
    // 'vertical-hoteluri' → 'hoteluri' (cheia de config din VerticalPage)
    const vertical = state.view.replace('vertical-', '') as
      | 'hoteluri'
      | 'terase'
      | 'cafenele'
    return (
      <Suspense fallback={<PageSpinner />}>
        <VerticalPage vertical={vertical} navigate={navigate} />
      </Suspense>
    )
  }
  if (state.view === 'case-de-marcat')
    return (
      <Suspense fallback={<PageSpinner />}>
        <CaseDeMarcatPage navigate={navigate} />
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
      <Suspense fallback={<PageSpinner />}>
        <PricingPage
          onBack={() => navigate('/')}
          onLogin={() => navigate('/auth?lang=ro')}
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
              navigate('/auth?plan=' + encodeURIComponent(plan) + '&lang=ro')
              return
            }
            try {
              const {
                data: { session: s },
              } = await supabase.auth.getSession()
              // Cod de referral din cookie-ul de afiliere (dacă vizitatorul a
              // venit de pe un link /r/:cod). Trimis la checkout pentru atribuire.
              const referralCode = getStoredReferral()
              const visitorId = getVisitorId()
              const res = await fetch('/.netlify/functions/stripe-checkout', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: 'Bearer ' + (s?.access_token || ''),
                },
                body: JSON.stringify({
                  plan,
                  ...(referralCode ? { referral_code: referralCode } : {}),
                  ...(visitorId ? { visitor_id: visitorId } : {}),
                }),
              })
              const d = await res.json()
              if (d.url) window.location.href = d.url
              else if (d.error === 'Stripe not configured') navigate('/dashboard')
            } catch {
              navigate('/dashboard')
            }
          }}
        />
      </Suspense>
    )
  if (state.view === 'notfound') return <NotFoundPage navigate={navigate} />

  // ── Afiliere: necesită user logat, dar NU rol de restaurant ────────────────
  // (un afiliat poate să nu aibă restaurant). Plasat înainte de gate-ul de
  // onboarding ca să nu fie redirecționat la /dashboard onboarding.
  if (state.view === 'afiliat') {
    return <AffiliateRoute navigate={navigate} />
  }

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
          writePlanIntent(p)
          // ?lang=ro explicit: anulează un menuvia_ui_lang='en' rămas dintr-o
          // vizită pe /en — funnel-ul RO nu trebuie să devină tăcut englezesc.
          navigate('/auth?plan=' + p + '&lang=ro')
        }}
        onLogin={() => navigate('/auth?lang=ro')}
        onPricing={() => navigate('/pricing')}
        onDemo={() => navigate('/demo')}
      />
    )

  // ── Landing EN (unauthenticated, diaspora) ──────────────────
  if (state.view === 'landing-en' && !user)
    return (
      <Suspense fallback={<PageSpinner />}>
        <LandingPageEn
          onStartPlan={(p) => {
            writePlanIntent(p)
            navigate('/auth?plan=' + p + '&lang=en')
          }}
          onLogin={() => navigate('/auth?lang=en')}
          onPricing={() => navigate('/pricing')}
          onDemo={() => navigate('/demo')}
        />
      </Suspense>
    )

  // ── Auth ───────────────────────────────────────────────────
  if (state.view === 'auth' || !user) {
    return (
      <Suspense fallback={<PageSpinner />}>
      <AuthPage
        onSuccess={() => {
          // Dacă userul a venit din pricing cu un plan ales, îl ducem direct
          // înapoi la pricing — onCheckout va detecta că e logat și va sări
          // la Stripe. Fără intent, mergem la dashboard ca până acum.
          let intent: string | null = null
          let afiliatIntent: string | null = null
          try {
            intent = sessionStorage.getItem('menuvia.plan_intent')
            afiliatIntent = sessionStorage.getItem('menuvia.afiliat_intent')
          } catch {
            /* ignore (private mode) */
          }
          if (intent === 'starter' || intent === 'growth' || intent === 'pro') {
            navigate('/pricing')
            return
          }
          // Venit de pe pagina programului de parteneriat → înapoi la /afiliat
          // (altfel ateriza pe dashboard și pierdea complet firul înscrierii).
          if (afiliatIntent === '1') {
            try {
              sessionStorage.removeItem('menuvia.afiliat_intent')
            } catch {
              /* ignore */
            }
            navigate('/afiliat')
            return
          }
          // Cursă cu efectul de auto-redirect din AppRouter: dacă el a apucat
          // deja să consume afiliat_intent și a dus userul pe /afiliat, acest
          // closure (care rulează după `await signIn`, chiar și demontat) NU
          // are voie să-l suprascrie cu /dashboard.
          if (window.location.pathname === '/afiliat') return
          navigate('/dashboard')
        }}
      />
      </Suspense>
    )
  }

  // ── Authenticated: landing redirects to dashboard ──────────
  // replace(), nu navigate() (FE-001): push ar lăsa /-ul sau /en în istoric și
  // Back ar re-declanșa redirectul — utilizatorul n-ar mai putea ieși din site.
  if (state.view === 'landing') {
    replace('/dashboard')
    return <PageSpinner />
  }
  if (state.view === 'landing-en') {
    replace('/dashboard')
    return <PageSpinner />
  }

  // ── Panou fondator (doar platform admin; guard-ul e în pagină) ──
  if (state.view === 'founder')
    return (
      <Suspense fallback={<PageSpinner />}>
        <FounderPage onBack={() => navigate('/dashboard')} />
      </Suspense>
    )

  if (restaurants.length === 0 && !rLoading)
    return (
      <Suspense fallback={<PageSpinner />}>
        <OnboardingPage
          onComplete={() => {
            refetch()
            navigate('/dashboard')
          }}
        />
      </Suspense>
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
