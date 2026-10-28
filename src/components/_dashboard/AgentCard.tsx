// ─────────────────────────────────────────────────────────────
// AgentCard — „Agentul tău Menuvia" (mig 303). Pe Acasă și în Setări.
// ─────────────────────────────────────────────────────────────
// Patronul își vede agentul atribuit și îi poate da acces la meniu dintr-un
// singur loc, pe ORICE plan (înainte, aprobarea trăia în fila Echipă, care cere
// planul 2). Accesul e EXPLICIT (un buton, nu o bifă pusă dinainte), revocabil,
// și acoperă doar meniul + mesele/QR — textul de mai jos spune exact asta.
//
// Fără agent atribuit (patronii veniți singuri) cardul NU se randează deloc.
// Gate-ul real e server-side (get_my_agent / owner_grant_partner_access).
import { useState } from 'react'
import { D } from '../../lib/constants'
import { useMyAgent } from '../../hooks/useMyAgent'
import { ownerGrantPartnerAccess, type AgentActionResult } from '../../lib/myAgent'
import { revokePartnerAccess } from '../../lib/founder'
import {
  AGENT_ACCESS_SCOPE_TEXT,
  describeAgentAccess,
  mailtoHref,
  telHref,
} from '../../lib/agentContact'
import { confirm as confirmDialog } from '../ui/confirm'

const btn = (e: React.CSSProperties = {}): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 16px',
  minHeight: 44,
  borderRadius: 9,
  fontSize: '0.85rem',
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
  ...e,
})

const TONE_COLOR = { ok: D.green, wait: D.gold, neutral: D.t2 } as const

export function AgentCard({
  restaurantId,
  enabled = true,
}: {
  restaurantId: string
  // false (staff fără drepturi de admin) → nici măcar apelul RPC.
  enabled?: boolean
}) {
  const { agent, reload } = useMyAgent(restaurantId, enabled)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)

  if (!agent || !agent.has_agent) return null

  const view = describeAgentAccess(agent.access_state)
  const attributionId = agent.attribution_id
  const tel = telHref(agent.phone)
  const mail = mailtoHref(agent.email)

  async function run(
    action: (id: string) => Promise<AgentActionResult>,
    okText: string,
  ): Promise<void> {
    setBusy(true)
    setMsg(null)
    try {
      const res = await action(attributionId)
      if (!res.ok) throw new Error(res.error ?? 'Eroare')
      setMsg({ text: okText, tone: 'ok' })
      reload()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Eroare', tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke(): Promise<void> {
    const ok = await confirmDialog({
      title: 'Retragi accesul agentului?',
      description:
        'Agentul nu va mai putea vedea sau edita meniul și mesele. Poți să-i dai din nou acces oricând.',
      confirmLabel: 'Retrage accesul',
      destructive: true,
    })
    if (!ok) return
    await run(revokePartnerAccess, 'Accesul agentului a fost retras')
  }

  const canGrant = agent.can_manage && agent.access_state !== 'granted'

  return (
    <div
      data-testid="agent-card"
      style={{
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 14,
        padding: '18px 20px',
      }}
    >
      <div
        style={{
          fontSize: '0.72rem',
          color: D.t3,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        Agentul tău Menuvia
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{ color: D.t1, fontWeight: 600, fontSize: '1rem', overflowWrap: 'anywhere' }}
        >
          {agent.agent_name ?? 'Agent de vânzări'}
        </div>
        <span
          data-testid="agent-access-badge"
          style={{ color: TONE_COLOR[view.tone], fontSize: '0.78rem', fontWeight: 600 }}
        >
          {view.label}
        </span>
      </div>

      {/* Contactul apare DOAR dacă agentul a consimțit (serverul întoarce altfel null). */}
      {(tel || mail) && (
        <div
          style={{
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
            marginTop: 6,
            fontSize: '0.82rem',
          }}
        >
          {tel && agent.phone && (
            <a href={tel} style={{ color: D.gold, textDecoration: 'none' }}>
              {agent.phone}
            </a>
          )}
          {mail && agent.email && (
            <a href={mail} style={{ color: D.gold, textDecoration: 'none', overflowWrap: 'anywhere' }}>
              {agent.email}
            </a>
          )}
        </div>
      )}

      <p style={{ color: D.t2, fontSize: '0.78rem', lineHeight: 1.55, margin: '12px 0 0' }}>
        {AGENT_ACCESS_SCOPE_TEXT}
      </p>

      {!agent.can_manage && (
        <p style={{ color: D.t3, fontSize: '0.76rem', margin: '10px 0 0' }}>
          Doar proprietarul restaurantului poate acorda sau retrage accesul agentului.
        </p>
      )}

      {agent.can_manage && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          {canGrant && (
            <button
              onClick={() => void run(ownerGrantPartnerAccess, 'Agentul are acum acces la meniu')}
              disabled={busy}
              style={btn({ background: D.gold, color: D.bg, opacity: busy ? 0.7 : 1 })}
            >
              Permite accesul agentului
            </button>
          )}
          {agent.access_state === 'requested' && (
            <button
              onClick={() => void run(revokePartnerAccess, 'Cererea agentului a fost refuzată')}
              disabled={busy}
              style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
            >
              Refuză cererea
            </button>
          )}
          {agent.access_state === 'granted' && (
            <button
              onClick={() => void handleRevoke()}
              disabled={busy}
              style={btn({
                background: 'transparent',
                color: D.red,
                border: '1px solid rgba(224,85,85,0.3)',
              })}
            >
              Retrage accesul
            </button>
          )}
        </div>
      )}

      {msg && (
        <div
          role="status"
          style={{
            marginTop: 10,
            fontSize: '0.8rem',
            color: msg.tone === 'ok' ? D.green : D.red,
          }}
        >
          {msg.text}
        </div>
      )}
    </div>
  )
}
