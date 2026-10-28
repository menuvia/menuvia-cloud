import React, { useEffect, useState, useRef, Suspense, lazy } from 'react'
// React Query a fost scos (mig 094 P2): instalat dar 0 useQuery/useMutation
// în codebase. Greutate de bundle + semnal arhitectural fals.
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { RestaurantProvider, useRestaurantCtx } from './contexts/RestaurantContext'
import { supabase, SUPABASE_CONFIGURED } from './lib/supabase'
import { ROUTE_CHANGE_EVENT } from './lib/routeEvents'
import { CheckoutError, describeCheckoutFailure, readCheckoutUrl } from './lib/checkout'
import { getStoredReferral, getVisitorId, resolvePendingReferral } from './lib/affiliate'
import { useRestaurants } from './hooks/useData'
import { PageSpinner, ConfigError, ErrorBoundary, QueryError } from './components/PageLoader'
import CookieBanner from './components/CookieBanner'
import { ToastProvider } from './components/ui/Toast'
import { ConfirmRoot } from './components/ui/ConfirmDialog'
import type { UiRole } from './lib/partnerAccess'
import { D } from './lib/constants'
import { planIntentDestination, signupPath, writePlanIntent } from './lib/planIntent'
import { authPathWithNext, nextFromSearch } from './lib/authRedirect'
import { loadPostLoginDestination } from './lib/postLogin'
import { legacyPathRedirect } from './lib/routeAliases'
import CheckoutReturnBanner from './components/CheckoutReturnBanner'
import { fnUrl } from './lib/fn'
import { browserSite, currentSite, defaultUiLang } from './lib/domain'
import { checkoutOpenOnSite, siteCheckoutClosedFailure } from './lib/siteMarket'

// ── Eager: doar pagina de intrare (LCP) ──────────────────────
// OPT-R2: LandingPage devine lazy — intra în chunk-ul de ENTRY descărcat și
// de fiecare scanare QR anonimă (calea /q/ + /m/ nu are nevoie de marketing).
// Prefetch condiționat pe '/' păstrează LCP-ul pe pagina de intrare reală.
const LandingPage = lazy(() => import('./pages/LandingPage'))
if (typeof window !== 'undefined' && window.location.pathname === '/') {
  void import('./pages/LandingPage')
}

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
// Prefetch al meniului oaspetelui, același tipar ca LandingPage pe '/': fără
// el, chunk-ul paginii pornea abia după montarea React + `getSession()` (ruta
// e randată doar după `loading` din AuthContext) — o serializare pe calea
// critică a scanării. Aici descărcarea pornește în paralel cu ele; importul
// e deduplicat de încărcătorul de module, deci lazy() de mai sus primește
// același modul. Regex-urile sunt cele din parsePath. Un eșec aici e tăcut:
// lazy() reîncearcă la randare și eroarea ajunge la ErrorBoundary ca înainte.
if (typeof window !== 'undefined') {
  const p = window.location.pathname
  if (/^\/q\/.+$/.test(p)) import('./pages/QrMenuPage').catch(() => undefined)
  else if (/^\/m\/.+$/.test(p)) import('./pages/PublicMenuPage').catch(() => undefined)
}
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
const CodviaPage = lazy(() => import('./pages/CodviaPage'))
const ReservePage = lazy(() => import('./pages/ReservePage'))
const RezervariPage = lazy(() => import('./pages/RezervariPage'))
const LandingPageEn = lazy(() => import('./pages/LandingPageEn'))
const PWAPrompt = lazy(() => import('./components/PWAPrompt'))
// Gate-ul de Termeni randează null fără sesiune — vizitatorul anonim (meniul
// QR, /m/:slug) nu-l vede niciodată, dar importul static îl ținea, cu
// lib/terms, în chunk-ul de ENTRY descărcat la fiecare scanare. Se montează
// (și se descarcă) doar când există user — vezi TermsGateMount.
const TermsAcceptanceGate = lazy(() => import('./components/TermsAcceptanceGate'))

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
  | 'codvia'
  | 'reserve'
  | 'rezervari-landing'
  | 'notfound'

interface RouteState {
  view: View
  slug?: string
  token?: string
}

function parsePath(): RouteState {
  // Alias vechi (ex. /preturi → /pricing): corectăm URL-ul din bară fără intrare
  // nouă în istoric (replaceState), apoi rutăm pe calea canonică. Idempotent —
  // parsePath poate rula de mai multe ori (inițializator de state, StrictMode).
  const alias = legacyPathRedirect(window.location.pathname)
  if (alias) {
    window.history.replaceState({}, '', alias + window.location.search + window.location.hash)
  }
  const p = alias ?? window.location.pathname
  const qrMatch = p.match(/^\/q\/(.+)$/)
  const menuMatch = p.match(/^\/m\/(.+)$/)
  // /rezervare/:slug — pagina publică de rezervare (linkul din Google Business
  // Profile). NU /r/:slug: prefixul /r/ e REZERVAT capturii de afiliere
  // (captureReferralFromUrl în main.tsx rulează înaintea routerului și rescrie
  // orice /r/* la '/' — coliziunea a fost prinsă de audit, ruta nu se randa).
  const reserveMatch = p.match(/^\/rezervare\/(.+)$/)
  const inviteMatch = p.match(/^\/invite\/(.+)$/)
  if (qrMatch) return { view: 'qr', token: qrMatch[1] }
  if (menuMatch) return { view: 'menu', slug: menuMatch[1] }
  if (reserveMatch) return { view: 'reserve', slug: reserveMatch[1] }
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
  if (p === '/codvia') return { view: 'codvia' }
  if (p === '/rezervari') return { view: 'rezervari-landing' }
  if (p === '/dashboard') return { view: 'dashboard' }
  if (p === '/afiliat') return { view: 'afiliat' }
  if (p === '/founder') return { view: 'founder' }
  if (p === '/pricing') return { view: 'pricing' }
  if (p === '/termeni' || p === '/terms') return { view: 'legal-terms' }
  if (p === '/confidentialitate' || p === '/privacy') return { view: 'legal-privacy' }
  if (p === '/cookies') return { view: 'legal-cookies' }
  if (p === '/dpa') return { view: 'legal-dpa' }
  // hostul .com (lib/domain.ts): rădăcina e landing-ul EN; orice alt host
  // (menuvia.ro, preview-uri, localhost) rămâne pe landing-ul RO de azi.
  if (p === '/')
    return { view: currentSite(window.location.hostname) === 'com' ? 'landing-en' : 'landing' }
  if (p === '/en') return { view: 'landing-en' }
  return { view: 'notfound' }
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
  // activeRole poate fi și „partner" (mig 286) — nu e în niciuna din listele de
  // roluri ale rutelor protejate, deci partenerul nu intră pe Bucătărie/Ospătar.
  roles: UiRole[]
  children: React.ReactNode
  navigate: (p: string) => void
}) {
  const { user, loading: authLoading } = useAuth()
  // FIX: Folosim activeRole din RestaurantContext în loc de o interogare de roluri (DB call extra)
  const { activeRole, loading: ctxLoading, error: ctxError } = useRestaurantCtx()

  useEffect(() => {
    if (authLoading || ctxLoading) return
    if (!user) {
      // `?next=` readuce omul aici după login (cale internă, validată).
      navigate(authPathWithNext(window.location.pathname, window.location.search))
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
        {ctxError ? (
          // Blip de rețea / eroare Supabase la încărcarea membership-urilor:
          // rolul e null NU pentru că n-are drept, ci pentru că fetch-ul a picat.
          // Arătăm „reîncearcă" (reload), nu mesajul alarmant de „fără acces".
          <QueryError
            message="Nu am putut încărca permisiunile. Verifică conexiunea și reîncearcă."
            onRetry={() => window.location.reload()}
          />
        ) : (
          <QueryError
            message="Nu ai acces la această pagină. Contactează managerul restaurantului."
            onRetry={() => navigate('/dashboard')}
          />
        )}
      </div>
    )
  return <>{children}</>
}

// Montează gate-ul de Termeni DOAR cu sesiune: fără user gate-ul întoarce oricum
// null, deci nimic vizibil nu se schimbă — doar chunk-ul lui iese din entry.
function TermsGateMount() {
  const { user } = useAuth()
  if (!user) return null
  return (
    <Suspense fallback={null}>
      <TermsAcceptanceGate />
    </Suspense>
  )
}

function AppRouter() {
  const { user, loading, signOut } = useAuth()
  const { restaurants, loading: rLoading, refetch, update } = useRestaurants()
  const [state, setState] = useState<RouteState>(parsePath)

  // FE-001 FIX: separate navigate (push) from replace (no history entry).
  // Redirects after auth use replace → back button doesn't return to /auth → no infinite loop.
  const navigate = (path: string) => {
    window.history.pushState({}, '', path)
    setState(parsePath())
    // `pushState` NU emite `popstate`, iar componentele montate în AFARA
    // routerului (TermsAcceptanceGate) nu se re-randează la un setState de
    // aici. Fără anunț, gate-ul rămânea cu ruta de la montare: cine intra pe
    // /auth și se autentifica avea gate-ul suprimat toată sesiunea, deci
    // consimțământul nu se mai consemna deloc (recenzie CodeRabbit pe #261).
    window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT))
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
    let cancelled = false
    void (async () => {
      // MFA (mig 235, review E5): după parolă, un cont cu factor TOTP verificat
      // are sesiune doar aal1 — AuthPage tocmai afișează pasul de cod, iar un
      // redirect aici l-ar demonta. Nu redirectăm; onSuccess navighează DUPĂ
      // verify. Conturile fără MFA au nextLevel=currentLevel → redirect normal.
      try {
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') return
      } catch {
        /* verificarea a eșuat — continuăm cu redirectul standard */
      }
      if (cancelled || autoRedirectedRef.current) return
      autoRedirectedRef.current = true
      // `?next=` explicit (redirect de la o rută protejată): întoarcem omul
      // unde era. Doar cale internă validată (lib/authRedirect.ts).
      const nextDest = nextFromSearch(window.location.search)
      if (nextDest) {
        replace(nextDest)
        return
      }
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
      // Intenția de plan (localStorage, TTL 24 h): contul confirmat din linkul
      // de email se deschide în ALT tab, unde `onSuccess` din AuthPage nu
      // rulează niciodată — singurul care vede sesiunea e efectul ăsta. Fără
      // ramura asta, restaurantul nou ateriza pe /dashboard în loc de
      // checkout. /pricing pornește singur plata (usePlanIntentAutoCheckout).
      // Doar intenția ACESTUI cont (sau aleasă în acest tab / `?plan=` din
      // URL): pe un dispozitiv partajat, ospătarul care se loghează nu are voie
      // să moștenească planul ales de altcineva (planIntent.ts).
      const intentDest = planIntentDestination(user.email ?? null, window.location.search)
      if (intentDest) {
        replace(intentDest)
        return
      }
      // Fiecare rol pe ecranul lui (lib/postLogin.ts): personalul pe pagina lui,
      // agentul fără restaurant pe panoul de afiliat, restul pe /dashboard
      // (patronul fără restaurant ajunge acolo pe onboarding).
      void loadPostLoginDestination(user.id).then((dest) => {
        replace(dest)
      })
    })()
    return () => {
      cancelled = true
    }
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
        'codvia',
        'reserve',
        'rezervari-landing',
        'notfound',
        'landing',
        'landing-en',
        'afiliat',
        // OPT-R2: rute care NU folosesc `restaurants` — ramurile lor de render
        // sunt toate înaintea gate-ului de onboarding (643). Legal/Recrutare
        // sunt statice; FounderPage folosește doar RPC-uri proprii, nu
        // useRestaurants. Fără excludere, primul paint aștepta rLoading degeaba.
        'recrutare',
        'legal-terms',
        'legal-privacy',
        'legal-cookies',
        'legal-dpa',
        'founder',
      ].includes(state.view))
  )
    return <PageSpinner />

  // ── Public routes (no auth needed) ─────────────────────────
  if (state.view === 'qr' && state.token)
    return (
      <Suspense fallback={<PageSpinner />}>
        {/* key={token}: schimbarea tokenului REMONTEAZĂ pagina, deci
            inițializatorii useState (rehidratarea din sessionStorage) rulează
            din nou. Fără el, starea mesei A putea fi afișată și persistată sub
            cheia mesei B (review audit v3). */}
        <QrMenuPage key={state.token} token={state.token} />
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
        <DemoPage onBack={() => navigate('/')} onStart={() => navigate(signupPath())} />
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
    const vertical = state.view.replace('vertical-', '') as 'hoteluri' | 'terase' | 'cafenele'
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
  if (state.view === 'codvia')
    return (
      <Suspense fallback={<PageSpinner />}>
        <CodviaPage navigate={navigate} />
      </Suspense>
    )
  if (state.view === 'reserve' && state.slug)
    return (
      <Suspense fallback={<PageSpinner />}>
        <ReservePage slug={state.slug} navigate={navigate} />
      </Suspense>
    )
  if (state.view === 'rezervari-landing')
    return (
      <Suspense fallback={<PageSpinner />}>
        <RezervariPage navigate={navigate} />
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
          onLogin={() => navigate('/auth?lang=' + defaultUiLang(browserSite()))}
          onCheckout={async (plan) => {
            // hostul .com: prețurile Stripe sunt doar în RON și Plan 3 nu se
            // vinde acolo — checkout-ul e închis cu mesaj explicit (lib/siteMarket).
            // Pe menuvia.ro condiția e mereu adevărată → flux neschimbat.
            if (!checkoutOpenOnSite(browserSite())) {
              throw new CheckoutError(siteCheckoutClosedFailure())
            }
            if (!user) {
              // Păstrăm planul ÎNAINTE de navigate (localStorage, TTL 24 h), ca
              // să-l recuperăm după login sau după confirmarea emailului în alt
              // tab. URL-ul primește și el ?plan= pentru storage blocat.
              writePlanIntent(plan)
              navigate('/auth?plan=' + encodeURIComponent(plan) + '&lang=ro')
              return
            }
            const {
              data: { session: s },
            } = await supabase.auth.getSession()
            // Cod de referral din cookie-ul de afiliere (dacă vizitatorul a
            // venit de pe un link /r/:cod). Trimis la checkout pentru atribuire.
            // Un vanity încă nerezolvat (RPC picat / răspuns întârziat) are o
            // ultimă șansă aici, plafonată la 1,5 s — nu blochează plata.
            await resolvePendingReferral(1500)
            const referralCode = getStoredReferral()
            const visitorId = getVisitorId()

            // Orice eșec ARUNCĂ un CheckoutError cu mesaj în română — pagina
            // de prețuri îl afișează. Înainte, tot ce nu era `url` sau exact
            // „Stripe not configured" nu producea NIMIC vizibil: omul apăsa
            // „Activează", nu se întâmpla nimic și pleca (audit v3).
            let res: Response
            try {
              res = await fetch(fnUrl('stripe-checkout'), {
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
            } catch {
              // Rețea căzută / funcție inexistentă: status 0 = „n-am ajuns".
              throw new CheckoutError(describeCheckoutFailure(0, null))
            }

            // 405 întoarce text simplu, nu JSON — parse-ul nu are voie să
            // transforme un răspuns cunoscut într-o eroare de rețea.
            let payload: unknown
            try {
              payload = await res.json()
            } catch {
              payload = null
            }

            if (res.ok) {
              const url = readCheckoutUrl(payload)
              if (url) {
                window.location.href = url
                return
              }
            }
            throw new CheckoutError(describeCheckoutFailure(res.ok ? 200 : res.status, payload))
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
      <Suspense fallback={<PageSpinner />}>
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
      </Suspense>
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
    // MFA (review E5): pe un view protejat fără sesiune normalizăm întâi
    // URL-ul la /auth — altfel, imediat după parolă, flip-ul lui `user` ar
    // randa view-ul protejat și ar DEMONTA AuthPage înainte de pasul TOTP
    // (contul cu MFA ar sări peste cod). Post-login, efectul de auto-redirect
    // duce oricum userul la destinația corectă pe roluri.
    if (state.view !== 'auth') {
      replace(authPathWithNext(window.location.pathname, window.location.search))
      return <PageSpinner />
    }
    return (
      <Suspense fallback={<PageSpinner />}>
        <AuthPage
          onSuccess={(email) => {
            // Dacă userul a venit din pricing cu un plan ales, îl ducem direct
            // înapoi la pricing — onCheckout va detecta că e logat și va sări
            // la Stripe. Fără intent, mergem la dashboard ca până acum.
            // `?next=` explicit (de la o rută protejată) bate orice intenție.
            const nextDest = nextFromSearch(window.location.search)
            if (nextDest) {
              navigate(nextDest)
              return
            }
            const intentDest = planIntentDestination(email, window.location.search)
            let afiliatIntent: string | null = null
            try {
              afiliatIntent = sessionStorage.getItem('menuvia.afiliat_intent')
            } catch {
              /* ignore (private mode) */
            }
            if (intentDest) {
              navigate(intentDest)
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
            // Fiecare rol pe ecranul lui — ACELAȘI calcul ca efectul de
            // auto-redirect (lib/postLogin.ts). Dacă efectul a mutat deja omul,
            // nu mai împingem a doua intrare în istoric.
            void (async () => {
              const { data } = await supabase.auth.getSession()
              const uid = data.session?.user.id
              const dest = uid ? await loadPostLoginDestination(uid) : '/dashboard'
              if (window.location.pathname !== '/auth') return
              navigate(dest)
            })()
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
        restaurants={restaurants}
        restaurantsLoading={rLoading}
        updateRestaurant={update}
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
            {/* Consimțământul la Termeni: se consemnează la prima sesiune, iar
                conturile fără el primesc ecranul o singură dată. Randează null
                pentru vizitatorii anonimi (meniul QR nu e atins). */}
            <TermsGateMount />
            {/* Întoarcerea din Stripe (?checkout=success|cancelled): banner
                NE-dialog, global, ca să apară și pe Onboarding (contul nou
                plătește înainte să-și creeze restaurantul). */}
            <CheckoutReturnBanner />
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
