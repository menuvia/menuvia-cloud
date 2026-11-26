// =============================================================
// Menuvia — src/lib/bridgeSetup.ts
// Ce primește patronul după „Înregistrează" în fila Bridge (C7a): linkul de
// descărcare al programului și un config.json gata făcut, ca instalarea să nu
// mai ceară nimic tastat. Înainte, fereastra arăta doar cheia, iar wizardul
// `--setup` cerea și „Supabase anon key", o valoare pe care panoul nu o
// afișa nicăieri — un drum fără ieșire chiar la primul pas.
// =============================================================
import { BRIDGE_DOWNLOAD_URL_RAW, SUPABASE_ANON_KEY, SUPABASE_URL } from './publicEnv'

/**
 * Linkul installer-ului, din `VITE_BRIDGE_DOWNLOAD_URL` (artefactul
 * workflow-ului `bridge-release.yml`, găzduit de fondator). Doar `https://`
 * absolut; orice altceva (gol, http, relativ, `javascript:`) = `null`, iar
 * butonul NU apare — niciodată un link mort sau unul care pleacă din pagină
 * spre altceva decât un fișier. NU se scrie un domeniu Menuvia de rezervă:
 * menuvia.ro nu e cumpărat, iar o rută /download nu există (clichetul DR1).
 */
export function bridgeDownloadUrl(raw: string | undefined | null): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/** Valoarea din build (sau `null`): ce citește BridgeTab. Funcție, nu
 *  constantă, ca testele componentei s-o poată înlocui. */
export function getBridgeDownloadUrl(): string | null {
  return bridgeDownloadUrl(BRIDGE_DOWNLOAD_URL_RAW)
}

export interface BridgePublicConfig {
  supabaseUrl: string
  supabaseAnonKey: string
}

/** Adresa + cheia anon ale build-ului (publice, deja în pachet), sau `null`
 *  pe un build neconfigurat — atunci butonul config.json nu apare: un fișier
 *  cu valori goale ar pica oricum la `--check`, dar cu un mesaj mai prost. */
export function getBridgePublicConfig(): BridgePublicConfig | null {
  return SUPABASE_URL && SUPABASE_ANON_KEY
    ? { supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY }
    : null
}

export interface BridgeConfigInput extends BridgePublicConfig {
  deviceSecret: string
  /** Planul fără bon (Planul 2): PC-ul există DOAR pentru imprimanta din
   *  bucătărie — serverul are deja `prints_kitchen_receipts=true` pe device. */
  kitchenOnly: boolean
}

/**
 * config.json-ul citit de `bridge/lib/config.js` (aceleași chei). Pe Planul 2:
 *   - `kitchen.enabled: true` — fără el, un patron care accepta valorile
 *     implicite ale wizardului (tichete = „nu") primea un bridge care nu
 *     tipărea NIMIC (bucla sare tichetele fără `kitchen.enabled`);
 *   - `kitchen.mode: 'tcp'` fără `host`: IP-ul imprimantei nu-l știe panoul,
 *     deci îl cere wizardul (singura întrebare la care trebuie răspuns);
 *   - `fiscalnet.required: false` — pe PC-ul din bucătărie nu există
 *     FiscalNet, iar `--check` raporta altfel „FiscalNet UNREACHABLE" și ieșea
 *     cu eroare. Bucla fiscală NU se oprește (o trecere ulterioară pe Planul 3
 *     ar produce bonuri vizibil eșuate în fila Bridge, nu bonuri pierdute).
 */
export function buildBridgeConfig(input: BridgeConfigInput): Record<string, unknown> {
  const base: Record<string, unknown> = {
    supabaseUrl: input.supabaseUrl,
    supabaseAnonKey: input.supabaseAnonKey,
    deviceSecret: input.deviceSecret,
  }
  if (!input.kitchenOnly) return base
  return {
    ...base,
    fiscalnet: { required: false },
    kitchen: { enabled: true, mode: 'tcp' },
  }
}

export function bridgeConfigJson(input: BridgeConfigInput): string {
  return JSON.stringify(buildBridgeConfig(input), null, 2) + '\n'
}

/** Numele fișierului: exact cel căutat de bridge lângă executabil. */
export const BRIDGE_CONFIG_FILENAME = 'config.json'

/** Descarcă un fișier text generat în browser (tiparul `downloadCsv`). */
export function downloadTextFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
