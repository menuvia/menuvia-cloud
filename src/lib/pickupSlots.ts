// ─────────────────────────────────────────────────────────────
// pickupSlots — construirea sloturilor de ridicare (pickup)
//
// Helper PUR (primește `now` ca parametru → testabil determinist), extras
// din PickupCheckoutSheet. Suportă programul peste miezul nopții cu aceeași
// doctrină ca rezervările (mig 201/241): când `end <= start`, fereastra
// validă e [start, 24:00) ∪ [00:00, end) — un food truck 18:00–02:00 oferă
// sloturi toată seara ȘI după miezul nopții, nu „închis" toată ziua.
// ─────────────────────────────────────────────────────────────

import { DEFAULT_RESTAURANT_TZ, safeTimeZone, wallTimeInZone, zonedWallToInstant } from './dates'

export interface PickupSlotSettings {
  min_lead_time_minutes: number
  slot_interval_minutes: number
  open_hours: { start: string; end: string }
}

/** Numărul maxim de sloturi oferite clientului (păstrat din UI-ul inițial). */
export const MAX_PICKUP_SLOTS = 16

/**
 * Sloturile de ridicare disponibile ACUM, ca ISO strings, aliniate la
 * intervalul configurat, începând de la now + lead time (dar nu înainte de
 * deschidere) până la închidere. Orele de program se interpretează în fusul
 * RESTAURANTULUI (`timezone`, implicit Europe/Bucharest; fus invalid → implicit),
 * independent de fusul dispozitivului. Listă goală = restaurantul e închis (sau
 * setările sunt invalide).
 */
export function buildPickupSlots(
  settings: PickupSlotSettings | null | undefined,
  now: Date = new Date(),
  timezone: string | null | undefined = DEFAULT_RESTAURANT_TZ,
): string[] {
  if (!settings) return []
  const lead = settings.min_lead_time_minutes
  const interval = settings.slot_interval_minutes
  // Interval invalid (0/negativ/NaN) ar bloca avansul cursorului — fail-closed.
  if (!Number.isFinite(interval) || interval <= 0 || !Number.isFinite(lead) || lead < 0) {
    return []
  }

  const [openH, openM] = settings.open_hours.start.split(':').map(Number)
  const [closeH, closeM] = settings.open_hours.end.split(':').map(Number)
  if ([openH, openM, closeH, closeM].some((n) => !Number.isFinite(n))) return []

  // Ora de PERETE a restaurantului, nu a telefonului: `setHours` pe un `Date`
  // lucra în fusul BROWSERULUI, deci un client cu telefonul pe alt fus (turist,
  // telefon setat greșit) primea sloturi decalate cu diferența de fus — iar
  // serverul (min lead) le judeca pe instantul real.
  const tz = safeTimeZone(timezone)
  const nowMs = now.getTime()
  const today = wallTimeInZone(nowMs, tz)
  const wallAt = (dayOffset: number, h: number, m: number): number =>
    zonedWallToInstant(today.year, today.month, today.day + dayOffset, h, m, tz)

  let open = wallAt(0, openH, openM)
  let close = wallAt(0, closeH, closeM)

  // Program peste miezul nopții (end <= start, doctrina mig 201): fereastra de
  // azi se întinde până MÂINE la ora de închidere; iar dacă suntem deja în
  // segmentul de după miezul nopții (now < close), deschiderea relevantă a
  // fost IERI — o mutăm în trecut ca să nu împingă sloturile spre diseară.
  if (close <= open) {
    if (nowMs < close) {
      open = wallAt(-1, openH, openM)
    } else {
      close = wallAt(1, closeH, closeM)
    }
  }

  let earliest = Math.max(nowMs + lead * 60_000, open)
  // Trunchiere la minut, apoi aliniere în sus la grila de interval pe MINUTUL
  // DE PERETE (ex. :07 cu interval 15 → :15) — un fus cu offset de :30 (India)
  // ar alinia altfel pe minutul UTC.
  earliest = Math.floor(earliest / 60_000) * 60_000
  const remainder = wallTimeInZone(earliest, tz).minute % interval
  if (remainder > 0) earliest += (interval - remainder) * 60_000

  if (close < earliest) return []

  const result: string[] = []
  let cursor = earliest
  while (cursor <= close && result.length < MAX_PICKUP_SLOTS) {
    result.push(new Date(cursor).toISOString())
    cursor += interval * 60_000
  }
  return result
}
