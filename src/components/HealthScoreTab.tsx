// =============================================================
// Menuvia — src/components/HealthScoreTab.tsx
// Customer Health Score dashboard pentru admin.
// Citește scorul cached, breakdown pe componente, sugestii acționabile.
// Buton recalculare manual cu cooldown 5 min.
// Limba personalului (lotul L7): textele din namespace-ul `health` (+
// `common`), cerute SUS; textele calculate (eticheta, tendința, sugestiile,
// vârsta, narațiunea) din lib/healthLang.ts. Erorile se țin ca DATE (cauza) și
// se traduc la randare. Montat LENEȘ din HomeTab, sub un `<Suspense>` propriu.
// =============================================================
import { useEffect, useState, useCallback } from 'react'
import { D, D_RAW } from '../lib/constants'
import { useRestaurantCtx } from '../contexts/RestaurantContext'
import { Skeleton } from './ui/Skeleton'
import {
  fetchHealthScore,
  recomputeHealthScore,
  type HealthScore,
  SCORE_MAX,
  trendColor,
  scoreColor,
  planHealthScore,
  planHealthTrend,
} from '../lib/health'
import {
  formatTimeAgoT,
  getActionableSuggestionsT,
  scoreLabelT,
  scoreNarrativeT,
  trendLabelT,
} from '../lib/healthLang'
import { useT } from '../i18n/useT'
import { describeStaffError } from '../i18n/staffErrors'
import { healthNs } from '../i18n/ns/health'
import { commonNs } from '../i18n/ns/common'

// Colors palette pentru lib helpers.
// D_RAW (hex brut), nu D: aceste valori alimentează `stroke` pe inelul SVG
// din CircularScore, unde var() nu se rezolvă.
const PALETTE = {
  green: D_RAW.green,
  gold: D_RAW.gold,
  orange: D_RAW.amber,
  red: D_RAW.red,
}

// Eroarea afișată, ca DATĂ: cauza + rezerva contextului (cheia din `health`).
type HealthErr = { cause: unknown; fallback: 'err_load' | 'err_recompute' }

// `fiscal` = planul are bon fiscal (planSurface.fiscal). Fără el componenta
// „Stabilitate" (bonurile în eroare ale Bridge-ului fiscal) iese din scor, din
// compoziție și din sugestii — lotul P: fiecare plan vede doar ce are.
export default function HealthScoreTab({ fiscal }: { fiscal: boolean }) {
  // `tc` e deja culoarea tendinței (mai jos), deci traducătorul comun e `tcm`.
  const th = useT(healthNs)
  const tcm = useT(commonNs)
  const { activeId } = useRestaurantCtx()
  const [score, setScore] = useState<HealthScore | null>(null)
  const [loading, setLoading] = useState(true)
  const [recomputing, setRecomputing] = useState(false)
  const [errState, setErr] = useState<HealthErr | null>(null)
  // Hint-urile refuzurilor, DOAR în afara românei: în română rămâne textul
  // serverului (regula 1 a lui `describeStaffError` ar schimba-o).
  const hints = tcm.lang === 'ro' ? undefined : { cooldown: th.t('err_cooldown') }
  const err = errState
    ? describeStaffError(errState.cause, tcm, { fallback: th.t(errState.fallback), hints })
    : null
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    if (!activeId) return
    setLoading(true)
    setErr(null)
    setLoadError(false)
    try {
      const s = await fetchHealthScore(activeId)
      setScore(s)
    } catch (e) {
      // Eroare reală de fetch (rețea/permisiuni) — distinctă de „scor inexistent",
      // care e reprezentat de `score === null` fără excepție.
      setLoadError(true)
      setErr({ cause: e, fallback: 'err_load' })
    } finally {
      setLoading(false)
    }
  }, [activeId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleRecompute() {
    if (!activeId) return
    setRecomputing(true)
    setErr(null)
    try {
      const fresh = await recomputeHealthScore(activeId)
      setScore(fresh)
    } catch (e) {
      setErr({ cause: e, fallback: 'err_recompute' })
    } finally {
      setRecomputing(false)
    }
  }

  if (loading)
    return (
      <div style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Skeleton variant="title" />
        <Skeleton variant="card" />
        <Skeleton variant="text" count={3} />
      </div>
    )

  // Eroare reală la încărcare (rețea/permisiuni/DB) — distinctă de „fără scor
  // calculat încă", ca să nu inducem în eroare adminul cu un ecran gol.
  if (loadError) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: D.t2 }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
        <div style={{ fontFamily: 'Fraunces,serif', fontSize: 20, color: D.t1, marginBottom: 8 }}>
          {th.t('loadFail_title')}
        </div>
        <p style={{ maxWidth: 480, margin: '0 auto 16px' }}>
          {th.t('loadFail_desc')}
        </p>
        {err && <div style={{ color: D.red, fontSize: 13, marginBottom: 16 }}>{err}</div>}
        <button
          onClick={() => void load()}
          style={{
            background: 'transparent',
            color: D.t1,
            border: `1px solid ${D.border}`,
            borderRadius: 8,
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {tcm.t('retry')}
        </button>
      </div>
    )
  }

  if (!score) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: D.t2 }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
        <div style={{ fontFamily: 'Fraunces,serif', fontSize: 20, color: D.t1, marginBottom: 8 }}>
          {th.t('none_title')}
        </div>
        <p style={{ maxWidth: 480, margin: '0 auto 16px' }}>
          {th.t('none_desc')}
        </p>
        <button
          onClick={handleRecompute}
          disabled={recomputing}
          style={{
            background: D.gold,
            color: '#000',
            border: 'none',
            borderRadius: 8,
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 600,
            cursor: recomputing ? 'wait' : 'pointer',
            opacity: recomputing ? 0.6 : 1,
          }}
        >
          {recomputing ? th.t('computing') : th.t('compute_now')}
        </button>
        {err && <div style={{ color: D.red, fontSize: 13, marginTop: 12 }}>{err}</div>}
      </div>
    )
  }

  const scope = { fiscal }
  const suggestions = getActionableSuggestionsT(score, scope, th)
  const shown = planHealthScore(score, scope)
  // Fără bon: `stable` (neutru) — narațiunea se decide doar pe scorul afișat.
  const trend = planHealthTrend(score, scope)
  const sc = scoreColor(shown, PALETTE)
  const tc = trendColor(trend, PALETTE)
  // Delta doar pe scorul brut al serverului (Planul 3): `previous_score` nu are
  // componentele lui, deci nu se poate normaliza la fel pe celelalte planuri.
  const delta = fiscal && score.previous_score != null ? score.score - score.previous_score : null

  return (
    <div
      style={{ maxWidth: 980, margin: '0 auto', padding: 24, fontFamily: 'DM Sans, sans-serif' }}
    >
      {/* Header */}
      <div
        style={{
          marginBottom: 24,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              color: D.t3,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            {th.t('eyebrow')}
          </div>
          <h1
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 32,
              fontWeight: 600,
              color: D.t1,
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            {th.t('title')}
          </h1>
          <div style={{ fontSize: 13, color: D.t3, marginTop: 6 }}>
            {th.t('last_recompute', { ago: formatTimeAgoT(score.computed_at, th) })}
          </div>
        </div>
        <button
          onClick={handleRecompute}
          disabled={recomputing}
          style={{
            background: 'transparent',
            color: D.t1,
            border: `1px solid ${D.border}`,
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 500,
            cursor: recomputing ? 'wait' : 'pointer',
            opacity: recomputing ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {recomputing ? th.t('recomputing') : th.t('recompute')}
        </button>
      </div>

      {err && (
        <div
          style={{
            background: 'rgba(224,85,85,0.1)',
            color: D.red,
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          {err}
        </div>
      )}

      {/* Hero Score Card */}
      <div
        style={{
          background: D.s2,
          border: `1px solid ${D.border}`,
          borderRadius: 16,
          padding: 32,
          marginBottom: 24,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: 32,
          alignItems: 'center',
        }}
      >
        <CircularScore score={shown} color={sc} />
        <div>
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 28,
              fontWeight: 600,
              color: D.t1,
              letterSpacing: '-0.01em',
              marginBottom: 4,
            }}
          >
            {scoreLabelT(shown, th)}
          </div>
          {/* Tendința și delta vin din scorul BRUT al serverului (cu Bridge
              fiscal) — doar pe planul cu bon; altfel ar contrazice scorul
              normalizat de alături (recenzia #334 / CodeRabbit). */}
          {fiscal && (
            <div style={{ color: tc, fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              {trendIcon(trend)} {trendLabelT(trend, th)}
              {delta !== null && delta !== 0 && (
                <span style={{ color: D.t3, fontWeight: 400, marginLeft: 8 }}>
                  {th.t('delta_vs_prev', { delta: `${delta > 0 ? '+' : ''}${delta}` })}
                </span>
              )}
            </div>
          )}
          <p style={{ color: D.t2, fontSize: 14, lineHeight: 1.55, margin: 0 }}>
            {scoreNarrativeT(shown, trend, th)}
          </p>
        </div>
      </div>

      {/* Component Breakdown */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 12,
            color: D.t3,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            marginBottom: 12,
            fontWeight: 600,
          }}
        >
          {th.t('comp_title')}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          <ScoreBar
            label={th.t('bar_login')}
            current={score.score_login}
            max={SCORE_MAX.login}
            icon="🔐"
          />
          <ScoreBar
            label={th.t('bar_orders')}
            current={score.score_orders}
            max={SCORE_MAX.orders}
            icon="📈"
          />
          <ScoreBar label={th.t('bar_team')} current={score.score_team} max={SCORE_MAX.team} icon="👥" />
          {fiscal && (
            <ScoreBar
              label={th.t('bar_tickets')}
              current={score.score_tickets}
              max={SCORE_MAX.tickets}
              icon="✓"
            />
          )}
          <ScoreBar
            label={th.t('bar_engagement')}
            current={score.score_engagement}
            max={SCORE_MAX.engagement}
            icon="⚙"
          />
        </div>
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 12,
              color: D.t3,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: 12,
              fontWeight: 600,
            }}
          >
            {th.t('sugg_title')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {suggestions.map((s, i) => (
              <div
                key={i}
                style={{
                  background: D.s2,
                  border: `1px solid ${D.border}`,
                  borderLeft: `3px solid ${scoreColor(s.current * (100 / s.max), PALETTE)}`,
                  borderRadius: 8,
                  padding: '14px 16px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'Fraunces,serif',
                      fontSize: 15,
                      fontWeight: 600,
                      color: D.t1,
                    }}
                  >
                    {s.component}
                  </div>
                  <div style={{ fontSize: 12, color: D.t3, fontFamily: 'Fraunces,serif' }}>
                    {s.current}
                    <span style={{ color: D.t3 }}>/{s.max}</span>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: D.t2, lineHeight: 1.5 }}>{s.suggestion}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer info */}
      <div
        style={{
          marginTop: 32,
          padding: 16,
          background: 'rgba(200,150,60,0.04)',
          border: `1px solid rgba(200,150,60,0.15)`,
          borderRadius: 10,
          fontSize: 12,
          color: D.t2,
          lineHeight: 1.55,
        }}
      >
        <div style={{ fontWeight: 600, color: D.gold, marginBottom: 6 }}>
          {th.t('how_title')}
        </div>
        {fiscal ? th.t('how_fiscal') : th.t('how_nonFiscal')}
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────

function CircularScore({ score, color }: { score: number; color: string }) {
  const size = 160
  const stroke = 12
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={D_RAW.s3}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: 48,
            fontWeight: 600,
            color,
            letterSpacing: '-0.04em',
            lineHeight: 1,
          }}
        >
          {score}
        </div>
        <div
          style={{
            fontSize: 11,
            color: D.t3,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginTop: 2,
          }}
        >
          /100
        </div>
      </div>
    </div>
  )
}

function ScoreBar({
  label,
  current,
  max,
  icon,
}: {
  label: string
  current: number
  max: number
  icon: string
}) {
  const pct = (current / max) * 100
  const color = scoreColor(pct, PALETTE)
  return (
    <div
      style={{ background: D.s2, border: `1px solid ${D.border}`, borderRadius: 10, padding: 14 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 12, color: D.t2, fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
        <span style={{ fontFamily: 'Fraunces,serif', fontSize: 22, fontWeight: 600, color }}>
          {current}
        </span>
        <span style={{ fontSize: 12, color: D.t3 }}>/{max}</span>
      </div>
      <div style={{ height: 4, background: D.s3, borderRadius: 2, overflow: 'hidden' }}>
        <div
          style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.5s' }}
        />
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────

function trendIcon(trend: HealthScore['trend']): string {
  switch (trend) {
    case 'rising':
      return '↗'
    case 'stable':
      return '→'
    case 'declining':
      return '↘'
    case 'critical':
      return '⚠'
  }
}
