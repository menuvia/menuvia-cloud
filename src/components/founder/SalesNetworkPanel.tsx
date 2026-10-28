// =============================================================
// Menuvia — src/components/founder/SalesNetworkPanel.tsx
// „Rețea de vânzări” în FounderPage → Afiliați (mig 302, pachetul 8b-1).
//
//   1. Contract: versiunea publicată (sau „Nepublicat — invitațiile sunt blocate”),
//      publică / retrage.
//   2. Invită șef de vânzări: creează invitația și arată linkul O SINGURĂ DATĂ.
//   3. Invitațiile: stare, cine a invitat, data, revocare.
//   4. Rețeaua: Activ / Suspendat / Închis cu motiv obligatoriu.
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
import { useSalesNetwork } from '../../hooks/useSalesNetwork'
import {
  SALES_FAILURE_MESSAGES,
  SalesNetworkError,
  adminCreateHeadInvite,
  adminListInvites,
  adminRevokeInvite,
  adminSetAffiliateStatus,
  adminSetContractVersion,
  describeSalesError,
  type AdminInvite,
  type InviteState,
} from '../../lib/salesNetwork'
import {
  AFFILIATE_STATUS_OPTIONS,
  buildInviteLink,
  checkContractVersionInput,
  networkRows,
  nextStatusesFor,
} from '../../lib/salesInviteFlow'
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
const hintStyle: CSSProperties = { fontSize: '0.8rem', color: D.t2, lineHeight: 1.5, margin: '0 0 12px' }
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
function ContractCard({
  currentVersion,
  known,
  loadError,
  onRetry,
  onChanged,
}: {
  /** Versiunea publicată, `null` = nepublicat (valid doar când `known`). */
  currentVersion: string | null
  /** Starea e cunoscută (citirea a reușit). */
  known: boolean
  loadError: string | null
  onRetry: () => void
  onChanged: () => Promise<void>
}) {
  const [versionInput, setVersionInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  const publish = async (): Promise<void> => {
    const check = checkContractVersionInput(versionInput)
    if (!check.ok) {
      setMsg({ kind: 'err', text: check.message })
      return
    }
    const ok = await confirm({
      title: `Publici versiunea ${check.version}?`,
      description:
        'De acum invitațiile funcționează, iar cei invitați acceptă exact această versiune. Publică-o doar după ce textul ei este deja în aplicație (src/lib/salesContract.ts); altfel cei invitați vor vedea că nu pot accepta.',
      confirmLabel: 'Publică',
    })
    if (!ok) return
    setBusy(true)
    setMsg(null)
    try {
      await adminSetContractVersion(check.version)
      setVersionInput('')
      setMsg({ kind: 'ok', text: `Versiunea ${check.version} este publicată.` })
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
      await adminSetContractVersion(null)
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              aria-label="Versiunea de publicat"
              placeholder="ex. 1.0"
              value={versionInput}
              onChange={(e) => setVersionInput(e.target.value)}
              style={{ ...inputStyle, width: 160 }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void publish()}
              style={disabledWhen(primaryBtn, busy)}
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
        </>
      )}
      <MessageLine msg={msg} />
    </div>
  )
}

// ── 2. Invită șef de vânzări ──────────────────────────────────────────────────
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
  const [copyMsg, setCopyMsg] = useState<Msg>(null)

  const create = async (): Promise<void> => {
    setBusy(true)
    setMsg(null)
    setCopyMsg(null)
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

  const copy = async (): Promise<void> => {
    if (link === null) return
    try {
      await navigator.clipboard.writeText(link)
      setCopyMsg({ kind: 'ok', text: 'Link copiat.' })
    } catch {
      setCopyMsg({
        kind: 'err',
        text: 'Nu am putut copia automat. Selectează linkul din câmp și copiază-l manual.',
      })
    }
  }

  const share = async (): Promise<void> => {
    if (link === null) return
    try {
      await navigator.share({ title: 'Invitație Menuvia', url: link })
    } catch {
      /* omul a închis fereastra de partajare: nimic de raportat */
    }
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  return (
    <div style={cardStyle}>
      <div style={titleStyle}>Invită șef de vânzări</div>
      <p style={hintStyle}>
        Linkul e personal și de unică folosință; expiră după câteva zile. Emailul și nota sunt doar
        pentru tine (cui i-ai dat linkul).
      </p>
      {!canInvite && (
        <p role="status" style={{ ...hintStyle, color: D.amber }}>
          Publică mai întâi o versiune a contractului: până atunci invitațiile sunt blocate.
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          aria-label="Email (opțional)"
          placeholder="Email (opțional)"
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
        <section
          aria-label="Linkul invitației"
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 10,
            border: `1px solid ${D.amber}`,
            background: D.amberA,
          }}
        >
          <p style={{ margin: '0 0 10px', fontSize: '0.84rem', fontWeight: 600 }}>
            Linkul se vede o singură dată. Copiază-l sau trimite-l acum: după ce închizi caseta nu
            îl mai poți recupera (poți doar să revoci invitația și să creezi alta).
          </p>
          <input
            aria-label="Link invitație"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            style={{ ...inputStyle, width: '100%' }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button type="button" onClick={() => void copy()} style={primaryBtn}>
              Copiază
            </button>
            {canShare && (
              <button type="button" onClick={() => void share()} style={ghostBtn}>
                Trimite
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setLink(null)
                setCopyMsg(null)
              }}
              style={ghostBtn}
            >
              Am salvat linkul, ascunde-l
            </button>
          </div>
          <MessageLine msg={copyMsg} />
        </section>
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
                  {inv.kind === 'head'
                    ? 'fondator'
                    : (inv.invitedByName ?? '(cont șters)')}
                  {' · creată '}
                  {formatWhen(inv.createdAt)}
                  {inv.state === 'open' ? ` · expiră ${formatWhen(inv.expiresAt)}` : ''}
                  {inv.email ? ` · ${inv.email}` : ''}
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
      confirmLabel: target === 'closed' ? 'Închide' : target === 'suspended' ? 'Suspendă' : 'Reactivează',
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
        Șefii și agenții lor. Rolul se vede din legătura cu un șef: cine nu are șef apare ca șef.
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
          const isHead = r.parentAffiliateId === null
          return (
            <div key={r.affiliateId} style={{ ...rowStyle, paddingLeft: isHead ? 0 : 18 }}>
              <div>
                <strong>{r.name}</strong>
                <span style={mutedStyle}>
                  {' · '}
                  {isHead ? 'Șef' : 'Agent'}
                  {' · '}
                  {STATUS_LABELS[r.status] ?? r.status}
                </span>
              </div>
              {options.length > 0 && editingId !== r.affiliateId && (
                <button type="button" onClick={() => startEdit(r.affiliateId, r.status)} style={ghostBtn}>
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
export default function SalesNetworkPanel({ affiliates, affiliatesError, onNetworkChanged }: Props) {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ fontWeight: 700, fontSize: '1rem' }}>Rețea de vânzări</div>
      <ContractCard
        currentVersion={currentVersion}
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
