// useLoyaltyProgramForm — starea programului de fidelizare, ținută de
// SettingsTab (lotul C7c), nu de card: SettingsTab rămâne montat între cele
// patru secțiuni ale Setărilor (DashboardPage), cardul nu — o stare în card se
// pierdea la prima trecere pe altă secțiune. Pagina o salvează în același
// „Salvează" cu restul formularului, iar `dirty` intră în paza de modificări
// nesalvate. Citirea e fail-closed ca înainte (`LoadState`): pe orice altceva
// decât `ready` nimic nu e „murdar" și nimic nu se scrie.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loyaltyDefaultReward } from '../lib/settingsLang'
import {
  loyaltyValuesEqual,
  parseLoyaltyValues,
  type LoyaltyFieldError,
  type LoyaltyLoadState,
  type LoyaltyValues,
} from '../lib/loyaltyProgramForm'

interface LoyaltyProgramRow {
  points_per_leu: number
  reward_threshold: number
  reward_description: string
}

export interface LoyaltyProgramForm {
  /** `idle` = programul nu se aplică (planul fără comenzi / fără module). */
  loadState: LoyaltyLoadState
  values: LoyaltyValues
  setField: (field: keyof LoyaltyValues, value: string) => void
  /** Programul are rând în `loyalty_programs` (a fost salvat cândva). */
  exists: boolean
  /** Câmpurile diferă de programul salvat (doar pe `ready`). */
  dirty: boolean
  reload: () => void
  /** `null` = valid; altfel cheia erorii (namespace `settingsCards`). */
  validate: () => LoyaltyFieldError | null
  /** Scrie programul (upsert, `is_active`); la succes valorile devin baza. */
  save: () => Promise<{ error: unknown }>
}

export function useLoyaltyProgramForm(
  restaurantId: string,
  enabled: boolean,
  /** Limba de bază a meniului: recompensa implicită e în ea (o vede oaspetele). */
  baseLang: string,
): LoyaltyProgramForm {
  // Valorile implicite ale unui program nesalvat — fixate la prima randare,
  // ca înainte (cardul le punea o singură dată, în `useState`).
  const [initial] = useState<LoyaltyValues>(() => ({
    pointsPerLeu: '1',
    threshold: '100',
    reward: loyaltyDefaultReward(baseLang),
  }))
  const [values, setValues] = useState<LoyaltyValues>(initial)
  const [saved, setSaved] = useState<LoyaltyValues>(initial)
  const [exists, setExists] = useState(false)
  const [loadState, setLoadState] = useState<LoyaltyLoadState>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!enabled) return
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
        // supabase-js NU aruncă: `{ error }` e o citire eșuată, nu „fără program".
        if (error) {
          setLoadState('error')
          return
        }
        const row = data as LoyaltyProgramRow | null
        const next: LoyaltyValues = row
          ? {
              pointsPerLeu: String(row.points_per_leu),
              threshold: String(row.reward_threshold),
              reward: row.reward_description,
            }
          : initial
        setValues(next)
        setSaved(next)
        setExists(row != null)
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
  }, [restaurantId, enabled, reloadKey, initial])

  const state: LoyaltyLoadState = enabled ? loadState : 'idle'
  const dirty = state === 'ready' && !loyaltyValuesEqual(values, saved)

  return {
    loadState: state,
    values,
    setField: (field, value) => setValues((v) => ({ ...v, [field]: value })),
    exists,
    dirty,
    reload: () => setReloadKey((k) => k + 1),
    validate: () => {
      const parsed = parseLoyaltyValues(values)
      return parsed.ok ? null : parsed.error
    },
    save: async () => {
      const parsed = parseLoyaltyValues(values)
      if (!parsed.ok) return { error: new Error(parsed.error) }
      const written = values
      const { error } = await supabase.from('loyalty_programs').upsert({
        restaurant_id: restaurantId,
        ...parsed.fields,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      if (error) return { error }
      setSaved(written)
      setExists(true)
      return { error: null }
    },
  }
}
