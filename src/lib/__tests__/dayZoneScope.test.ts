// Clichet de CLASĂ (lotul G2b): „azi” și „ziua” unui ecran de personal se
// judecă într-unul dintre cele DOUĂ fusuri ale restaurantului — ziua de
// RAPORTARE (`reportTimeZone`) sau fusul OPERAȚIONAL (`restaurantTimeZone`),
// ambele din src/lib/dates.ts — nu în fusul Bucureștiului scris de mână și nu în
// calendarul DISPOZITIVULUI. Tiparele care ocolesc regula apar DOAR în fișierele
// din registru, fiecare cu MOTIV: (b) suprafață fiscală / doar-România (ziua
// românească a încasării), (c) platformă, date de referință sau anul de
// copyright. Registrul doar SCADE: o intrare care nu mai e găsită pică (ZT3) —
// lotul G2c și-a șters cele șase intrări (paginile de personal prin
// RestaurantContext, fluxul oaspetelui) și n-a adăugat niciuna.
// ATENȚIE: potrivește și COMENTARIILE (ca utcDayPrefix.test.ts) — nu scrie
// tiparele literal în explicațiile din fișierele ne-înregistrate.
//   ZT1 anti-vacuitate: scanarea vede sursa (> 100 de fișiere) și găsește
//       locurile înregistrate (P5 nu mai are niciun loc viu — clasa e închisă;
//       controlul lui pozitiv e în ZT4).
//   ZT2 niciun loc în afara registrului.
//   ZT3 fiecare intrare din registru e încă găsită.
//   ZT4 control POZITIV/NEGATIV al fiecărui tipar pe surse sintetice — formele
//       interzise sunt prinse, cele legitime (`getUTC*`, `Date.UTC(`, `new
//       Date(iso)`, `formatYmd(`) nu.
//   ZT5 cablajul din DashboardPage, STRUCTURAL: cele două fusuri se calculează
//       din `reportTimeZone(restaurant)` / `restaurantTimeZone(restaurant)`, iar
//       Acasă, Rapoarte și Stocuri primesc `timeZone={reportTz}`, Rezervări și
//       harta `timeZone={localTz}`. Testele DOM ale filelor (HO7/HO8, RP3, SK3,
//       FE3, RV14) dau prop-ul direct, deci nu văd un prop scos sau inversat aici.
//       Mutația care pică: `timeZone={reportTz}` scos de pe ReportsTab, sau
//       `localTz` dat Stocurilor.
//   ZT6 după o schimbare reușită de ȚARĂ, DashboardPage revalidează features
//       (recenzia CodeRabbit pe #377): țara decide gate-urile pe bani ȘI ziua de
//       raportare, deci un cache vechi ar fi pus Rapoartele pe noul fus cu
//       defalcarea pe ziua românească. Mutația care pică: apelul scos.
//   ZT7 cablajul paginilor de SERVICIU și al OASPETELUI (lotul G2c), STRUCTURAL:
//       Ospătar și Bucătărie calculează `localTz` din `activeRestaurant`, iar
//       FIECARE `<OrderCard` (și `<OrderAuditSheet`) primește exact
//       `timeZone={localTz}`; „azi" al ospătarului e `useZonedTodayRange(localTz)`;
//       QrMenuPage dă foii „Masa ta” fusul din proiecția QR; ReservationSheet ia
//       fusul prin `restaurantTimeZone`; nicio oră formatată pe fusul
//       dispozitivului (`toLocaleTimeString(`) în paginile/foile mutate, iar
//       istoricul comenzii formatează cu `timeZone:`. Testele DOM ale cardurilor
//       dau prop-ul direct, deci nu văd un prop scos în pagină. Mutațiile care
//       pică: `timeZone={localTz}` scos de pe un `<OrderCard`; hook-ul chemat cu
//       fusul implicit; `toLocaleTimeString` readus în WaiterPage/QrCartSheet.
//   ZT8 INTRAREA și graful meniului QR NU ajung la `lib/dates` (PR #293: entry-ul
//       oaspetelui e ținut mic, iar `lib/dates` evaluează formatter-e Intl la
//       încărcare). Graful e cel STATIC (importurile de valoare, transitiv; cele
//       `import type` și `import()` leneșe nu contează), pornit din main.tsx și
//       din QrMenuPage. Control POZITIV: graful lui PublicMenuPage și al lui
//       WaiterPage chiar ajunge la `lib/dates`, iar parserul prinde un import de
//       valoare și sare unul `import type`. Mutațiile care pică:
//       `restaurantTimeZone` importat în RestaurantContext; `safeTimeZone`
//       importat în lib/qr.ts (pastila lăsată acolo).
// Mutațiile care pică: calendarul dispozitivului readus în ReservationsTab, API-ul
// zilei românești readus în HomeTab, fusul scris de mână readus în ReportsTab
// (ZT2); tiparul constructorului local slăbit până prinde `Date.UTC(` (ZT4).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const SRC = resolve(ROOT, 'src')

const PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  // P1 — API-ul zilei ROMÂNEȘTI (corect doar pe suprafețele fiscale).
  {
    name: 'P1 ziua românească',
    re: /\b(?:toRomaniaYMD|isoToRomaniaYMD|romaniaDayBoundaryISO|romaniaDayRange|useRomaniaTodayRange)\(/,
  },
  // P2 — fusul Bucureștiului scris de mână, între ghilimele.
  { name: 'P2 fus fix', re: /['"]Europe\/Bucharest['"]/ },
  // P3 — calendarul DISPOZITIVULUI (nu prinde variantele UTC).
  {
    name: 'P3 calendarul dispozitivului',
    re: /\.(?:getFullYear|getMonth|getDate|getDay|getHours|getMinutes)\(\)|\.set(?:Hours|Date|Month|FullYear)\(/,
  },
  // P4 — constructorul pe ora LOCALĂ a dispozitivului (an, lună, …).
  { name: 'P4 constructor local', re: /new Date\(\s*(?:[A-Za-z_$][\w$.]*(?:\(\))?!?|\d+)\s*,/ },
  // P5 — o coloană `date` (fără oră) formatată ca instant, pe fusul gazdei.
  { name: 'P5 dată ca instant', re: /new Date\([^)]*\.(?:day|report_date)\b[^)]*\)\.toLocale/ },
]

const ALLOWED: ReadonlyArray<{ hit: string; reason: string }> = [
  { hit: 'src/lib/dates.ts P1 ziua românească', reason: 'definițiile variantelor românești' },
  { hit: 'src/lib/dates.ts P2 fus fix', reason: 'formatter-ele românești + DEFAULT_RESTAURANT_TZ (sursa unică a implicitului)' },
  { hit: 'src/lib/receiptStats.ts P1 ziua românească', reason: '(b) bonurile fiscale de azi (BridgeTab), ziua românească' },
  { hit: 'src/components/VatReportTab.tsx P1 ziua românească', reason: '(b) raportul TVA, pe ziua românească a încasării (mig 272)' },
  { hit: 'src/components/AnalyticsTab.tsx P1 ziua românească', reason: '(b) v_daily_orders e pe ziua românească (mig 267), fila e doar fiscală' },
  { hit: 'src/lib/countries.ts P2 fus fix', reason: 'date de referință: România → fusul ei; implicitul regional' },
  { hit: 'src/components/SettingsTab.tsx P2 fus fix', reason: 'lotul G1: implicitul afișat al câmpului de fus' },
  { hit: 'src/lib/payoutFlow.ts P2 fus fix', reason: '(c) plățile afiliaților, platformă' },
  { hit: 'src/pages/FounderPage.tsx P2 fus fix', reason: '(c) ecranul fondatorului, platformă' },
  { hit: 'src/pages/FounderPage.tsx P3 calendarul dispozitivului', reason: '(c) ecranul fondatorului, platformă' },
  { hit: 'src/pages/FounderPage.tsx P4 constructor local', reason: '(c) ecranul fondatorului, platformă' },
  { hit: 'src/components/LegalFooter.tsx P3 calendarul dispozitivului', reason: 'anul de copyright, cosmetic' },
  { hit: 'src/components/marketing/MarketingFooter.tsx P3 calendarul dispozitivului', reason: 'anul de copyright, cosmetic' },
  { hit: 'src/pages/LandingPageEn.tsx P3 calendarul dispozitivului', reason: 'anul de copyright, cosmetic' },
]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      // Dicționarele nu conțin cod de dată; testele au tipare intenționate.
      if (e.name !== '__tests__' && !(e.name === 'ns' && dir.endsWith(`${sep}i18n`))) out.push(...sourceFiles(p))
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

/** Numele tiparelor prinse pe o sursă (o dată per tipar). */
export function matchedPatterns(src: string): string[] {
  const lines = src.split('\n')
  return PATTERNS.filter((p) => lines.some((l) => p.re.test(l))).map((p) => p.name)
}

interface Hit {
  key: string
  where: string
}
function scan(files: string[]): Hit[] {
  const hits: Hit[] = []
  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join('/')
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const p of PATTERNS) if (p.re.test(line)) hits.push({ key: `${rel} ${p.name}`, where: `${rel}:${i + 1}` })
      })
  }
  return hits
}

describe('clichet: ziua se judecă pe fusul restaurantului', () => {
  const files = sourceFiles(SRC)
  const hits = scan(files)

  it('ZT1 anti-vacuitate: scanarea vede sursa și locurile înregistrate', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(hits.length).toBeGreaterThan(ALLOWED.length)
    for (const p of PATTERNS.slice(0, 4)) expect(hits.some((h) => h.key.endsWith(` ${p.name}`)), p.name).toBe(true)
  })

  it('ZT2 niciun loc în afara registrului', () => {
    const allowed = new Set(ALLOWED.map((a) => a.hit))
    expect(hits.filter((h) => !allowed.has(h.key)).map((h) => `${h.where} — ${h.key}`)).toEqual([])
  })

  it('ZT3 fiecare intrare din registru e încă găsită (registrul doar scade)', () => {
    const found = new Set(hits.map((h) => h.key))
    expect(ALLOWED.filter((a) => !found.has(a.hit)).map((a) => a.hit)).toEqual([])
    expect(new Set(ALLOWED.map((a) => a.hit)).size).toBe(ALLOWED.length)
    for (const a of ALLOWED) expect(a.reason.trim().length, a.hit).toBeGreaterThan(10)
  })

  it('ZT4 control pozitiv și negativ al tiparelor', () => {
    const bad: ReadonlyArray<[string, string]> = [
      ['const d = toRomaniaYMD(new Date())', 'P1 ziua românească'],
      ['const r = romaniaDayRange(ymd)', 'P1 ziua românească'],
      ["const tz = 'Europe/Bucharest'", 'P2 fus fix'],
      ['x.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })', 'P2 fus fix'],
      ['start.setHours(0, 0, 0, 0)', 'P3 calendarul dispozitivului'],
      ['return d.getFullYear() + "-" + d.getMonth()', 'P3 calendarul dispozitivului'],
      ['end.setDate(end.getDate() + 7)', 'P3 calendarul dispozitivului'],
      ['const f = new Date(y, m - 1, 1)', 'P4 constructor local'],
      ['setSpecificDate(new Date(y!, mo! - 1, d!))', 'P4 constructor local'],
      ['new Date(t.getFullYear(), 0, 1)', 'P4 constructor local'],
      ['new Date(2026, 0, 1)', 'P4 constructor local'],
      ["new Date(r.report_date).toLocaleDateString('ro-RO', {})", 'P5 dată ca instant'],
      ['day: new Date(d.day as string).toLocaleDateString(loc, opts)', 'P5 dată ca instant'],
    ]
    for (const [src, name] of bad) expect(matchedPatterns(src), src).toContain(name)
    const good = [
      'const d = toZonedYMD(new Date(), timeZone)',
      'const tz = DEFAULT_RESTAURANT_TZ // București',
      'return `${t.getUTCFullYear()}-${t.getUTCMonth() + 1}-${t.getUTCDate()}`',
      't.setUTCDate(1)',
      'const t = new Date(Date.UTC(y, m - 1, d + n))',
      'const at = new Date(iso)',
      'const now = new Date()',
      'new Date(now.getTime() + 86400000)',
      'new Date(fromMs - 1).toISOString()',
      "formatYmd(r.report_date, 'ro-RO', { day: '2-digit' })",
      'new Date(r.created_at).toLocaleTimeString(locale)',
    ]
    for (const src of good) expect(matchedPatterns(src), src).toEqual([])
  })

  it('ZT5 DashboardPage dă fiecărei file fusul ei', () => {
    const dash = readFileSync(join(SRC, 'pages', 'DashboardPage.tsx'), 'utf8')
    expect(dash).toMatch(/const reportTz = reportTimeZone\(restaurant\)/)
    expect(dash).toMatch(/const localTz = restaurantTimeZone\(restaurant\)/)
    // Atributele unei file = textul de la `<Nume` până la primul `/>`.
    const props = (name: string): string[] => {
      const out: string[] = []
      const re = new RegExp(`<${name}\\b`, 'g')
      for (let m = re.exec(dash); m; m = re.exec(dash)) {
        const end = dash.indexOf('/>', m.index)
        out.push(dash.slice(m.index, end < 0 ? undefined : end))
      }
      return out
    }
    const expected: ReadonlyArray<[string, string]> = [
      ['HomeTab', 'reportTz'],
      ['ReportsTab', 'reportTz'],
      ['StocksTab', 'reportTz'],
      ['ReservationsTab', 'localTz'],
      ['FloorPlanEditor', 'localTz'],
    ]
    for (const [name, tz] of expected) {
      const uses = props(name)
      expect(uses.length, name).toBeGreaterThanOrEqual(1)
      for (const u of uses) {
        const zones = u.match(/timeZone=\{(\w+)\}/g) ?? []
        expect(zones, name).toEqual([`timeZone={${tz}}`])
      }
    }
  })

  it('ZT6 schimbarea țării revalidează features (fusul și gate-urile pe bani se mișcă împreună)', () => {
    const dash = readFileSync(join(SRC, 'pages', 'DashboardPage.tsx'), 'utf8')
    expect(dash).toMatch(/featuresReloadRef\.current = features\.reload/)
    expect(dash).toMatch(/!res\.error && 'country' in fields\) void featuresReloadRef\.current\?\.\(\)/)
  })

  // Atributele unui element = textul de la `<Nume` până la primul `/>`.
  const propsIn = (source: string, name: string): string[] => {
    const out: string[] = []
    const re = new RegExp(`<${name}\\b`, 'g')
    for (let m = re.exec(source); m; m = re.exec(source)) {
      const end = source.indexOf('/>', m.index)
      out.push(source.slice(m.index, end < 0 ? undefined : end))
    }
    return out
  }

  it('ZT7 paginile de serviciu și foile oaspetelui primesc fusul localului', () => {
    const read = (f: string): string => readFileSync(join(SRC, f), 'utf8')
    const waiter = read('pages/WaiterPage.tsx')
    const kitchen = read('pages/KitchenPage.tsx')
    const qrPage = read('pages/QrMenuPage.tsx')
    const resv = read('components/ReservationSheet.tsx')
    const cart = read('components/QrCartSheet.tsx')
    const audit = read('components/OrderAuditSheet.tsx')

    for (const [file, src] of [['WaiterPage', waiter], ['KitchenPage', kitchen]] as const) {
      expect(src, file).toMatch(/const localTz = restaurantTimeZone\(activeRestaurant\)/)
      const cards = propsIn(src, 'OrderCard')
      expect(cards.length, `${file} <OrderCard`).toBeGreaterThanOrEqual(1)
      for (const c of cards) expect(c.match(/timeZone=\{[^}]*\}/g) ?? [], file).toEqual(['timeZone={localTz}'])
    }
    expect(propsIn(waiter, 'OrderCard').length).toBeGreaterThanOrEqual(2) // lista + „Stadiu mese”
    const audits = propsIn(waiter, 'OrderAuditSheet')
    expect(audits.length).toBe(1)
    for (const a of audits) expect(a.match(/timeZone=\{[^}]*\}/g) ?? []).toEqual(['timeZone={localTz}'])
    expect(waiter).toMatch(/useZonedTodayRange\(localTz\)/)

    const carts = propsIn(qrPage, 'QrCartSheet')
    expect(carts.length).toBe(1)
    for (const c of carts) expect(c).toMatch(/timeZone=\{ctx\?\.restaurant\.timezone\b/)
    expect(resv).toMatch(/const tz = restaurantTimeZone\(restaurant\)/)

    for (const [file, src] of [['WaiterPage', waiter], ['ReservationSheet', resv], ['QrCartSheet', cart], ['OrderAuditSheet', audit]] as const) {
      expect(src.includes('toLocaleTimeString('), file).toBe(false)
    }
    expect(resv.includes('toLocaleString('), 'ReservationSheet').toBe(false)
    expect(audit).toMatch(/timeZone: safeTimeZone\(timeZone\)/)
  })

  // Graful STATIC al importurilor de valoare (relative), transitiv. `import type`
  // (și un `{ type A, type B }` numai cu tipuri) nu aduce cod; `import()` leneș nu
  // e în graf. Re-exporturile (`export … from`) contează. Întoarce fișierele
  // atinse, relativ la ROOT.
  const IMPORT_RE =
    /^\s*(?:import|export(?=\s+(?:type\s+)?[*{]))\s+(type\s+)?((?:(?!\n\s*(?:import|export)\s)[\s\S])*?)\s*from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm
  /** Specificatorii importurilor de VALOARE dintr-o sursă. */
  function valueImports(source: string): string[] {
    const out: string[] = []
    for (const m of source.matchAll(IMPORT_RE)) {
      if (m[4]) {
        out.push(m[4])
        continue
      }
      if (m[1]) continue // import type …
      const clause = (m[2] ?? '').trim()
      if (clause.startsWith('{') && clause.endsWith('}')) {
        const names = clause.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean)
        if (names.length > 0 && names.every((x) => x.startsWith('type '))) continue
      }
      if (m[3]) out.push(m[3])
    }
    return out
  }
  function staticGraph(entry: string): Set<string> {
    const seen = new Set<string>()
    const stack = [resolve(ROOT, entry)]
    while (stack.length > 0) {
      const file = stack.pop() as string
      const rel = relative(ROOT, file).split(sep).join('/')
      if (seen.has(rel)) continue
      seen.add(rel)
      if (!/\.tsx?$/.test(file)) continue
      for (const spec of valueImports(readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('.')) continue
        const base = resolve(dirname(file), spec)
        const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(
          (c) => existsSync(c) && statSync(c).isFile(),
        )
        if (hit) stack.push(hit)
      }
    }
    return seen
  }

  it('ZT8 intrarea și graful meniului QR nu ajung la lib/dates (control pozitiv pe /m și Ospătar)', () => {
    // Parserul: valoare prinsă, tip sărit, import multilinie prins.
    expect(valueImports("import { restaurantTimeZone } from '../lib/dates'")).toEqual(['../lib/dates'])
    expect(valueImports("import type { RegionalFields } from './dates'")).toEqual([])
    expect(valueImports("import { type WallTime } from './dates'")).toEqual([])
    expect(valueImports("export { safeTimeZone } from './dates'")).toEqual(['./dates'])
    expect(valueImports("export const X = 1\n// citit din './dates'")).toEqual([])
    expect(valueImports("import {\n  safeTimeZone,\n  type WallTime,\n} from './dates'\nimport x from './y'")).toEqual([
      './dates',
      './y',
    ])

    const DATES = 'src/lib/dates.ts'
    const entry = staticGraph('src/main.tsx')
    const qr = staticGraph('src/pages/QrMenuPage.tsx')
    expect(entry.size).toBeGreaterThan(20) // anti-vacuitate: graful chiar se parcurge
    expect(entry.has('src/contexts/RestaurantContext.tsx')).toBe(true)
    expect(entry.has('src/lib/memberships.ts')).toBe(true)
    expect(qr.has('src/lib/qr.ts')).toBe(true)
    expect(entry.has(DATES), 'intrarea (main.tsx) ajunge la lib/dates').toBe(false)
    expect(qr.has(DATES), 'graful QrMenuPage ajunge la lib/dates').toBe(false)
    expect(staticGraph('src/pages/PublicMenuPage.tsx').has(DATES)).toBe(true)
    expect(staticGraph('src/pages/WaiterPage.tsx').has(DATES)).toBe(true)
  })
})
