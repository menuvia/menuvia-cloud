// „Începe gratuit" deschide ÎNSCRIEREA, nu autentificarea (audit v3, S0).
//
// Defectul: CTA-urile de marketing fără plan (comparație, verticale, case de
// marcat, rezervări, demo) duceau pe `/auth?lang=ro`, adică pe „Autentificare".
// Cine voia să-și facă cont vedea un formular de login și trebuia să găsească
// singur comutatorul — exact la intrarea în funel.
//
//   SU1  `/auth?…&mode=signup` pornește pe „Cont nou"; fără el (sau cu altă
//        valoare) rămâne „Autentificare"; `?plan=` duce în continuare pe „Cont nou"
//   SU2  `signupPath()` produce un URL pe care `initialAuthMode` îl recunoaște,
//        în ambele limbi (control pozitiv: fără el SU3 ar trece și cu helperul stricat)
//   SU3  CLICHET: paginile de marketing și rutele din App.tsx nu mai conțin
//        literalul `/auth?lang=ro` pe un CTA „Începe" — doar `signupPath()`
//   SU4  anti-vacuitate: butoanele „Începe gratuit" chiar sunt în sursele scanate
//        și login-urile legitime („Intră în cont", „Cont existent") au rămas
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { initialAuthMode, signupPath } from '../planIntent'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')

// Paginile unde „Începe gratuit" NU alege un plan.
const START_PAGES = [
  'src/pages/CaseDeMarcatPage.tsx',
  'src/pages/ComparatiePage.tsx',
  'src/pages/VerticalPage.tsx',
  'src/pages/RezervariPage.tsx',
]

describe('„Începe gratuit" → înscriere', () => {
  it('SU1: mode=signup pornește pe „Cont nou"; restul rămân pe login', () => {
    expect(initialAuthMode('?lang=ro&mode=signup')).toBe('signup')
    expect(initialAuthMode('?mode=signup')).toBe('signup')
    expect(initialAuthMode('?lang=ro')).toBe('login')
    expect(initialAuthMode('?lang=ro&mode=login')).toBe('login')
    expect(initialAuthMode('?mode=SIGNUP')).toBe('login')
    expect(initialAuthMode('')).toBe('login')
    // semnalul vechi rămâne valabil
    expect(initialAuthMode('?plan=growth&lang=ro')).toBe('signup')
  })

  it('SU2: signupPath() e recunoscut de initialAuthMode, în ambele limbi', () => {
    for (const lang of ['ro', 'en'] as const) {
      const path = signupPath(lang)
      expect(path.startsWith('/auth?')).toBe(true)
      expect(path).toContain('lang=' + lang)
      expect(initialAuthMode(path.slice(path.indexOf('?')))).toBe('signup')
    }
    expect(signupPath()).toBe(signupPath('ro'))
  })

  it('SU3: nicio pagină de marketing nu mai trimite „Începe" pe login', () => {
    for (const f of START_PAGES) {
      const src = read(f)
      expect(src, `${f} cheamă signupPath()`).toContain('signupPath()')
      expect(src, `${f} are încă literalul de login`).not.toMatch(/navigate\(\s*['"`]\/auth\?lang=ro['"`]\s*\)/)
    }
    const app = read('src/App.tsx')
    // Demo-ul (singurul „Începe" din App.tsx fără plan) merge pe înscriere.
    expect(app).toMatch(/onStart=\{\(\) => navigate\(signupPath\(\)\)\}/)
  })

  it('SU4: anti-vacuitate — CTA-urile „Începe" sunt în sursele scanate, login-urile au rămas', () => {
    for (const f of START_PAGES.slice(0, 3)) {
      expect(read(f), `${f} nu mai are „Începe gratuit”`).toContain('Începe gratuit')
    }
    // Login-urile legitime NU au fost atinse (altfel „fix"-ul ar fi un înlocuitor orb).
    expect(read('src/pages/RecrutarePage.tsx')).toContain("navigate('/auth?lang=ro')")
    expect(read('src/App.tsx')).toContain("onLogin={() => navigate('/auth?lang=ro')}")
  })
})
