// src/lib/__tests__/i18nMenu.test.ts
// Helperi puri de meniu multilingv (mig 197) — fallback la original,
// derivarea limbilor din conținut + intersecția cu menu_languages.
//
// Lotul O6c — marcajul „de verificat” al traducerilor AI (`ai_fields`) și
// cele trei semantici de scriere:
//   TC1  mergeAiTranslations completează golurile (și cele doar cu spații),
//        nu suprascrie textul existent nici marcajele lui, marchează DOAR ce a
//        completat, aruncă câmpurile din afara listei permise, ignoră baza și
//        limbile necerute, e idempotentă și nu mută intrarea. Mutația care
//        pică: vechiul spread `{ ...ai, ...existing }` din AiBulkGenerate
//        (un câmp „   ” blochează completarea, iar nimic nu e marcat).
//   TC2  mergeTranslations (editoarele din fișe): un nume NESCHIMBAT își
//        păstrează marcajul, unul schimbat sau golit și-l pierde; `field`
//        scrie subtitlul fără să atingă numele. Mutația care pică: marcajul
//        scos la orice salvare (o salvare de fișă „verifica” tot).
//   TC3  applyManualEdit / markTranslationReviewed / setTranslationValue scot
//        marcajul doar câmpurilor atinse, păstrează descrierea și limbile
//        neatinse, iar o intrare rămasă doar cu marcaj dispare; aiFieldsOf
//        ignoră gunoiul, câmpurile necunoscute și marcajele pe text gol.
//   TC4  cititorii oaspetelui ignoră marcajul: trName/trDesc/trMeta dau același
//        rezultat cu și fără el, o intrare doar cu marcaj cade pe original, iar
//        availableMenuLangs NU oferă o limbă al cărei singur conținut e marcajul.
//   TC5  `?lang=` (previzualizarea): doar coduri cunoscute, lowercase; limba
//        cerută trece doar dacă meniul o oferă și nu e baza.
import { describe, it, expect } from 'vitest'
import {
  normalizeMenuSearch,
  trName,
  trDesc,
  trMeta,
  availableMenuLangs,
  activeTranslationLangs,
  mergeTranslations,
  aiFieldsOf,
  mergeAiTranslations,
  applyManualEdit,
  markTranslationReviewed,
  setTranslationValue,
  langFromSearch,
  requestedMenuLang,
  type TranslationEntry,
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

  it('ML7 o limbă tradusă doar pe opțiuni / extra-uri / subtitlu apare (recenzia pe #355)', () => {
    const tr = (code: string): Translations => ({ [code]: { name: 'x' } }) as Translations
    const onlyOption = [
      {
        products: [
          { modifier_groups: [{ translations: {}, modifier_options: [{ translations: tr('fr') }] }] },
        ],
      },
    ]
    expect(availableMenuLangs(onlyOption)).toEqual(['fr'])
    const onlyGroup = [{ products: [{ modifier_groups: [{ translations: tr('de') }] }] }]
    expect(availableMenuLangs(onlyGroup)).toEqual(['de'])
    const onlyExtra = [{ products: [{ extras: [{ translations: tr('en') }] }] }]
    expect(availableMenuLangs(onlyExtra)).toEqual(['en'])
    const onlySubtitle = [{ translations: { it: { meta_text: 'Primi piatti' } } as Translations }]
    expect(availableMenuLangs(onlySubtitle)).toEqual(['it'])
    // Control: textele goale nu fac o limbă.
    const blank = [{ products: [{ extras: [{ translations: { en: { name: '  ' } } as Translations }] }] }]
    expect(availableMenuLangs(blank)).toEqual([])
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

describe('TC1 mergeAiTranslations — fill-only-gaps cu marcaj', () => {
  const existing: Translations = {
    en: { name: 'Tripe soup', description: '   ', ai_fields: ['name'] },
    de: { name: 'Kuttelsuppe' },
    fr: { name: 'Gardée' }, // limbă necerută mai jos
  }
  const ai: Translations = {
    en: { name: 'AI soup', description: 'With sour cream' },
    de: { name: 'KI Suppe', description: 'Mit Sahne', meta_text: 'halucinat' },
    fr: { name: 'IA' },
    ro: { name: 'Bază' },
  }

  it('completează golurile (inclusiv spațiile), marchează doar ce a completat', () => {
    const { translations, filled } = mergeAiTranslations(existing, ai, {
      langs: ['ro', 'en', 'de'],
      base: 'ro',
      fields: { name: true, description: true },
    })
    expect(translations).toEqual({
      // numele existent și marcajul lui rămân; descrierea „   ” = gol → completată
      en: { name: 'Tripe soup', description: 'With sour cream', ai_fields: ['name', 'description'] },
      // meta_text nu e permis (halucinat) → aruncat; numele manual rămâne nemarcat
      de: { name: 'Kuttelsuppe', description: 'Mit Sahne', ai_fields: ['description'] },
      fr: { name: 'Gardée' },
    })
    expect(filled).toBe(2)
  })

  it('o limbă nouă primește tot ce e permis; descrierea fără original nu', () => {
    const { translations, filled } = mergeAiTranslations(null, { it: { name: 'Zuppa', description: 'x' } }, {
      langs: ['it'],
      fields: { name: true },
    })
    expect(translations).toEqual({ it: { name: 'Zuppa', ai_fields: ['name'] } })
    expect(filled).toBe(1)
  })

  it('e idempotentă și nu mută intrarea', () => {
    const snap = JSON.stringify(existing)
    const opts = { langs: ['en', 'de'], fields: { name: true, description: true } }
    const once = mergeAiTranslations(existing, ai, opts)
    const twice = mergeAiTranslations(once.translations, ai, opts)
    expect(twice.filled).toBe(0)
    expect(twice.translations).toEqual(once.translations)
    expect(JSON.stringify(existing)).toBe(snap)
  })

  it('AI gol sau gunoi → nimic scris', () => {
    const broken = 'gunoi' as unknown as Translations
    expect(mergeAiTranslations(existing, broken, { langs: ['en'], fields: { name: true } })).toEqual({
      translations: existing,
      filled: 0,
    })
  })
})

describe('TC2 mergeTranslations — marcajul cade doar la schimbare', () => {
  const existing: Translations = {
    en: { name: 'Mains', description: 'păstrată', ai_fields: ['name', 'description'] },
    de: { name: 'Haupt', ai_fields: ['name'] },
  }

  it('nume neschimbat → marcaj păstrat; schimbat → scos; golit → scos', () => {
    const out = mergeTranslations(existing, { en: ' Mains ', de: 'Hauptgerichte' }, ['en', 'de'])
    expect(out.en).toEqual({ name: 'Mains', description: 'păstrată', ai_fields: ['name', 'description'] })
    expect(out.de).toEqual({ name: 'Hauptgerichte' })
    const cleared = mergeTranslations(existing, { en: '' }, ['en'])
    expect(cleared.en).toEqual({ description: 'păstrată', ai_fields: ['description'] })
  })

  it('field=meta_text scrie subtitlul și lasă numele (cu marcajul lui)', () => {
    const out = mergeTranslations(existing, { de: 'Warm' }, ['de'], 'ro', 'meta_text')
    expect(out.de).toEqual({ name: 'Haupt', ai_fields: ['name'], meta_text: 'Warm' })
  })
})

describe('TC3 scriitorii manuali și aiFieldsOf', () => {
  const tr: Translations = {
    en: { name: 'Soup', description: 'Hot', ai_fields: ['name', 'description'] },
    fr: { name: 'Soupe', ai_fields: ['name'] }, // limbă neatinsă
  }

  it('applyManualEdit: câmpurile trimise se scriu și își pierd marcajul, restul rămân', () => {
    const out = applyManualEdit(tr, 'en', { name: ' Broth ' })
    expect(out).toEqual({
      en: { name: 'Broth', description: 'Hot', ai_fields: ['description'] },
      fr: { name: 'Soupe', ai_fields: ['name'] },
    })
    // Confirmarea unui text AI neschimbat e tot o trimitere: marcajul cade.
    expect(applyManualEdit(tr, 'en', { name: 'Soup', description: 'Hot' }).en).toEqual({
      name: 'Soup',
      description: 'Hot',
    })
    // '' șterge câmpul; intrarea rămasă goală dispare; baza nu se scrie.
    expect(applyManualEdit({ de: { name: 'X' } }, 'de', { name: '' })).toEqual({})
    expect(applyManualEdit(tr, 'ro', { name: 'Supă' })).toEqual(tr)
  })

  it('markTranslationReviewed: doar marcajul pleacă; intrarea doar cu marcaj dispare', () => {
    expect(markTranslationReviewed(tr, 'en')).toEqual({
      en: { name: 'Soup', description: 'Hot' },
      fr: { name: 'Soupe', ai_fields: ['name'] },
    })
    expect(markTranslationReviewed(tr, 'en', ['description']).en).toEqual({
      name: 'Soup',
      description: 'Hot',
      ai_fields: ['name'],
    })
    const onlyFlag = { en: { ai_fields: ['name'] } } as Translations
    expect(markTranslationReviewed(onlyFlag, 'en')).toEqual({})
    // Fără marcaj: neschimbat (nici o intrare goală nu dispare).
    const plain = { en: {} } as Translations
    expect(markTranslationReviewed(plain, 'en')).toEqual(plain)
  })

  it('setTranslationValue: tastarea scoate marcajul câmpului atins', () => {
    expect(setTranslationValue(tr, 'en', 'name', 'Sou')).toEqual({
      en: { name: 'Sou', description: 'Hot', ai_fields: ['description'] },
      fr: { name: 'Soupe', ai_fields: ['name'] },
    })
    expect(setTranslationValue({ en: { name: 'A', ai_fields: ['name'] } }, 'en', 'name', '')).toEqual({})
    // netrimat cât omul scrie
    expect(setTranslationValue(null, 'de', 'name', 'Suppe ').de).toEqual({ name: 'Suppe ' })
  })

  it('nu mută intrarea', () => {
    const snap = JSON.stringify(tr)
    applyManualEdit(tr, 'en', { name: 'Z' })
    markTranslationReviewed(tr, 'en')
    setTranslationValue(tr, 'en', 'name', 'Z')
    expect(JSON.stringify(tr)).toBe(snap)
  })

  it('aiFieldsOf ignoră gunoiul, câmpurile necunoscute și marcajele pe text gol', () => {
    expect(aiFieldsOf(null)).toEqual([])
    expect(aiFieldsOf({ name: 'A', ai_fields: 'name' } as unknown as TranslationEntry)).toEqual([])
    expect(
      aiFieldsOf({ name: 'A', description: '  ', ai_fields: ['zzz', 'description', 'name', 'name'] } as unknown as TranslationEntry),
    ).toEqual(['name'])
  })
})

describe('TC4 cititorii oaspetelui ignoră marcajul', () => {
  it('trName/trDesc/trMeta: același rezultat cu și fără marcaj', () => {
    const plain = { name: 'Supă', description: 'Caldă', meta_text: 'Zilnic', translations: { en: { name: 'Soup', description: 'Hot', meta_text: 'Daily' } } }
    const flagged = {
      ...plain,
      translations: { en: { ...plain.translations.en, ai_fields: ['name', 'description', 'meta_text'] } } as Translations,
    }
    for (const row of [plain, flagged]) {
      expect(trName(row, 'en')).toBe('Soup')
      expect(trDesc(row, 'en')).toBe('Hot')
      expect(trMeta(row, 'en')).toBe('Daily')
    }
    const onlyFlag = { name: 'Supă', description: null, meta_text: null, translations: { en: { ai_fields: ['name'] } } as Translations }
    expect(trName(onlyFlag, 'en')).toBe('Supă')
    expect(trDesc(onlyFlag, 'en')).toBeNull()
  })

  it('availableMenuLangs nu oferă o limbă al cărei singur conținut e marcajul', () => {
    const cats = [
      { translations: { de: { ai_fields: ['name'] } } as Translations, products: [] },
    ]
    expect(availableMenuLangs(cats)).toEqual([])
    // Control: cu text, limba apare.
    expect(availableMenuLangs([{ translations: { de: { name: 'X', ai_fields: ['name'] } } as Translations }])).toEqual(['de'])
  })
})

describe('TC5 ?lang= pentru previzualizare', () => {
  it('langFromSearch: doar coduri cunoscute, lowercase', () => {
    expect(langFromSearch('?lang=de')).toBe('de')
    expect(langFromSearch('?lang=DE')).toBe('de')
    expect(langFromSearch('?lang=xx')).toBeNull()
    expect(langFromSearch('')).toBeNull()
    expect(langFromSearch('?cat=1&lang=en&x=2')).toBe('en')
    expect(langFromSearch('?cat=1')).toBeNull()
  })

  it('requestedMenuLang: doar o limbă oferită, nu baza', () => {
    expect(requestedMenuLang('en', ['en', 'de'], 'ro')).toBe('en')
    expect(requestedMenuLang('ro', ['en'], 'ro')).toBeNull()
    expect(requestedMenuLang('fr', ['en'], 'ro')).toBeNull()
    expect(requestedMenuLang(null, ['en'], 'ro')).toBeNull()
  })
})
