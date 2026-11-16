// src/lib/reservationRanges.ts — intervalele filei Rezervări (Azi / Mâine /
// Săptămâna / o zi aleasă) în fusul OPERAȚIONAL al localului (lotul G2b):
// aceeași zi în care serverul a validat rezervarea (`create_reservation_public`,
// mig 298). Pur, fără supabase — rulabil și testabil fără DOM.
//
// Înainte, intervalele se construiau cu `setHours(0, 0, 0, 0)` pe fusul
// DISPOZITIVULUI, iar „mâine” era `now + 86 400 000 ms`: un manager al unui local
// din New York care deschidea panoul din București vedea „azi” = ziua
// Bucureștiului, iar în zilele de 23/25 de ore „mâine” cădea pe ziua greșită.
// Lucrul pe ȘIRURI YYYY-MM-DD (`addDaysYmd`) nu trece prin ore deloc.
import { addDaysYmd, toZonedYMD, zonedDayRange } from './dates'

export interface ReservationRange {
  from: string
  to: string
}

export type ReservationPreset = 'today' | 'tomorrow' | 'week' | 'custom'

/** O zi întreagă (`ymd`) în fusul localului, ca instante ISO. */
export function reservationDayRange(ymd: string, timeZone: string): ReservationRange {
  return zonedDayRange(ymd, timeZone)
}

/** „Săptămâna” = de la începutul zilei `ymd` până la sfârșitul zilei `ymd + 7`
 *  (8 zile calendaristice — semantica de dinainte, păstrată). */
export function reservationWeekRange(ymd: string, timeZone: string): ReservationRange {
  return {
    from: zonedDayRange(ymd, timeZone).from,
    to: zonedDayRange(addDaysYmd(ymd, 7), timeZone).to,
  }
}

export interface ReservationPresets {
  todayYmd: string
  today: ReservationRange
  tomorrow: ReservationRange
  week: ReservationRange
}

/** Cele trei presetări, la momentul `now`, în fusul localului. „Mâine” =
 *  ziua calendaristică următoare (`addDaysYmd`), NU `now + 24 h`. */
export function reservationPresets(timeZone: string, now: Date = new Date()): ReservationPresets {
  const todayYmd = toZonedYMD(now, timeZone)
  return {
    todayYmd,
    today: reservationDayRange(todayYmd, timeZone),
    tomorrow: reservationDayRange(addDaysYmd(todayYmd, 1), timeZone),
    week: reservationWeekRange(todayYmd, timeZone),
  }
}

/** Care presetare e activă acum (chip-ul evidențiat); altfel 'custom'. */
export function activeRangePreset(
  range: ReservationRange,
  timeZone: string,
  now: Date = new Date(),
): ReservationPreset {
  const p = reservationPresets(timeZone, now)
  const same = (r: ReservationRange): boolean => r.from === range.from && r.to === range.to
  if (same(p.today)) return 'today'
  if (same(p.tomorrow)) return 'tomorrow'
  if (same(p.week)) return 'week'
  return 'custom'
}
