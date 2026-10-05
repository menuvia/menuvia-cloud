// ─────────────────────────────────────────────────────────────
// useRomaniaTodayRange — intervalul „azi" (ziua ROMÂNEASCĂ), care se
// RECALCULEAZĂ la trecerea miezului nopții.
// ─────────────────────────────────────────────────────────────
// WaiterPage memoiza intervalul cu `[]`: o tabletă lăsată deschisă peste
// noapte rămânea pe ziua de IERI (rezervările de azi nu apăreau, cele de ieri
// rămâneau). Aici ziua se reevaluează periodic și la revenirea în prim-plan
// (tabletele adorm: un interval de 60 s nu rulează cât timp ecranul e stins,
// deci `visibilitychange`/`focus` sunt cele care repară la trezire).
//
// Identitatea obiectului întors e STABILĂ în aceeași zi (useMemo pe `ymd`):
// `useReservations` depinde de `range.from/to`, iar un obiect nou la fiecare
// verificare ar declanșa un refetch + re-abonare degeaba.
import { useEffect, useMemo, useState } from 'react'
import { romaniaDayRange, toRomaniaYMD } from '../lib/dates'

/** Cât de des se verifică dacă s-a schimbat ziua (ms). */
export const TODAY_RANGE_POLL_MS = 60_000

export function useRomaniaTodayRange(): { from: string; to: string } {
  const [ymd, setYmd] = useState<string>(() => toRomaniaYMD(new Date()))

  useEffect(() => {
    // Aceeași valoare → React sare peste re-randare.
    const refresh = (): void => setYmd(toRomaniaYMD(new Date()))
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    refresh() // între prima randare și montarea efectului poate trece miezul nopții
    const id = setInterval(refresh, TODAY_RANGE_POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return useMemo(() => romaniaDayRange(ymd), [ymd])
}
