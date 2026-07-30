// LoyaltySettingsCard — Setări → Comenzi: programul de fidelizare (Loyalty v1,
// mig 226). Pattern-ul OnlinePaymentsCard: gate-ul REAL e server-side
// (plan_features.loyalty growth+ + modulul `loyalty` + program activ);
// aici doar UX-ul. Configurația (puncte/leu, prag, recompensă) se scrie
// direct în loyalty_programs — RLS permite doar adminilor restaurantului.
import { useEffect, useState, type CSSProperties } from 'react'
import { D } from '../lib/constants'
import { planTier } from '../lib/features'
import { supabase } from '../lib/supabase'
import { Toggle } from './_dashboard/sharedUI'
import { Icon } from './ui/Icon'
import type { useRestaurantModules } from '../hooks/useRestaurantModules'

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

export default function LoyaltySettingsCard({ restaurantId, plan, modulesState, toast }: Props) {
  const eligible = planTier(plan) >= 2
  const [pointsPerLeu, setPointsPerLeu] = useState('1')
  const [threshold, setThreshold] = useState('100')
  const [reward, setReward] = useState('Un desert din partea casei')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!eligible) return
    let cancelled = false
    void supabase
      .from('loyalty_programs')
      .select('points_per_leu, reward_threshold, reward_description')
      .eq('restaurant_id', restaurantId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (data) {
          setPointsPerLeu(String(data.points_per_leu))
          setThreshold(String(data.reward_threshold))
          setReward(data.reward_description)
        }
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [restaurantId, eligible])

  async function save(): Promise<void> {
    const ppl = parseFloat(pointsPerLeu.replace(',', '.'))
    const thr = parseInt(threshold, 10)
    if (!Number.isFinite(ppl) || ppl <= 0 || ppl > 100) {
      toast('Punctele pe leu trebuie între 0,1 și 100.', 'error')
      return
    }
    if (!Number.isFinite(thr) || thr < 1 || thr > 100000) {
      toast('Pragul trebuie între 1 și 100.000 de puncte.', 'error')
      return
    }
    if (reward.trim().length === 0 || reward.length > 200) {
      toast('Descrie recompensa (max. 200 de caractere).', 'error')
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
      toast(error.message, 'error')
      return
    }
    toast('Programul de fidelizare a fost salvat')
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
          Fidelizare — puncte și recompense
        </span>
      </div>
      <div style={{ fontSize: '0.75rem', color: D.t2, lineHeight: 1.6, marginBottom: 14 }}>
        Clienții primesc puncte la fiecare comandă din meniul QR și o recompensă când ating
        pragul. Punctele merg pe un card digital în telefonul clientului — opțional legat de
        numărul lui de telefon (stocat criptat, ca hash).
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
          Disponibil de la planul <strong style={{ color: D.gold }}>Meniu + Comenzi</strong> —
          punctele se acordă pe comenzile din QR.
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
                Activează fidelizarea în meniul QR
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 2 }}>
                Clienții văd cardul de puncte în meniu; ospătarii răscumpără recompensele din
                pagina lor, pe codul cardului.
              </div>
            </div>
            <Toggle
              value={modulesState.isEnabled('loyalty')}
              onChange={(v) => {
                modulesState
                  .setModule('loyalty', v)
                  .then(() => toast(v ? 'Fidelizarea activată' : 'Fidelizarea dezactivată'))
                  .catch((err) =>
                    toast(err instanceof Error ? err.message : 'Eroare la salvare', 'error'),
                  )
              }}
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12,
            }}
          >
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', color: D.t2, marginBottom: 5 }}>
                Puncte per leu cheltuit
              </label>
              <input
                value={pointsPerLeu}
                onChange={(e) => setPointsPerLeu(e.target.value)}
                inputMode="decimal"
                style={inp}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', color: D.t2, marginBottom: 5 }}>
                Prag pentru recompensă (puncte)
              </label>
              <input
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                inputMode="numeric"
                style={inp}
              />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: D.t2, marginBottom: 5 }}>
              Recompensa (ce primește clientul la prag)
            </label>
            <input
              value={reward}
              onChange={(e) => setReward(e.target.value.slice(0, 200))}
              placeholder="Ex: Un desert din partea casei"
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
              {saving ? 'Se salvează…' : 'Salvează programul'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
