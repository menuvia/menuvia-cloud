// ─────────────────────────────────────────────────────────────
// pickupSlots — construirea sloturilor de ridicare (pickup)
//
// Helper PUR (primește `now` ca parametru → testabil determinist), extras
// din PickupCheckoutSheet. Suportă programul peste miezul nopții cu aceeași
// doctrină ca rezervările (mig 201/241): când `end <= start`, fereastra
// validă e [start, 24:00) ∪ [00:00, end) — un food truck 18:00–02:00 oferă
// sloturi toată seara ȘI după miezul nopții, nu „închis" toată ziua.
// ─────────────────────────────────────────────────────────────

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
 * deschidere) până la închidere. Listă goală = restaurantul e închis (sau
 * setările sunt invalide).
 */
export function buildPickupSlots(
  settings: PickupSlotSettings | null | undefined,
  now: Date = new Date(),
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

  const open = new Date(now)
  open.setHours(openH, openM, 0, 0)
  const close = new Date(now)
  close.setHours(closeH, closeM, 0, 0)

  // Program peste miezul nopții (end <= start, doctrina mig 201): fereastra de
  // azi se întinde până MÂINE la ora de închidere; iar dacă suntem deja în
  // segmentul de după miezul nopții (now < close), deschiderea relevantă a
  // fost IERI — o mutăm în trecut ca să nu împingă sloturile spre diseară.
  if (close.getTime() <= open.getTime()) {
    if (now.getTime() < close.getTime()) {
      open.setDate(open.getDate() - 1)
    } else {
      close.setDate(close.getDate() + 1)
    }
  }

  const earliest = new Date(now.getTime() + lead * 60_000)
  if (earliest.getTime() < open.getTime()) {
    earliest.setTime(open.getTime())
  }

  // Aliniere în sus la grila de interval (ex. :07 cu interval 15 → :15).
  const min = earliest.getMinutes()
  const remainder = min % interval
  if (remainder > 0) earliest.setMinutes(min + (interval - remainder))
  earliest.setSeconds(0)
  earliest.setMilliseconds(0)

  if (close.getTime() < earliest.getTime()) return []

  const result: string[] = []
  let cursor = new Date(earliest)
  while (cursor.getTime() <= close.getTime() && result.length < MAX_PICKUP_SLOTS) {
    result.push(cursor.toISOString())
    cursor = new Date(cursor.getTime() + interval * 60_000)
  }
  return result
}
