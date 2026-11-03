// ─────────────────────────────────────────────────────────────
// useMenuVersionRefetch — meniul QR se reîmprospătează la REVENIREA în tab,
// DOAR dacă versiunea lui s-a schimbat (mig 313: `get_menu_version`).
//
// La montare (și la schimbarea restaurantului) citește versiunea de bază. La
// fiecare `visibilitychange` → vizibil întreabă din nou; dacă diferă, cheamă
// `onChanged` (refetch-ul meniului) și reține noua versiune. O sondă picată
// (`null`) nu declanșează nimic — „nu știu” nu e „s-a schimbat”.
// ─────────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react'
import { fetchMenuVersion, menuVersionChanged } from '../lib/menuVersion'

export function useMenuVersionRefetch(restaurantId: string | null, onChanged: () => void): void {
  // Ultimul callback, fără să re-abonăm ascultătorul la fiecare randare.
  const onChangedRef = useRef(onChanged)
  useEffect(() => {
    onChangedRef.current = onChanged
  }, [onChanged])

  useEffect(() => {
    if (!restaurantId || typeof document === 'undefined') return
    let cancelled = false
    let baseline: string | null = null
    let inFlight = false

    void fetchMenuVersion(restaurantId).then((v) => {
      if (!cancelled) baseline = v
    })

    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible' || inFlight) return
      inFlight = true
      void fetchMenuVersion(restaurantId)
        .then((next) => {
          if (cancelled || !menuVersionChanged(baseline, next)) return
          baseline = next
          onChangedRef.current()
        })
        .finally(() => {
          inFlight = false
        })
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [restaurantId])
}
