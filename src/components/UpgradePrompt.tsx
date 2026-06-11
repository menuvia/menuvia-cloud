// ─────────────────────────────────────────────────────────────
// UpgradePrompt — Card cu mesaj de upgrade pentru features locked
// ─────────────────────────────────────────────────────────────
import { D } from '../lib/constants'
import { PLAN_NAMES, suggestUpgrade } from '../lib/features'

interface Props {
  currentPlan: string
  featureName: string // ex: "Gestiune stocuri"
  description?: string // ex: "Urmărește stocul..."
  emoji?: string
  onUpgrade?: () => void // optional callback (ex: navigate to /pricing)
}

export default function UpgradePrompt({
  currentPlan,
  featureName,
  description,
  emoji = '🔒',
  onUpgrade,
}: Props) {
  const nextPlan = suggestUpgrade(currentPlan)
  const nextPlanName = nextPlan ? PLAN_NAMES[nextPlan] : PLAN_NAMES.pro

  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${D.s2} 0%, ${D.goldA} 100%)`,
        border: `1px solid ${D.gold}33`,
        borderRadius: 14,
        padding: '28px 24px',
        textAlign: 'center',
        maxWidth: 480,
        margin: '20px auto',
      }}
    >
      <div style={{ fontSize: '3rem', marginBottom: 12 }}>{emoji}</div>
      <div
        style={{
          fontFamily: 'Fraunces, serif',
          fontSize: '1.4rem',
          fontWeight: 600,
          color: D.t1,
          marginBottom: 8,
          letterSpacing: '-0.01em',
        }}
      >
        {featureName}
      </div>
      {description && (
        <div style={{ fontSize: '0.88rem', color: D.t2, lineHeight: 1.55, marginBottom: 18 }}>
          {description}
        </div>
      )}
      <div
        style={{
          background: D.s3,
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: 18,
          fontSize: '0.82rem',
          color: D.t2,
          lineHeight: 1.5,
        }}
      >
        Această funcționalitate e disponibilă din planul{' '}
        <strong style={{ color: D.gold }}>{nextPlanName}</strong>.
        <br />
        Planul tău curent: {PLAN_NAMES[currentPlan] ?? currentPlan}
      </div>
      {onUpgrade && (
        <button
          onClick={onUpgrade}
          style={{
            background: D.gold,
            color: '#000',
            border: 'none',
            borderRadius: 10,
            padding: '12px 24px',
            fontSize: '0.92rem',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'DM Sans, sans-serif',
            boxShadow: '0 4px 14px rgba(200,150,60,0.3)',
          }}
        >
          Vezi planurile →
        </button>
      )}
    </div>
  )
}
