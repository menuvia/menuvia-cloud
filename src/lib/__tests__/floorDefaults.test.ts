// Numele IMPLICITE ale etajelor și zonelor noi de pe harta sălii (precondiția
// activării limbilor personalului). Sunt DATE: se salvează în
// `restaurants.floor_layout` și le vede oaspetele pe harta publică a
// rezervării, deci urmează limba de BAZĂ a meniului, nu a personalului.
// (Prefixul FD: verificat cu grep în src/, tests/, e2e/, supabase/, docs și
// CLAUDE.md, nefolosit înainte.)
//   FD1  româna = textele de dinainte („Parter”, „Etaj N”, „Zonă”); fiecare
//        dintre cele 7 limbi ale meniului are numele EI, fără litere sau
//        cuvinte românești; o limbă necunoscută cade pe română.
//        Mutația care pică: tabelul cu româna pe toate limbile.
//   FD2  editorul pornește din `floorDefaults(baseLang)`, iar DashboardPage îi
//        dă limba de bază a localului. Mutația care pică: `DEFAULT_ZONE_LABEL`
//        readus în FloorPlanEditor.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { DEFAULT_FLOOR_NAME, DEFAULT_ZONE_LABEL, defaultFloorName, floorDefaults } from '../floorPlan'
import { MENU_LANGS } from '../i18nMenu'

const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')

describe('numele implicite de pe harta sălii', () => {
  it('FD1 limba de bază a meniului; româna e textul de dinainte', () => {
    const ro = floorDefaults('ro')
    expect(ro.ground).toBe('Parter')
    expect(ro.floor(2)).toBe('Etaj 2')
    expect(ro.zone).toBe('Zonă')
    expect(DEFAULT_FLOOR_NAME).toBe('Parter')
    expect(defaultFloorName(3)).toBe('Etaj 3')
    expect(DEFAULT_ZONE_LABEL).toBe('Zonă')
    const ROMANIAN = /[ăâîșțĂÂÎȘȚ]|\b(Parter|Etaj)\b/
    const grounds = new Set<string>()
    for (const { code } of MENU_LANGS) {
      const d = floorDefaults(code)
      grounds.add(d.ground)
      expect(d.floor(4), code).toMatch(/4/)
      if (code !== 'ro') {
        for (const v of [d.ground, d.floor(4), d.zone]) expect(v, `${code}: ${v}`).not.toMatch(ROMANIAN)
      }
    }
    expect(grounds.size).toBe(MENU_LANGS.length)
    for (const unknown of ['xx', '', null, undefined]) expect(floorDefaults(unknown).ground).toBe('Parter')
  })

  it('FD2 editorul pornește din limba de bază primită de la DashboardPage', () => {
    const editor = read('src/components/FloorPlanEditor.tsx')
    expect(editor).toContain('const names = floorDefaults(baseLang)')
    expect(editor).not.toMatch(/DEFAULT_FLOOR_NAME|DEFAULT_ZONE_LABEL|defaultFloorName/)
    expect(read('src/pages/DashboardPage.tsx')).toMatch(/<FloorPlanEditor[\s\S]*?baseLang=\{menuBaseLang\(restaurant\.language\)\}/)
  })
})
