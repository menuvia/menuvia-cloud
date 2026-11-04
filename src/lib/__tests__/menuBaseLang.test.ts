// Limba de bază a meniului (lotul O6a, audit nov 2026 MENU-13). Înainte româna
// era presupusă peste tot: un meniu scris în franceză apărea „Română” în
// switcher și nu-și putea adăuga o traducere în română.
//
//   ML1  menuBaseLang: limba cunoscută a localului, altfel `ro`.
//   ML2  trName/trDesc: pe baza dată, originalul; pe `ro` (acum doar o
//        traducere), traducerea română. [PICĂ: `lang === 'ro'` fix — un local
//        francez cu traducere română arăta franceza pe pastila „Română”]
//   ML3  availableMenuLangs / detectBrowserLang / activeTranslationLangs sar
//        BAZA, nu româna: o traducere română apare ca limbă în plus.
//   ML4  control: fără bază dată, comportamentul de dinainte (baza = ro).
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  activeTranslationLangs,
  availableMenuLangs,
  detectBrowserLang,
  menuBaseLang,
  trDesc,
  trName,
} from '../i18nMenu'
import { localizeProduct } from '../menuRefresh'
import { makeProduct } from '../../components/__tests__/fixtures'

const soupe = {
  name: 'Soupe à l’oignon',
  description: 'Gratinée',
  translations: { ro: { name: 'Supă de ceapă', description: 'Gratinată' }, en: { name: 'Onion soup' } },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('limba de bază a meniului', () => {
  it('ML1 menuBaseLang', () => {
    expect(menuBaseLang('fr')).toBe('fr')
    expect(menuBaseLang('ro')).toBe('ro')
    expect(menuBaseLang(null)).toBe('ro')
    expect(menuBaseLang('xx')).toBe('ro')
  })

  it('ML2 originalul pe bază, româna ca traducere', () => {
    expect(trName(soupe, 'fr', 'fr')).toBe('Soupe à l’oignon')
    expect(trName(soupe, 'ro', 'fr')).toBe('Supă de ceapă')
    expect(trDesc(soupe, 'ro', 'fr')).toBe('Gratinată')
    expect(trName(soupe, 'en', 'fr')).toBe('Onion soup')
    const p = makeProduct({ name: soupe.name, description: soupe.description, translations: soupe.translations })
    expect(localizeProduct(p, 'ro', 'fr').name).toBe('Supă de ceapă')
    expect(localizeProduct(p, 'fr', 'fr')).toBe(p)
  })

  it('ML3 limbile în plus sar baza, nu româna', () => {
    const cats = [{ translations: null, products: [{ translations: soupe.translations }] }]
    expect(availableMenuLangs(cats, null, 'fr')).toEqual(['ro', 'en'])
    expect(activeTranslationLangs(['ro', 'fr', 'de'], 'fr')).toEqual(['ro', 'de'])
    vi.stubGlobal('navigator', { languages: ['fr-FR', 'ro-RO'], language: 'fr-FR' })
    expect(detectBrowserLang(['ro', 'en'], 'fr')).toBe('ro')
  })

  it('ML4 fără bază: româna e baza, ca înainte', () => {
    expect(trName(soupe, 'ro')).toBe('Soupe à l’oignon')
    const cats = [{ translations: null, products: [{ translations: soupe.translations }] }]
    expect(availableMenuLangs(cats)).toEqual(['en'])
    expect(activeTranslationLangs(['ro', 'en'])).toEqual(['en'])
  })
})
