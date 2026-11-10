// ─────────────────────────────────────────────────────────────
// Shared utilities — used across KitchenPage, WaiterPage, etc.
// ─────────────────────────────────────────────────────────────
import { D } from './constants'
import { staffAudio } from './staffAudio'

/** Vârsta de la `createdAt` (ISO) despărțită pe unități — sursa unică a
 *  calculului, citită de `elapsedT` (src/i18n/elapsed.ts, lotul L4b), care
 *  pune unitățile în limba personalului. Varianta românească scrisă în cod,
 *  `elapsed()`, a fost ștearsă în L4c (Bucătăria era ultimul consumator). */
export type ElapsedParts =
  | { unit: 's'; n: number }
  | { unit: 'm'; n: number }
  | { unit: 'hm'; h: number; m: number }

export function elapsedParts(createdAt: string): ElapsedParts {
  const sec = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
  if (sec < 60) return { unit: 's', n: sec }
  const min = Math.floor(sec / 60)
  if (min < 60) return { unit: 'm', n: min }
  return { unit: 'hm', h: Math.floor(min / 60), m: min % 60 }
}

/** Color based on order age: green → amber → red */
export function urgencyColor(createdAt: string): string {
  const min = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000)
  if (min >= 20) return D.red
  if (min >= 10) return D.amber
  return D.t3
}

/**
 * Beep scurt de notificare (comandă nouă / gata / apel). Contextul audio e
 * UNIC pe pagină și se deblochează la primul gest — vezi lib/staffAudio.ts
 * (sunetul era mut pe KDS până la o atingere, iar pe iPhone/iPad pentru totdeauna).
 */
export function playSound(hz: number, ms: number): void {
  staffAudio.beep(hz, ms)
}
