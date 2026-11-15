// Fila Statistici în limba personalului (lotul L7) — părțile pure. (Prefixul
// AY: verificat cu grep în src/, tests/, e2e/, supabase/tests, docs și
// CLAUDE.md, nefolosit înainte; AY0–AY5 sunt testele cu DOM din
// src/components/__tests__/AnalyticsLang.test.tsx.)
//   AY6  precondiția de suspendare, clichet STRUCTURAL: AnalyticsTab cere
//        `analytics` + `common` SUS, înaintea primului `return` (și înaintea
//        gate-ului `analyticsAccess`), nu folosește alt namespace, nu mai are
//        `toUserMessage(` și nici localul fix „ro-RO” pe axa zilelor; fila
//        rămâne `lazy` în DashboardPage; localul axei vine din limba
//        UTILIZATORULUI (`staffLocale(uiLang)`, clichetul LF din L6b — până la
//        recenzia CodeRabbit pe #373 testul îngheța limba dicționarului
//        servit). Mutația care pică: `useT(analyticsNs)` mutat sub
//        `if (!hasAccess) return null`.
//   AY7  ziua de pe axă: `staffLocale('ro')` = „ro-RO”, deci în română EXACT
//        formatul de dinainte (ZZ.LL); engleza/franceza/germana au formatul lor
//        („03/11”, „03.11.”). Mutația care pică: `staffLocale` cu „en-US”
//        pentru engleză (ar da „11/03”).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { staffLocale } from '../../i18n/format'

const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')
const DAY_OPTS: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' }

describe('Statistici — părțile pure', () => {
  it('AY6: AnalyticsTab cere namespace-urile înaintea primului return', () => {
    const src = read('src/components/AnalyticsTab.tsx')
    const start = src.indexOf('export default function AnalyticsTab(')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start)
    const m = /^[ \t]*(?:if \([^\n]*\)\s*)?return\b/m.exec(body)
    expect(m).not.toBeNull()
    const top = body.slice(0, m?.index ?? 0)
    expect(top).toContain('useT(analyticsNs)')
    expect(top).toContain('useT(commonNs)')
    // Înaintea gate-ului de acces: o limbă nouă suspendă o singură dată, chiar
    // și pe restaurantele din afara României (mesajul lor e tradus).
    expect(top.indexOf('useT(analyticsNs)')).toBeLessThan(top.indexOf('analyticsAccess('))
    const used = [...new Set([...src.matchAll(/useT\((\w+)\)/g)].map((x) => x[1]))].sort()
    expect(used).toEqual(['analyticsNs', 'commonNs'])
    const imported = [...new Set([...src.matchAll(/from '\.\.\/i18n\/ns\/(\w+)(?:\/\w+)?'/g)].map((x) => x[1]))]
    expect(imported.sort()).toEqual(['analytics', 'common'])
    expect(src).not.toContain('toUserMessage(')
    expect(src).not.toContain("'ro-RO'")
    expect(src).toContain('staffLocale(uiLang)')
    expect(read('src/pages/DashboardPage.tsx')).toContain("lazy(() => import('../components/AnalyticsTab'))")
  })

  it('AY7: ziua de pe axă — româna de dinainte, formatul celorlalte limbi', () => {
    const d = new Date('2026-11-03T12:00:00Z')
    expect(staffLocale('ro')).toBe('ro-RO')
    expect(d.toLocaleDateString(staffLocale('ro'), DAY_OPTS)).toBe(d.toLocaleDateString('ro-RO', DAY_OPTS))
    expect(d.toLocaleDateString(staffLocale('ro'), DAY_OPTS)).toBe('03.11')
    expect(d.toLocaleDateString(staffLocale('en'), DAY_OPTS)).toBe('03/11')
    expect(d.toLocaleDateString(staffLocale('fr'), DAY_OPTS)).toBe('03/11')
    expect(d.toLocaleDateString(staffLocale('de'), DAY_OPTS)).toBe('03.11.')
  })
})
