// src/lib/__tests__/i18nMenu.test.ts
// Helperi puri de meniu multilingv (mig 197) — fallback la original,
// derivarea limbilor din conținut + intersecția cu menu_languages.
import { describe, it, expect } from 'vitest'
import {
  normalizeMenuSearch,
  trName,
  trDesc,
  availableMenuLangs,
  activeTranslationLangs,
  mergeTranslations,
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

// Editorul manual de traduceri pe categorii (CategoriesTab).
describe('activeTranslationLangs', () => {
  it('fără limbi configurate → nicio limbă de tradus', () => {
    expect(activeTranslationLangs(null)).toEqual([])
    expect(activeTranslationLangs(undefined)).toEqual([])
    expect(activeTranslationLangs([])).toEqual([])
  })

  it('scoate ro, codurile necunoscute și duplicatele; ordinea e cea din MENU_LANGS', () => {
    expect(activeTranslationLangs(['de', 'ro', 'en', 'xx', 'en'])).toEqual(['en', 'de'])
  })
})

describe('mergeTranslations (editor manual categorii)', () => {
  const existing: Translations = {
    en: { name: 'Mains', description: 'păstrată' },
    de: { name: 'Hauptgerichte' },
    fr: { name: 'Plats' }, // limbă NEactivă — trebuie să supraviețuiască
  }

  it('scrie numele limbilor active și păstrează limbile neactive', () => {
    const out = mergeTranslations(existing, { en: ' Main courses ', de: 'Hauptspeisen' }, [
      'en',
      'de',
    ])
    expect(out).toEqual({
      en: { name: 'Main courses', description: 'păstrată' },
      de: { name: 'Hauptspeisen' },
      fr: { name: 'Plats' },
    })
  })

  it('un nume gol șterge doar `name`; intrarea goală dispare', () => {
    const out = mergeTranslations(existing, { en: '   ', de: '' }, ['en', 'de'])
    expect(out).toEqual({ en: { description: 'păstrată' }, fr: { name: 'Plats' } })
  })

  it('ignoră numele pentru limbi neactive și pe ro', () => {
    const out = mergeTranslations({}, { it: 'Secondi', ro: 'X', en: 'Mains' }, ['ro', 'en'])
    expect(out).toEqual({ en: { name: 'Mains' } })
  })

  it('nu mută obiectul existent', () => {
    const snap = JSON.stringify(existing)
    mergeTranslations(existing, { en: 'Altceva' }, ['en'])
    expect(JSON.stringify(existing)).toBe(snap)
  })

  it('pornește de la null/gunoi fără să arunce', () => {
    expect(mergeTranslations(null, { en: 'A' }, ['en'])).toEqual({ en: { name: 'A' } })
    const broken = { en: 'gunoi' } as unknown as Translations
    expect(mergeTranslations(broken, { en: 'B' }, ['en'])).toEqual({ en: { name: 'B' } })
  })
})
