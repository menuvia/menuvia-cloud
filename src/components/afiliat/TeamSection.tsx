// src/components/afiliat/TeamSection.tsx
// „Echipa ta” — DOAR pentru șeful de vânzări (`role === 'head'` din
// get_sales_network, mig 304): recruții DIRECȚI (nume/telefon/email doar cu
// consimțământul lor, exact cum îi întoarce serverul), invitațiile deschise cu
// „Retrage” și „Invită agent”.
//
// Linkul invitației se vede O SINGURĂ DATĂ (caseta comună
// components/sales/OneTimeLinkBox.tsx, aceeași ca în panoul fondatorului):
// tokenul se întoarce o dată de server, trăiește doar în starea acestei
// componente (nu în storage, nu în console) și dispare la „Am salvat linkul,
// ascunde-l”.
//
// `HeadCard` e perechea pentru agent: cardul șefului lui (contact doar cu
// consimțământul ȘEFULUI).
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { D } from '../../lib/constants'
import { publicBaseUrl } from '../../lib/domain'
import { formatRON } from '../../lib/affiliate'
import { buildInviteLink } from '../../lib/salesInviteFlow'
import { inviteSlots } from '../../lib/salesPanel'
import { mailtoHref, telHref } from '../../lib/agentContact'
import {
  createAgentInvite,
  describeSalesError,
  revokeAgentInvite,
  type SalesHeadCard,
  type SalesNetwork,
  type SalesTeamMember,
} from '../../lib/salesNetwork'
import { confirm } from '../ui/confirm'
import OneTimeLinkBox from '../sales/OneTimeLinkBox'

const sectionStyle: CSSProperties = {
  background: D.s2,
  border: `1px solid ${D.border}`,
  borderRadius: 14,
  padding: '18px 20px',
}
const h2Style: CSSProperties = { margin: '0 0 4px', fontSize: '1.05rem', color: D.t1 }
const hintStyle: CSSProperties = {
  margin: '0 0 12px',
  color: D.t2,
  fontSize: '0.8rem',
  lineHeight: 1.5,
}
const subTitle: CSSProperties = {
  fontSize: '0.7rem',
  color: D.t2,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  margin: '16px 0 8px',
}
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
  padding: '10px 12px',
  background: D.s3,
  borderRadius: 10,
}
const primaryBtn: CSSProperties = {
  background: D.gold,
  color: D.onGold,
  border: 'none',
  borderRadius: 9,
  padding: '10px 16px',
  minHeight: 44,
  fontSize: '0.85rem',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: D.fontBody,
}
const ghostBtn: CSSProperties = {
  ...primaryBtn,
  background: 'transparent',
  color: D.t1,
  border: `1px solid ${D.border}`,
  fontWeight: 500,
}
const inputStyle: CSSProperties = {
  background: D.s1,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '10px 12px',
  minHeight: 44,
  fontSize: '0.85rem',
  color: D.t1,
  fontFamily: D.fontBody,
  boxSizing: 'border-box',
}

function disabledWhen(base: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...base, opacity: 0.55, cursor: 'not-allowed' } : base
}

function formatDay(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS_LABELS: Record<string, string> = {
  active: 'activ',
  suspended: 'suspendat',
  closed: 'închis',
}

/**
 * Telefonul / emailul, doar când serverul le-a întors (consimțământ). Linkurile
 * se reconstruiesc din cifre / un email validat (lib/agentContact.ts), niciodată
 * din textul brut; fără link valid rămâne doar textul.
 */
function ContactLines({ phone, email }: { phone: string | null; email: string | null }) {
  const tel = telHref(phone)
  const mail = mailtoHref(email)
  const linkStyle: CSSProperties = {
    color: D.gold,
    textDecoration: 'none',
    overflowWrap: 'anywhere',
  }
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.78rem', marginTop: 2 }}>
      {phone ? (
        tel ? (
          <a href={tel} style={linkStyle}>
            {phone}
          </a>
        ) : (
          <span style={{ color: D.t1 }}>{phone}</span>
        )
      ) : null}
      {email ? (
        mail ? (
          <a href={mail} style={linkStyle}>
            {email}
          </a>
        ) : (
          <span style={{ color: D.t1, overflowWrap: 'anywhere' }}>{email}</span>
        )
      ) : null}
    </div>
  )
}

function MemberRow({ m }: { m: SalesTeamMember }) {
  const label = m.contactShared && m.name ? m.name : `Agentul ${m.ordinal}`
  return (
    <div style={rowStyle}>
      <div style={{ minWidth: 0, flex: '1 1 200px' }}>
        <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.88rem' }}>{label}</div>
        {m.contactShared ? (
          <ContactLines phone={m.phone} email={m.email} />
        ) : (
          <div style={{ color: D.t3, fontSize: '0.74rem', marginTop: 2 }}>
            Datele de contact sunt ascunse: agentul nu a ales să le arate.
          </div>
        )}
        <div style={{ color: D.t2, fontSize: '0.74rem', marginTop: 4 }}>
          {(STATUS_LABELS[m.status] ?? m.status) +
            ` · în echipă din ${formatDay(m.joinedAt)}` +
            ` · ${m.clientsActive} clienți activi din ${m.clientsTotal}` +
            (m.lastSaleAt ? ` · ultima vânzare ${formatDay(m.lastSaleAt)}` : '')}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ color: D.gold, fontWeight: 700, fontSize: '0.95rem' }}>
          {formatRON(m.headBonusRonCents, 'RON')}
        </div>
        <div style={{ color: D.t3, fontSize: '0.7rem' }}>bonusul tău</div>
      </div>
    </div>
  )
}

export function HeadCard({ head }: { head: SalesHeadCard }) {
  return (
    <section aria-labelledby="head-title" style={sectionStyle}>
      <h2 id="head-title" style={h2Style}>
        Șeful tău de vânzări
      </h2>
      {head.contactShared ? (
        <>
          <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.9rem' }}>
            {head.name ?? 'Șeful tău'}
          </div>
          <ContactLines phone={head.phone} email={head.email} />
        </>
      ) : (
        <p style={{ ...hintStyle, margin: 0 }}>
          Șeful tău nu a ales să-și arate datele de contact. Pentru întrebări, folosește canalul pe
          care ți-a trimis invitația.
        </p>
      )}
    </section>
  )
}

export default function TeamSection({
  network,
  onChanged,
}: {
  network: SalesNetwork
  /** Reîncarcă get_sales_network după o invitație creată / retrasă. */
  onChanged: () => Promise<void>
}) {
  const [note, setNote] = useState<string>('')
  const [busy, setBusy] = useState<boolean>(false)
  const [message, setMessage] = useState<string | null>(null)
  // Linkul cu token: DOAR aici, în memorie, până îl ascunde omul.
  const [link, setLink] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const slots = inviteSlots(network)
  const published = network.contract.currentVersion !== null
  const canInvite = published && slots.canCreate && !busy

  const create = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const invite = await createAgentInvite(note)
      const base = publicBaseUrl(
        window.location.hostname,
        import.meta.env.VITE_APP_URL,
        window.location.origin,
      )
      setLink(buildInviteLink('agent', invite.token, base))
      setNote('')
      await onChanged()
    } catch (e) {
      setMessage(describeSalesError(e))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (inviteId: string): Promise<void> => {
    const ok = await confirm({
      title: 'Retragi invitația?',
      description: 'Linkul nu va mai funcționa. Poți crea oricând o invitație nouă.',
      confirmLabel: 'Retrage',
      destructive: true,
    })
    if (!ok) return
    setRevokingId(inviteId)
    setMessage(null)
    try {
      await revokeAgentInvite(inviteId)
      await onChanged()
    } catch (e) {
      setMessage(describeSalesError(e))
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <section aria-labelledby="team-title" style={sectionStyle}>
      <h2 id="team-title" style={h2Style}>
        Echipa ta
      </h2>
      <p style={hintStyle}>
        Agenții pe care i-ai invitat direct. Primești un bonus din vânzările lor reale, nu din
        simpla recrutare.
      </p>

      {network.team.length === 0 ? (
        <div style={{ color: D.t2, fontSize: '0.82rem' }}>Încă nu ai niciun agent în echipă.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {network.team.map((m) => (
            <MemberRow key={m.affiliateId} m={m} />
          ))}
        </div>
      )}

      <div style={subTitle}>
        {slots.max > 0
          ? `Invitații deschise (${slots.open} din ${slots.max})`
          : `Invitații deschise (${slots.open})`}
      </div>
      {network.openInvites.length === 0 ? (
        <div style={{ color: D.t2, fontSize: '0.82rem' }}>Nicio invitație deschisă.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {network.openInvites.map((inv) => {
            const revoking = revokingId === inv.id
            return (
              <div key={inv.id} style={rowStyle}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: D.t1, fontSize: '0.85rem', overflowWrap: 'anywhere' }}>
                    {inv.note ?? 'Invitație fără notă'}
                  </div>
                  <div style={{ color: D.t2, fontSize: '0.74rem' }}>
                    {`creată ${formatDay(inv.createdAt)} · expiră ${formatDay(inv.expiresAt)}`}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={revoking}
                  onClick={() => void revoke(inv.id)}
                  style={disabledWhen({ ...ghostBtn, color: D.red, borderColor: D.red }, revoking)}
                >
                  {revoking ? 'Se retrage…' : 'Retrage'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div style={subTitle}>Invită agent</div>
      {!published ? (
        <p role="status" style={{ ...hintStyle, color: D.amber }}>
          Contractul de colaborare nu e publicat încă, deci invitațiile sunt blocate.
        </p>
      ) : !slots.canCreate ? (
        <p role="status" style={{ ...hintStyle, color: D.amber }}>
          Ai atins numărul maxim de invitații deschise. Retrage una neutilizată sau așteaptă să
          expire.
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          aria-label="Notă (opțional)"
          aria-describedby="agent-invite-note-hint"
          placeholder="Notă (opțional): cui îi dai linkul"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          style={{ ...inputStyle, flex: '1 1 220px' }}
        />
        <button
          type="button"
          disabled={!canInvite}
          onClick={() => void create()}
          style={disabledWhen(primaryBtn, !canInvite)}
        >
          {busy ? 'Se creează…' : 'Invită agent'}
        </button>
      </div>
      <p id="agent-invite-note-hint" style={{ ...hintStyle, margin: '6px 0 0' }}>
        Nota o vezi tu și administratorii Menuvia, ca să știi cui ai dat linkul. Linkul e personal,
        de unică folosință și expiră
        {network.limits.inviteTtlDays > 0
          ? ` după ${network.limits.inviteTtlDays} zile`
          : ' în câteva zile'}
        .
      </p>
      {message !== null ? (
        <div role="alert" style={{ color: D.red, fontSize: '0.82rem', marginTop: 10 }}>
          {message}
        </div>
      ) : null}

      {link !== null ? (
        <OneTimeLinkBox key={link} link={link} revokeVerb="retragi" onHide={() => setLink(null)} />
      ) : null}
    </section>
  )
}
