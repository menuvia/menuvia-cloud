// =============================================================
// Menuvia — src/components/founder/SalesNetworkPanel.tsx
// „Rețea de vânzări” în FounderPage → Afiliați (mig 304, pachetul 8b-1).
//
//   1. Contract: versiunea publicată (sau „Nepublicat — invitațiile sunt blocate”)
//      cu amprenta ei (sha256, scurtată), publică / retrage. Publicarea trimite
//      versiunea ȘI sha256 al textului din aplicație (lib/salesContract.ts);
//      fără text pentru versiunea tastată butonul e DEZACTIVAT (nu există ce
//      hash să trimită, iar cei invitați n-ar avea ce accepta). Retragerea
//      (`null`, `null`) rămâne mereu posibilă.
//   2. Invită șef de vânzări: creează invitația și arată linkul O SINGURĂ DATĂ.
//      Emailul opțional e o RESTRICȚIE (doar un cont cu exact acel email,
//      confirmat, poate accepta), nu o notă — textul de lângă câmp o spune.
//   3. Invitațiile: stare, cine a invitat, data, revocare.
//   4. Rețeaua: Activ / Suspendat / Închis cu motiv obligatoriu. Rolul afișat
//      vine din `sales_role` (coloana din mig 304, proiectată de
//      `admin_list_affiliates` din mig 305), nu din lipsa unui părinte: fără el
//      (proiecție dinainte de 305, program public) nimeni nu apare ca „Șef”.
//
// TRISTATE peste tot: o citire eșuată (RPC lipsă = PGRST202, rețea) NU se
// afișează ca „nepublicat” sau „zero invitații”; arată mesajul de eroare și
// acțiunile de bani / permisiuni rămân dezactivate. Serverul e autoritatea.
//
// Tokenul invitației trăiește DOAR în starea acestei componente: nu intră în
// storage, în console sau în listă (serverul nu-l mai întoarce niciodată).
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { D } from '../../lib/constants'
import { publicBaseUrl } from '../../lib/domain'
import { confirm } from '../ui/confirm'
import OneTimeLinkBox from '../sales/OneTimeLinkBox'
import { useSalesNetwork } from '../../hooks/useSalesNetwork'
import { useContractTextHash } from '../../hooks/useContractTextHash'
import {
  SALES_FAILURE_MESSAGES,
  SalesNetworkError,
  adminCreateHeadInvite,
  adminListInvites,
  adminRevokeInvite,
  adminSetAffiliateStatus,
  adminSetContractVersion,
  describeSalesError,
  sha256Hex,
  type AdminInvite,
  type InviteState,
} from '../../lib/salesNetwork'
import {
  AFFILIATE_STATUS_OPTIONS,
  NETWORK_ROLE_LABELS,
  buildInviteLink,
  checkContractVersionInput,
  contractGate,
  contractVersionLabel,
  networkRows,
  nextStatusesFor,
  shortHash,
} from '../../lib/salesInviteFlow'
import { contractTextFor } from '../../lib/salesContract'
import type { AdminAffiliateRow } from '../../lib/founder'

interface Props {
  /** Rândurile din `admin_list_affiliates` (încărcate de secțiunea părinte); `null` = necunoscut. */
  affiliates: AdminAffiliateRow[] | null
  /** Mesajul de eroare al încărcării listei (când `affiliates` e `null`). */
  affiliatesError: string | null
  /** Cere părintelui să reîncarce lista după o schimbare de stare. */
  onNetworkChanged: () => void
}

type Msg = { kind: 'ok' | 'err'; text: string } | null

// ── Stiluri (aceleași tokenuri ca restul FounderPage) ─────────────────────────
const cardStyle: CSSProperties = {
  background: D.s2,
  border: `1px solid ${D.border}`,
  borderRadius: 14,
  padding: 18,
}
const titleStyle: CSSProperties = { fontWeight: 600, fontSize: '0.9rem', marginBottom: 4 }
const hintStyle: CSSProperties = {
  fontSize: '0.8rem',
  color: D.t2,
  lineHeight: 1.5,
  margin: '0 0 12px',
}
const inputStyle: CSSProperties = {
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '10px 12px',
  minHeight: 44,
  fontSize: '0.85rem',
  color: D.t1,
  fontFamily: D.fontBody,
  boxSizing: 'border-box',
  outline: 'none',
}
const primaryBtn: CSSProperties = {
  padding: '8px 14px',
  minHeight: 44,
  borderRadius: 9,
  border: 'none',
  background: D.gold,
  color: D.onGold,
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontWeight: 600,
  fontFamily: D.fontBody,
}
const ghostBtn: CSSProperties = {
  padding: '8px 14px',
  minHeight: 44,
  borderRadius: 9,
  border: `1px solid ${D.border}`,
  background: 'transparent',
  color: D.t2,
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontFamily: D.fontBody,
}
const dangerBtn: CSSProperties = { ...ghostBtn, color: D.red, borderColor: D.red }
const rowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 0',
  borderTop: `1px solid ${D.border}`,
  fontSize: '0.82rem',
}
const mutedStyle: CSSProperties = { color: D.t3, fontSize: '0.76rem' }

function disabledWhen(base: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...base, opacity: 0.5, cursor: 'not-allowed' } : base
}

function MessageLine({ msg }: { msg: Msg }) {
  if (msg === null) return null
  return (
    <div
      role={msg.kind === 'err' ? 'alert' : 'status'}
      style={{
        marginTop: 10,
        fontSize: '0.82rem',
        color: msg.kind === 'err' ? D.red : D.green,
      }}
    >
      {msg.text}
    </div>
  )
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ro-RO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const INVITE_STATE_LABELS: Record<InviteState, string> = {
  open: 'deschisă',
  used: 'folosită',
  revoked: 'revocată',
  expired: 'expirată',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Activ',
  suspended: 'Suspendat',
  closed: 'Închis',
}

// ── 1. Contract ───────────────────────────────────────────────────────────────
function missingTextMessage(version: string): string {
  return `Textul contractului ${contractVersionLabel(version)} nu există încă în aplicație (src/lib/salesContract.ts), deci versiunea nu poate fi publicată: cei invitați n-ar avea ce accepta.`
}

function ContractCard({
  currentVersion,
  currentTextHash,
  known,
  loadError,
  onRetry,
  onChanged,
}: {
  /** Versiunea publicată, `null` = nepublicat (valid doar când `known`). */
  currentVersion: string | null
  /** Amprenta (sha256) publicată a textului; `null` = nepublicat. */
  currentTextHash: string | null
  /** Starea e cunoscută (citirea a reușit). */
  known: boolean
  loadError: string | null
  onRetry: () => void
  onChanged: () => Promise<void>
}) {
  const [versionInput, setVersionInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  // Versiunea TASTATĂ: forma (oglinda serverului) și textul ei din aplicație.
  // Fără text nu există ce hash să trimitem → publicarea e dezactivată (fail-closed).
  const typedCheck = checkContractVersionInput(versionInput)
  const typedText = typedCheck.ok ? contractTextFor(typedCheck.version) : null
  const typedProblem: string | null =
    versionInput.trim() === ''
      ? null
      : typedCheck.ok === false
        ? typedCheck.message
        : typedText === null
          ? missingTextMessage(typedCheck.version)
          : null
  const canPublish = !busy && typedCheck.ok && typedText !== null

  // Versiunea PUBLICATĂ: textul ei e în aplicație și îi corespunde amprenta?
  // (Altfel cei invitați văd „Contractul s-a actualizat” și nu pot accepta.)
  const publishedText = contractTextFor(currentVersion)
  const publishedLocalHash = useContractTextHash(publishedText)
  const publishedGate = contractGate(
    currentVersion,
    currentTextHash,
    publishedText,
    publishedLocalHash,
  )

  const publish = async (): Promise<void> => {
    const check = checkContractVersionInput(versionInput)
    if (!check.ok) {
      setMsg({ kind: 'err', text: check.message })
      return
    }
    const text = contractTextFor(check.version)
    // Butonul e oricum dezactivat; garda rămâne ca nimic să nu plece fără text.
    if (text === null) {
      setMsg({ kind: 'err', text: missingTextMessage(check.version) })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      // Amprenta textului EXACT din aplicație: serverul o leagă de versiune și
      // respinge la acceptare orice alt text (`contract_hash_mismatch`).
      const hash = await sha256Hex(text)
      const ok = await confirm({
        title: `Publici versiunea ${check.version}?`,
        description: `De acum invitațiile funcționează, iar cei invitați acceptă exact textul acestei versiuni din aplicație (amprenta sha256 ${shortHash(hash)}). Serverul respinge la acceptare orice alt text.`,
        confirmLabel: 'Publică',
      })
      if (!ok) return
      const published = await adminSetContractVersion(check.version, hash)
      setVersionInput('')
      setMsg({
        kind: 'ok',
        text: `Versiunea ${published.version ?? check.version} este publicată.`,
      })
      await onChanged()
    } catch (e) {
      setMsg({ kind: 'err', text: describeSalesError(e) })
    } finally {
      setBusy(false)
    }
  }

  const withdraw = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Retragi versiunea publicată?',
      description:
        'Invitațiile se blochează din nou (cele deja create nu pot fi folosite) până publici o versiune. Conturile deja înscrise rămân.',
      confirmLabel: 'Retrage',
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    setMsg(null)
    try {
      await adminSetContractVersion(null, null)
      setMsg({ kind: 'ok', text: 'Versiunea a fost retrasă. Invitațiile sunt blocate.' })
      await onChanged()
    } catch (e) {
      setMsg({ kind: 'err', text: describeSalesError(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={cardStyle}>
      <div style={titleStyle}>Contract de colaborare</div>
      {!known ? (
        loadError === null ? (
          <p style={hintStyle}>Se încarcă starea contractului…</p>
        ) : (
          <div role="alert" style={{ ...hintStyle, color: D.red }}>
            {loadError}{' '}
            <button type="button" onClick={onRetry} style={ghostBtn}>
              Reîncearcă
            </button>
          </div>
        )
      ) : (
        <>
          <p style={{ ...hintStyle, color: currentVersion === null ? D.amber : D.green }}>
            {currentVersion === null
              ? 'Nepublicat — invitațiile sunt blocate.'
              : `Publicat: versiunea ${currentVersion}.`}
          </p>
          {currentVersion !== null && (
            <div style={{ ...hintStyle, margin: '-6px 0 12px' }}>
              <div>
                Amprenta textului (sha256):{' '}
                {currentTextHash === null ? (
                  'lipsă'
                ) : (
                  <code title={currentTextHash} style={{ fontFamily: D.fontMono, color: D.t1 }}>
                    {shortHash(currentTextHash)}
                  </code>
                )}
              </div>
              {publishedGate.state === 'ready' && (
                <div role="status" style={{ color: D.green }}>
                  Textul din aplicație corespunde amprentei publicate.
                </div>
              )}
              {publishedGate.state === 'checking' && (
                <div role="status">Se verifică textul din aplicație…</div>
              )}
              {publishedGate.state === 'hash_error' && (
                <div role="alert" style={{ color: D.red }}>
                  {publishedGate.message}
                </div>
              )}
              {publishedGate.state === 'missing_text' && (
                <div role="alert" style={{ color: D.amber }}>
                  Textul versiunii {publishedGate.version} nu există în aplicație: cei invitați nu o
                  pot accepta. Retrage-o sau publică o versiune al cărei text e în aplicație.
                </div>
              )}
              {publishedGate.state === 'mismatch' && (
                <div role="alert" style={{ color: D.red }}>
                  Textul din aplicație pentru versiunea {publishedGate.version} NU corespunde
                  amprentei publicate: cei invitați nu pot accepta. Publică o versiune nouă.
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              aria-label="Versiunea de publicat"
              aria-describedby={
                typedProblem !== null ? 'sales-contract-version-problem' : undefined
              }
              placeholder="ex. 1.0"
              value={versionInput}
              onChange={(e) => setVersionInput(e.target.value)}
              style={{ ...inputStyle, width: 160 }}
            />
            <button
              type="button"
              disabled={!canPublish}
              onClick={() => void publish()}
              style={disabledWhen(primaryBtn, !canPublish)}
            >
              Publică versiunea
            </button>
            {currentVersion !== null && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void withdraw()}
                style={disabledWhen(dangerBtn, busy)}
              >
                Retrage versiunea
              </button>
            )}
          </div>
          {typedProblem !== null && (
            <p
              id="sales-contract-version-problem"
              role="status"
              style={{ ...hintStyle, color: D.amber, margin: '10px 0 0' }}
            >
              {typedProblem}
            </p>
          )}
        </>
      )}
      <MessageLine msg={msg} />
    </div>
  )
}

// ── 2. Invită șef de vânzări ──────────────────────────────────────────────────
const EMAIL_HINT_ID = 'sales-head-invite-email-hint'

function HeadInviteCard({
  canInvite,
  onCreated,
}: {
  /** Contractul e publicat (stare cunoscută). Fără el, serverul oricum refuză. */
  canInvite: boolean
  onCreated: () => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  // Linkul cu token: DOAR aici, în memorie, până îl ascunde omul.
  const [link, setLink] = useState<string | null>(null)

  const create = async (): Promise<void> => {
    setBusy(true)
    setMsg(null)
    try {
      const invite = await adminCreateHeadInvite(email, note)
      const base = publicBaseUrl(
        window.location.hostname,
        import.meta.env.VITE_APP_URL,
        window.location.origin,
      )
      setLink(buildInviteLink('head', invite.token, base))
      setEmail('')
      setNote('')
      await onCreated()
    } catch (e) {
      setMsg({ kind: 'err', text: describeSalesError(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={cardStyle}>
      <div style={titleStyle}>Invită șef de vânzări</div>
      <p style={hintStyle}>
        Linkul e personal și de unică folosință; expiră după câteva zile. Nota e doar pentru tine
        (cui i-ai dat linkul).
      </p>
      {!canInvite && (
        <p role="status" style={{ ...hintStyle, color: D.amber }}>
          Publică mai întâi o versiune a contractului: până atunci invitațiile sunt blocate.
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          aria-label="Email (opțional)"
          aria-describedby={EMAIL_HINT_ID}
          placeholder="Email (opțional: restricționează invitația)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ ...inputStyle, flex: '1 1 200px' }}
        />
        <input
          aria-label="Notă (opțional)"
          placeholder="Notă (opțional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ ...inputStyle, flex: '1 1 200px' }}
        />
      </div>
      {/* Regula REALĂ a serverului (mig 304, sales_invite_redeem): emailul nu e o
          notiță, e o restricție — alt cont primește `invite_invalid`, fără cauză. */}
      <p id={EMAIL_HINT_ID} style={hintStyle}>
        Dacă scrii un email, invitația poate fi acceptată NUMAI de un cont cu exact acest email,
        confirmat. Lasă câmpul gol dacă nu știi sigur ce adresă va folosi.
      </p>
      <button
        type="button"
        disabled={busy || !canInvite}
        onClick={() => void create()}
        style={disabledWhen(primaryBtn, busy || !canInvite)}
      >
        {busy ? 'Se creează…' : 'Creează invitație'}
      </button>
      <MessageLine msg={msg} />

      {link !== null && (
        <OneTimeLinkBox key={link} link={link} revokeVerb="revoci" onHide={() => setLink(null)} />
      )}
    </div>
  )
}

// ── 3. Lista invitațiilor ─────────────────────────────────────────────────────
function InvitesList({
  invites,
  error,
  onRetry,
  onRevoked,
}: {
  invites: AdminInvite[] | null
  error: SalesNetworkError | null
  onRetry: () => void
  onRevoked: () => Promise<void>
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg>(null)

  const revoke = async (invite: AdminInvite): Promise<void> => {
    const ok = await confirm({
      title: 'Revoci invitația?',
      description:
        'Linkul nu va mai funcționa. Dacă cineva l-a primit deja, va vedea „invitație invalidă”.',
      confirmLabel: 'Revocă',
      destructive: true,
    })
    if (!ok) return
    setBusyId(invite.id)
    setMsg(null)
    try {
      await adminRevokeInvite(invite.id)
      setMsg({ kind: 'ok', text: 'Invitația a fost revocată.' })
      await onRevoked()
    } catch (e) {
      setMsg({ kind: 'err', text: describeSalesError(e) })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={cardStyle}>
      <div style={titleStyle}>Invitații</div>
      {invites === null ? (
        error === null ? (
          <p style={hintStyle}>Se încarcă invitațiile…</p>
        ) : (
          <div role="alert" style={{ ...hintStyle, color: D.red }}>
            {error.message}{' '}
            <button type="button" onClick={onRetry} style={ghostBtn}>
              Reîncearcă
            </button>
          </div>
        )
      ) : invites.length === 0 ? (
        <p style={hintStyle}>Nicio invitație încă.</p>
      ) : (
        <div>
          {invites.map((inv) => (
            <div key={inv.id} style={rowStyle}>
              <div>
                <div>
                  <strong>{inv.kind === 'head' ? 'Șef' : 'Agent'}</strong>
                  {' · '}
                  {INVITE_STATE_LABELS[inv.state]}
                  {inv.usedByName ? ` · ${inv.usedByName}` : ''}
                </div>
                <div style={mutedStyle}>
                  Invitat de{' '}
                  {inv.kind === 'head' ? 'fondator' : (inv.invitedByName ?? '(cont șters)')}
                  {' · creată '}
                  {formatWhen(inv.createdAt)}
                  {inv.state === 'open' ? ` · expiră ${formatWhen(inv.expiresAt)}` : ''}
                  {inv.email ? ` · doar pentru ${inv.email}` : ''}
                  {inv.note ? ` · ${inv.note}` : ''}
                </div>
              </div>
              {inv.state === 'open' && (
                <button
                  type="button"
                  disabled={busyId === inv.id}
                  onClick={() => void revoke(inv)}
                  style={disabledWhen(dangerBtn, busyId === inv.id)}
                >
                  Revocă
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <MessageLine msg={msg} />
    </div>
  )
}

// ── 4. Rețeaua ────────────────────────────────────────────────────────────────
function NetworkList({
  affiliates,
  affiliatesError,
  onChanged,
}: {
  affiliates: AdminAffiliateRow[] | null
  affiliatesError: string | null
  onChanged: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newStatus, setNewStatus] = useState<string>('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  const startEdit = (id: string, current: string): void => {
    const options = nextStatusesFor(current)
    setEditingId(id)
    setNewStatus(options[0] ?? '')
    setReason('')
    setMsg(null)
  }

  const apply = async (id: string, current: string): Promise<void> => {
    const allowed = nextStatusesFor(current)
    const target = allowed.find((s) => s === newStatus)
    if (target === undefined) {
      setMsg({ kind: 'err', text: SALES_FAILURE_MESSAGES.invalid_status })
      return
    }
    const why = reason.trim()
    if (why.length < 3) {
      setMsg({ kind: 'err', text: SALES_FAILURE_MESSAGES.reason_required })
      return
    }
    const ok = await confirm({
      title:
        target === 'closed'
          ? 'Închizi contul definitiv?'
          : target === 'suspended'
            ? 'Suspenzi contul?'
            : 'Reactivezi contul?',
      description:
        target === 'closed'
          ? 'Închiderea e definitivă: un cont închis nu mai poate fi redeschis.'
          : target === 'suspended'
            ? 'Contul nu mai primește comisioane noi și nu mai poate trimite invitații. Comisioanele deja câștigate rămân în evidență. Poți reactiva contul oricând.'
            : 'Contul redevine activ: primește din nou comisioane și poate trimite invitații.',
      confirmLabel:
        target === 'closed' ? 'Închide' : target === 'suspended' ? 'Suspendă' : 'Reactivează',
      destructive: target !== 'active',
    })
    if (!ok) return
    setBusy(true)
    setMsg(null)
    try {
      await adminSetAffiliateStatus(id, target, why)
      setEditingId(null)
      setReason('')
      setMsg({ kind: 'ok', text: 'Starea contului a fost schimbată.' })
      onChanged()
    } catch (e) {
      setMsg({ kind: 'err', text: describeSalesError(e) })
    } finally {
      setBusy(false)
    }
  }

  const rows = affiliates === null ? null : networkRows(affiliates)

  return (
    <div style={cardStyle}>
      <div style={titleStyle}>Rețeaua</div>
      <p style={hintStyle}>
        Șefii și agenții lor (agenții stau sub șeful lor). Rolul vine din contul de rețea, nu din
        lipsa unui șef: un partener din programul public, sau unul al cărui rol nu e încă știut,
        apare ca „Partener”.
      </p>
      {rows === null ? (
        affiliatesError === null ? (
          <p style={hintStyle}>Se încarcă rețeaua…</p>
        ) : (
          <div role="alert" style={{ ...hintStyle, color: D.red }}>
            {affiliatesError}
          </div>
        )
      ) : rows.length === 0 ? (
        <p style={hintStyle}>Niciun cont în rețea încă.</p>
      ) : (
        rows.map((r) => {
          const options = nextStatusesFor(r.status)
          // Indentarea arată STRUCTURA (legătura cu un părinte); eticheta, rolul.
          const hasParent = r.parentAffiliateId !== null
          return (
            <div key={r.affiliateId} style={{ ...rowStyle, paddingLeft: hasParent ? 18 : 0 }}>
              <div>
                <strong>{r.name}</strong>
                <span style={mutedStyle}>
                  {' · '}
                  {NETWORK_ROLE_LABELS[r.role]}
                  {' · '}
                  {STATUS_LABELS[r.status] ?? r.status}
                </span>
              </div>
              {options.length > 0 && editingId !== r.affiliateId && (
                <button
                  type="button"
                  onClick={() => startEdit(r.affiliateId, r.status)}
                  style={ghostBtn}
                >
                  Schimbă starea
                </button>
              )}
              {editingId === r.affiliateId && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%' }}>
                  <select
                    aria-label="Starea nouă"
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    style={inputStyle}
                  >
                    {AFFILIATE_STATUS_OPTIONS.filter((o) => options.includes(o.value)).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Motiv (obligatoriu)"
                    placeholder="Motiv (obligatoriu)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    style={{ ...inputStyle, flex: '1 1 200px' }}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void apply(r.affiliateId, r.status)}
                    style={disabledWhen(primaryBtn, busy)}
                  >
                    Aplică
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} style={ghostBtn}>
                    Renunță
                  </button>
                </div>
              )}
            </div>
          )
        })
      )}
      <MessageLine msg={msg} />
    </div>
  )
}

// ── Panoul ────────────────────────────────────────────────────────────────────
export default function SalesNetworkPanel({
  affiliates,
  affiliatesError,
  onNetworkChanged,
}: Props) {
  const net = useSalesNetwork(true)
  const [invites, setInvites] = useState<AdminInvite[] | null>(null)
  const [invitesError, setInvitesError] = useState<SalesNetworkError | null>(null)

  const loadInvites = useCallback(async (): Promise<void> => {
    try {
      setInvites(await adminListInvites())
      setInvitesError(null)
    } catch (e) {
      // Păstrăm ultima listă cunoscută; eroarea se arată separat.
      setInvitesError(e instanceof SalesNetworkError ? e : new SalesNetworkError('unknown'))
    }
  }, [])

  useEffect(() => {
    void loadInvites()
  }, [loadInvites])

  const known = net.network !== null
  const currentVersion = net.network?.contract.currentVersion ?? null
  const currentTextHash = net.network?.contract.currentTextHash ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ fontWeight: 700, fontSize: '1rem' }}>Rețea de vânzări</div>
      <ContractCard
        currentVersion={currentVersion}
        currentTextHash={currentTextHash}
        known={known}
        loadError={net.error === null ? null : net.error.message}
        onRetry={() => void net.reload()}
        onChanged={net.reload}
      />
      <HeadInviteCard canInvite={known && currentVersion !== null} onCreated={loadInvites} />
      <InvitesList
        invites={invites}
        error={invitesError}
        onRetry={() => void loadInvites()}
        onRevoked={loadInvites}
      />
      <NetworkList
        affiliates={affiliates}
        affiliatesError={affiliatesError}
        onChanged={onNetworkChanged}
      />
    </div>
  )
}
