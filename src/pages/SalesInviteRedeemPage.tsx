// =============================================================
// Menuvia — src/pages/SalesInviteRedeemPage.tsx
// Răscumpărarea unei invitații în rețeaua de vânzări (mig 304, pachetul 8b-1):
//   /sef-vanzari/:token → șef de vânzări     /echipa/:token → agent
//
// Principii:
//   • Tokenul NU se păstrează nicăieri în afara memoriei paginii: nu în storage,
//     nu în console, nu în istoric. La montare, URL-ul curent este înlocuit
//     (history.replaceState) cu o cale FĂRĂ token. Singura excepție intenționată
//     e calea spre /auth (?next=…), prin care omul fără cont se întoarce aici;
//     telemetria o curăță (lib/telemetryScrub.ts).
//   • Fără sesiune → /auth?mode=signup&next=<calea invitației> (replace, ca
//     intrarea cu token să nu rămână în istoric). După login (sau codul de 6
//     cifre, în același tab) App.tsx onorează `next` și revine pe pagină. Contul
//     NOU confirmat din LINKUL din email se deschide în alt tab: `next` ajunge
//     acolo doar pentru că linkul de confirmare îl poartă (`authRedirectUrl`,
//     lib/planIntent.ts, validat cu `safeNextPath`).
//   • FAIL-CLOSED pe contract: butonul rămâne dezactivat cât contractul nu e
//     publicat, cât textul versiunii publicate nu e în acest bundle
//     (lib/salesContract.ts) și cât sha256(textul afișat) nu e EXACT amprenta
//     publicată de server (`contract.currentTextHash`) — nu se acceptă un
//     document care nu a fost afișat. Hash-ul trimis la răscumpărare e cel
//     verificat; serverul îl compară și el (`contract_hash_mismatch`).
//   • „Reîncarcă pagina” trebuie să păstreze invitația: tokenul a fost scos din
//     URL la montare, deci reîncărcarea merge pe calea CU token (replace, fără
//     intrare nouă în istoric), iar pagina nouă îl curăță din nou. Notificările
//     trimit la ACEST buton, nu la reîncărcarea din browser.
//   • Adresa FĂRĂ token (reîncărcare din browser, „Deschide în browser”, adresă
//     copiată) NU e „invitație invalidă”: invitația n-a ajuns la server, deci
//     pagina spune doar să fie redeschis linkul primit (fără niciun apel).
//   • Un singur mesaj pentru orice problemă a invitației (`invite_invalid`),
//     ca pe server (anti-oracol). Serverul e autoritatea; validarea CUI de aici
//     doar dă un mesaj imediat. O invitație poate fi legată de un email (doar un
//     cont cu exact acel email, confirmat, o poate accepta), iar serverul
//     răspunde tot `invite_invalid`: de aceea refuzul oferă MEREU (pentru orice
//     cauză, deci fără oracol) ieșirea „Deconectează-te și folosește alt cont”.
// =============================================================
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { D } from '../lib/constants'
import { useAuth } from '../contexts/AuthContext'
import { useSalesNetwork } from '../hooks/useSalesNetwork'
import { useContractTextHash } from '../hooks/useContractTextHash'
import { PageSpinner } from '../components/PageLoader'
import {
  INVITE_BASE_PATH,
  checkInviteFields,
  contractGate,
  fieldForSalesReason,
  invitePathWithToken,
  signupPathForInvite,
} from '../lib/salesInviteFlow'
import { contractTextFor } from '../lib/salesContract'
import {
  SALES_FAILURE_MESSAGES,
  SalesNetworkError,
  describeSalesError,
  isInviteTokenShape,
  redeemSalesInvite,
  type SalesRole,
} from '../lib/salesNetwork'

interface Props {
  kind: SalesRole
  /** Tokenul din URL. Se citește O dată (useState); URL-ul e curățat la montare. */
  token: string
  navigate: (path: string) => void
  /** Înlocuiește intrarea curentă din istoric (fără intrare nouă). */
  replace: (path: string) => void
  /**
   * Reîncărcare COMPLETĂ (bundle nou, deci și textul nou al contractului) pe o
   * cale dată. Implicit `window.location.replace`; testele o înlocuiesc.
   */
  reloadAt?: (path: string) => void
}

// Ce NU depinde de bifă (get_my_agent, mig 303): numele agentului e afișat patronilor
// restaurantelor aduse de el (și managerilor lor) oricum. Bifa deschide telefonul și
// emailul către proprietarul contului și contactul complet către rețea (mig 304).
const SHARE_NOTE =
  'Numele tău îl văd oricum patronii restaurantelor aduse de tine, în cardul „Agentul tău Menuvia” din panoul lor. Opțiunea o poți schimba oricând din panoul tău, la „Consimțământ de contact”.'

function reloadWithLocation(path: string): void {
  window.location.replace(path)
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
      'Arată numele, telefonul și emailul meu agenților din echipa mea, iar telefonul și emailul patronilor restaurantelor pe care le aduc (poți retrage oricând din panoul tău)',
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
      'Arată numele, telefonul și emailul meu șefului meu de vânzări, iar telefonul și emailul patronilor restaurantelor pe care le aduc (poți retrage oricând din panoul tău)',
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
  reloadAt = reloadWithLocation,
}: Props) {
  const { user, loading: authLoading, signOut } = useAuth()
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

  // Contractul: versiunea + amprenta publicate și sha256 al textului din bundle.
  // Calculat ÎNAINTEA ramurilor fără formular (hook-urile nu stau după un return).
  const currentVersion = network?.contract.currentVersion ?? null
  const publishedHash = network?.contract.currentTextHash ?? null
  const contractText = contractTextFor(currentVersion)
  const localHash = useContractTextHash(contractText)

  const [phone, setPhone] = useState('')
  const [cui, setCui] = useState('')
  // Bifa „am citit și accept” e legată de AMPRENTA citită: dacă versiunea se
  // schimbă (reload după `contract_*_mismatch`), bifa veche nu mai valorează.
  const [acceptedHash, setAcceptedHash] = useState<string | null>(null)
  const [shareContact, setShareContact] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [cuiError, setCuiError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Invitația a fost respinsă de server: formularul nu mai are rost.
  const [blocked, setBlocked] = useState(false)
  // Ieșirea spre ALT cont, după un refuz al serverului: `email` = contul curent
  // e anonim / fără email (`anonymous_account`); `other` = `invite_invalid`
  // (printre cauze: invitația e legată de emailul altui cont).
  const [switchAccount, setSwitchAccount] = useState<'email' | 'other' | null>(null)

  const replaceRef = useRef(replace)
  // Ref-ul se actualizează DUPĂ commit (nu în randare): o randare aruncată nu are
  // voie să-i dea efectului (2) un callback necomis. Declarat înaintea efectelor
  // care îl citesc, deci rulează primul la fiecare commit.
  useEffect(() => {
    replaceRef.current = replace
  }, [replace])

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
  // Fără token = adresa curățată la montare a fost reîncărcată / copiată /
  // deschisă în alt browser. Invitația NU a ajuns la server, deci pagina nu are
  // voie să spună că e invalidă (omul ar cere alta, iar cea bună ar rămâne
  // deschisă). Nu e oracol: nu pleacă nicio cerere.
  if (token.trim() === '') {
    return (
      <Shell>
        <h1 style={{ fontSize: '1.3rem', margin: '0 0 12px' }}>{copy.title}</h1>
        <p role="status" style={{ color: D.t2, lineHeight: 1.5 }}>
          Din motive de siguranță, linkul invitației nu rămâne în bara de adrese: după o reîncărcare
          a paginii, „Deschide în browser” sau o adresă copiată, ajungi aici fără el. Ca să
          continui, deschide din nou linkul primit (pe WhatsApp sau pe email); invitația ta nu a
          fost folosită.
        </p>
        <button type="button" style={primaryButton(false)} onClick={() => navigate('/')}>
          Înapoi la pagina principală
        </button>
      </Shell>
    )
  }
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
  const gate = contractGate(currentVersion, publishedHash, contractText, localHash)
  const accepted = gate.state === 'ready' && acceptedHash === gate.hash
  const canSubmit = gate.state === 'ready' && accepted && !submitting && !blocked
  const reloadPath = invitePathWithToken(kind, token)

  const submit = async (): Promise<void> => {
    if (gate.state !== 'ready' || !accepted || submitting || blocked) return
    const { version, hash } = gate
    setFormError(null)
    const fields = checkInviteFields(phone, cui)
    setPhoneError(fields.phoneError)
    setCuiError(fields.cuiError)
    if (!fields.ok || fields.cui === null) return

    setSubmitting(true)
    try {
      await redeemSalesInvite(kind, {
        token,
        phone: fields.phone,
        cui: fields.cui,
        contractVersion: version,
        // Amprenta VERIFICATĂ a textului afișat (=== cea publicată).
        contractHash: hash,
        shareContact,
      })
      // replace: intrarea paginii de invitație nu rămâne în istoric.
      replace('/afiliat')
    } catch (e) {
      const message = describeSalesError(e)
      const reason = e instanceof SalesNetworkError ? e.reason : null
      const field = reason === null ? null : fieldForSalesReason(reason)
      // Refuzul legat de un câmp (ex. `cui_conflict`) stă sub câmp, nu jos.
      if (field === 'cui') setCuiError(message)
      else if (field === 'phone') setPhoneError(message)
      else setFormError(message)
      if (reason === 'invite_invalid' || reason === 'already_affiliate') setBlocked(true)
      if (reason === 'invite_invalid') setSwitchAccount('other')
      if (reason === 'anonymous_account') {
        setBlocked(true)
        setSwitchAccount('email')
      }
      // Contractul s-a schimbat între timp: aducem versiunea (și amprenta) nouă.
      if (
        reason === 'contract_version_mismatch' ||
        reason === 'contract_hash_mismatch' ||
        reason === 'contract_not_published'
      ) {
        setAcceptedHash(null)
        void reload()
      }
      setSubmitting(false)
    }
  }

  const reloadButton =
    reloadPath === null ? null : (
      <button
        type="button"
        style={{ ...primaryButton(false), marginTop: 10 }}
        onClick={() => reloadAt(reloadPath)}
      >
        Reîncarcă pagina
      </button>
    )

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

      {gate.state === 'unpublished' && (
        <div role="status" style={noticeStyle}>
          Programul se deschide în curând. Contractul nu este încă publicat, deci invitația nu poate
          fi folosită acum. Revino pe același link mai târziu.
        </div>
      )}
      {/* Spre BUTONUL paginii, nu spre reîncărcarea din browser: tokenul a fost
          scos din URL, deci doar butonul (calea CU token) păstrează invitația. */}
      {gate.state === 'missing_text' && (
        <div role="status" style={noticeStyle}>
          <strong>Contractul s-a actualizat.</strong> Textul versiunii {gate.version} nu poate fi
          afișat în această versiune a aplicației, deci nu îl poți accepta încă. Apasă butonul
          „Reîncarcă pagina” de mai jos (reîncărcarea din browser pierde invitația). Dacă mesajul
          rămâne și după aceea, scrie-ne.
          {reloadButton}
        </div>
      )}
      {gate.state === 'mismatch' && (
        <div role="status" style={noticeStyle}>
          <strong>Contractul s-a actualizat.</strong> Textul afișat de această versiune a aplicației
          nu este cel publicat pentru versiunea {gate.version}, deci nu îl poți accepta. Apasă
          butonul „Reîncarcă pagina” de mai jos (reîncărcarea din browser pierde invitația). Dacă
          mesajul rămâne și după aceea, scrie-ne.
          {reloadButton}
        </div>
      )}
      {gate.state === 'checking' && (
        <div
          role="status"
          style={{ ...noticeStyle, background: D.s3, border: `1px solid ${D.border}` }}
        >
          Se verifică textul contractului…
        </div>
      )}
      {gate.state === 'hash_error' && (
        <div role="alert" style={noticeStyle}>
          {gate.message} În alt browser deschide linkul primit, nu adresa din bară: din motive de
          siguranță, adresa nu mai conține invitația.
        </div>
      )}

      {gate.state === 'ready' && (
        <section style={{ marginBottom: 16 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>
            Contract de colaborare, versiunea {gate.version}
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
            {gate.text}
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
            aria-describedby={phoneError !== null ? 'sales-phone-error' : undefined}
          />
          {phoneError !== null && (
            <div id="sales-phone-error" role="alert" style={fieldErrorStyle}>
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
            aria-describedby={cuiError !== null ? 'sales-cui-error' : undefined}
          />
          {cuiError !== null && (
            <div id="sales-cui-error" role="alert" style={fieldErrorStyle}>
              {cuiError}
            </div>
          )}
        </div>

        <label style={{ ...checkRowStyle, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={accepted}
            // Fără text verificat nu există ce accepta: bifa rămâne goală.
            onChange={(e) =>
              setAcceptedHash(e.target.checked && gate.state === 'ready' ? gate.hash : null)
            }
            style={{ width: 20, height: 20, flexShrink: 0, marginTop: 2 }}
          />
          <span>
            Am citit și accept contractul de colaborare
            {gate.state === 'ready' ? ` (versiunea ${gate.version})` : ''}.
          </span>
        </label>

        <label style={{ ...checkRowStyle, marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={shareContact}
            aria-describedby="share-contact-note"
            onChange={(e) => setShareContact(e.target.checked)}
            style={{ width: 20, height: 20, flexShrink: 0, marginTop: 2 }}
          />
          <span>{copy.shareLabel}</span>
        </label>
        <p
          id="share-contact-note"
          style={{ margin: '0 0 18px 30px', color: D.t2, fontSize: '0.8rem', lineHeight: 1.5 }}
        >
          {SHARE_NOTE}
        </p>

        {formError !== null && (
          <div role="alert" style={{ ...fieldErrorStyle, marginBottom: 12, fontSize: '0.88rem' }}>
            {formError}
          </div>
        )}
        {switchAccount !== null && (
          // După deconectare, efectul (2) duce omul la înscriere cu întoarcere
          // pe această invitație (tokenul e încă în memorie).
          <button
            type="button"
            style={{ ...primaryButton(false), marginBottom: 12 }}
            onClick={() => void signOut()}
          >
            {switchAccount === 'email'
              ? 'Deconectează-te și intră cu emailul tău'
              : 'Deconectează-te și folosește alt cont'}
          </button>
        )}

        <button type="submit" disabled={!canSubmit} style={primaryButton(!canSubmit)}>
          {submitting ? 'Se salvează…' : 'Accept și intru în echipă'}
        </button>
      </form>
    </Shell>
  )
}
