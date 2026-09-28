// ─────────────────────────────────────────────────────────────
// dates — granițe de zi în fusul României, DST-aware.
// ─────────────────────────────────────────────────────────────
// Sursă unică pentru „ziua de azi" a restaurantelor (EET +02:00 iarna /
// EEST +03:00 vara). Hardcodarea lui +03:00 muta granița cu o oră iarna,
// iar folosirea datei UTC punea „azi" pe ziua greșită lângă miezul nopții.
// Extras din ReportsTab (unde a fost reparat prima dată) ca HomeTab și alți
// consumatori să nu mai reimplementeze greșit.

// Instantul ISO (UTC) al începutului/sfârșitului zilei calendaristice `ymd`
// în fusul Europe/Bucharest, indiferent de sezon ȘI de fusul GAZDEI.
//
// Varianta veche parsa cu `new Date(toLocaleString(...))`, adică în fusul
// gazdei: corectă pe UTC și pe Europe/Bucharest, dar pe o gazdă cu propria
// tranziție DST aproape de a României (Europe/London) dădea 29 mar →
// 23:00Z și 25 oct → 20:00Z, cu o oră greșit (recenzie CodeRabbit pe #276).
// Acum offset-ul se citește din părțile formatate în Europe/Bucharest,
// comparate cu instantul însuși — nimic nu mai trece prin fusul gazdei.
// Al doilea pas re-evaluează offset-ul la instantul CORECTAT: la 25 oct,
// 00:00 local e încă EEST (+3), dar „ghicitul" 00:00Z e deja după tranziție.
const BUC_WALL_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Bucharest',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

// Offset-ul Europe/Bucharest (ms, +7200000 iarna / +10800000 vara) la instantul t.
function bucharestOffsetMs(t: number): number {
  const parts = BUC_WALL_FMT.formatToParts(new Date(t))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wall - Math.floor(t / 1000) * 1000
}

export function romaniaDayBoundaryISO(ymd: string, endOfDay: boolean): string {
  const [y, mo, d] = ymd.split('-').map(Number)
  const h = endOfDay ? 23 : 0
  const mi = endOfDay ? 59 : 0
  const s = endOfDay ? 59 : 0
  const ms = endOfDay ? 999 : 0
  const guess = Date.UTC(y!, mo! - 1, d!, h, mi, s, ms)
  const offsetMs = bucharestOffsetMs(guess - bucharestOffsetMs(guess))
  return new Date(guess - offsetMs).toISOString()
}

// Un singur formatter la nivel de modul: `toRomaniaYMD` rulează acum PER RÂND
// (BridgeTab: până la 100 de bonuri, la fiecare randare și la poll-ul de 15 s),
// iar construcția unui Intl.DateTimeFormat e partea scumpă — același motiv ca
// DAY_FMT din ReportsTab. Ieșirea e identică.
const RO_YMD_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Bucharest',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// Data calendaristică (YYYY-MM-DD) a unui instant ÎN fusul României.
export function toRomaniaYMD(d: Date): string {
  const parts = RO_YMD_FMT.formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

// Ziua României a unui timestamp venit de la server. PostgREST întoarce
// `timestamptz` în UTC (`2026-09-04T21:30:00+00:00` — TimeZone-ul sesiunii pe
// Supabase e UTC, mig 272), deci PREFIXUL șirului e ziua UTC: între 00:00 și
// 02:00 (iarna) / 03:00 (vara), ora României, el arată încă ziua de IERI. O zi
// românească se compară cu instantul CONVERTIT, niciodată cu prefixul șirului
// (clichet: src/lib/__tests__/utcDayPrefix.test.ts). Șir neparsabil → null, nu
// excepție: `formatToParts` pe un Invalid Date aruncă RangeError, iar apelantul
// e o randare.
export function isoToRomaniaYMD(iso: string): string | null {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : toRomaniaYMD(new Date(t))
}
