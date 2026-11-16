// reservationSlots — sloturile rezervării publice, în fusul LOCALULUI (lotul G2c).
//
// Pur și testabil cu instante fixe (ca lib/pickupSlots.ts): ReservationSheet îl
// cheamă cu `Date.now()` și cu fusul din proiecția publică.
//
// Paritatea cu serverul (`create_reservation_public`, mig 298, cu ziua de
// serviciu din 241 și fereastra peste miezul nopții din 201) e scopul fișierului:
// clientul oferă doar sloturi pe care serverul le acceptă (min/max, open_days,
// fereastra); golul de primăvară e filtrat SUPLIMENTAR în client.
//   * min / max se judecă pe INSTANT: serverul respinge `p_starts_at < now() +
//     min_advance_hours` și `p_starts_at > now() + max_advance_days zile`; pe
//     sesiunea Supabase (UTC, verificat în 272) „N days" = N × 24 h. Pe o sesiune
//     cu ore de vară, `now() + interval 'N days'` ar diferi cu ±1 h — paritatea
//     ține doar cât sesiunea rămâne pe UTC.
//   * `open_days` se judecă pe ziua de SERVICIU: pe un program peste miezul
//     nopții, serverul ia ziua PRECEDENTĂ pentru banda [00:00, close). Sloturile
//     unei date alese D sunt fie în [open, 24:00) din D, fie în [00:00, close)
//     din D+1 — deci ziua de serviciu a TUTUROR e chiar D.
//   * Ora de perete devine instant prin `zonedWallToInstant` în fusul validat
//     (fus invalid → București, ca `safe_time_zone`); vechiul truc cu
//     `toLocaleString` cădea pe UTC brut la un fus invalid.
//   * O oră din golul de primăvară (03:00/03:30 la București pe 29 martie) nu
//     există pe ceas: nu se oferă (instantul ei s-ar afișa altfel decât
//     eticheta). Filtru DOAR în client — serverul nu verifică golul și ar
//     accepta instantul (ora de perete următoare).
import { addDaysYmd, formatTimeInZone, safeTimeZone, toZonedYMD, zonedWallToInstant } from './dates'

export interface ReservationSlotSettings {
  open_days: number[]
  open_time: string
  close_time: string
  slot_interval: number
  min_advance_hours: number
  max_advance_days: number
}

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// „HH:MM" sau „HH:MM:SS" (coloana `time` din Postgres) → minutele zilei.
function minutesOfDay(hhmm: string): number {
  const parts = hhmm.split(':')
  const h = Number(parts[0] ?? 0)
  const m = Number(parts[1] ?? 0)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

function parseYmd(ymd: string): [number, number, number] | null {
  const m = YMD_RE.exec(ymd)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/**
 * Data reală a unui slot. Pe un program PESTE miezul nopții (close <= open),
 * sloturile cu ora sub ora de deschidere aparțin zilei următoare (program
 * 18:00–02:00: slotul „01:00" ales pe D e la 01:00 pe D+1).
 */
export function effectiveSlotYmd(
  dateYmd: string,
  timeSlot: string,
  s: Pick<ReservationSlotSettings, 'open_time' | 'close_time'>,
): string {
  const openMin = minutesOfDay(s.open_time)
  const closeMin = minutesOfDay(s.close_time)
  if (closeMin <= openMin && minutesOfDay(timeSlot) < openMin) return addDaysYmd(dateYmd, 1)
  return dateYmd
}

/** Ziua ISO a săptămânii (1 = luni … 7 = duminică, ca `extract(isodow)`) a unei
 *  date `YYYY-MM-DD`, fără niciun fus. Șir care nu e dată → null. */
export function isoDowOfYmd(ymd: string): number | null {
  const p = parseYmd(ymd)
  if (!p) return null
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()
  return d === 0 ? 7 : d
}

/** Instantul ISO (UTC) al slotului `hhmm` ales pe data `dateYmd`, interpretat în
 *  fusul LOCALULUI. Date/oră neparsabile → null. */
export function reservationSlotInstantIso(
  dateYmd: string,
  hhmm: string,
  s: Pick<ReservationSlotSettings, 'open_time' | 'close_time'>,
  timeZone: string | null | undefined,
): string | null {
  const p = parseYmd(effectiveSlotYmd(dateYmd, hhmm, s))
  const parts = hhmm.split(':')
  const h = Number(parts[0])
  const mi = Number(parts[1])
  if (!p || !Number.isFinite(h) || !Number.isFinite(mi)) return null
  const t = zonedWallToInstant(p[0], p[1], p[2], h, mi, safeTimeZone(timeZone))
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/**
 * Sloturile (ore de perete „HH:MM") oferite pe data `dateYmd`, la momentul
 * `nowMs`, în fusul localului — doar sloturi pe care serverul le acceptă, minus
 * golul de primăvară (vezi antetul). Zi închisă / dată lipsă / interval invalid → [].
 */
export function buildReservationSlots(
  dateYmd: string,
  s: ReservationSlotSettings,
  nowMs: number,
  timeZone: string | null | undefined,
): string[] {
  if (!dateYmd || !(s.slot_interval > 0)) return []
  const dow = isoDowOfYmd(dateYmd)
  if (dow == null || !Array.isArray(s.open_days) || !s.open_days.includes(dow)) return []

  const tz = safeTimeZone(timeZone)
  const minEpoch = nowMs + s.min_advance_hours * HOUR_MS
  const maxEpoch = nowMs + s.max_advance_days * DAY_MS
  const openMin = minutesOfDay(s.open_time)
  const closeMin = minutesOfDay(s.close_time)
  // Peste miezul nopții (close <= open): iterăm până la close + 24 h și etichetăm
  // sloturile de după miezul nopții cu ora de perete (mins % 1440).
  const endMin = closeMin <= openMin ? closeMin + 24 * 60 : closeMin
  const slots: string[] = []
  for (let mins = openMin; mins < endMin; mins += s.slot_interval) {
    const wall = mins % (24 * 60)
    const label = pad2(Math.floor(wall / 60)) + ':' + pad2(wall % 60)
    const iso = reservationSlotInstantIso(dateYmd, label, s, tz)
    if (iso == null) continue
    const epoch = Date.parse(iso)
    if (epoch < minEpoch || epoch > maxEpoch) continue
    // Golul de primăvară: ora nu există pe ceasul localului.
    if (formatTimeInZone(iso, tz) !== label) continue
    slots.push(label)
  }
  return slots
}

/**
 * „Azi", „Mâine" și ultima zi rezervabilă, pe ziua LOCALULUI: `max` e ziua
 * locală a instantului pe care îl compară serverul (`now + N × 24 h`).
 */
export function reservationDayBounds(
  nowMs: number,
  maxAdvanceDays: number,
  timeZone: string | null | undefined,
): { today: string; tomorrow: string; max: string } {
  const tz = safeTimeZone(timeZone)
  const today = toZonedYMD(new Date(nowMs), tz)
  return {
    today,
    tomorrow: addDaysYmd(today, 1),
    max: toZonedYMD(new Date(nowMs + maxAdvanceDays * DAY_MS), tz),
  }
}
