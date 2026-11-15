// LoyaltySettingsCard — Setări → Comenzi: programul de fidelizare (Loyalty v1,
// mig 226). Pattern-ul OnlinePaymentsCard: gate-ul REAL e server-side
// (plan_features.loyalty growth+ + modulul `loyalty` + program activ);
// aici doar UX-ul. Configurația (puncte/leu, prag, recompensă) se scrie
// direct în loyalty_programs — RLS permite doar adminilor restaurantului.
// Limba (lotul L6b): textele vin din `settingsCards` (același chunk cu fila
// Setări), „Reîncearcă” din `common`; erorile serverului prin
// `describeStaffError` (în română exact `toUserMessage`). Recompensa
// IMPLICITĂ rămâne românească: e o valoare a meniului (o vede oaspetele), nu
// un text al personalului.
import { useEffect, useId, useState, type CSSProperties } from 'react'
import { D, PLAN_LABELS } from '../lib/constants'
import { planTier } from '../lib/features'
import { supabase } from '../lib/supabase'
import { Toggle } from './_dashboard/sharedUI'
import { Icon } from './ui/Icon'
import type { useRestaurantModules } from '../hooks/useRestaurantModules'
import { useT } from '../i18n/useT'
import { describeStaffError } from '../i18n/staffErrors'
import { settingsCardsNs } from '../i18n/ns/settingsCards'
import { commonNs } from '../i18n/ns/common'
import { fillNodes } from '../i18n/fillNodes'

interface Props {
  restaurantId: string
  plan: string
  modulesState: ReturnType<typeof useRestaurantModules>
  toast: (msg: string, type?: string) => void
}

const inp: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 8,
  padding: '9px 12px',
  color: D.t1,
  fontSize: '0.85rem',
  fontFamily: 'DM Sans,sans-serif',
}

interface LoyaltyProgramRow {
  points_per_leu: number
  reward_threshold: number
  reward_description: string
}

// Starea citirii programului existent. „Salvează" e activ DOAR pe 'ready':
// înainte, `{ error }` de la supabase-js (care NU aruncă) era ignorat, cardul
// rămânea cu valorile implicite și butonul se activa — iar un „Salvează" apăsat
// după un blip de rețea suprascria prin upsert pragul și recompensa reale ale
// localului cu cele implicite (100 de puncte, „Un desert din partea casei").
type LoadState = 'loading' | 'ready' | 'error'

// Valoarea implicită a recompensei: DATĂ a meniului (o vede oaspetele), deci
// în română în orice limbă a personalului — ca numele „Masa N” din L6a.
const DEFAULT_REWARD = 'Un desert din partea casei'

export default function LoyaltySettingsCard({ restaurantId, plan, modulesState, toast }: Props) {
  const tr = useT(settingsCardsNs)
  const tc = useT(commonNs)
  const eligible = planTier(plan) >= 2
  const [pointsPerLeu, setPointsPerLeu] = useState('1')
  const [threshold, setThreshold] = useState('100')
  const [reward, setReward] = useState(DEFAULT_REWARD)
  const [saving, setSaving] = useState(false)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const fieldId = useId()
  const loaded = loadState === 'ready'

  useEffect(() => {
    if (!eligible) return
    let cancelled = false
    setLoadState('loading')
    async function load(): Promise<void> {
      try {
        const { data, error } = await supabase
          .from('loyalty_programs')
          .select('points_per_leu, reward_threshold, reward_description')
          .eq('restaurant_id', restaurantId)
          .maybeSingle()
        if (cancelled) return
        if (error) {
          setLoadState('error')
          return
        }
        const row = data as LoyaltyProgramRow | null
        if (row) {
          setPointsPerLeu(String(row.points_per_leu))
          setThreshold(String(row.reward_threshold))
          setReward(row.reward_description)
        }
        setLoadState('ready')
      } catch {
        // Respingere de transport (fetch picat) — aceeași stare ca `{ error }`.
        if (!cancelled) setLoadState('error')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [restaurantId, eligible, reloadKey])

  async function save(): Promise<void> {
    const ppl = parseFloat(pointsPerLeu.replace(',', '.'))
    const thr = parseInt(threshold, 10)
    if (!Number.isFinite(ppl) || ppl <= 0 || ppl > 100) {
      toast(tr.t('loy_err_ppl'), 'error')
      return
    }
    if (!Number.isFinite(thr) || thr < 1 || thr > 100000) {
      toast(tr.t('loy_err_threshold'), 'error')
      return
    }
    if (reward.trim().length === 0 || reward.length > 200) {
      toast(tr.t('loy_err_reward'), 'error')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('loyalty_programs').upsert({
      restaurant_id: restaurantId,
      points_per_leu: ppl,
      reward_threshold: thr,
      reward_description: reward.trim(),
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    setSaving(false)
    if (error) {
      toast(describeStaffError(error, tc), 'error')
      return
    }
    toast(tr.t('loy_saved'))
  }

  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 14,
        padding: 22,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon name="star" size={16} color={D.gold} />
        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1 }}>
          {tr.t('loy_title')}
        </span>
      </div>
      <div style={{ fontSize: '0.75rem', color: D.t2, lineHeight: 1.6, marginBottom: 14 }}>
        {tr.t('loy_desc')}
      </div>

      {!eligible ? (
        <div
          style={{
            background: D.s3,
            borderRadius: 10,
            padding: '12px 14px',
            fontSize: '0.78rem',
            color: D.t2,
          }}
        >
          {fillNodes(tr.t('loy_locked'), {
            plan: <strong style={{ color: D.gold }}>{PLAN_LABELS.growth}</strong>,
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: D.t1 }}>
                {tr.t('loy_enableTitle')}
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 2 }}>
                {tr.t('loy_enableDesc')}
              </div>
            </div>
            <Toggle
              label={tr.t('loy_toggle')}
              value={modulesState.isEnabled('loyalty')}
              onChange={(v) => {
                modulesState
                  .setModule('loyalty', v)
                  .then(() => toast(tr.t(v ? 'loy_enabled' : 'loy_disabled')))
                  .catch((err: unknown) =>
                    toast(describeStaffError(err, tc, { fallback: tr.t('err_save') }), 'error'),
                  )
              }}
            />
          </div>

          {loadState === 'error' && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                background: D.redA,
                border: `1px solid ${D.red}`,
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: '0.78rem',
                color: D.t1,
              }}
            >
              <span>{tr.t('loy_loadError')}</span>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                style={{
                  background: D.s3,
                  color: D.t1,
                  border: `1px solid ${D.border}`,
                  borderRadius: 8,
                  padding: '8px 14px',
                  minHeight: 44,
                  fontFamily: 'DM Sans,sans-serif',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {tc.t('retry')}
              </button>
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12,
            }}
          >
            <div>
              <label
                htmlFor={`${fieldId}-ppl`}
                style={{ display: 'block', fontSize: '0.72rem', color: D.t2, marginBottom: 5 }}
              >
                {tr.t('loy_ppl')}
              </label>
              <input
                id={`${fieldId}-ppl`}
                value={pointsPerLeu}
                onChange={(e) => setPointsPerLeu(e.target.value)}
                inputMode="decimal"
                style={inp}
              />
            </div>
            <div>
              <label
                htmlFor={`${fieldId}-thr`}
                style={{ display: 'block', fontSize: '0.72rem', color: D.t2, marginBottom: 5 }}
              >
                {tr.t('loy_threshold')}
              </label>
              <input
                id={`${fieldId}-thr`}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                inputMode="numeric"
                style={inp}
              />
            </div>
          </div>
          <div>
            <label
              htmlFor={`${fieldId}-reward`}
              style={{ display: 'block', fontSize: '0.72rem', color: D.t2, marginBottom: 5 }}
            >
              {tr.t('loy_reward')}
            </label>
            <input
              id={`${fieldId}-reward`}
              value={reward}
              onChange={(e) => setReward(e.target.value.slice(0, 200))}
              placeholder={tr.t('loy_rewardPlaceholder')}
              style={inp}
            />
          </div>
          <div>
            <button
              onClick={() => void save()}
              disabled={saving || !loaded}
              style={{
                background: D.gold,
                color: D.bg,
                border: 'none',
                borderRadius: 8,
                padding: '10px 18px',
                fontFamily: 'DM Sans,sans-serif',
                fontSize: 13,
                fontWeight: 600,
                cursor: saving ? 'wait' : 'pointer',
                minHeight: 44,
                opacity: saving || !loaded ? 0.7 : 1,
              }}
            >
              {saving ? tr.t('loy_saving') : tr.t('loy_save')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
