// ─────────────────────────────────────────────────────────────
// AuthPage — punctul de conversie al funnel-ului (Val 1, DESIGN_SPEC.md).
// Vizual: lumea caldă-luminoasă (ca landing/pricing), NU paleta de dashboard.
// Dacă userul a venit din pricing cu un plan ales, pill-ul de plan intent
// îi confirmă alegerea — nu aterizează pe un login generic.
// Logica de auth (signup/login/reset/confirm email) e neschimbată.
//
// E4a — bilingv RO/EN: cine vine de pe /en (LandingPageEn.tsx) vede acest
// ecran în engleză. Convenția de limbă (identică peste tot în funnel-ul EN):
// cheia localStorage 'menuvia_ui_lang' ('ro' | 'en'), parametrul URL
// ?lang=en/?lang=ro o setează la mount. Default absolut: 'ro' — fluxul RO
// e neschimbat vizual/textual.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getPlanByInternalId } from '../lib/plans'
import { useIsMobile } from '../hooks/useIsMobile'
import { Icon } from '../components/ui/Icon'
import { track } from '../lib/analytics'

// Versiunea de Termeni consemnată la signup prin RPC-ul record_terms_acceptance
// (mig 042, semnătura: p_version text default '1.0'). Incrementeaz-o când se
// publică o versiune nouă a documentelor legale.
const TERMS_VERSION = '1.0'

// Prefetch: start loading DashboardPage in the background while the user
// types credentials. By the time login completes, the chunk is cached.
const _prefetch = import('../pages/DashboardPage').catch(() => {
  /* ignore */
})
void _prefetch // prevent unused-var lint

// Paleta caldă-luminoasă (aliniată cu M din App.tsx — marketing funnel)
const A = {
  bg: '#FAF9F6',
  panel: '#F5F1EA',
  surface: '#FFFFFF',
  text: '#1A1208',
  text2: '#5C4A2A',
  text3: '#9A8C7A',
  border: '#E8E0D2',
  accent: '#C8963C',
  accentSoft: '#FAF3E5',
  error: '#B3403F',
  errorBg: 'rgba(179,64,63,0.08)',
  errorBorder: 'rgba(179,64,63,0.3)',
}

const inp: React.CSSProperties = {
  width: '100%',
  background: A.surface,
  border: `1px solid ${A.border}`,
  borderRadius: 10,
  padding: '12px 14px',
  fontSize: '0.95rem',
  color: A.text,
  outline: 'none',
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}

const label: React.CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  color: A.text2,
  marginBottom: 6,
  fontWeight: 500,
}

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  background: disabled ? A.border : A.accent,
  color: disabled ? A.text3 : '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '14px 0',
  fontFamily: 'DM Sans,sans-serif',
  fontSize: 15,
  fontWeight: 700,
  cursor: disabled ? 'not-allowed' : 'pointer',
  boxShadow: disabled ? 'none' : '0 4px 14px rgba(200,150,60,0.25)',
})

// Helperii readPlanIntent/clearPlanIntent/writePlanIntent + cheia au fost
// mutați în ../lib/planIntent ca să respecte react-refresh/only-export-components.
import { readPlanIntent, writePlanIntent } from '../lib/planIntent'

function readIntentFromUrlOrSession(): 'starter' | 'growth' | 'pro' | null {
  const m = window.location.search.match(/[?&]plan=(starter|growth|pro)\b/)
  if (m) return m[1] as 'starter' | 'growth' | 'pro'
  const s = readPlanIntent()
  if (s === 'starter' || s === 'growth' || s === 'pro') return s
  return null
}

const UI_LANG_KEY = 'menuvia_ui_lang'
type UiLang = 'ro' | 'en'

// Limba activă: 'en' dacă ?lang=en, SAU (fără parametru și localStorage e
// 'en'); altfel 'ro' (default absolut). Citit sincron la mount, ca formularul
// să apară deja în limba corectă din primul render, fără flash.
function detectLang(): UiLang {
  const urlLang = new URLSearchParams(window.location.search).get('lang')
  if (urlLang === 'en') return 'en'
  if (urlLang === 'ro') return 'ro'
  try {
    if (window.localStorage.getItem(UI_LANG_KEY) === 'en') return 'en'
  } catch {
    /* ignore — localStorage indisponibil (mod privat etc.) */
  }
  return 'ro'
}

// Tabelul de traducere — TOATE stringurile vizibile ale acestui fișier.
// Textele RO sunt byte-identice cu cele de dinainte de bilingv (zero
// regresie vizuală pe fluxul RO, care rămâne default-ul absolut).
const S = {
  ro: {
    brand: 'Menuvia',
    intentContinuePrefix: 'Continui cu',
    intentSubcopy: {
      starter: 'Plan pentru meniu QR, fără comenzi.',
      growth: 'Plan recomandat pentru comenzi de la masă.',
      pro: 'Se activează cu verificare inițială — te contactăm noi.',
    },
    resetCheckEmailTitle: 'Verifică emailul',
    resetSentPrefix: 'Am trimis un link de resetare la',
    backToLogin: 'Înapoi la autentificare',
    resetPasswordTitle: 'Resetează parola',
    resetPasswordSubtitle: 'Introdu emailul și vei primi un link de resetare.',
    emailLabel: 'Email',
    emailPlaceholder: 'email@restaurant.ro',
    emailRequiredError: 'Scrie adresa de email a contului.',
    processingBtn: 'Se procesează...',
    sendResetLinkBtn: 'Trimite link de resetare',
    backToLoginArrow: '← Înapoi la autentificare',
    confirmEmailTitle: 'Verifică emailul',
    confirmSentPrefix: 'Am trimis un link de confirmare la',
    // emailRedirectTo (mai jos) readuce userul direct în aplicație — textul
    // vechi „revino să te autentifici" rupea funelul exact aici.
    confirmInstructions: 'Apasă linkul din email — te aduce direct înapoi în contul tău.',
    brandTagline: 'Configurezi restaurantul în câteva minute.',
    heroSubtitle: 'Adaugi meniul, generezi QR-urile și poți primi comenzi direct de la masă.',
    heroBullets: [
      'Meniu QR gata de folosit',
      'QR-uri pentru mese generate automat',
      'Poți porni simplu și activa comenzi când ai nevoie',
    ],
    heroFooter: '30 de zile gratuite. Anulezi oricând.',
    loginTitle: 'Bun venit înapoi',
    signupTitle: 'Creează cont gratuit',
    loginSubtitle: 'Intră în contul tău Menuvia.',
    signupSubtitle: 'Începi cu meniul digital în 30 de secunde.',
    nameLabel: 'Nume',
    namePlaceholder: 'Numele tău',
    passwordLabel: 'Parolă',
    passwordPlaceholder: 'Minimum 8 caractere',
    loginBtn: 'Intră în cont',
    signupBtn: 'Creează cont',
    forgotPassword: 'Ai uitat parola?',
    noAccount: 'Nu ai cont?',
    hasAccount: 'Ai deja cont?',
    createOne: 'Creează unul',
    errorGeneric: 'Nu am putut procesa cererea. Verifică datele și reîncearcă.',
    termsPrefix: 'Am citit și accept ',
    termsLinkTerms: 'Termenii',
    termsAnd: ' și ',
    termsLinkPrivacy: 'Politica de confidențialitate',
    termsRequiredError:
      'Bifează acceptarea Termenilor și a Politicii de confidențialitate pentru a crea contul.',
    mfaTitle: 'Verificare în doi pași',
    mfaSubtitle: 'Introdu codul de 6 cifre din aplicația ta de autentificare.',
    mfaCodeLabel: 'Cod de verificare',
    mfaVerifyBtn: 'Verifică',
    mfaInvalidCode: 'Cod incorect sau expirat. Încearcă din nou.',
    mfaBack: '← Înapoi la autentificare',
  },
  en: {
    brand: 'Menuvia',
    intentContinuePrefix: 'Continuing with',
    intentSubcopy: {
      starter: 'Plan for a QR menu, no ordering.',
      growth: 'Recommended plan for table ordering.',
      pro: 'Activated after a quick verification — we’ll reach out to you.',
    },
    resetCheckEmailTitle: 'Check your email',
    resetSentPrefix: 'We sent a reset link to',
    backToLogin: 'Back to sign in',
    resetPasswordTitle: 'Reset your password',
    resetPasswordSubtitle: 'Enter your email and you’ll receive a reset link.',
    emailLabel: 'Email',
    emailPlaceholder: 'email@restaurant.com',
    emailRequiredError: 'Enter the account email address.',
    processingBtn: 'Processing...',
    sendResetLinkBtn: 'Send reset link',
    backToLoginArrow: '← Back to sign in',
    confirmEmailTitle: 'Check your email',
    confirmSentPrefix: 'We sent a confirmation link to',
    confirmInstructions: 'Click the link in the email — it brings you right back into your account.',
    brandTagline: 'Set up your restaurant in minutes.',
    heroSubtitle:
      'Add your menu, generate the QR codes, and start taking orders straight from the table.',
    heroBullets: [
      'Ready-to-use QR menu',
      'Table QR codes generated automatically',
      'Start simple and turn on ordering whenever you need it',
    ],
    heroFooter: '30 days free. Cancel anytime.',
    loginTitle: 'Welcome back',
    signupTitle: 'Create a free account',
    loginSubtitle: 'Sign in to your Menuvia account.',
    signupSubtitle: 'Start your digital menu in 30 seconds.',
    nameLabel: 'Name',
    namePlaceholder: 'Your name',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Minimum 8 characters',
    loginBtn: 'Sign in',
    signupBtn: 'Create account',
    forgotPassword: 'Forgot your password?',
    noAccount: 'Don’t have an account?',
    hasAccount: 'Already have an account?',
    createOne: 'Create one',
    errorGeneric: 'We couldn’t process your request. Please check your details and try again.',
    termsPrefix: 'I have read and accept the ',
    termsLinkTerms: 'Terms',
    termsAnd: ' and the ',
    termsLinkPrivacy: 'Privacy Policy',
    termsRequiredError: 'Please accept the Terms and the Privacy Policy to create your account.',
    mfaTitle: 'Two-step verification',
    mfaSubtitle: 'Enter the 6-digit code from your authenticator app.',
    mfaCodeLabel: 'Verification code',
    mfaVerifyBtn: 'Verify',
    mfaInvalidCode: 'Incorrect or expired code. Please try again.',
    mfaBack: '← Back to sign in',
  },
} as const

function PlanIntentPill({ intent, lang }: { intent: 'starter' | 'growth' | 'pro'; lang: UiLang }) {
  const plan = getPlanByInternalId(intent)
  const t = S[lang]
  return (
    <div
      style={{
        background: A.accentSoft,
        border: `1px solid ${A.accent}55`,
        borderRadius: 12,
        padding: '12px 16px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span style={{ fontSize: '1.3rem' }}>{plan.emoji}</span>
      <div>
        <div style={{ color: A.text, fontSize: '0.9rem', fontWeight: 700 }}>
          {t.intentContinuePrefix} {plan.name}
        </div>
        <div style={{ color: A.text2, fontSize: '0.76rem', marginTop: 2 }}>
          {t.intentSubcopy[intent]}
        </div>
      </div>
    </div>
  )
}

// Cardul centrat folosit de sub-ecranele reset/confirm (păstrează layoutul
// simplu cu o singură coloană — acolo nu e nevoie de panoul de brand).
function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: A.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        fontFamily: 'DM Sans,sans-serif',
      }}
    >
      <div
        style={{
          background: A.surface,
          border: `1px solid ${A.border}`,
          borderRadius: 18,
          padding: 36,
          width: '100%',
          maxWidth: 420,
          boxShadow: '0 8px 32px rgba(26,18,8,0.06)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

export default function AuthPage({ onSuccess }: { onSuccess: () => void }) {
  // Limba activă e citită SINCRON la mount (URL > localStorage) ca formularul
  // să apară din primul render în limba corectă, fără flash.
  const [lang] = useState<UiLang>(detectLang)
  const t = S[lang]

  // Persistăm alegerea de limbă dacă /auth a fost deschisă cu ?lang=en/ro
  // (venită din /en). Citim direct URL-ul (nu folosim router).
  useEffect(() => {
    const urlLang = new URLSearchParams(window.location.search).get('lang')
    if (urlLang === 'en' || urlLang === 'ro') {
      try {
        window.localStorage.setItem(UI_LANG_KEY, urlLang)
      } catch {
        /* ignore — localStorage indisponibil */
      }
    }
  }, [])

  // Intent-ul e citit SINCRON (URL > session) ca pill-ul să apară din primul
  // render, fără flash. Effect-ul de mai jos doar persistă URL-ul în session.
  const [planIntent] = useState<'starter' | 'growth' | 'pro' | null>(readIntentFromUrlOrSession)
  const isMobile = useIsMobile()

  // Persistăm planul-țintă dacă /auth a fost deschisă din /pricing cu ?plan=...
  // Citim direct URL-ul (nu folosim router) ca să nu adăugăm dependență.
  useEffect(() => {
    const m = window.location.search.match(/[?&]plan=(starter|growth|pro)\b/)
    if (m) writePlanIntent(m[1])
  }, [])

  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Acceptarea Termenilor + Politicii e OBLIGATORIE la signup (GDPR/audit):
  // butonul de creare cont stă dezactivat până la bifă.
  const [termsAccepted, setTermsAccepted] = useState(false)
  // FIX: separate state for "signup needs email confirmation" case
  const [confirmEmail, setConfirmEmail] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  // MFA (mig 235): după parolă, conturile cu factor TOTP verificat trec prin
  // pasul de cod (aal1 → aal2). null = pasul nu e activ.
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')

  // Erorile Supabase vin în ENGLEZĂ (Invalid login credentials etc.) — publicul
  // e non-tehnic și român. Mapăm mesajele cunoscute pe română; necunoscutele cad
  // pe un mesaj generic acționabil (nu textul brut englez). Pentru lang='en'
  // mesajul Supabase e deja în engleză — îl întoarcem brut, cu fallback generic
  // tradus dacă lipsește.
  const translateAuthError = (msg: string): string => {
    if (lang === 'en') return msg || t.errorGeneric
    const m = msg.toLowerCase()
    if (m.includes('invalid login credentials')) return 'Email sau parolă greșită.'
    if (m.includes('already registered') || m.includes('already been registered'))
      return 'Există deja un cont cu acest email. Încearcă autentificarea sau resetarea parolei.'
    if (m.includes('email not confirmed'))
      return 'Emailul nu e confirmat încă. Verifică inbox-ul (și spam-ul) pentru linkul de confirmare.'
    if (m.includes('password should be') || m.includes('password is too short'))
      return 'Parola e prea scurtă — folosește minim 6 caractere.'
    if (m.includes('rate limit') || m.includes('too many requests'))
      return 'Prea multe încercări. Așteaptă un minut și reîncearcă.'
    if (m.includes('invalid email') || m.includes('unable to validate email'))
      return 'Adresa de email nu pare validă. Verific-o și reîncearcă.'
    if (m.includes('network') || m.includes('fetch') || m.includes('failed to'))
      return 'Problemă de conexiune. Verifică internetul și reîncearcă.'
    return 'Nu am putut procesa cererea. Verifică datele și reîncearcă.'
  }

  const handle = async (evt: React.FormEvent) => {
    evt.preventDefault()
    setLoading(true)
    setError(null)

    if (mode === 'signup') {
      // Plasă de siguranță pe lângă butonul dezactivat (ex. submit cu Enter).
      if (!termsAccepted) {
        setError(t.termsRequiredError)
        setLoading(false)
        return
      }
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name },
          // Linkul de confirmare readuce userul DIRECT în aplicație (sesiune
          // deja creată de GoTrue la click) — înainte, textul îi cerea să
          // „revină să se autentifice" și funelul se rupea exact aici.
          // Același pattern de URL ca resetPasswordForEmail de mai jos.
          emailRedirectTo: (import.meta.env.VITE_APP_URL || window.location.origin) + '/auth',
        },
      })
      if (signUpErr) {
        setError(translateAuthError(signUpErr.message))
        setLoading(false)
        return
      }

      // Audit consimțământ (mig 042): consemnăm versiunea de Termeni acceptată.
      // Best-effort: fără sesiune (confirmare de email pending) RPC-ul nu are
      // auth.uid() și eșuează — logăm defensiv, nu blocăm niciodată signup-ul.
      try {
        const { error: termsErr } = await supabase.rpc('record_terms_acceptance', {
          p_version: TERMS_VERSION,
        })
        if (termsErr) console.warn('[auth] record_terms_acceptance eșuat:', termsErr.message)
      } catch (termsEx) {
        console.warn('[auth] record_terms_acceptance eșuat:', termsEx)
      }
      // Telemetria funelului — zero PII (fără email/nume în properties).
      track('signup_completed', {
        email_confirmation_required: !data.session,
        plan_intent: planIntent,
      })

      // If Supabase requires email confirmation, session is null — don't call onSuccess()
      if (!data.session) {
        setConfirmEmail(true)
        setLoading(false)
        return
      }
      onSuccess()
      return
    }

    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
    if (signInErr) {
      setError(translateAuthError(signInErr.message))
      setLoading(false)
      return
    }

    // MFA (mig 235): dacă contul are un factor TOTP verificat, sesiunea de
    // după parolă e doar aal1 — cerem codul înainte de onSuccess. Orice eroare
    // aici lasă fluxul să continue: enforcement-ul REAL e server-side
    // (is_platform_admin cere aal2), pasul din UI e doar drumul prietenos.
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        const { data: factors } = await supabase.auth.mfa.listFactors()
        const totp = (factors?.totp ?? []).find((f) => f.status === 'verified')
        if (totp) {
          setMfaFactorId(totp.id)
          setMfaCode('')
          setLoading(false)
          return
        }
      }
    } catch {
      /* fallback: continuăm fără pasul MFA din UI */
    }
    onSuccess()
  }

  const handleMfaVerify = async (evt: React.FormEvent) => {
    evt.preventDefault()
    if (!mfaFactorId || mfaCode.trim().length < 6) return
    setLoading(true)
    setError(null)
    try {
      const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({
        factorId: mfaFactorId,
      })
      if (cErr) throw cErr
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: ch.id,
        code: mfaCode.trim(),
      })
      if (vErr) {
        setError(t.mfaInvalidCode)
        setLoading(false)
        return
      }
      onSuccess()
    } catch {
      setError(t.mfaInvalidCode)
      setLoading(false)
    }
  }

  const handleReset = async () => {
    // Email gol = feedback explicit, nu no-op tăcut (click-ul părea mort).
    if (!resetEmail.trim()) {
      setError(t.emailRequiredError)
      return
    }
    setLoading(true)
    setError(null)
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: (import.meta.env.VITE_APP_URL || window.location.origin) + '/reset-password',
    })
    if (resetErr) {
      setError(translateAuthError(resetErr.message))
      setLoading(false)
      return
    }
    setResetSent(true)
    setLoading(false)
  }

  if (showReset) {
    if (resetSent) {
      return (
        <CenteredCard>
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 16 }}>
              <Icon name="mail" size={40} color={A.accent} />
            </div>
            <h2
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: '1.4rem',
                color: A.text,
                marginBottom: 12,
              }}
            >
              {t.resetCheckEmailTitle}
            </h2>
            <p style={{ color: A.text2, marginBottom: 24, lineHeight: 1.6 }}>
              {t.resetSentPrefix} <strong style={{ color: A.text }}>{resetEmail}</strong>.
            </p>
            <button
              onClick={() => {
                setShowReset(false)
                setResetSent(false)
                setMode('login')
              }}
              style={primaryBtn(false)}
            >
              {t.backToLogin}
            </button>
          </div>
        </CenteredCard>
      )
    }
    return (
      <CenteredCard>
        <div
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.1rem',
            color: A.accent,
            marginBottom: 24,
            fontWeight: 700,
          }}
        >
          {t.brand}
        </div>
        <h1
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.5rem',
            color: A.text,
            marginBottom: 6,
          }}
        >
          {t.resetPasswordTitle}
        </h1>
        <p style={{ color: A.text3, fontSize: '0.85rem', marginBottom: 28 }}>
          {t.resetPasswordSubtitle}
        </p>
        {/* <form> real: Enter trimite (ca formularul principal de login). */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleReset()
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div>
            <label htmlFor="reset-email" style={label}>
              {t.emailLabel}
            </label>
            <input
              id="reset-email"
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              placeholder={t.emailPlaceholder}
              style={inp}
              onFocus={(e) => (e.target.style.borderColor = A.accent)}
              onBlur={(e) => (e.target.style.borderColor = A.border)}
            />
          </div>
          {error && (
            <div
              role="alert"
              style={{
                background: A.errorBg,
                border: `1px solid ${A.errorBorder}`,
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                color: A.error,
              }}
            >
              {error}
            </div>
          )}
          <button type="submit" disabled={loading} style={primaryBtn(loading)}>
            {loading ? t.processingBtn : t.sendResetLinkBtn}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowReset(false)
              setError(null)
            }}
            style={{
              background: 'none',
              border: 'none',
              color: A.text3,
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontFamily: 'DM Sans,sans-serif',
              // Touch target ≥44px fără să schimbe ritmul vizual (margin negativ).
              padding: '12px 8px',
              minHeight: 44,
              margin: '-8px 0 -12px',
            }}
          >
            {t.backToLoginArrow}
          </button>
        </form>
      </CenteredCard>
    )
  }

  // Pasul MFA (mig 235) — sesiunea există (aal1), dar contul cere codul TOTP.
  if (mfaFactorId) {
    return (
      <CenteredCard>
        <div
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.1rem',
            color: A.accent,
            marginBottom: 24,
            fontWeight: 700,
          }}
        >
          {t.brand}
        </div>
        <h1
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.5rem',
            color: A.text,
            marginBottom: 6,
          }}
        >
          {t.mfaTitle}
        </h1>
        <p style={{ color: A.text3, fontSize: '0.85rem', marginBottom: 28 }}>{t.mfaSubtitle}</p>
        <form
          onSubmit={handleMfaVerify}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div>
            <label htmlFor="mfa-code" style={label}>
              {t.mfaCodeLabel}
            </label>
            <input
              id="mfa-code"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              autoFocus
              style={{ ...inp, letterSpacing: '0.25em', fontVariantNumeric: 'tabular-nums' }}
              onFocus={(e) => (e.target.style.borderColor = A.accent)}
              onBlur={(e) => (e.target.style.borderColor = A.border)}
            />
          </div>
          {error && (
            <div
              role="alert"
              style={{
                background: A.errorBg,
                border: `1px solid ${A.errorBorder}`,
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                color: A.error,
              }}
            >
              {error}
            </div>
          )}
          <button type="submit" disabled={loading || mfaCode.length < 6} style={primaryBtn(loading)}>
            {loading ? t.processingBtn : t.mfaVerifyBtn}
          </button>
          <button
            type="button"
            onClick={() => {
              // Înapoi = renunță la sesiunea aal1 pe jumătate autentificată.
              void supabase.auth.signOut()
              setMfaFactorId(null)
              setMfaCode('')
              setError(null)
            }}
            style={{
              background: 'none',
              border: 'none',
              color: A.text3,
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontFamily: 'DM Sans,sans-serif',
              padding: '12px 8px',
              minHeight: 44,
              margin: '-8px 0 -12px',
            }}
          >
            {t.mfaBack}
          </button>
        </form>
      </CenteredCard>
    )
  }

  // FIX: show "check email" screen instead of proceeding with broken state
  if (confirmEmail) {
    return (
      <CenteredCard>
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: 16 }}>
            <Icon name="mail" size={40} color={A.accent} />
          </div>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.4rem',
              color: A.text,
              marginBottom: 12,
            }}
          >
            {t.confirmEmailTitle}
          </h2>
          <p style={{ color: A.text2, marginBottom: 24, lineHeight: 1.6 }}>
            {t.confirmSentPrefix} <strong style={{ color: A.text }}>{email}</strong>.
            <br />
            {t.confirmInstructions}
          </p>
          <button
            onClick={() => {
              setConfirmEmail(false)
              setMode('login')
            }}
            style={primaryBtn(false)}
          >
            {t.backToLogin}
          </button>
        </div>
      </CenteredCard>
    )
  }

  // ── Panoul de brand (stânga pe desktop / header compact pe mobil) ──
  const brandPanel = isMobile ? (
    <div style={{ padding: '28px 24px 4px', textAlign: 'center' }}>
      <div
        style={{
          fontFamily: 'Fraunces,serif',
          fontSize: '1.6rem',
          color: A.accent,
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        {t.brand}
      </div>
      <p style={{ color: A.text2, fontSize: '0.9rem', lineHeight: 1.5 }}>{t.brandTagline}</p>
    </div>
  ) : (
    <div
      style={{
        flex: '1 1 380px',
        background: A.panel,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '56px 48px',
      }}
    >
      <div
        style={{
          fontFamily: 'Fraunces,serif',
          fontSize: '1.5rem',
          color: A.accent,
          fontWeight: 700,
          marginBottom: 36,
        }}
      >
        {t.brand}
      </div>
      <h2
        style={{
          fontFamily: 'Fraunces,serif',
          fontSize: 'clamp(1.5rem, 2.6vw, 2rem)',
          color: A.text,
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: '-0.02em',
          marginBottom: 12,
        }}
      >
        {t.brandTagline}
      </h2>
      <p style={{ color: A.text2, fontSize: '1rem', lineHeight: 1.6, marginBottom: 28 }}>
        {t.heroSubtitle}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 36 }}>
        {t.heroBullets.map((b) => (
          <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: '#E8F2EC',
                border: '1.5px solid #2D8659',
                color: '#2D8659',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.7rem',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              ✓
            </span>
            <span style={{ color: A.text, fontSize: '0.92rem' }}>{b}</span>
          </div>
        ))}
      </div>
      <div style={{ color: A.text3, fontSize: '0.82rem' }}>{t.heroFooter}</div>
    </div>
  )

  return (
    <div
      style={{
        minHeight: '100vh',
        background: A.bg,
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        fontFamily: 'DM Sans,sans-serif',
      }}
    >
      {brandPanel}

      {/* Panoul de formular */}
      <div
        style={{
          flex: '1 1 420px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: isMobile ? '16px 20px 40px' : '40px 32px',
        }}
      >
        <div
          style={{
            background: A.surface,
            border: `1px solid ${A.border}`,
            borderRadius: 18,
            padding: isMobile ? '28px 22px' : 36,
            width: '100%',
            maxWidth: 420,
            boxShadow: '0 8px 32px rgba(26,18,8,0.06)',
          }}
        >
          {planIntent && <PlanIntentPill intent={planIntent} lang={lang} />}

          <h1
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.5rem',
              color: A.text,
              marginBottom: 6,
              letterSpacing: '-0.02em',
            }}
          >
            {mode === 'login' ? t.loginTitle : t.signupTitle}
          </h1>
          <p style={{ color: A.text3, fontSize: '0.85rem', marginBottom: 24 }}>
            {mode === 'login' ? t.loginSubtitle : t.signupSubtitle}
          </p>

          <form onSubmit={handle} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mode === 'signup' && (
              <div>
                <label htmlFor="auth-name" style={label}>
                  {t.nameLabel}
                </label>
                <input
                  id="auth-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.namePlaceholder}
                  required
                  style={inp}
                  onFocus={(e) => (e.target.style.borderColor = A.accent)}
                  onBlur={(e) => (e.target.style.borderColor = A.border)}
                />
              </div>
            )}
            <div>
              <label htmlFor="auth-email" style={label}>
                {t.emailLabel}
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.emailPlaceholder}
                required
                style={inp}
                onFocus={(e) => (e.target.style.borderColor = A.accent)}
                onBlur={(e) => (e.target.style.borderColor = A.border)}
              />
            </div>
            <div>
              <label htmlFor="auth-password" style={label}>
                {t.passwordLabel}
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.passwordPlaceholder}
                required
                minLength={8}
                style={inp}
                onFocus={(e) => (e.target.style.borderColor = A.accent)}
                onBlur={(e) => (e.target.style.borderColor = A.border)}
              />
            </div>

            {mode === 'signup' && (
              <label
                htmlFor="auth-terms"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  fontSize: '0.8rem',
                  color: A.text2,
                  lineHeight: 1.5,
                  cursor: 'pointer',
                }}
              >
                <input
                  id="auth-terms"
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  style={{
                    width: 18,
                    height: 18,
                    marginTop: 1,
                    accentColor: A.accent,
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                />
                <span>
                  {t.termsPrefix}
                  <a
                    href="/termeni"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: A.accent, fontWeight: 600 }}
                  >
                    {t.termsLinkTerms}
                  </a>
                  {t.termsAnd}
                  <a
                    href="/confidentialitate"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: A.accent, fontWeight: 600 }}
                  >
                    {t.termsLinkPrivacy}
                  </a>
                </span>
              </label>
            )}

            {error && (
              <div
                role="alert"
                style={{
                  background: A.errorBg,
                  border: `1px solid ${A.errorBorder}`,
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontSize: 13,
                  color: A.error,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (mode === 'signup' && !termsAccepted)}
              style={{
                ...primaryBtn(loading || (mode === 'signup' && !termsAccepted)),
                marginTop: 4,
              }}
            >
              {loading ? t.processingBtn : mode === 'login' ? t.loginBtn : t.signupBtn}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 20, fontSize: '0.85rem', color: A.text3 }}>
            {mode === 'login' && (
              <button
                onClick={() => {
                  setShowReset(true)
                  setResetEmail(email)
                  setError(null)
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: A.text3,
                  cursor: 'pointer',
                  fontSize: '0.82rem',
                  fontFamily: 'DM Sans,sans-serif',
                  display: 'block',
                  width: '100%',
                  // Touch target ≥44px; marginul negativ păstrează spațierea vizuală.
                  padding: '12px 8px',
                  minHeight: 44,
                  margin: '-12px 0 -4px',
                }}
              >
                {t.forgotPassword}
              </button>
            )}
            {mode === 'login' ? t.noAccount : t.hasAccount}{' '}
            <button
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login')
                setError(null)
              }}
              style={{
                background: 'none',
                border: 'none',
                color: A.accent,
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 600,
                fontFamily: 'DM Sans,sans-serif',
                // Touch target ≥44px pe buton inline: padding + margin negativ
                // simetric ca textul să rămână aliniat cu rândul.
                padding: '12px 8px',
                margin: '-12px -8px',
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 44,
              }}
            >
              {mode === 'login' ? t.createOne : t.loginBtn}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
