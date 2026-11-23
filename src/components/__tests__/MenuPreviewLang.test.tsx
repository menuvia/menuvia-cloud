// Previzualizarea meniului din Setări → Aspect în limba de BAZĂ a meniului
// (precondiția B6 a activării limbilor personalului). (Prefixul PVL: verificat
// cu grep în src/, tests/, e2e/, supabase/, docs și CLAUDE.md, nefolosit.)
//   PVL1 fără `lang`: româna de dinainte — produsele-mostră, pastila „Deschis
//        acum”, sloganul și numele de rezervă „Bistro Exemplu”.
//   PVL2 `lang="de"`: produsele, pastila, sloganul și numele de rezervă în
//        germană, fără resturi românești; etichetele cardurilor („Hinzufügen”
//        etc.) vin din `lang`. Mutația care pică: `lang` neîntors cardurilor
//        (cardProps fără `lang`) sau pastila scrisă direct în română.
//   PVL3 limba de bază vine din formularul de Setări, nu din limba
//        personalului (clichet pe sursă). Mutația care pică: `lang={uiLang}`.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import MenuPreview from '../menu/MenuPreview'


describe('MenuPreview în limba de bază a meniului', () => {
  it('PVL1 fără lang: româna de dinainte', () => {
    const { container } = render(<MenuPreview themeSettings={null} />)
    const text = container.textContent ?? ''
    expect(text).toContain('Bistro Exemplu')
    expect(text).toContain('Risotto cu ciuperci')
    expect(text).toContain('Deschis acum')
  })

  it('PVL2 lang="de": produse, pastilă, slogan și nume de rezervă în germană', () => {
    const { container } = render(<MenuPreview themeSettings={null} lang="de" />)
    const text = container.textContent ?? ''
    expect(text).toContain('Beispiel-Bistro')
    expect(text).toContain('Pilzrisotto')
    expect(text).toContain('Jetzt geöffnet')
    expect(text).not.toMatch(/[ăâîșț]|Deschis acum|Bistro Exemplu|Risotto cu ciuperci|Bucătărie/)
  })

  it('PVL3 SettingsTab îi dă limba de bază din formular', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/SettingsTab.tsx'), 'utf8')
    expect(src).toMatch(/<MenuPreview[\s\S]*?lang=\{menuBaseLang\(form\.language\)\}/)
  })
})
