// =============================================================
// Menuvia — src/lib/publicEnv.ts
// Variabilele PUBLICE de build citite O SINGURĂ dată, ca mai multe module să
// le citească la fel (stau oricum în pachetul JS al fiecărui vizitator):
//   - adresa proiectului Supabase + cheia ANON: lib/supabase.ts (clientul
//     aplicației) și lib/bridgeSetup.ts (config.json-ul dat de fila Bridge —
//     bridge-ul vorbește cu ACEEAȘI bază, prin RPC-urile bridge_* deschise
//     pentru anon și păzite de device_secret);
//   - linkul installer-ului Menuvia Bridge: lib/bridgeSetup.ts (validat acolo).
// Fără importuri: testele care mock-uiesc lib/supabase nu-l ating.
// =============================================================

export function isValidSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const env = import.meta.env
const rawSupabaseUrl = String(env.VITE_SUPABASE_URL ?? '').trim()
const rawSupabaseKey = String(env.VITE_SUPABASE_ANON_KEY ?? '').trim()

/** `''` când lipsește sau nu e un URL http(s) valid. */
export const SUPABASE_URL: string = isValidSupabaseUrl(rawSupabaseUrl) ? rawSupabaseUrl : ''
/** `''` când lipsește. */
export const SUPABASE_ANON_KEY: string = rawSupabaseKey
/** `VITE_BRIDGE_DOWNLOAD_URL` brut (`''` când lipsește); validarea (doar
 *  `https://`) e în `bridgeDownloadUrl` din lib/bridgeSetup.ts. */
export const BRIDGE_DOWNLOAD_URL_RAW: string = String(env.VITE_BRIDGE_DOWNLOAD_URL ?? '')
