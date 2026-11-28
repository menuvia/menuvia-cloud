// ─────────────────────────────────────────────────────────────
// settingsForm — regulile PURE ale formularului de Setări (lotul C7c).
//
// (1) Care secțiune are câmpuri salvate cu „Salvează" (butonul de sus apare
//     DOAR acolo): pe Planul 1, „Meniu QR" are numai carduri care se salvează
//     singure (module, SMS), iar un „Salvează" care trimitea tot rândul și
//     spunea „Salvat" fără să fi salvat nimic era o minciună.
// (2) Orele și intervalele ridicării: un „9" (fără minute) ajungea în
//     `pickup_settings.open_hours`, iar `buildPickupSlots` (lib/pickupSlots.ts)
//     întorcea atunci ZERO sloturi — oaspeții nu mai puteau comanda pentru
//     ridicare, fără niciun avertisment. Intervalele de minute aruncau orice
//     tastă în afara plajei, deci câmpul nu putea fi golit sau retastat.
// (3) Schimbarea slug-ului: adresa veche /m/<slug> nu are alias (mig 096b,
//     `get_restaurant_by_slug` rezolvă doar slug-ul curent), deci QR-ul general
//     tipărit, linkurile publicate și pagina de rezervări mor imediat.
// ─────────────────────────────────────────────────────────────
import type { SettingsSection } from './dashboardNav'
import type { PlanSurface } from './planSurface'

export interface MinutesRange {
  readonly min: number
  readonly max: number
}

/** Pregătirea minimă a unei ridicări (minute) — plaja de dinainte a câmpului. */
export const PICKUP_LEAD_RANGE: MinutesRange = { min: 5, max: 240 }
/** Intervalul dintre sloturile de ridicare (minute). */
export const PICKUP_SLOT_RANGE: MinutesRange = { min: 5, max: 60 }

// HH:MM (00:00–23:59); secundele opționale sunt ce poate întoarce un
// <input type="time"> cu `step` — `buildPickupSlots` citește doar ora și minutul.
const PICKUP_TIME = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/

/** O oră de ridicare pe care `buildPickupSlots` o poate citi. */
export function isPickupTime(value: unknown): value is string {
  return typeof value === 'string' && PICKUP_TIME.test(value)
}

/** Numărul întreg de minute din câmp, DOAR dacă e în plajă; altfel `null`. */
export function parseMinutes(raw: string, range: MinutesRange): number | null {
  const s = raw.trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return n >= range.min && n <= range.max ? n : null
}

/**
 * La ieșirea din câmp: un număr întreg în afara plajei se aduce la capătul ei
 * (300 → 240, 4 → 5); un câmp gol sau ne-numeric rămâne `null` — atunci câmpul
 * arată eroarea, nu ghicește o valoare.
 */
export function clampMinutes(raw: string, range: MinutesRange): number | null {
  const s = raw.trim()
  if (!/^\d+$/.test(s)) return null
  return Math.min(range.max, Math.max(range.min, Number(s)))
}

/**
 * Secțiunea randează cel puțin un card salvat cu „Salvează" (formularul
 * paginii). Restaurant și Aspect meniu sunt numai formular; Abonament & cont
 * are doar acțiuni cu salvare proprie; „Comenzi & plăți" are formular DOAR cu
 * ridicarea (`pickup`) sau cu comenzile (`ordering`: sugestiile la coș și
 * programul de fidelizare) — pe Planul 1 și pe planul NECUNOSCUT rămân numai
 * cardurile care se salvează singure (module, SMS).
 */
export function sectionHasFormFields(
  section: SettingsSection,
  surface: PlanSurface | null,
): boolean {
  switch (section) {
    case 'restaurant':
    case 'menu':
      return true
    case 'orders':
      return surface?.pickup === true || surface?.ordering === true
    case 'account':
      return false
  }
}

/**
 * Schimbarea slug-ului cere confirmare doar când există o adresă VECHE care
 * moare: un restaurant fără slug salvat n-are încă linkuri de pierdut.
 */
export function slugChangeNeedsConfirm(
  saved: string | null | undefined,
  next: string | null | undefined,
): boolean {
  const before = (saved ?? '').trim()
  const after = (next ?? '').trim()
  return before !== '' && after !== '' && after !== before
}
