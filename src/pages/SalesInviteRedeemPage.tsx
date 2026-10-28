// =============================================================
// Menuvia — src/pages/SalesInviteRedeemPage.tsx
// Răscumpărarea unei invitații în rețeaua de vânzări (mig 302, pachetul 8b-1):
//   /sef-vanzari/:token → șef de vânzări     /echipa/:token → agent
//
// Principii:
//   • Tokenul NU se păstrează nicăieri în afara memoriei paginii: nu în storage,
//     nu în console, nu în istoric. La montare, URL-ul curent este înlocuit
//     (history.replaceState) cu o cale FĂRĂ token. Singura excepție intenționată
//     e calea spre /auth (?next=…), prin care omul fără cont se întoarce aici;
//     telemetria o curăță (lib/telemetryScrub.ts).
//   • Fără sesiune → /auth?mode=signup&next=<calea invitației> (replace, ca
//     intrarea cu token să nu rămână în istoric). După login revine pe pagină.
//   • FAIL-CLOSED pe contract: butonul rămâne dezactivat cât contractul nu e
//     publicat sau cât textul versiunii publicate nu e în acest bundle
//     (lib/salesContract.ts) — nu se acceptă un document care nu a fost afișat.
//   • Un singur mesaj pentru orice problemă a invitației (`invite_invalid`),
//     ca pe server (anti-oracol). Serverul e autoritatea; validarea CUI de aici
//     doar dă un mesaj imediat.
// =============================================================
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { D } from '../lib/constants'
import { useAuth } from '../contexts/AuthContext'
import { useSalesNetwork } from '../hooks/useSalesNetwork'
import { PageSpinner } from '../components/PageLoader'
import { INVITE_BASE_PATH, checkInviteFields, signupPathForInvite } from '../lib/salesInviteFlow'
import { contractTextFor } from '../lib/salesContract'
import {
  SALES_FAILURE_MESSAGES,
  SalesNetworkError,
  describeSalesError,
  isInviteTokenShape,
  redeemSalesInvite,
  sha256Hex,
  type SalesRole,
} from '../lib/salesNetwork'

interface Props {
  kind: SalesRole
  /** Tokenul din URL. Se citește O dată (useState); URL-ul e curățat la montare. */
  token: string
  navigate: (path: string) => void
  /** Înlocuiește intrarea curentă din istoric (fără intrare nouă). */
  replace: (path: string) => void
}

const COPY: Record<
  SalesRole,
  { title: string; lead: string; rules: string[]; shareLabel: string }
> = {
  head: {
    title: 'Invitație: șef de vânzări Menuvia',
    lead: 'Ai fost invitat să conduci o echipă de agenți care prezintă Menuvia restaurantelor.',
    rules: [
      'Nu plătești nicio taxă de intrare, de instruire sau de participare.',
      'Câștigi comision doar din vânzări reale: abonamente plătite ale restaurantelor aduse de tine și de echipa ta.',
      'Poți invita agenți în echipa ta; primești un bonus din vânzările lor, nu din simpla recrutare.',
      'Contractul de mai jos spune exact ce primești și ce nu ai voie să faci. Îl accepți în același pas.',
    ],
    shareLabel:
      'Arată numele, telefonul și emailul meu agenților din echipa mea (poți retrage oricând)',
  },
  agent: {
    title: 'Invitație: agent de vânzări Menuvia',
    lead: 'Ai fost invitat în echipa unui șef de vânzări Menuvia.',
    rules: [
      'Nu plătești nicio taxă de intrare, de instruire sau de participare.',
      'Câștigi comision doar din vânzări reale: abonamente plătite ale restaurantelor atribuite ție.',
      'Nu încasezi bani de la clienți și nu ai un număr minim de vânzări de atins.',
      'Contractul de mai jos spune exact ce primești și ce nu ai voie să faci. Îl accepți în același pas.',
    ],
    shareLabel:
      'Arată numele, telefonul și emailul meu șefului meu de vânzări (poți retrage oricând)',
  },
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: D.bg,
  color: D.t1,
  fontFamily: D.fontBody,
  display: 'flex',
  justifyContent: 'center',
  padding: '32px 16px',
  boxSizing: 'border-box',
}
const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 560,
  background: D.s2,
  border: `1px solid ${D.border}`,
  borderRadius: 16,
  padding: 24,
  boxSizing: 'border-box',
  alignSelf: 'flex-start',
}
const inputStyle: CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '12px 14px',
  fontSize: '0.95rem',
  color: D.t1,
  outline: 'none',
  fontFamily: D.fontBody,
  boxSizing: 'border-box',
  minHeight: 44,
}
const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  color: D.t2,
  marginBottom: 6,
  fontWeight: 600,
}
const fieldErrorStyle: CSSProperties = { color: D.red, fontSize: '0.8rem', marginTop: 6 }
const noticeStyle: CSSProperties = {
  background: D.amberA,
  border: `1px solid ${D.amber}`,
  color: D.t1,
  borderRadius: 10,
  padding: '12px 14px',
  fontSize: '0.88rem',
  marginBottom: 16,
}
const checkRowStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
  fontSize: '0.88rem',
  color: D.t1,
  lineHeight: 1.45,
  cursor: 'pointer',
}

function primaryButton(disabled: boolean): CSSProperties {
  return {
    width: '100%',
    minHeight: 48,
    borderRadius: 10,
    border: 'none',
    background: disabled ? D.s4 : D.gold,
    color: disabled ? D.tDisabled : D.onGold,
    fontWeight: 700,
    fontSize: '0.95rem',
    fontFamily: D.fontBody,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={pageStyle}>
      <div style={cardStyle}>{children}</div>
    </div>
  )
}

export default function SalesInviteRedeemPage({
  kind,
  token: tokenProp,
  navigate,
  replace,
}: Props) {
  const { user, loading: authLoading } = useAuth()
  // Tokenul se citește O singură dată: după curățarea URL-ului, un re-parse al
  // rutei (popstate) ar aduce un token gol, dar pagina îl are deja.
  const [token] = useState<string>(tokenProp)
  const tokenOk = isInviteTokenShape(token)
  const basePath = INVITE_BASE_PATH[kind]
  const copy = COPY[kind]

  const {
    network,
    loading: netLoading,
    error: netError,
    unavailable,
    reload,
  } = useSalesNetwork(!authLoading && user !== null && tokenOk)

  const [phone, setPhone] = useState('')
  const [cui, setCui] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [shareContact, setShareContact] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [cuiError, setCuiError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Invitația a fost respinsă de server: formularul nu mai are rost.
  const [blocked, setBlocked] = useState(false)

  const replaceRef = useRef(replace)
  replaceRef.current = replace

  // 1) Tokenul iese din URL imediat ce a fost citit (rămâne doar în memorie).
  //    Pe ruta /auth?next=… NU rulează (alt component); acolo curăță telemetria.
  useEffect(() => {
    try {
      window.history.replaceState(window.history.state, '', basePath)
    } catch {
      /* mediu fără History API: nimic de curățat */
    }
  }, [basePath])

  // 2) Fără sesiune → înscriere, cu întoarcere pe această invitație după login.
  useEffect(() => {
    if (authLoading || user !== null || !tokenOk) return
    const signupPath = signupPathForInvite(kind, token)
    if (signupPath === null) return
    replaceRef.current(signupPath)
  }, [authLoading, user, tokenOk, token, kind])

  // ── Ramuri fără formular ──────────────────────────────────────
  if (!tokenOk) {
    return (
      <Shell>
        <h1 style={{ fontSize: '1.3rem', margin: '0 0 12px' }}>{copy.title}</h1>
        <p role="alert" style={{ color: D.t2, lineHeight: 1.5 }}>
          {SALES_FAILURE_MESSAGES.invite_invalid}
        </p>
        <button type="button" style={primaryButton(false)} onClick={() => navigate('/')}>
          Înapoi la pagina principală
        </button>
      </Shell>
    )
  }
  if (authLoading || user === null) return <PageSpinner />
  // `network === null` fără eroare = încă nu s-a terminat prima citire (hook-ul
  // pornește `loading` abia în efect): spinner, nu un mesaj de eroare fals.
  if (network === null && (netLoading || netError === null)) return <PageSpinner />

  if (network === null) {
    // TRISTATE: starea contului e NECUNOSCUTĂ (rețea / RPC nedeployat) — nu
    // ghicim; omul poate reîncerca, iar butonul de acceptare nu există.
    return (
      <Shell>
        <h1 style={{ fontSize: '1.3rem', margin: '0 0 12px' }}>{copy.title}</h1>
        <p role="alert" style={{ color: D.t2, lineHeight: 1.5 }}>
          {unavailable
            ? SALES_FAILURE_MESSAGES.unavailable
            : (netError?.message ?? SALES_FAILURE_MESSAGES.unknown)}
        </p>
        <button type="button" style={primaryButton(false)} onClick={() => void reload()}>
          Reîncearcă
        </button>
      </Shell>
    )
  }

  if (network.affiliateId !== null) {
    return (
      <Shell>
        <h1 style={{ fontSize: '1.3rem', margin: '0 0 12px' }}>{copy.title}</h1>
        <p role="alert" style={{ color: D.t2, lineHeight: 1.5 }}>
          {SALES_FAILURE_MESSAGES.already_affiliate}
        </p>
        <button type="button" style={primaryButton(false)} onClick={() => replace('/afiliat')}>
          Mergi la panoul tău
        </button>
      </Shell>
    )
  }

  // ── Contractul (fail-closed) ──────────────────────────────────
  const currentVersion = network.contract.currentVersion
  const contractText = contractTextFor(currentVersion, kind)
  const contractReady = currentVersion !== null && contractText !== null
  const canSubmit = contractReady && accepted && !submitting && !blocked

  const submit = async (): Promise<void> => {
    if (!canSubmit || currentVersion === null || contractText === null) return
    setFormError(null)
    const fields = checkInviteFields(phone, cui)
    setPhoneError(fields.phoneError)
    setCuiError(fields.cuiError)
    if (!fields.ok || fields.cui === null) return

    setSubmitting(true)
    try {
      const contractHash = await sha256Hex(contractText)
      await redeemSalesInvite(kind, {
        token,
        phone: fields.phone,
        cui: fields.cui,
        contractVersion: currentVersion,
        contractHash,
        shareContact,
      })
      // replace: intrarea paginii de invitație nu rămâne în istoric.
      replace('/afiliat')
    } catch (e) {
      setFormError(describeSalesError(e))
      if (e instanceof SalesNetworkError) {
        if (e.reason === 'invite_invalid' || e.reason === 'already_affiliate') setBlocked(true)
        // Contractul s-a schimbat între timp: aducem versiunea nouă.
        if (e.reason === 'contract_version_mismatch' || e.reason === 'contract_not_published')
          void reload()
      }
      setSubmitting(false)
    }
  }

  return (
    <Shell>
      <h1 style={{ fontSize: '1.4rem', margin: '0 0 8px' }}>{copy.title}</h1>
      <p style={{ color: D.t2, margin: '0 0 16px', lineHeight: 1.5 }}>{copy.lead}</p>

      <ul style={{ margin: '0 0 20px', paddingLeft: 20, color: D.t1, lineHeight: 1.55 }}>
        {copy.rules.map((r) => (
          <li key={r} style={{ marginBottom: 6 }}>
            {r}
          </li>
        ))}
      </ul>

      {currentVersion === null && (
        <div role="status" style={noticeStyle}>
          Programul se deschide în curând. Contractul nu este încă publicat, deci invitația nu poate
          fi folosită acum. Revino pe același link mai târziu.
        </div>
      )}
      {currentVersion !== null && contractText === null && (
        <div role="status" style={noticeStyle}>
          Textul contractului (versiunea {currentVersion}) nu poate fi afișat în această versiune a
          aplicației, deci nu îl poți accepta încă. Reîncarcă pagina; dacă mesajul rămâne, scrie-ne.
        </div>
      )}

      {contractText !== null && currentVersion !== null && (
        <section style={{ marginBottom: 16 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>
            Contract de colaborare, versiunea {currentVersion}
          </div>
          <div
            tabIndex={0}
            style={{
              maxHeight: 260,
              overflowY: 'auto',
              background: D.s3,
              border: `1px solid ${D.border}`,
              borderRadius: 10,
              padding: 14,
              fontSize: '0.84rem',
              lineHeight: 1.55,
              color: D.t1,
              whiteSpace: 'pre-wrap',
            }}
          >
            {contractText}
          </div>
        </section>
      )}

      <form
        onSubmit={(ev) => {
          ev.preventDefault()
          void submit()
        }}
        noValidate
      >
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="sales-phone" style={labelStyle}>
            Telefon
          </label>
          <input
            id="sales-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={inputStyle}
            aria-invalid={phoneError !== null}
          />
          {phoneError !== null && (
            <div role="alert" style={fieldErrorStyle}>
              {phoneError}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label htmlFor="sales-cui" style={labelStyle}>
            CUI (cu sau fără RO în față)
          </label>
          <input
            id="sales-cui"
            type="text"
            inputMode="text"
            autoComplete="off"
            value={cui}
            onChange={(e) => setCui(e.target.value)}
            style={inputStyle}
            aria-invalid={cuiError !== null}
          />
          {cuiError !== null && (
            <div role="alert" style={fieldErrorStyle}>
              {cuiError}
            </div>
          )}
        </div>

        <label style={{ ...checkRowStyle, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            style={{ width: 20, height: 20, flexShrink: 0, marginTop: 2 }}
          />
          <span>
            Am citit și accept contractul de colaborare
            {currentVersion !== null ? ` (versiunea ${currentVersion})` : ''}.
          </span>
        </label>

        <label style={{ ...checkRowStyle, marginBottom: 18 }}>
          <input
            type="checkbox"
            checked={shareContact}
            onChange={(e) => setShareContact(e.target.checked)}
            style={{ width: 20, height: 20, flexShrink: 0, marginTop: 2 }}
          />
          <span>{copy.shareLabel}</span>
        </label>

        {formError !== null && (
          <div role="alert" style={{ ...fieldErrorStyle, marginBottom: 12, fontSize: '0.88rem' }}>
            {formError}
          </div>
        )}

        <button type="submit" disabled={!canSubmit} style={primaryButton(!canSubmit)}>
          {submitting ? 'Se salvează…' : 'Accept și intru în echipă'}
        </button>
      </form>
    </Shell>
  )
}
