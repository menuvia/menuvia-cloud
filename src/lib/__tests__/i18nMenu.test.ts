// src/lib/__tests__/i18nMenu.test.ts
// Helperi puri de meniu multilingv (mig 197) — fallback la original,
// derivarea limbilor din conținut + intersecția cu menu_languages.
import { describe, it, expect } from 'vitest'
import {
  normalizeMenuSearch,
  trName,
  trDesc,
  availableMenuLangs,
  type Translations,
} from '../i18nMenu'

describe('normalizeMenuSearch', () => {
  it('elimină diacriticele și face lowercase', () => {
    expect(normalizeMenuSearch('Ciorbă Rădăuțeană')).toBe('ciorba radauteana')
    expect(normalizeMenuSearch('MICI cu Muștar')).toBe('mici cu mustar')
  })

  it('lasă textul fără diacritice neschimbat (în afară de case)', () => {
    expect(normalizeMenuSearch('Pizza')).toBe('pizza')
  })
})

describe('trName / trDesc — fallback la original', () => {
  const item = {
    name: 'Ciorbă de burtă',
    description: 'Cu smântână și ardei iute',
    translations: {
      en: { name: 'Tripe soup', description: 'With sour cream' },
      de: { name: '   ' }, // traducere goală după trim → fallback
    } as Translations,
  }

  it('ro întoarce ÎNTOTDEAUNA originalul (baza)', () => {
    expect(trName(item, 'ro')).toBe('Ciorbă de burtă')
    expect(trDesc(item, 'ro')).toBe('Cu smântână și ardei iute')
  })

  it('limbă tradusă → traducerea', () => {
    expect(trName(item, 'en')).toBe('Tripe soup')
    expect(trDesc(item, 'en')).toBe('With sour cream')
  })

  it('traducere goală/lipsă → fallback la original', () => {
    expect(trName(item, 'de')).toBe('Ciorbă de burtă') // '   ' → fallback
    expect(trDesc(item, 'de')).toBe('Cu smântână și ardei iute') // lipsă
    expect(trName(item, 'fr')).toBe('Ciorbă de burtă') // limbă absentă
  })

  it('fără translations → original; descriere null rămâne null', () => {
    expect(trName({ name: 'Mici', translations: null }, 'en')).toBe('Mici')
    expect(trDesc({ description: null, translations: null }, 'en')).toBeNull()
  })
})

describe('availableMenuLangs — derivare din conținut + intersecție', () => {
  const categories = [
    {
      translations: { en: { name: 'Starters' } } as Translations,
      products: [
        { translations: { de: { description: 'Mit Senf' } } as Translations },
        { translations: { hu: { name: '' } } as Translations }, // goală → nu contează
      ],
    },
    { translations: null, products: [] },
  ]

  it('găsește limbile cu MĂCAR o traducere nevidă, în ordinea MENU_LANGS', () => {
    expect(availableMenuLangs(categories)).toEqual(['en', 'de'])
  })

  it('ro nu apare niciodată (e baza)', () => {
    const cats = [{ translations: { ro: { name: 'x' } } as Translations }]
    expect(availableMenuLangs(cats)).toEqual([])
  })

  it('menu_languages ne-vid intersectează (limbă deselectată dispare)', () => {
    expect(availableMenuLangs(categories, ['en'])).toEqual(['en'])
  })

  it('menu_languages vid/null → fără regresie (derivare pură din conținut)', () => {
    expect(availableMenuLangs(categories, [])).toEqual(['en', 'de'])
    expect(availableMenuLangs(categories, null)).toEqual(['en', 'de'])
  })

  it('limbile necunoscute din translations sunt ignorate', () => {
    const cats = [{ translations: { xx: { name: 'ceva' } } as Translations }]
    expect(availableMenuLangs(cats)).toEqual([])
  })
})
