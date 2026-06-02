// =============================================================
// Menuvia — src/components/HealthScoreTab.tsx
// Customer Health Score dashboard pentru admin.
// Citește scorul cached, breakdown pe componente, sugestii acționabile.
// Buton recalculare manual cu cooldown 5 min.
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
  trendLabel,
  trendColor,
  scoreColor,
  scoreLabel,
  getActionableSuggestions,
} from '../lib/health'

// Colors palette pentru lib helpers.
// D_RAW (hex brut), nu D: aceste valori alimentează `stroke` pe inelul SVG
// din CircularScore, unde var() nu se rezolvă.
const PALETTE = {
  green: D_RAW.green,
  gold: D_RAW.gold,
  orange: D_RAW.amber,
  red: D_RAW.red,
}

export default function HealthScoreTab() {
  const { activeId } = useRestaurantCtx()
  const [score, setScore] = useState<HealthScore | null>(null)
  const [loading, setLoading] = useState(true)
  const [recomputing, setRecomputing] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!activeId) return
    setLoading(true)
    setErr(null)
    try {
      const s = await fetchHealthScore(activeId)
      setScore(s)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare la încărcare')
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
      setErr(e instanceof Error ? e.message : 'Eroare recalculare')
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

  if (!score) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: D.t2 }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
        <div style={{ fontFamily: 'Fraunces,serif', fontSize: 20, color: D.t1, marginBottom: 8 }}>
          Scorul nu a fost încă calculat
        </div>
        <p style={{ maxWidth: 480, margin: '0 auto 16px' }}>
          Scorul se calculează automat la 30 minute. Poți declanșa o recalculare manuală acum.
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
          {recomputing ? 'Se calculează…' : 'Calculează acum'}
        </button>
        {err && <div style={{ color: D.red, fontSize: 13, marginTop: 12 }}>{err}</div>}
      </div>
    )
  }

  const suggestions = getActionableSuggestions(score)
  const sc = scoreColor(score.score, PALETTE)
  const tc = trendColor(score.trend, PALETTE)
  const delta = score.previous_score != null ? score.score - score.previous_score : null

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
            Customer Health Score
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
            Cum stă cafeneaua ta
          </h1>
          <div style={{ fontSize: 13, color: D.t3, marginTop: 6 }}>
            Ultima recalculare: {formatTimeAgo(score.computed_at)}
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
          {recomputing ? '⏳ Calculez…' : '↻ Recalculează'}
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
        <CircularScore score={score.score} color={sc} />
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
            {scoreLabel(score.score)}
          </div>
          <div style={{ color: tc, fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            {trendIcon(score.trend)} {trendLabel(score.trend)}
            {delta !== null && delta !== 0 && (
              <span style={{ color: D.t3, fontWeight: 400, marginLeft: 8 }}>
                ({delta > 0 ? '+' : ''}
                {delta} față de scorul precedent)
              </span>
            )}
          </div>
          <p style={{ color: D.t2, fontSize: 14, lineHeight: 1.55, margin: 0 }}>
            {scoreNarrative(score.score, score.trend)}
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
          Compoziție scor
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          <ScoreBar
            label="Login frecvență"
            current={score.score_login}
            max={SCORE_MAX.login}
            icon="🔐"
          />
          <ScoreBar
            label="Volum comenzi"
            current={score.score_orders}
            max={SCORE_MAX.orders}
            icon="📈"
          />
          <ScoreBar label="Echipă" current={score.score_team} max={SCORE_MAX.team} icon="👥" />
          <ScoreBar
            label="Stabilitate"
            current={score.score_tickets}
            max={SCORE_MAX.tickets}
            icon="✓"
          />
          <ScoreBar
            label="Engagement"
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
            Ce poți face pentru a crește scorul
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
          Cum funcționează scorul
        </div>
        Scor 0-100 calculat la 30 minute pe baza a 5 componente: login (20), comenzi (30), echipă
        (15), stabilitate Bridge (20), engagement features (15). Sub 40 → primesc alertă automată să
        te contactez. <strong>Reducere churn estimată: 40-60%</strong> doar prin detectare precoce.
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

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'acum câteva secunde'
  if (mins < 60) return `acum ${mins} minute`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `acum ${hrs} ore`
  const days = Math.floor(hrs / 24)
  return `acum ${days} zile`
}

function scoreNarrative(score: number, trend: HealthScore['trend']): string {
  if (trend === 'critical') {
    return 'Cafeneaua ta arată semne îngrijorătoare. Verifică sugestiile de mai jos și contactează-mă dacă ai blocaje — vreau să rezolvăm împreună.'
  }
  if (score >= 80) {
    return 'Felicitări! Folosești Menuvia la potențial maxim. Continuă tot așa și consideră să recomanzi platforma altor patroni.'
  }
  if (score >= 60) {
    return 'Cont sănătos, dar mai sunt zone de îmbunătățit. Caută-ți spațiu pentru 1-2 din sugestiile de mai jos.'
  }
  if (score >= 40) {
    return 'Sunt destule oportunități de optimizare. Adresează în primul rând componenta cu scorul cel mai mic.'
  }
  return 'Folosirea aplicației e sub potențial. Hai să discutăm — îți pot arăta cum să tragi mai multă valoare.'
}
