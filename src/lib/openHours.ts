// openHours — pastila „Deschis / Închis" și programul de azi de pe meniul public
// (/m/:slug), în fusul LOCALULUI (lotul G2c).
//
// Mutat din lib/qr.ts: singurul consumator e PublicMenuPage, iar `lib/qr` e în
// graful meniului QR — un import din `lib/dates` acolo ar fi adus formatter-ele
// în fiecare scanare QR (ZT8).
//
// Ora locală vine din `wallTimeInZone` (formatter `hourCycle: 'h23'`): varianta
// veche, care doar oprea ceasul pe 12 ore, putea întoarce „24" la miezul nopții
// pe unele motoare (clichetul OH8 interzice opțiunea în fișier). Fus invalid →
// București (ca `safe_time_zone`), nu pastilă ascunsă. Momentul e PARAMETRU
// (`nowMs`), deci testele folosesc instante fixe.
//
// Ziua de SERVICIU (ca 241 la rezervări): pe un program peste miezul nopții
// (close <= open), banda [00:00, close) aparține programului de IERI. Vineri
// 18:00–02:00 cu sâmbăta închisă → sâmbătă la 01:00 e DESCHIS; joi închis →
// vineri la 01:00 e ÎNCHIS. Pe un program identic în toate zilele rezultatul e
// același cu cel vechi (OH1).
import type { HoursStructured, WeekDay } from './qr'
import { safeTimeZone, wallTimeInZone } from './dates'

// Indexul `getUTCDay()` (0 = duminică) → cheia din `hours_structured`.
const DAYS: readonly WeekDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function parseHHMM(s: string | null | undefined): number {
  const [h, m] = String(s ?? '').split(':').map((x) => parseInt(x, 10))
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

interface LocalNow {
  today: WeekDay
  yesterday: WeekDay
  minutes: number
}

function localNow(timezone: string | null | undefined, nowMs: number): LocalNow {
  const w = wallTimeInZone(nowMs, safeTimeZone(timezone))
  const dow = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()
  return {
    today: DAYS[dow],
    yesterday: DAYS[(dow + 6) % 7],
    minutes: w.hour * 60 + w.minute,
  }
}

/**
 * true / false pe baza orelor structurate, în fusul localului. null dacă lipsesc
 * orele (pastila ascunsă complet, NU „ÎNCHIS").
 */
export function computeIsOpen(
  hours: HoursStructured | null | undefined,
  timezone: string | null | undefined,
  nowMs: number = Date.now(),
): boolean | null {
  if (!hours || Object.keys(hours).length === 0) return null
  const now = localNow(timezone, nowMs)

  const today = hours[now.today]
  if (today && !today.closed) {
    const open = parseHHMM(today.open)
    const close = parseHHMM(today.close)
    // Peste miezul nopții (close <= open): azi contează doar [open, 24:00);
    // open == close → 24/7.
    if (close <= open ? now.minutes >= open : now.minutes >= open && now.minutes < close) return true
  }

  const yesterday = hours[now.yesterday]
  if (yesterday && !yesterday.closed) {
    const open = parseHHMM(yesterday.open)
    const close = parseHHMM(yesterday.close)
    // Banda de după miezul nopții a serviciului de IERI.
    if (close <= open && now.minutes < close) return true
  }
  return false
}

/** Programul de azi (ziua LOCALĂ), formatat „08:00–23:00", sau null. */
export function todayHoursLabel(
  hours: HoursStructured | null | undefined,
  timezone: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!hours) return null
  const today = hours[localNow(timezone, nowMs).today]
  if (!today || today.closed) return null
  return today.open + '–' + today.close
}
