// netlify/functions/lib/emailFormat.js
// Datele, orele și banii din emailuri (lotul L8a). Fusul și momentul vin
// DIN CONTEXT, niciodată din gazdă: Netlify rulează pe UTC, iar vechii
// helperi care se bazau pe calendarul gazdei arătau „8 nov.” în loc de „9 nov.”
// (perioada raportului săptămânal), ziua precedentă pe o gazdă la vest de UTC
// (raportul zilnic) și „astăzi” în loc de „mâine” (subiectul reminderului).
//
// Pe ctx-ul românesc (ro-RO / București) ieșirea e BYTE-identică cu vechii
// helperi rulați pe o gazdă din București — oracolul EO1 o îngheață.
'use strict'

const { DEFAULT_TZ, LOCALES, safeTimeZone } = require('./emailLang')

const RO_CTX = Object.freeze({ lang: 'ro', locale: 'ro-RO', timeZone: DEFAULT_TZ, now: null })

function makeCtx({ lang = 'ro', locale, timeZone, now = null } = {}) {
  const l = LOCALES[lang] ? lang : 'ro'
  return Object.freeze({
    lang: l,
    locale: typeof locale === 'string' && locale ? locale : LOCALES[l],
    timeZone: safeTimeZone(timeZone),
    now: Number.isFinite(now) ? now : null,
  })
}

function nowMs(ctx) {
  return ctx && Number.isFinite(ctx.now) ? ctx.now : Date.now()
}

/** „marți, 17 noiembrie · 00:30” în fusul și limba contextului; gol → ''. */
function dateTimeLong(iso, ctx = RO_CTX) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const date = d.toLocaleDateString(ctx.locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: ctx.timeZone,
    })
    const time = d.toLocaleTimeString(ctx.locale, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: ctx.timeZone,
    })
    return `${date} · ${time}`
  } catch {
    return String(iso)
  }
}

/** Ziua calendaristică (YYYY-MM-DD) a instantului `ms` în fusul `tz`. */
function zonedYmd(ms, tz) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms)
}

function ymdDayIndex(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86400000)
}

/**
 * Ziua rezervării față de momentul trimiterii, ambele pe FUSUL LOCALULUI:
 * `{kind:'today'}` (azi sau deja trecut, ca vechiul cod), `{kind:'tomorrow'}`,
 * `{kind:'date', date}` sau `{kind:'none'}` (lipsă/invalid).
 */
function relativeDay(iso, ctx = RO_CTX) {
  if (!iso) return { kind: 'none' }
  try {
    const t = new Date(iso).getTime()
    const days = ymdDayIndex(zonedYmd(t, ctx.timeZone)) - ymdDayIndex(zonedYmd(nowMs(ctx), ctx.timeZone))
    if (!Number.isFinite(days)) return { kind: 'none' }
    if (days <= 0) return { kind: 'today' }
    if (days === 1) return { kind: 'tomorrow' }
    return {
      kind: 'date',
      date: new Date(t).toLocaleDateString(ctx.locale, { day: 'numeric', month: 'long', timeZone: ctx.timeZone }),
    }
  } catch {
    return { kind: 'none' }
  }
}

/**
 * O DATĂ calendaristică ('2026-11-15', `day` din compute_daily_report): fără
 * fus — se citește ca miezul nopții UTC și se formatează pe UTC, deci aceeași
 * zi pe orice gazdă. Gol → ''.
 */
function calendarDay(ymd, ctx = RO_CTX) {
  if (!ymd) return ''
  try {
    return new Date(ymd).toLocaleDateString(ctx.locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    })
  } catch {
    return String(ymd)
  }
}

/** Intervalul [start, end) ca „9 nov. – 15 nov.” pe fusul contextului. */
function periodShort(start, end, ctx = RO_CTX) {
  try {
    const s = new Date(start)
    const e = new Date(end)
    const fmt = (d) => d.toLocaleDateString(ctx.locale, { day: 'numeric', month: 'short', timeZone: ctx.timeZone })
    return `${fmt(s)} – ${fmt(new Date(e.getTime() - 1))}`
  } catch {
    return ''
  }
}

/** Suma în lei: româna EXACT ca vechiul `formatLei`; altfel moneda RON în limba contextului. */
function lei(n, ctx = RO_CTX) {
  if (n == null) return '—'
  const ro = () =>
    new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' lei'
  if (ctx.lang === 'ro') return ro()
  try {
    return new Intl.NumberFormat(ctx.locale, { style: 'currency', currency: 'RON' }).format(n)
  } catch {
    return ro()
  }
}

/**
 * Subiectele românești vechi puneau suma NEFORMATATĂ (`${d.revenue || 0} lei`)
 * — înghețată de oracol pe română; în celelalte limbi suma se formatează.
 */
function legacyLeiRaw(n, ctx = RO_CTX) {
  if (ctx.lang === 'ro') return `${n || 0} lei`
  return lei(n || 0, ctx)
}

/**
 * Valoarea absolută a unui procent de evoluție, fără semnul „%” (șabloanele îl
 * pun). Româna rămâne EXACT `${Math.abs(n)}` (oracolul EO1 — „23.5”); celelalte
 * limbi folosesc separatorul zecimal al limbii („23,5” în fr/de).
 */
function pctAbs(n, ctx = RO_CTX) {
  const v = Math.abs(n)
  if (ctx.lang === 'ro') return `${v}`
  try {
    return new Intl.NumberFormat(ctx.locale, { maximumFractionDigits: 1 }).format(v)
  } catch {
    return `${v}`
  }
}

module.exports = {
  RO_CTX,
  makeCtx,
  dateTimeLong,
  zonedYmd,
  relativeDay,
  calendarDay,
  periodShort,
  lei,
  legacyLeiRaw,
  pctAbs,
}
