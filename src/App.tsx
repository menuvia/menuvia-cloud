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

// ── Eager: tiny, always-needed pages ─────────────────────────
import AuthPage from './pages/AuthPage'
import OnboardingPage from './pages/OnboardingPage'
// LandingPage rămâne eager: e pagina de intrare (LCP) — nu o lazy-load-ăm.
import LandingPage from './pages/LandingPage'

// ── Lazy: heavy pages loaded on demand ───────────────────────
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
const LegalPage = lazy(() => import('./pages/LegalPage'))
const AfiliatPage = lazy(() => import('./pages/AfiliatPage'))
const FounderPage = lazy(() => import('./pages/FounderPage'))
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
  | 'afiliat'
  | 'founder'
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
  if (p === '/dashboard') return { view: 'dashboard' }
  if (p === '/afiliat') return { view: 'afiliat' }
  if (p === '/founder') return { view: 'founder' }
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

// Ruta /afiliat: necesită user logat (NU rol de restaurant). Redirecționarea se
// face într-un useEffect (nu în render) ca să evităm setState-în-render.
function AffiliateRoute({ navigate }: { navigate: (p: string) => void }) {
  const { user, loading: authLoading } = useAuth()
  useEffect(() => {
    if (authLoading) return
    if (!user) navigate('/auth')
  }, [user, authLoading]) // eslint-disable-line react-hooks/exhaustive-deps
  if (authLoading || !user) return <PageSpinner />
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
      <Suspense fallback={<PageSpinner />}>
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

  // ── Panou fondator (doar platform admin; guard-ul e în pagină) ──
  if (state.view === 'founder')
    return (
      <Suspense fallback={<PageSpinner />}>
        <FounderPage onBack={() => navigate('/dashboard')} />
      </Suspense>
    )

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
