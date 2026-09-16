// ─────────────────────────────────────────────────────────────
// TermsAcceptanceGate — plasa care face consimțământul să EXISTE.
//
// Contextul defectului (audit v3): bifa de la signup se pierdea întotdeauna,
// fiindcă `record_terms_acceptance` cere `auth.uid()` iar `signUp` întoarce
// `session = null` cât timp confirmarea de email e pornită. Măsurat pe
// producție: 0 din 7 conturi aveau `terms_accepted_at`.
//
// Gate-ul acoperă două cazuri:
//   1. omul A BIFAT la signup → avem intenția în localStorage, legată de
//      emailul lui → o consemnăm tăcut la prima sesiune, fără să-l mai
//      întrebăm o dată (ar fi o a doua cerere pentru același consimțământ);
//   2. contul e mai vechi decât bifa, intenția s-a pierdut, sau omul e pe alt
//      dispozitiv → ecran de acceptare, o singură dată.
//
// Fail-open pe NECUNOSCUT: fără user sau fără profil încărcat nu blocăm nimic.
// Un blip de rețea nu are voie să închidă dashboard-ul cuiva care a acceptat
// deja — aceeași disciplină ca tristate-ul de plan și ca bannerul casei.
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { D } from '../lib/constants'
import {
  TERMS_VERSION,
  clearPendingTermsConsent,
  needsTermsAcceptance,
  readPendingTermsConsent,
  recordTermsAcceptance,
} from '../lib/terms'

/**
 * Rutele pe care gate-ul NU are voie să apară. Recuperarea parolei creează o
 * sesiune REALĂ, deci fără excepția asta un om care și-a uitat parola ar
 * trebui să accepte Termenii înainte să și-o poată schimba. Citit o singură
 * dată, la montare: fluxul de recuperare pornește mereu cu o navigare
 * completă din email, deci acolo unde contează valoarea e corectă.
 */
const AUTH_PATHS = ['/auth', '/reset-password']

/** Anunțul de navigare emis de `navigate()` din App (pushState nu emite nimic). */
export const ROUTE_CHANGE_EVENT = 'menuvia:route'

function readPath(): string {
  try {
    return window.location.pathname
  } catch {
    return ''
  }
}

export default function TermsAcceptanceGate() {
  const { user, profile, refreshProfile, signOut } = useAuth()
  // Ruta se RECITEȘTE la fiecare navigare, nu doar la montare: gate-ul e
  // montat lângă router și nu se remontează, deci o valoare înghețată la
  // montare l-ar suprima pentru toată sesiunea celui care intră pe /auth.
  const [path, setPath] = useState(readPath)
  useEffect(() => {
    const sync = () => setPath(readPath())
    window.addEventListener('popstate', sync)
    window.addEventListener(ROUTE_CHANGE_EVENT, sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener(ROUTE_CHANGE_EVENT, sync)
    }
  }, [])
  const onAuthRoute = AUTH_PATHS.includes(path)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Consemnarea automată se încearcă O SINGURĂ dată per cont; dacă pică, omul
  // vede ecranul și decide el. Reținem PENTRU CINE am încercat, ca o schimbare
  // de cont pe același tab să nu moștenească încercarea precedentă.
  const [autoFailedFor, setAutoFailedFor] = useState<string | null>(null)
  const autoTriedFor = useRef<string | null>(null)

  // Citit o singură dată per cont: un obiect nou la fiecare randare ar face
  // efectele de mai jos să se re-execute la infinit prin lista de dependențe.
  // Fără user nu există intenție de luat în seamă, deci `uid` chiar e folosit
  // în corp (nu e o dependență decorativă).
  const uid = user?.id ?? null
  const email = user?.email ?? null
  // Intențiile sunt indexate pe email, deci citim DOAR pe a contului curent.
  const pending = useMemo(() => (email ? readPendingTermsConsent(email) : null), [email])

  const needs = !!user && !onAuthRoute && needsTermsAcceptance(profile)
  const hasOwnPending = !!pending

  // Schimbarea contului în același tab resetează ecranul. Fără asta, B ar
  // găsi căsuța BIFATĂ de A — exact tiparul pe care un ecran de consimțământ
  // nu are voie să-l aibă.
  useEffect(() => {
    setChecked(false)
    setError(null)
    setAutoFailedFor(null)
  }, [uid])

  useEffect(() => {
    // Consimțământul e deja consemnat în profil → intenția nu mai are rost.
    // Ștergem DOAR intrarea acestui cont: intențiile altor conturi de pe
    // același dispozitiv rămân valabile pentru sesiunile lor.
    if (!pending || !email) return
    if (profile && !needsTermsAcceptance(profile)) clearPendingTermsConsent(email)
  }, [pending, email, profile])

  useEffect(() => {
    if (!needs || !hasOwnPending || !uid || autoTriedFor.current === uid) return
    autoTriedFor.current = uid
    void (async () => {
      try {
        await recordTermsAcceptance(pending?.version ?? TERMS_VERSION, email ?? undefined)
        await refreshProfile()
      } catch (err) {
        // Nu ascundem eșecul: ecranul de mai jos preia și cere acceptarea.
        console.error('[terms] consemnarea automată a eșuat:', err)
        clearPendingTermsConsent(email ?? undefined)
        setAutoFailedFor(uid)
      }
    })()
  }, [needs, hasOwnPending, pending, refreshProfile, uid, email])

  const accept = useCallback(async () => {
    if (!checked || busy) return
    setBusy(true)
    setError(null)
    try {
      await recordTermsAcceptance(TERMS_VERSION, email ?? undefined)
      await refreshProfile()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Nu am putut consemna acceptarea. Reîncearcă.',
      )
    } finally {
      setBusy(false)
    }
  }, [checked, busy, refreshProfile, email])

  if (!needs) return null
  // Consemnare automată în curs pentru cineva care A bifat deja: nu-l oprim.
  if (hasOwnPending && autoFailedFor !== uid) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-gate-title"
      style={{
        position: 'fixed',
        inset: 0,
        // Peste cookie banner (9999) și cardurile PWA: pe un telefon scurt,
        // banner-ul de cookie-uri acoperea butonul „Accept și continui".
        zIndex: 10000,
        background: 'rgba(12, 10, 8, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: D.s1,
          border: `1px solid ${D.border}`,
          borderRadius: 16,
          padding: '26px 24px',
          maxWidth: 480,
          width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <h2
          id="terms-gate-title"
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.3rem',
            color: D.t1,
            margin: 0,
            marginBottom: 10,
            fontWeight: 600,
          }}
        >
          Acceptă Termenii ca să continui
        </h2>
        <p style={{ color: D.t2, fontSize: '0.9rem', lineHeight: 1.6, marginTop: 0 }}>
          Avem nevoie de acordul tău consemnat pentru Termeni și pentru Politica de
          confidențialitate. Durează o secundă și se cere o singură dată.
        </p>

        <label
          htmlFor="terms-gate-check"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            margin: '16px 0',
            cursor: 'pointer',
            color: D.t1,
            fontSize: '0.88rem',
            lineHeight: 1.5,
          }}
        >
          <input
            id="terms-gate-check"
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            style={{ marginTop: 3, width: 17, height: 17, accentColor: D.gold, flexShrink: 0 }}
          />
          <span>
            Am citit și accept{' '}
            <a href="/termeni" target="_blank" rel="noreferrer" style={{ color: D.gold }}>
              Termenii
            </a>{' '}
            și{' '}
            <a href="/confidentialitate" target="_blank" rel="noreferrer" style={{ color: D.gold }}>
              Politica de confidențialitate
            </a>
            .
          </span>
        </label>

        {error && (
          <div
            role="alert"
            style={{
              background: D.s3,
              border: `1px solid ${D.red}`,
              borderRadius: 10,
              padding: '10px 12px',
              color: D.t1,
              fontSize: '0.84rem',
              marginBottom: 14,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        <button
          onClick={() => void accept()}
          disabled={!checked || busy}
          data-testid="terms-accept"
          style={{
            width: '100%',
            padding: '13px 0',
            borderRadius: 11,
            border: 'none',
            background: !checked || busy ? D.s3 : D.gold,
            color: !checked || busy ? D.t3 : D.onGold,
            fontFamily: 'DM Sans,sans-serif',
            fontWeight: 700,
            fontSize: '0.95rem',
            cursor: !checked || busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Se consemnează...' : 'Accept și continui'}
        </button>

        {/* Ieșirea din cont e obligatorie: fără ea, cineva care nu vrea să
            accepte (sau la care consemnarea pică) rămâne blocat în propriul
            cont, fără nicio cale de ieșire. */}
        <button
          onClick={() => void signOut()}
          disabled={busy}
          style={{
            width: '100%',
            marginTop: 10,
            padding: '11px 0',
            borderRadius: 11,
            border: `1px solid ${D.border}`,
            background: 'transparent',
            color: D.t2,
            fontFamily: 'DM Sans,sans-serif',
            fontWeight: 600,
            fontSize: '0.88rem',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          Ieși din cont
        </button>
      </div>
    </div>
  )
}
