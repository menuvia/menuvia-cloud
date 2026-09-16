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
  pendingConsentMatches,
  readPendingTermsConsent,
  recordTermsAcceptance,
} from '../lib/terms'

export default function TermsAcceptanceGate() {
  const { user, profile, refreshProfile } = useAuth()
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
  const pending = useMemo(() => readPendingTermsConsent(), [user?.id])

  const needs = !!user && needsTermsAcceptance(profile)
  const hasOwnPending = pendingConsentMatches(pending, user?.email)

  useEffect(() => {
    // Intenție rămasă de la alt cont (dispozitiv partajat) sau deja consemnată:
    // o ștergem, ca să nu fie folosită mai târziu pentru cineva care n-a bifat.
    if (!pending) return
    if (user && !hasOwnPending) clearPendingTermsConsent()
    else if (profile && !needsTermsAcceptance(profile)) clearPendingTermsConsent()
  }, [pending, user, profile, hasOwnPending])

  useEffect(() => {
    const uid = user?.id
    if (!needs || !hasOwnPending || !uid || autoTriedFor.current === uid) return
    autoTriedFor.current = uid
    void (async () => {
      try {
        await recordTermsAcceptance(pending?.version ?? TERMS_VERSION)
        await refreshProfile()
      } catch (err) {
        // Nu ascundem eșecul: ecranul de mai jos preia și cere acceptarea.
        console.error('[terms] consemnarea automată a eșuat:', err)
        clearPendingTermsConsent()
        setAutoFailedFor(uid)
      }
    })()
  }, [needs, hasOwnPending, pending, refreshProfile, user?.id])

  const accept = useCallback(async () => {
    if (!checked || busy) return
    setBusy(true)
    setError(null)
    try {
      await recordTermsAcceptance(TERMS_VERSION)
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
  }, [checked, busy, refreshProfile])

  if (!needs) return null
  // Consemnare automată în curs pentru cineva care A bifat deja: nu-l oprim.
  if (hasOwnPending && autoFailedFor !== user?.id) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-gate-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
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
      </div>
    </div>
  )
}
