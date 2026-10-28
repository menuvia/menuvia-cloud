// useMyAgent — agentul atribuit restaurantului (mig 303), pentru cardul de pe
// Acasă / Setări și butonul „Ajutor”.
//
// TRISTATE: `agent === null` = necunoscut (se încarcă, eroare de rețea, lipsă de
// drepturi sau formă neașteptată) — UI-ul nu randează nimic pe `null`; doar un
// răspuns valid cu `has_agent: true` arată cardul. Un fals „ai un agent” sau un
// buton de acordare construit pe date neînțelese ar fi mai rău decât lipsa lui.
import { useState, useEffect, useCallback } from 'react'
import { loadMyAgent } from '../lib/myAgent'
import type { MyAgentResult } from '../lib/agentContact'

export function useMyAgent(restaurantId: string | null | undefined, enabled: boolean = true) {
  // Rezultatul se leagă de restaurantul pentru care a fost cerut: la schimbarea
  // restaurantului nu se afișează agentul vechi sub titlul celui nou.
  const [state, setState] = useState<{ key: string | null; agent: MyAgentResult | null }>({
    key: null,
    agent: null,
  })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled || !restaurantId) return
    let cancelled = false
    void (async () => {
      let result: MyAgentResult | null
      try {
        result = await loadMyAgent(restaurantId)
      } catch {
        result = null // non-admin / rețea: fără card, fără zgomot
      }
      if (!cancelled) setState({ key: restaurantId, agent: result })
    })()
    return () => {
      cancelled = true
    }
  }, [restaurantId, enabled, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  const agent = enabled && restaurantId && state.key === restaurantId ? state.agent : null
  return { agent, reload }
}
