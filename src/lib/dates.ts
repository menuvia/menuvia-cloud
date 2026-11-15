// ─────────────────────────────────────────────────────────────
// dates — granițe de zi în fusul României ȘI în fusul unui local, DST-aware.
// ─────────────────────────────────────────────────────────────
// Sursă unică pentru „ziua de azi" a restaurantelor. Hardcodarea lui +03:00
// muta granița cu o oră iarna, iar folosirea datei UTC punea „azi" pe ziua
// greșită lângă miezul nopții. Extras din ReportsTab (unde a fost reparat prima
// dată) ca HomeTab și alți consumatori să nu mai reimplementeze greșit.
//
// Două familii (lotul G2b):
//  - variantele `romania*` (ziua ROMÂNEASCĂ): suprafețele fiscale / doar-România
//    (bonuri, TVA, `v_daily_orders`) — rămân pe București DELIBERAT;
//  - variantele generice (`toZonedYMD`, `zonedDayRange`, …) cu fusul ca
//    parametru, alimentate de cele DOUĂ reguli de la finalul fișierului:
//    `reportTimeZone` (ziua de raportare) și `restaurantTimeZone` (operațional).
// Clichetul `dayZoneScope.test.ts` (ZT1–ZT4) ține API-ul românesc, fusul fix și
// calendarul dispozitivului în registrul lui, cu motiv.

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

// ─────────────────────────────────────────────────────────────
// Ora de PERETE într-un fus arbitrar (pickup: sloturi + afișare).
// ─────────────────────────────────────────────────────────────
// Fusul implicit al platformei: fus lipsă sau invalid → acesta (aceeași regulă
// ca `safe_time_zone`, mig 298, și `report_time_zone`, mig 325). Panoul citește
// `restaurants.timezone` prin `reportTimeZone`/`restaurantTimeZone` (lotul G2b);
// paginile de ospătar/bucătărie și fluxul oaspetelui încă nu (G2c), deci acolo
// default-ul e ce se afișează — aceeași valoare ca în `lib/qr.ts` (isOpenNow).
export const DEFAULT_RESTAURANT_TZ = 'Europe/Bucharest'

// Formatter-ele Intl sunt scumpe — unul per fus, refolosit.
const WALL_FMT_CACHE = new Map<string, Intl.DateTimeFormat>()

function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = WALL_FMT_CACHE.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    WALL_FMT_CACHE.set(timeZone, f)
  }
  return f
}

// Un fus invalid (coloană editată greșit, gunoi) face ca Intl să ARUNCE
// RangeError — iar apelantul e o randare (meniul public, cardul din Bucătărie).
// Fail-safe pe fusul implicit, nu ecran de eroare.
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_RESTAURANT_TZ
  try {
    wallFormatter(tz)
    return tz
  } catch {
    return DEFAULT_RESTAURANT_TZ
  }
}

export interface WallTime {
  year: number
  month: number // 1–12
  day: number
  hour: number
  minute: number
  second: number
}

// Părțile de perete ale instantului `t` (ms) în fusul `timeZone`.
export function wallTimeInZone(t: number, timeZone: string): WallTime {
  const parts = wallFormatter(timeZone).formatToParts(new Date(t))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

// Offset-ul fusului (ms) la instantul t — generalizarea lui bucharestOffsetMs.
function zoneOffsetMs(t: number, timeZone: string): number {
  const w = wallTimeInZone(t, timeZone)
  const wall = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return wall - Math.floor(t / 1000) * 1000
}

// Instantul (ms) al orei de perete (y, m, d, h, mi) în `timeZone`. Valorile
// în afara intervalului se normalizează ca la Date.UTC (ziua 0, ora 24 etc.).
// Doi pași, ca romaniaDayBoundaryISO: offset-ul se re-evaluează la instantul
// corectat, altfel lângă o tranziție DST rezultatul ar fi cu o oră greșit.
export function zonedWallToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  const offset = zoneOffsetMs(guess - zoneOffsetMs(guess, timeZone), timeZone)
  return guess - offset
}

// „HH:mm" (24h) al unui instant ÎN fusul restaurantului — nu al telefonului.
// `toLocaleTimeString` fără `timeZone` afișa ora în fusul BROWSERULUI: un turist
// cu telefonul pe alt fus vedea alt „Vino la" decât ora reală a localului.
// Șir neparsabil → '' (apelantul e o randare).
export function formatTimeInZone(
  iso: string | null | undefined,
  timeZone: string = DEFAULT_RESTAURANT_TZ,
): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const w = wallTimeInZone(t, safeTimeZone(timeZone))
  return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`
}

// Intervalul [00:00:00.000, 23:59:59.999] al zilei românești `ymd`, ca instante
// ISO (UTC) — pentru interogări „azi" (`.gte(from).lte(to)`). Aceeași
// convenție ca ReportsTab/HomeTab: capetele vin din `romaniaDayBoundaryISO`,
// deci sunt corecte pe DST și independente de fusul gazdei.
export function romaniaDayRange(ymd: string): { from: string; to: string } {
  return { from: romaniaDayBoundaryISO(ymd, false), to: romaniaDayBoundaryISO(ymd, true) }
}

// ─────────────────────────────────────────────────────────────
// Granițe de zi într-un fus ARBITRAR (lotul G2b) + cele două reguli de fus.
// ─────────────────────────────────────────────────────────────

/** Câmpurile regionale ale unui restaurant (din `restaurants`, mig 049/296). */
export interface RegionalFields {
  country?: string | null
  timezone?: string | null
}

/**
 * Fusul OPERAȚIONAL al localului — rezervări, harta meselor: fusul lui, oricare
 * ar fi țara (fus lipsă sau invalid → implicitul platformei). Oglinda SQL
 * `restaurant_time_zone` (mig 324) și a validării din `create_reservation_public`
 * (mig 298): ziua în care serverul a validat rezervarea.
 */
export function restaurantTimeZone(r: RegionalFields | null | undefined): string {
  return safeTimeZone(r?.timezone)
}

/**
 * Fusul ZILEI DE RAPORTARE — Acasă, Rapoarte, Toate locațiile, data NIR. Țara
 * România (sau NECUNOSCUTĂ: bază fără mig 296, restaurant încă neîncărcat) →
 * București, fiindcă banii de pe Planul 3 stau pe ziua românească a încasării
 * (mig 267/268/272) și un ecran nu are voie să aibă două definiții de „azi";
 * altfel fusul localului. Regula e pe ȚARĂ (o schimbă doar owner-ul/fondatorul,
 * mig 296), nu pe plan (ar comuta la downgrade) și nu pe fus (îl scrie orice
 * admin). Oglinda SQL `report_time_zone` (mig 325).
 */
export function reportTimeZone(r: RegionalFields | null | undefined): string {
  if (!r || !r.country || r.country === 'RO') return DEFAULT_RESTAURANT_TZ
  return safeTimeZone(r.timezone)
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseYmd(ymd: string): [number, number, number] | null {
  const m = YMD_RE.exec(ymd)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Data calendaristică (YYYY-MM-DD) a unui instant în fusul dat (fus invalid →
 *  implicitul platformei, nu RangeError într-o randare). */
export function toZonedYMD(d: Date, timeZone: string): string {
  const w = wallTimeInZone(d.getTime(), safeTimeZone(timeZone))
  return `${w.year}-${pad2(w.month)}-${pad2(w.day)}`
}

/** Ziua (în fusul dat) a unui timestamp de la server — instantul CONVERTIT,
 *  niciodată prefixul UTC al șirului. Șir neparsabil → null, ca `isoToRomaniaYMD`. */
export function isoToZonedYMD(iso: string, timeZone: string): string | null {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : toZonedYMD(new Date(t), timeZone)
}

/** `ymd` ± `n` zile calendaristice, pe ȘIR (fără niciun fus: aritmetica pe
 *  `Date.UTC` nu trece prin ore, deci nici prin zilele de 23/25 h). */
export function addDaysYmd(ymd: string, n: number): string {
  const p = parseYmd(ymd)
  if (!p) return ymd
  const t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n))
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

/**
 * Instantul (ms) al începutului zilei `ymd` în fusul dat. NU e
 * `zonedWallToInstant(y, m, d, 0, 0)` într-un pas: pe un fus cu tranziția LA
 * miezul nopții (America/Havana 8 mar 2026, Asia/Beirut, America/Santiago) ora
 * 00:00 nu există sau apare de două ori, iar varianta într-un pas punea
 * începutul zilei în ziua PRECEDENTĂ (Havana: 04:00Z = 23:00 pe 7 martie, în loc
 * de 05:00Z). Se iau cei doi candidați de ofset și se alege cel MAI MIC care cade
 * în ziua cerută.
 */
export function zonedDayStartMs(ymd: string, timeZone: string): number {
  const tz = safeTimeZone(timeZone)
  const p = parseYmd(ymd)
  if (!p) return Number.NaN
  const guess = Date.UTC(p[0], p[1] - 1, p[2])
  const o1 = zoneOffsetMs(guess, tz)
  const o2 = zoneOffsetMs(guess - o1, tz)
  const candidates = [guess - o2, guess - o1].sort((a, b) => a - b)
  for (const c of candidates) {
    if (toZonedYMD(new Date(c), tz) === ymd) return c
  }
  return guess - o2
}

/**
 * Intervalul [00:00:00.000, 23:59:59.999] al zilei `ymd` în fusul dat, ca
 * instante ISO (UTC) — `to` = începutul zilei următoare − 1 ms (convenția D14:
 * zile consecutive nu se suprapun și nu lasă gol). Pe Europe/Bucharest dă
 * EXACT `romaniaDayRange` (DZ2), inclusiv în zilele de 23 h și 25 h.
 */
export function zonedDayRange(ymd: string, timeZone: string): { from: string; to: string } {
  const from = zonedDayStartMs(ymd, timeZone)
  const next = zonedDayStartMs(addDaysYmd(ymd, 1), timeZone)
  return { from: new Date(from).toISOString(), to: new Date(next - 1).toISOString() }
}

// Un formatter per (limbă, opțiuni) — construcția Intl e partea scumpă.
const YMD_FMT_CACHE = new Map<string, Intl.DateTimeFormat>()

/**
 * O DATĂ fără oră (`YYYY-MM-DD`, ex. coloanele `date` din DB) formatată în
 * limba dată, fără să treacă prin vreun fus: `new Date('YYYY-MM-DD')` e miezul
 * nopții UTC, iar formatat fără `timeZone` arăta ziua de DINAINTE pe un browser
 * la vest de UTC. Șir care nu e o dată → ''.
 */
export function formatYmd(ymd: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const p = parseYmd(ymd)
  if (!p) return ''
  const key = `${locale}|${JSON.stringify(options)}`
  let f = YMD_FMT_CACHE.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' })
    YMD_FMT_CACHE.set(key, f)
  }
  return f.format(Date.UTC(p[0], p[1] - 1, p[2]))
}
