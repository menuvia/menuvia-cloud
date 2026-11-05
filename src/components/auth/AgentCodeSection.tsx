// src/components/auth/AgentCodeSection.tsx
// Bannerul „Ai venit prin agentul tău Menuvia" și câmpul de cod tastat de pe
// formularul de înscriere (mig 301). Stilurile inline folosesc tokenii MKT (lumea
// caldă a funnel-ului, ca AuthPage). Patronii veniți singuri nu văd NICIUN câmp:
// câmpul apare doar după „Am un cod de agent".
import { MKT } from '../../lib/marketing'
import { D } from '../../lib/constants'
import { useT } from '../../i18n/useT'
import { authNs } from '../../i18n/ns/auth'
import type { AgentCodeProblem } from '../../hooks/useSignupAgentCode'

const ERROR = '#B3403F'

// Limba vine din `FunnelLangProvider`-ul paginii (AuthPage).
export function AgentCodeBanner({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useT(authNs)
  return (
    <div
      role="status"
      style={{
        background: MKT.accentSoft,
        border: `1px solid ${MKT.accent}55`,
        borderRadius: 12,
        padding: '12px 16px',
        marginBottom: 20,
      }}
    >
      <div style={{ color: MKT.text, fontSize: '0.9rem', fontWeight: 700 }}>{t('agentBannerTitle')}</div>
      <div style={{ color: MKT.text2, fontSize: '0.78rem', marginTop: 4, lineHeight: 1.5 }}>
        {t('agentBannerBody')}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: MKT.text3,
          cursor: 'pointer',
          fontSize: '0.78rem',
          fontFamily: D.fontBody,
          textDecoration: 'underline',
          // Țintă de atingere ≥44px fără să schimbe ritmul vizual.
          padding: '12px 0 0',
          minHeight: 44,
        }}
      >
        {t('agentNotMine')}
      </button>
    </div>
  )
}

export function AgentCodeField({
  open,
  onOpen,
  value,
  onChange,
  problem,
}: {
  open: boolean
  onOpen: () => void
  value: string
  onChange: (value: string) => void
  problem: AgentCodeProblem
}) {
  const { t } = useT(authNs)
  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        style={{
          background: 'none',
          border: 'none',
          color: MKT.text2, // 8,5:1 pe alb (aurul-cerneală are doar 3,9:1)
          textDecoration: 'underline',
          cursor: 'pointer',
          fontSize: '0.82rem',
          fontWeight: 600,
          fontFamily: D.fontBody,
          textAlign: 'left',
          padding: '12px 0',
          minHeight: 44,
          margin: '-8px 0',
        }}
      >
        {t('agentHaveCode')}
      </button>
    )
  }
  return (
    <div>
      <label
        htmlFor="auth-agent-code"
        style={{
          display: 'block',
          fontSize: '0.78rem',
          color: MKT.text2,
          marginBottom: 6,
          fontWeight: 500,
        }}
      >
        {t('agentCodeLabel')}
      </label>
      <input
        id="auth-agent-code"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('agentCodePlaceholder')}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={60}
        aria-invalid={problem !== null}
        aria-describedby="auth-agent-code-help"
        style={{
          width: '100%',
          background: MKT.surface,
          border: `1px solid ${problem ? ERROR : MKT.border}`,
          borderRadius: 10,
          padding: '12px 14px',
          fontSize: '0.95rem',
          color: MKT.text,
          outline: 'none',
          fontFamily: D.fontBody,
          boxSizing: 'border-box',
        }}
      />
      <div
        id="auth-agent-code-help"
        role={problem ? 'alert' : undefined}
        style={{
          marginTop: 6,
          fontSize: '0.76rem',
          lineHeight: 1.45,
          color: problem ? ERROR : MKT.text3,
        }}
      >
        {problem === 'shape' ? t('agentShape') : problem === 'unknown' ? t('agentUnknown') : t('agentCodeHelp')}
      </div>
    </div>
  )
}
