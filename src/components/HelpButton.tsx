// HelpButton — butonul „Ajutor" din bara laterală a dashboard-ului (mig 303).
//
// Agentul atribuit (apel / WhatsApp / email) — DOAR dacă a consimțit la afișarea
// contactului (get_my_agent întoarce telefonul/emailul numai atunci); altfel
// adresa de suport din lib/domain.ts. Fără promisiuni de timp de răspuns: textul
// numește un canal, nu un termen (PT1 interzice promisiunile personale).
import { useState } from 'react'
import { D } from '../lib/constants'
import { CONTACT_EMAIL } from '../lib/domain'
import { useMyAgent } from '../hooks/useMyAgent'
import { buildHelpOptions } from '../lib/agentContact'
import { Icon } from './ui/Icon'

export function HelpButton({
  restaurantId,
  enabled,
}: {
  restaurantId: string | null
  // true doar pentru owner/manager: staff-ul fără drepturi primește direct suportul.
  enabled: boolean
}) {
  const { agent } = useMyAgent(restaurantId, enabled)
  const [open, setOpen] = useState(false)
  const help = buildHelpOptions(agent, CONTACT_EMAIL)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          minHeight: 44,
          padding: '10px 12px',
          borderRadius: 9,
          border: `1px solid ${D.border}`,
          cursor: 'pointer',
          background: 'transparent',
          color: D.t2,
          fontSize: '0.85rem',
          fontFamily: 'DM Sans,sans-serif',
        }}
      >
        <Icon name="info" size={16} /> Ajutor
      </button>
      {open && (
        <div
          data-testid="help-panel"
          style={{
            background: D.s2,
            border: `1px solid ${D.border}`,
            borderRadius: 9,
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ color: D.t2, fontSize: '0.78rem', lineHeight: 1.5 }}>
            {help.source === 'agent'
              ? `Agentul tău Menuvia${help.agentName ? `, ${help.agentName}` : ''}, te poate ajuta:`
              : 'Ai o întrebare sau o problemă? Scrie-ne pe email.'}
          </div>
          {help.actions.map((a) => (
            <a
              key={a.kind}
              href={a.href}
              target={a.kind === 'whatsapp' ? '_blank' : undefined}
              rel={a.kind === 'whatsapp' ? 'noopener noreferrer' : undefined}
              style={{
                color: D.gold,
                fontSize: '0.85rem',
                textDecoration: 'none',
                minHeight: 36,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {a.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
