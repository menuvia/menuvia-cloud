// =============================================================
// Menuvia — src/hooks/useSalesNetwork.ts
// „Echipa mea" / rolul în rețeaua de vânzări (mig 302, pachetul 8a).
//
// TRISTATE, ca `useBridgeConnected`: `network === null` înseamnă „nu știm" (se
// încarcă, RPC nedeployat, eroare de rețea) — NU „nu ești în rețea". Un cont care
// chiar nu e în rețea primește un `SalesNetwork` cu `role: null`. Ecranele nu
// trebuie să ascundă/arate nimic definitiv pe `null`; `error` spune de ce.
// =============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchSalesNetwork,
  setMyContactSharing,
  SalesNetworkError,
  type SalesNetwork,
} from '../lib/salesNetwork'

export interface UseSalesNetwork {
  /** `null` = necunoscut (încărcare / eroare), NU „în afara rețelei". */
  network: SalesNetwork | null
  loading: boolean
  /** Ultima eroare de citire (mesaj românesc în `error.message`), sau `null`. */
  error: SalesNetworkError | null
  /** RPC-ul nu e încă deployat pe server (frontend înaintea migrației 302). */
  unavailable: boolean
  reload: () => Promise<void>
  /**
   * Schimbă consimțământul de contact și reîncarcă. Întoarce eroarea (nu o
   * aruncă) ca butonul să afișeze mesajul fără try/catch în componentă.
   */
  setContactSharing: (share: boolean) => Promise<SalesNetworkError | null>
}

function asSalesError(e: unknown): SalesNetworkError {
  return e instanceof SalesNetworkError ? e : new SalesNetworkError('unknown')
}

/**
 * @param enabled  `false` oprește complet interogarea (ex. utilizator nelogat).
 */
export function useSalesNetwork(enabled: boolean = true): UseSalesNetwork {
  const [network, setNetwork] = useState<SalesNetwork | null>(null)
  const [loading, setLoading] = useState<boolean>(enabled)
  const [error, setError] = useState<SalesNetworkError | null>(null)
  // Numărătoare de cereri: un răspuns întârziat (alt `reload`, `enabled` schimbat,
  // componentă demontată) nu are voie să scrie peste starea mai nouă.
  const seqRef = useRef(0)

  const reload = useCallback(async (): Promise<void> => {
    const seq = ++seqRef.current
    if (!enabled) return
    setLoading(true)
    try {
      const next = await fetchSalesNetwork()
      if (seq !== seqRef.current) return
      setNetwork(next)
      setError(null)
    } catch (e) {
      if (seq !== seqRef.current) return
      // Păstrăm ultima stare cunoscută: un blip nu are voie să golească un ecran
      // deja corect; eroarea e raportată separat.
      setError(asSalesError(e))
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      seqRef.current += 1
      setNetwork(null)
      setError(null)
      setLoading(false)
      return
    }
    void reload()
    return () => {
      // Demontare / schimbare de `enabled`: invalidăm orice cerere în zbor.
      seqRef.current += 1
    }
  }, [enabled, reload])

  const setContactSharing = useCallback(
    async (share: boolean): Promise<SalesNetworkError | null> => {
      try {
        await setMyContactSharing(share)
      } catch (e) {
        return asSalesError(e)
      }
      await reload()
      return null
    },
    [reload],
  )

  return {
    network,
    loading,
    error,
    unavailable: error?.reason === 'unavailable',
    reload,
    setContactSharing,
  }
}
