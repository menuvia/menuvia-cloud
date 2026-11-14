// HelpButton — butonul „Ajutor" din bara laterală a dashboard-ului (mig 303).
//
// Agentul atribuit (apel / WhatsApp / email) — DOAR dacă a consimțit la afișarea
// contactului (get_my_agent întoarce telefonul/emailul numai atunci); altfel
// adresa de suport din lib/domain.ts. Fără promisiuni de timp de răspuns: textul
// numește un canal, nu un termen (PT1 interzice promisiunile personale).
// Lotul L4c: textele vin din `dashboard` (butonul stă doar în bara laterală a
// panoului). Etichetele acțiunilor se aleg după TIPUL acțiunii și după sursă
// (`helpActionKey`); în română sunt exact cele din `buildHelpOptions`.
import { useState } from 'react'
import { D } from '../lib/constants'
import { CONTACT_EMAIL } from '../lib/domain'
import { useMyAgent } from '../hooks/useMyAgent'
import { buildHelpOptions, type HelpAction, type HelpOptions } from '../lib/agentContact'
import { Icon } from './ui/Icon'
import { useT } from '../i18n/useT'
import { dashboardNs } from '../i18n/ns/dashboard'

type HelpActionKey = 'help_call' | 'help_whatsapp' | 'help_emailAgent' | 'help_emailSupport'

// Nu se exportă: un export ne-componentă dintr-un .tsx pică
// react-refresh/only-export-components (lint-ul e --max-warnings 0).
function helpActionKey(a: HelpAction, source: HelpOptions['source']): HelpActionKey {
  if (a.kind === 'call') return 'help_call'
  if (a.kind === 'whatsapp') return 'help_whatsapp'
  return source === 'agent' ? 'help_emailAgent' : 'help_emailSupport'
}

export function HelpButton({
  restaurantId,
  enabled,
}: {
  restaurantId: string | null
  // true doar pentru owner/manager: staff-ul fără drepturi primește direct suportul.
  enabled: boolean
}) {
  const { t } = useT(dashboardNs)
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
        <Icon name="info" size={16} /> {t('help_button')}
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
              ? help.agentName
                ? t('help_agentNamed', { name: help.agentName })
                : t('help_agent')
              : t('help_support')}
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
              {t(helpActionKey(a, help.source))}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
