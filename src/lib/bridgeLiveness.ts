// =============================================================
// Menuvia — src/lib/bridgeLiveness.ts
// „E pornit bridge-ul?" pentru UN dispozitiv, din `last_seen_at` — aceeași
// regulă ca `bridge_connection_status` (mig 265, banner-ul de pe Acasă și
// Ospătar, lib/bridgeStatus.ts). Modul FĂRĂ importuri: îl citesc BridgeTab și
// testele, fără să tragă după el clientul Supabase.
//
// `bridge_devices.status` NU e un semnal de viață: e un flag LIPICIOS — toate
// scrierile îl duc pe `online` (heartbeat, validate, get_pending) și nimic nu-l
// readuce pe `offline` (singura funcție care ar fi făcut-o, mig 035, scria
// într-o coloană inexistentă). Pe el, fila Bridge arăta „● Online" lângă
// „Ultim semnal 3 zile", exact pe ecranul pe care patronul îl deschide ca să
// afle de ce Acasă spune „casa nu e conectată".
// =============================================================

/** Pragul de viață, identic cu `interval '3 minutes'` din mig 265 (6 bătăi
 *  ratate la heartbeat-ul de 30 s al bridge-ului). Schimbi unul, îl schimbi și
 *  pe celălalt — altfel banner-ul și fila spun lucruri diferite. */
export const BRIDGE_LIVENESS_MS = 3 * 60_000

/**
 * `true` = dispozitivul a bătut în ultimele 3 minute. `null`, o dată
 * nevalidă sau mai veche decât pragul = oprit. O dată din VIITOR (ceasul
 * PC-ului cu browserul rămas în urmă față de server) contează ca viu: e
 * proaspătă, iar serverul o compară cu propriul ceas, la fel.
 */
export function isBridgeDeviceLive(lastSeenAt: string | null | undefined, nowMs: number): boolean {
  if (!lastSeenAt) return false
  const t = Date.parse(lastSeenAt)
  if (!Number.isFinite(t)) return false
  return nowMs - t < BRIDGE_LIVENESS_MS
}
