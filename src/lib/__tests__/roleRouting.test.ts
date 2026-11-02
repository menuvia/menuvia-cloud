// Garda de rol pe /dashboard (lib/roleRouting.ts + App.tsx).
//
//   RR1  ospătarul → /waiter, bucătarul → /kitchen. Mutația care pică: garda
//        scoasă (`staffHomeForRole` → mereu null) — codul vechi, unde personalul
//        intra în editorul complet de meniu și mese.
//   RR2  control: owner, manager, partner (vizită de agent) și rolul necunoscut
//        (null) RĂMÂN pe /dashboard. Mutația care pică: „orice rol ≠ owner →
//        afară" (partenerul și fondatorul în vizită ar fi aruncați).
//   RR3  „Nu ai acces" nu mai trimite personalul înapoi pe /dashboard: bucătarul
//        de pe /waiter merge pe /kitchen. Mutația care pică: `'/dashboard'` fix.
//   RR4  App.tsx aplică garda ÎNAINTEA randării lui DashboardPage (și după
//        încărcarea rolului), cu replace (Back nu întoarce pe /dashboard), iar
//        „Nu ai acces" folosește noAccessDestination. Clichet pe sursă: fără el,
//        RR1 ar trece și cu funcția nefolosită nicăieri.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { noAccessDestination, staffHomeForRole } from '../roleRouting'

describe('staffHomeForRole', () => {
  it('RR1 personalul pe ecranul lui', () => {
    expect(staffHomeForRole('waiter')).toBe('/waiter')
    expect(staffHomeForRole('kitchen')).toBe('/kitchen')
  })

  it('RR2 owner / manager / partner / necunoscut rămân pe /dashboard', () => {
    for (const r of ['owner', 'manager', 'partner', null] as const) {
      expect(staffHomeForRole(r)).toBeNull()
    }
  })

  it('RR3 „Nu ai acces" duce pe ecranul rolului', () => {
    expect(noAccessDestination('kitchen')).toBe('/kitchen')
    expect(noAccessDestination('waiter')).toBe('/waiter')
    expect(noAccessDestination('partner')).toBe('/dashboard')
    expect(noAccessDestination(null)).toBe('/dashboard')
  })
})

describe('App.tsx — garda e chiar aplicată', () => {
  // Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts).
  const src = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

  it('RR4 garda stă înaintea lui DashboardPage, cu replace, iar „Nu ai acces" o folosește', () => {
    const guard = src.indexOf('const staffHome = staffHomeForRole(activeRole)')
    const render = src.indexOf('<DashboardPage')
    expect(guard).toBeGreaterThan(0)
    expect(render).toBeGreaterThan(guard)
    const between = src.slice(guard, render)
    expect(between).toMatch(/if \(staffHome\) \{\s*replace\(staffHome\)/)
    // Rolul se citește DUPĂ încărcare: altfel null (încă necunoscut) ar lăsa să
    // treacă o randare a editorului.
    const loadingGate = src.lastIndexOf('if (ctxLoading) return <PageSpinner />', guard)
    expect(loadingGate).toBeGreaterThan(0)
    expect(src).toContain('onRetry={() => navigate(noAccessDestination(activeRole))}')
    expect(src).not.toContain("onRetry={() => navigate('/dashboard')}")
  })
})
