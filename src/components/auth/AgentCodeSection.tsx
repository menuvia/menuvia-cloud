// src/components/auth/AgentCodeSection.tsx
// Bannerul „Ai venit prin agentul tău Menuvia" și câmpul de cod tastat de pe
// formularul de înscriere (mig 301). Stilurile inline folosesc tokenii MKT (lumea
// caldă a funnel-ului, ca AuthPage). Patronii veniți singuri nu văd NICIUN câmp:
// câmpul apare doar după „Am un cod de agent".
import { MKT } from '../../lib/marketing'
import type { OtpLang } from '../../lib/otp'
import type { AgentCodeProblem } from '../../hooks/useSignupAgentCode'

const ERROR = '#B3403F'

const TEXT = {
  ro: {
    bannerTitle: 'Ai venit prin agentul tău Menuvia',
    bannerBody:
      'Îl legăm de contul tău, ca să te poată ajuta la configurare. Nu are acces la datele restaurantului decât dacă îi dai tu acordul.',
    notMine: 'Nu e agentul meu',
    haveCode: 'Am un cod de agent',
    codeLabel: 'Codul agentului',
    codePlaceholder: 'ex. k7m2xq9',
    codeHelp: 'Îl primești de la agentul tău. Poți lăsa câmpul gol.',
    shape:
      'Codul poate avea doar litere, cifre și cratimă (2–40 de caractere). Verifică-l sau lasă câmpul gol.',
    unknown: 'Nu găsim acest cod de agent. Verifică-l sau lasă câmpul gol.',
  },
  en: {
    bannerTitle: 'You came through your Menuvia agent',
    bannerBody:
      'We’ll link them to your account so they can help you set up. They get no access to your restaurant’s data unless you allow it.',
    notMine: 'Not my agent',
    haveCode: 'I have an agent code',
    codeLabel: 'Agent code',
    codePlaceholder: 'e.g. k7m2xq9',
    codeHelp: 'You get it from your agent. You can leave this empty.',
    shape:
      'The code can only contain letters, digits and hyphens (2–40 characters). Check it or leave the field empty.',
    unknown: 'We can’t find this agent code. Check it or leave the field empty.',
  },
} as const

export function AgentCodeBanner({ lang, onDismiss }: { lang: OtpLang; onDismiss: () => void }) {
  const t = TEXT[lang]
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
      <div style={{ color: MKT.text, fontSize: '0.9rem', fontWeight: 700 }}>{t.bannerTitle}</div>
      <div style={{ color: MKT.text2, fontSize: '0.78rem', marginTop: 4, lineHeight: 1.5 }}>
        {t.bannerBody}
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
          fontFamily: 'DM Sans,sans-serif',
          textDecoration: 'underline',
          // Țintă de atingere ≥44px fără să schimbe ritmul vizual.
          padding: '12px 0 0',
          minHeight: 44,
        }}
      >
        {t.notMine}
      </button>
    </div>
  )
}

export function AgentCodeField({
  lang,
  open,
  onOpen,
  value,
  onChange,
  problem,
}: {
  lang: OtpLang
  open: boolean
  onOpen: () => void
  value: string
  onChange: (value: string) => void
  problem: AgentCodeProblem
}) {
  const t = TEXT[lang]
  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        style={{
          background: 'none',
          border: 'none',
          color: MKT.accentInk,
          cursor: 'pointer',
          fontSize: '0.82rem',
          fontWeight: 600,
          fontFamily: 'DM Sans,sans-serif',
          textAlign: 'left',
          padding: '12px 0',
          minHeight: 44,
          margin: '-8px 0',
        }}
      >
        {t.haveCode}
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
        {t.codeLabel}
      </label>
      <input
        id="auth-agent-code"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.codePlaceholder}
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
          fontFamily: 'DM Sans,sans-serif',
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
        {problem === 'shape' ? t.shape : problem === 'unknown' ? t.unknown : t.codeHelp}
      </div>
    </div>
  )
}
