// =============================================================
// Menuvia — src/lib/bridgeStatus.ts
// Liveness-ul bridge-ului fiscal, pentru banner-ul „casa nu e conectată".
// =============================================================
import { supabase } from './supabase'

export interface BridgeConnectionStatus {
  /** Există măcar un dispozitiv înregistrat pentru restaurant. */
  registered: boolean
  /** A bătut în ultimele 3 minute (pragul e în RPC, mig 265). */
  connected: boolean
  /** Ultimul heartbeat, ISO. `null` când nu există dispozitive. */
  last_seen_at: string | null
}

/**
 * Citește starea bridge-ului pentru banner-ul de pe Acasă și Ospătar.
 *
 * Trece prin RPC-ul `bridge_connection_status` (mig 265), NU printr-un `select`
 * pe `bridge_devices`: mig 240 a șters politica de citire pentru membri (expunea
 * `device_secret` oricărui waiter), deci o interogare directă întoarce zero
 * rânduri pentru staff și ar produce un „nu e conectată" fals.
 *
 * ARUNCĂ un `Error` real pe eroare (nu obiectul Supabase brut, ca în
 * `createOrder`/`get_order_audit_history`), ca apelantul să poată distinge
 * „necunoscut" de „deconectat" — banner-ul se afișează DOAR pe `connected:false`
 * cunoscut, niciodată pe o eroare de rețea.
 */
export async function fetchBridgeConnectionStatus(
  restaurantId: string,
): Promise<BridgeConnectionStatus> {
  const { data, error } = await supabase.rpc('bridge_connection_status', {
    p_restaurant_id: restaurantId,
  })

  if (error) {
    const err = new Error(`Nu s-a putut citi starea casei de marcat: ${error.message}`)
    // Păstrăm codul pentru diagnoză (ex. PGRST202 = RPC nedeployat încă).
    ;(err as Error & { code?: string }).code = error.code
    throw err
  }
  if (data == null) {
    throw new Error('Starea casei de marcat a venit goală de la server')
  }
  return data as BridgeConnectionStatus
}
