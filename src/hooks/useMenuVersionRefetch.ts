// ─────────────────────────────────────────────────────────────
// useMenuVersionRefetch — meniul QR se reîmprospătează la REVENIREA în tab,
// DOAR dacă versiunea lui s-a schimbat (mig 313: `get_menu_version`).
//
// La montare (și la schimbarea restaurantului) citește versiunea de bază. La
// fiecare `visibilitychange` → vizibil întreabă din nou; dacă diferă, cheamă
// `onChanged` (refetch-ul meniului). Noua versiune devine bază DOAR dacă
// `onChanged` raportează succes (`true`): un refetch picat lasă baza veche, ca
// aceeași versiune să declanșeze din nou refetch-ul la următoarea revenire
// (altfel meniul vechi rămânea până la o versiune și mai nouă). O sondă picată
// (`null`) nu declanșează nimic — „nu știu” nu e „s-a schimbat”.
// ─────────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react'
import { fetchMenuVersion, menuVersionChanged } from '../lib/menuVersion'

export function useMenuVersionRefetch(
  restaurantId: string | null,
  onChanged: () => Promise<boolean>,
): void {
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
      // `inFlight` acoperă și refetch-ul: două reveniri rapide nu pornesc
      // două refetch-uri pe aceeași versiune.
      void fetchMenuVersion(restaurantId)
        .then(async (next) => {
          if (cancelled || !menuVersionChanged(baseline, next)) return
          let ok = false
          try {
            ok = await onChangedRef.current()
          } catch {
            ok = false
          }
          if (ok && !cancelled) baseline = next
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
