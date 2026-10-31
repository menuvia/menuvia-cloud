// =============================================================
// Menuvia — src/hooks/usePollWhileVisible.ts
// Reîmprospătare periodică DOAR cât fila e vizibilă (perf-staff-6).
// =============================================================
// Ecranele de staff (casa de marcat, ture, facturi, Happy Hour, harta live,
// banner-ul casei fiscale) aveau fiecare propriul `setInterval`, care rula și
// cu fila ascunsă: o tabletă lăsată pe tab-ul „Casă de marcat" peste noapte
// trimitea 4 cereri la 15 s, ore în șir, pentru un ecran pe care nu-l vedea
// nimeni. Contractul de aici, unic pentru toate:
//   • cât fila e ASCUNSĂ, cronometrul e OPRIT (zero cereri, zero treziri);
//   • la REVENIREA în filă se face imediat o citire (datele au îmbătrânit cât
//     timp n-a privit nimeni), apoi cronometrul repornește de la zero;
//   • citirea inițială rămâne a consumatorului (fiecare ecran își încarcă
//     datele la montare/schimbarea restaurantului) — aici e doar ritmul.
import { useEffect, useRef } from 'react'

/** Fila e vizibilă? Fără `document` (SSR) → da. DOAR `hidden` contează ca ascuns:
 *  starea istorică `prerender` (și jsdom fără pretendToBeVisual) nu e „ascuns". */
export function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

/**
 * Variantă imperativă, pentru efectele care își țin singure starea (harta live,
 * hook-ul casei fiscale). Întoarce funcția de oprire — de chemat în cleanup.
 */
export function startPollingWhileVisible(poll: () => void, intervalMs: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null
  const start = () => {
    if (timer == null) timer = setInterval(poll, intervalMs)
  }
  const stop = () => {
    if (timer != null) {
      clearInterval(timer)
      timer = null
    }
  }
  const onVisibility = () => {
    if (isDocumentVisible()) {
      // Repornire „curată": oprim orice cronometru rămas, citim acum, apoi ritmul.
      stop()
      poll()
      start()
    } else {
      stop()
    }
  }
  if (isDocumentVisible()) start()
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
  }
  return () => {
    stop()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }
}

/**
 * Hook-ul: `poll` poate avea identitate nouă la fiecare randare (se citește
 * ultima versiune printr-un ref), deci cronometrul NU se reîncepe la fiecare
 * randare — doar când se schimbă `intervalMs` sau `enabled`.
 */
export function usePollWhileVisible(
  poll: () => void,
  intervalMs: number,
  enabled: boolean = true,
): void {
  const pollRef = useRef(poll)
  useEffect(() => {
    pollRef.current = poll
  })
  useEffect(() => {
    if (!enabled) return
    return startPollingWhileVisible(() => pollRef.current(), intervalMs)
  }, [intervalMs, enabled])
}
