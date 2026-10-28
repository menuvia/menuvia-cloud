// ─────────────────────────────────────────────────────────────
// receiptStats — contoarele „azi" din BridgeTab, în ziua României.
// ─────────────────────────────────────────────────────────────
// Pur (fără supabase), ca testul să nu fie nevoit să randeze BridgeTab.
//
// Defectul reparat: „azi" se calcula în ora României, dar `created_at` se
// compara ca PREFIX de șir — iar PostgREST întoarce timestamptz în UTC
// (TimeZone-ul sesiunii pe Supabase e UTC, mig 272). Un bon emis între 00:00 și
// 02:00 (iarna) / 03:00 (vara) are prefixul zilei PRECEDENTE, deci nu intra în
// „azi" în NICIO zi — tocmai orele de vârf ale unui bar. Înainte de jumătatea
// de reparație din iulie 2026 (425787f) ambele părți erau UTC: fereastră
// decalată, dar coerentă; reparația doar pe o parte a transformat decalajul în
// pierdere.
import { isoToRomaniaYMD, toRomaniaYMD } from './dates'

export type ReceiptStatus = 'pending' | 'sent' | 'success' | 'error' | 'cancelled'

export interface ReceiptDayStats {
  /** pending + sent — încă netipărite. */
  pending: number
  /** success — tipărite. */
  success: number
  /** error — eșuate (cancelled nu se numără nicăieri). */
  errors: number
}

export function receiptStatsForRomaniaDay(
  receipts: ReadonlyArray<{ status: ReceiptStatus; created_at: string }>,
  now: Date,
): ReceiptDayStats {
  const today = toRomaniaYMD(now)
  const stats: ReceiptDayStats = { pending: 0, success: 0, errors: 0 }
  for (const r of receipts) {
    if (isoToRomaniaYMD(r.created_at) !== today) continue
    if (r.status === 'pending' || r.status === 'sent') stats.pending += 1
    else if (r.status === 'success') stats.success += 1
    else if (r.status === 'error') stats.errors += 1
  }
  return stats
}
