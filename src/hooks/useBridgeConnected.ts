// =============================================================
// Menuvia — src/hooks/useBridgeConnected.ts
// Starea bridge-ului fiscal, TRISTATE, pentru banner-ul „casa nu e conectată".
// =============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchBridgeConnectionStatus, type BridgeConnectionStatus } from '../lib/bridgeStatus'

/** Reîmprospătare periodică: bridge-ul poate cădea cu pagina deschisă.
 *  60 s e de două ori pragul din RPC (3 min), deci banner-ul apare în cel mult
 *  4 minute de la oprirea casei, fără să batem serverul degeaba. */
const POLL_MS = 60_000

export interface UseBridgeConnected {
  /** `null` = NU știm (încă se încarcă, RPC nedeployat, sau eroare de rețea).
   *  Banner-ul se afișează DOAR pe `false` — niciodată pe necunoscut. */
  status: BridgeConnectionStatus | null
  loading: boolean
  reload: () => Promise<void>
}

/**
 * Citește liveness-ul bridge-ului pentru `restaurantId`.
 *
 * TRISTATE deliberat (aceeași disciplină ca `paymentsEnabled` din WaiterPage,
 * audit v3 DS-1): o eroare NU înseamnă „deconectat". Dacă am trata eroarea ca
 * `false`, un blip de rețea sau o migrație neaplicată încă ar pune un banner
 * roșu de alarmă fiscală pe ecranul fiecărui restaurant — exact genul de fals
 * pozitiv după care operatorul învață să ignore alerta.
 *
 * `enabled` oprește complet interogarea pe planurile fără fiscalizare.
 */
export function useBridgeConnected(
  restaurantId: string | null,
  enabled: boolean,
): UseBridgeConnected {
  const [status, setStatus] = useState<BridgeConnectionStatus | null>(null)
  const [loading, setLoading] = useState(false)
  // Ignorăm răspunsurile venite pentru alt restaurant (utilizatori multi-local).
  const activeIdRef = useRef<string | null>(restaurantId)

  const run = useCallback(async (): Promise<void> => {
    if (restaurantId == null || !enabled) return
    setLoading(true)
    try {
      const next = await fetchBridgeConnectionStatus(restaurantId)
      if (activeIdRef.current !== restaurantId) return
      setStatus(next)
    } catch {
      // Necunoscut, NU „deconectat": nu atingem starea, ca un singur blip să nu
      // stingă un banner deja corect afișat și nici să nu inventeze unul.
    } finally {
      if (activeIdRef.current === restaurantId) setLoading(false)
    }
  }, [restaurantId, enabled])

  useEffect(() => {
    // Reset SINCRON la schimbarea restaurantului: starea localului A nu are voie
    // să fie citită nicio clipă sub numele localului B.
    activeIdRef.current = restaurantId
    setStatus(null)
    if (restaurantId == null || !enabled) {
      setLoading(false)
      return
    }
    void run()
    const t = setInterval(() => void run(), POLL_MS)
    return () => clearInterval(t)
  }, [restaurantId, enabled, run])

  return { status, loading, reload: run }
}
