// ─────────────────────────────────────────────────────────────
// Shared utilities — used across KitchenPage, WaiterPage, etc.
// ─────────────────────────────────────────────────────────────
import { D } from './constants'
import { staffAudio } from './staffAudio'

/** Human-readable elapsed time since `createdAt` ISO string */
export function elapsed(createdAt: string): string {
  const sec = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  return `${Math.floor(min / 60)}h ${min % 60}m`
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
