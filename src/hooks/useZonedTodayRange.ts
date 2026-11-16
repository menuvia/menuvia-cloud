// ─────────────────────────────────────────────────────────────
// useZonedTodayRange — intervalul „azi" în fusul LOCALULUI (lotul G2c), care se
// RECALCULEAZĂ la trecerea miezului nopții.
// ─────────────────────────────────────────────────────────────
// „Azi" al ospătarului (rezervările zilei) e ziua OPERAȚIONALĂ a restaurantului,
// `restaurantTimeZone(activeRestaurant)` — nu ziua Bucureștiului scrisă de mână
// și nu ziua tabletei. Pe București rezultatul e IDENTIC cu vechiul
// `useRomaniaTodayRange` (`zonedDayRange` = `romaniaDayRange`, DZ2).
//
// WaiterPage memoiza intervalul cu `[]`: o tabletă lăsată deschisă peste
// noapte rămânea pe ziua de IERI (rezervările de azi nu apăreau, cele de ieri
// rămâneau). Aici ziua se reevaluează periodic și la revenirea în prim-plan
// (tabletele adorm: un interval de 60 s nu rulează cât timp ecranul e stins,
// deci `visibilitychange`/`focus` sunt cele care repară la trezire).
//
// Starea e `{ tz, ymd }`, nu doar `ymd`: la o schimbare de fus (alt restaurant
// activ) intervalul e al NOULUI fus în aceeași randare — altfel prima randare ar
// combina ziua veche cu fusul nou și ar declanșa un fetch degeaba.
//
// Identitatea obiectului întors e STABILĂ în aceeași zi (useMemo pe `ymd`+`tz`):
// `useReservations` depinde de `range.from/to`, iar un obiect nou la fiecare
// verificare ar declanșa un refetch + re-abonare degeaba.
import { useEffect, useMemo, useState } from 'react'
import { safeTimeZone, toZonedYMD, zonedDayRange } from '../lib/dates'

/** Cât de des se verifică dacă s-a schimbat ziua (ms). */
export const TODAY_RANGE_POLL_MS = 60_000

interface ZonedDay {
  tz: string
  ymd: string
}

export function useZonedTodayRange(timeZone: string): { from: string; to: string } {
  // Fus invalid → implicitul platformei (București), ca `safe_time_zone`.
  const tz = safeTimeZone(timeZone)
  const [day, setDay] = useState<ZonedDay>(() => ({ tz, ymd: toZonedYMD(new Date(), tz) }))

  useEffect(() => {
    const refresh = (): void => {
      const ymd = toZonedYMD(new Date(), tz)
      // Același obiect → React sare peste re-randare.
      setDay((prev) => (prev.tz === tz && prev.ymd === ymd ? prev : { tz, ymd }))
    }
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
  }, [tz])

  // Fusul s-a schimbat de la ultima stare: ziua NOULUI fus, în aceeași randare
  // (efectul o fixează în stare imediat după).
  const ymd = day.tz === tz ? day.ymd : toZonedYMD(new Date(), tz)
  return useMemo(() => zonedDayRange(ymd, tz), [ymd, tz])
}
