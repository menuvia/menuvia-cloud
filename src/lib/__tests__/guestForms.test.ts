// src/lib/__tests__/guestForms.test.ts
// Clichete pe SURSĂ pentru formulare (a11y-autocomplete, ux-guest-11). Randarea
// (16px, etichete, autocomplete pe câmpurile oaspetelui) e testată în testele
// componentelor; aici stau doar lucrurile pe care jsdom nu le poate vedea:
//   GF1  câmpurile de identitate din login/înscriere/parolă nouă au
//        `autoComplete` (managerul de parole și completarea automată). Mutația
//        care pică: oricare `autoComplete` scos.
//   GF2  CTA-urile lipite de marginea de jos (coșul QR, ridicarea, rezervarea)
//        lasă loc barei de home a iPhone-ului: `calc(Npx + env(safe-area-inset-
//        bottom, 0px))`. jsdom aruncă `env()` din stiluri, deci testul e pe sursă.
//        Mutația care pică: padding-ul fix vechi (`'8px 20px 28px'`).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

interface InputTag {
  id: string | null
  type: string | null
  autoComplete: string | null
}

// `<input … />` cu atributele care contează. Valorile `{…}` sunt păstrate brut.
function inputs(src: string): InputTag[] {
  return [...src.matchAll(/<input\b[\s\S]*?\/>/g)].map((m) => {
    const tag = m[0]
    return {
      id: tag.match(/\bid="([\w-]+)"/)?.[1] ?? null,
      type: tag.match(/\btype="(\w+)"/)?.[1] ?? null,
      autoComplete: tag.match(/\bautoComplete=(\{[^}]*\}|"[^"]*")/)?.[1] ?? null,
    }
  })
}

describe('Formulare — autocomplete și bara de home', () => {
  it('GF1 login/înscriere/parolă nouă: câmpurile de identitate au autoComplete', () => {
    const auth = inputs(read('src/pages/AuthPage.tsx'))
    const reset = inputs(read('src/pages/ResetPasswordPage.tsx'))
    const byId = (list: InputTag[], id: string): InputTag => {
      const found = list.find((i) => i.id === id)
      if (!found) throw new Error(`lipsește <input id="${id}">`)
      return found
    }
    expect(byId(auth, 'auth-email').autoComplete).toBe('"email"')
    expect(byId(auth, 'reset-email').autoComplete).toBe('"email"')
    expect(byId(auth, 'auth-name').autoComplete).toBe('"name"')
    // Aceeași parolă servește ambele moduri: nouă la înscriere, salvată la login.
    const pw = byId(auth, 'auth-password').autoComplete ?? ''
    expect(pw).toContain("'new-password'")
    expect(pw).toContain("'current-password'")
    expect(byId(reset, 'new-password').autoComplete).toBe('"new-password"')
    expect(byId(reset, 'confirm-password').autoComplete).toBe('"new-password"')
    // Clasă: ORICE câmp de parolă din cele două pagini are autoComplete.
    const pwNoAc = [...auth, ...reset].filter((i) => i.type === 'password' && !i.autoComplete)
    expect(pwNoAc).toEqual([])
  })

  it('GF2 foile cu CTA jos lasă loc barei de home (safe-area-inset-bottom)', () => {
    const SAFE = /calc\(\d+px \+ env\(safe-area-inset-bottom, 0px\)\)/
    for (const f of [
      'src/components/QrCartSheet.tsx',
      'src/components/PickupCheckoutSheet.tsx',
      'src/components/ReservationSheet.tsx',
    ]) {
      expect(read(f), f).toMatch(SAFE)
    }
    // Control: tiparul nu se potrivește pe padding-ul fix de dinainte.
    expect("padding: '8px 20px 28px'").not.toMatch(SAFE)
  })
})
