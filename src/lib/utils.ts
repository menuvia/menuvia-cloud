// ─────────────────────────────────────────────────────────────
// Shared utilities — used across KitchenPage, WaiterPage, etc.
// ─────────────────────────────────────────────────────────────
import { D } from './constants'

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

/** Play a short notification beep via Web Audio API */
export function playSound(hz: number, ms: number): void {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = hz
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000)
    osc.start()
    osc.stop(ctx.currentTime + ms / 1000)
  } catch {
    /* AudioContext unavailable */
  }
}
