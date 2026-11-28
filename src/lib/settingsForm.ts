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
//     ridicare, fără niciun avertisment. Validarea acceptă EXACT ce citește
//     `buildPickupSlots` (nu mai strict: o oră salvată care merge pentru
//     oaspeți nu are voie să blocheze „Salvează"). Intervalele de minute
//     aruncau orice tastă în afara plajei, deci câmpul nu putea fi golit sau
//     retastat.
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

// Orele de ridicare: forma pe care o poate ține câmpul VECHI (text liber —
// „9:00", „24:00", „9:5") ȘI pe care `buildPickupSlots` o citește corect.
// Ora are 1–2 cifre, minutul 1–2 cifre (`split(':')` + `Number`: „9:5" =
// 09:05), secundele sunt opționale (le poate întoarce un <input type="time">
// cu `step`; `buildPickupSlots` le ignoră). „24:00" e miezul nopții de la
// capătul zilei (Date.UTC trece ora 24 în ziua următoare, ca „00:00" pe
// ramura peste miezul nopții, mig 201). Recenzia lotului C7c: varianta strictă
// (doar HH:MM, 00–23) respingea valori salvate cu care oaspeții COMANDĂ, iar
// câmpul `type="time"` le afișa goale, cu eroare. Respinse rămân DOAR formele
// care dau ZERO sloturi („9", „9.00", „9 AM", gol) și cele fără sens.
const PICKUP_TIME = /^(\d{1,2}):(\d{1,2})(?::[0-5]\d)?$/

function parsePickupTime(value: unknown): { hour: number; minute: number } | null {
  if (typeof value !== 'string') return null
  // `Number` ignoră spațiile, deci și `buildPickupSlots` citește „ 09:00".
  const m = PICKUP_TIME.exec(value.trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (minute > 59 || hour > 24 || (hour === 24 && minute !== 0)) return null
  return { hour, minute }
}

/** O oră de ridicare pe care `buildPickupSlots` o citește (produce sloturi). */
export function isPickupTime(value: unknown): value is string {
  return parsePickupTime(value) != null
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Valoarea dată unui `<input type="time">`: acesta acceptă DOAR „HH:MM" și
 * golește orice altceva (sanitizarea browserului), deci o oră salvată „9:00"
 * apărea ca un câmp gol. Se completează cu zero („9:00" → „09:00", „9:5" →
 * „09:05"), „24:00" se arată „00:00" (aceeași fereastră pe ramura peste miezul
 * nopții), iar o oră ilizibilă dă „" — câmpul gol cu eroarea de sub el.
 * Doar afișare: formularul păstrează valoarea salvată până o schimbă omul.
 */
export function pickupTimeInputValue(value: unknown): string {
  const t = parsePickupTime(value)
  if (!t) return ''
  return `${pad2(t.hour === 24 ? 0 : t.hour)}:${pad2(t.minute)}`
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
