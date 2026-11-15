// Scorul de sănătate în limba personalului (lotul L7) — helperii puri din
// lib/healthLang.ts. (Prefixul HQ: verificat cu grep în src/, tests/, e2e/,
// supabase/tests, docs și CLAUDE.md, nefolosit înainte; HQ0–HQ5 sunt testele
// cu DOM din src/components/__tests__/HealthLang.test.tsx.)
//   HQ6  `trendLabelT`/`scoreLabelT` în română = `trendLabel`/`scoreLabel` din
//        lib/health.ts (oracolul NEATINS) pe toate tendințele și pe fiecare
//        scor 0–100. Mutația care pică: un prag mutat (`>= 60` → `> 60`).
//   HQ7  vârsta scorului: în română EXACT textele de dinainte, cu pluralele
//        FALSE („acum 1 minute”, „acum 1 ore”, „acum 21 zile”); în
//        engleză/franceză/germană acordul limbii („1 minute ago” / „5 minutes
//        ago”, „il y a 1 jour”, „vor 2 Tagen”). Mutația care pică: o formă
//        `one` românească „acum 1 minut”.
//   HQ8  `getActionableSuggestionsT` în română = `getActionableSuggestions` pe
//        o matrice care atinge FIECARE ramură (login niciodată / recent / de
//        10 zile; zero comenzi / în scădere / în creștere; echipă de 1 / 2 /
//        5; bonuri în eroare 0 / 1 / 4; cu și fără bon). Mutația care pică
//        (verificată): `{more}` calculat `3 - team` fără `Math.max(…, 1)`.
//   HQ9  în en/fr/de sugestiile și narațiunile n-au resturi românești, iar
//        pluralele se acordă („1 fehlerhafter Fiskalbeleg” / „4 fehlerhafte Fiskalbelege”,
//        „1 receipt failed” / „4 receipts failed”); componenta de bonuri apare
//        doar cu bon. Narațiunea românească = textele de dinainte.
//   HQ10 precondiția de suspendare, clichet STRUCTURAL: HealthScoreTab cere
//        `health` + `common` SUS, înaintea primului `return`, și nu folosește
//        alt namespace; HomeTab îl montează `lazy` sub un `<Suspense>` PROPRIU
//        (o limbă nouă suspendă doar cardul, nu toată fila Acasă); lib/healthLang
//        importă din i18n/ns doar TIPUL. Mutația care pică: `useT(healthNs)`
//        mutat sub `if (loading) return`. Plus (la integrare): antetul
//        cardului „Scor meniu” e randat de HomeTab ÎNSUȘI, în afara acelui
//        `<Suspense>`, deci HomeTab cere `health` SUS (înaintea primului
//        `return`) și folosește `scoreLabelT`/`getActionableSuggestionsT`, nu
//        oracolele românești. Mutația care pică: `{scoreLabel(shownScore)}`
//        readus în HomeTab.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: {} }))

import { makeTranslator, type Dict } from '../../i18n/core'
import healthRo from '../../i18n/ns/health/ro'
import healthEn from '../../i18n/ns/health/en'
import healthFr from '../../i18n/ns/health/fr'
import healthDe from '../../i18n/ns/health/de'
import {
  getActionableSuggestions,
  scoreLabel,
  trendLabel,
  type HealthScore,
  type HealthTrend,
} from '../health'
import {
  formatTimeAgoT,
  getActionableSuggestionsT,
  scoreLabelT,
  scoreNarrativeT,
  trendLabelT,
} from '../healthLang'

const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')
const RO = makeTranslator(healthRo, 'ro')
const OTHERS = {
  en: makeTranslator(healthEn, 'en'),
  fr: makeTranslator(healthFr, 'fr'),
  de: makeTranslator(healthDe, 'de'),
} as const
const TRENDS: HealthTrend[] = ['rising', 'stable', 'declining', 'critical']
const DAY = 86_400_000

function score(over: Partial<HealthScore> = {}, details: Partial<HealthScore['details']> = {}): HealthScore {
  return {
    score: 50,
    previous_score: null,
    trend: 'stable',
    score_login: 10,
    score_orders: 15,
    score_team: 5,
    score_tickets: 10,
    score_engagement: 5,
    computed_at: '2026-11-15T10:00:00Z',
    details: { last_login: null, orders_this_week: 3, orders_prev_week: 3, team_size: 2, open_alerts: 2, ...details },
    ...over,
  }
}

// Bucățile românești (≥ 6 caractere, fără locurile {x}) care nu există în
// dicționarul țintei — tiparul „fără resturi” al loturilor L5–L6, pe text.
function leftovers(text: string, target: Dict): string[] {
  const forms = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  for (const [k, v] of Object.entries(healthRo as Dict)) {
    const own = forms(target[k]).join('\n')
    for (const f of forms(v))
      for (const piece of f.split(/\{\w+\}/)) {
        const p = piece.trim()
        if (p.length >= 6 && !own.includes(p) && text.includes(p)) out.push(`${k}: ${p}`)
      }
  }
  return out
}

describe('Scorul de sănătate — helperii traduși', () => {
  it('HQ6: eticheta și tendința în română = oracolul din lib/health', () => {
    for (const t of TRENDS) expect(trendLabelT(t, RO)).toBe(trendLabel(t))
    for (let s = 0; s <= 100; s++) expect(scoreLabelT(s, RO), String(s)).toBe(scoreLabel(s))
    // Control pozitiv: în engleză diferă.
    expect(scoreLabelT(45, OTHERS.en)).toBe('Average')
    expect(trendLabelT('critical', OTHERS.de)).toBe('Kritisch — erfordert Aufmerksamkeit')
  })

  it('HQ7: vârsta scorului — româna de dinainte, acordul celorlalte limbi', () => {
    const now = Date.parse('2026-11-15T10:00:00Z')
    const ago = (ms: number) => new Date(now - ms).toISOString()
    const ro = (ms: number) => formatTimeAgoT(ago(ms), RO, now)
    expect(ro(30_000)).toBe('acum câteva secunde')
    expect(ro(60_000)).toBe('acum 1 minute')
    expect(ro(59 * 60_000)).toBe('acum 59 minute')
    expect(ro(60 * 60_000)).toBe('acum 1 ore')
    expect(ro(23 * 3_600_000)).toBe('acum 23 ore')
    expect(ro(DAY)).toBe('acum 1 zile')
    expect(ro(21 * DAY)).toBe('acum 21 zile')
    expect(formatTimeAgoT(ago(60_000), OTHERS.en, now)).toBe('1 minute ago')
    expect(formatTimeAgoT(ago(5 * 60_000), OTHERS.en, now)).toBe('5 minutes ago')
    expect(formatTimeAgoT(ago(DAY), OTHERS.fr, now)).toBe('il y a 1 jour')
    expect(formatTimeAgoT(ago(3 * 3_600_000), OTHERS.fr, now)).toBe('il y a 3 heures')
    expect(formatTimeAgoT(ago(2 * DAY), OTHERS.de, now)).toBe('vor 2 Tagen')
    expect(formatTimeAgoT(ago(30_000), OTHERS.de, now)).toBe('vor wenigen Sekunden')
  })

  it('HQ8: sugestiile în română = getActionableSuggestions pe fiecare ramură', () => {
    const now = Date.now()
    // O oră în plus față de zile întregi: cele două apeluri ale lui Date.now()
    // (aici și în oracol) cad în aceeași zi.
    const loginAgo = (d: number) => new Date(now - d * DAY - 3_600_000).toISOString()
    const cases: HealthScore[] = []
    for (const last_login of [null, loginAgo(2), loginAgo(10)])
      for (const [wk, prev] of [
        [0, 5],
        [2, 10],
        [8, 5],
      ] as const)
        for (const team_size of [1, 2, 5])
          for (const open_alerts of [0, 1, 4])
            cases.push(
              score({}, { last_login, orders_this_week: wk, orders_prev_week: prev, team_size, open_alerts }),
            )
    // Și scoruri maxime: nicio sugestie.
    cases.push(score({ score_login: 20, score_orders: 30, score_team: 15, score_tickets: 20, score_engagement: 15 }))
    let seen = 0
    for (const s of cases)
      for (const fiscal of [true, false]) {
        const expected = getActionableSuggestions(s, { fiscal })
        expect(getActionableSuggestionsT(s, { fiscal }, RO, now)).toEqual(expected)
        seen += expected.length
      }
    // Control pozitiv: matricea chiar produce sugestii (inclusiv pe bonuri).
    expect(seen).toBeGreaterThan(500)
    const withTickets = getActionableSuggestionsT(score({}, { open_alerts: 1 }), { fiscal: true }, RO, now)
    expect(withTickets.map((x) => x.suggestion)).toContain(
      '1 bonuri în eroare în ultimele 7 zile. Verifică Setări → Casă & tichete — casa de marcat, hârtie, conexiune.',
    )
  })

  it('HQ9: celelalte limbi — fără resturi românești, plurale acordate', () => {
    const now = Date.now()
    const s = score({}, { last_login: new Date(now - 10 * DAY - 3_600_000).toISOString(), open_alerts: 4 })
    for (const [lang, tr] of Object.entries(OTHERS)) {
      const target = { en: healthEn, fr: healthFr, de: healthDe }[lang as keyof typeof OTHERS] as Dict
      const sugg = getActionableSuggestionsT(s, { fiscal: true }, tr, now)
      expect(sugg, lang).toHaveLength(5)
      const narr = [0, 45, 65, 90].map((x) => scoreNarrativeT(x, 'stable', tr))
      narr.push(scoreNarrativeT(90, 'critical', tr))
      const text = [...sugg.flatMap((x) => [x.component, x.suggestion]), ...narr].join('\n')
      expect(leftovers(text, target), lang).toEqual([])
      // Fără bon: componenta de bonuri iese.
      expect(getActionableSuggestionsT(s, { fiscal: false }, tr, now), lang).toHaveLength(4)
    }
    // Control pozitiv al verificării: textul românesc are resturi față de engleză.
    const roText = getActionableSuggestionsT(s, { fiscal: true }, RO, now)
      .map((x) => x.suggestion)
      .join('\n')
    expect(leftovers(roText, healthEn as Dict).length).toBeGreaterThan(3)
    const one = score({}, { open_alerts: 1 })
    const tickets = (tr: (typeof OTHERS)[keyof typeof OTHERS], x: HealthScore) =>
      getActionableSuggestionsT(x, { fiscal: true }, tr, now).find((g) => g.component === tr.t('sc_tickets'))?.suggestion ?? ''
    expect(tickets(OTHERS.de, one)).toMatch(/^1 fehlerhafter Fiskalbeleg /)
    expect(tickets(OTHERS.de, s)).toMatch(/^4 fehlerhafte Fiskalbelege /)
    expect(tickets(OTHERS.en, one)).toMatch(/^1 receipt failed /)
    expect(tickets(OTHERS.en, s)).toMatch(/^4 receipts failed /)
    expect(tickets(OTHERS.fr, s)).toMatch(/^4 tickets fiscaux en erreur /)
    // Narațiunea românească = textele de dinainte (mutate din HealthScoreTab).
    expect(scoreNarrativeT(90, 'critical', RO)).toBe(
      'Cafeneaua ta arată semne îngrijorătoare. Verifică sugestiile de mai jos; dacă ai blocaje, folosește butonul „Ajutor”.',
    )
    expect(scoreNarrativeT(85, 'rising', RO)).toBe(
      'Felicitări! Folosești Menuvia la potențial maxim. Continuă tot așa și consideră să recomanzi platforma altor patroni.',
    )
    expect(scoreNarrativeT(60, 'stable', RO)).toBe(
      'Cont sănătos, dar mai sunt zone de îmbunătățit. Caută-ți spațiu pentru 1-2 din sugestiile de mai jos.',
    )
    expect(scoreNarrativeT(40, 'declining', RO)).toBe(
      'Sunt destule oportunități de optimizare. Adresează în primul rând componenta cu scorul cel mai mic.',
    )
    expect(scoreNarrativeT(39, 'stable', RO)).toBe(
      'Folosirea aplicației e sub potențial. Începe cu componenta cu scorul cel mai mic.',
    )
  })

  it('HQ10: HealthScoreTab cere namespace-urile sus; HomeTab îl montează leneș, sub Suspense propriu', () => {
    const src = read('src/components/HealthScoreTab.tsx')
    const start = src.indexOf('export default function HealthScoreTab(')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start)
    const firstReturn = /^[ \t]*(?:if \([^\n]*\)\s*)?return\b/m.exec(body)
    expect(firstReturn).not.toBeNull()
    const top = body.slice(0, firstReturn?.index ?? 0)
    // Control pozitiv: cererile de sus sunt văzute.
    expect(top).toContain('useT(healthNs)')
    expect(top).toContain('useT(commonNs)')
    const used = [...new Set([...src.matchAll(/useT\((\w+)\)/g)].map((m) => m[1]))].sort()
    expect(used).toEqual(['commonNs', 'healthNs'])
    const imported = [...new Set([...src.matchAll(/from '\.\.\/i18n\/ns\/(\w+)(?:\/\w+)?'/g)].map((m) => m[1]))]
    expect(imported.sort()).toEqual(['common', 'health'])
    // Nicio etichetă calculată nu mai vine din helperii românești.
    expect(src).not.toMatch(/\b(?:trendLabel|scoreLabel|getActionableSuggestions)\(/)
    const home = read('src/components/_dashboard/HomeTab.tsx')
    expect(home).toContain("const HealthScoreTab = lazy(() => import('../HealthScoreTab'))")
    expect(home).toMatch(/<Suspense fallback=\{[^\n]*\}>\s*<HealthScoreTab /)
    const homeStart = home.indexOf('export default function HomeTab(')
    expect(homeStart).toBeGreaterThan(0)
    const homeBody = home.slice(homeStart)
    const homeReturn = /^[ \t]*(?:if \([^\n]*\)\s*)?return\b/m.exec(homeBody)
    expect(homeReturn).not.toBeNull()
    expect(homeBody.slice(0, homeReturn?.index ?? 0)).toContain('useT(healthNs)')
    expect(home).toContain('scoreLabelT(shownScore, th)')
    expect(home).toContain('getActionableSuggestionsT(health, healthScope, th)')
    expect(home).not.toMatch(/\b(?:trendLabel|scoreLabel|getActionableSuggestions)\(/)
    const lib = read('src/lib/healthLang.ts')
    expect(lib).toContain("import type healthRo from '../i18n/ns/health/ro'")
    expect(lib).not.toMatch(/^import (?!type)[^\n]*i18n\/ns\//m)
  })
})
