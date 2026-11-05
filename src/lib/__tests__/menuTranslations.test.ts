// lib/menuTranslations — raportul de traduceri al meniului (lotul O6c), pur.
//
//   MT1  buildTranslationUnits pe un instantaneu cu toate cele 5 feluri de rând:
//        cheile, tabelele, câmpurile (descrierea doar cu original nevid,
//        subtitlul doar pe categoriile cu subtitlu), contextul AI DOAR pe
//        grupuri/opțiuni/extra-uri și ordinea meniului. Mutația care pică:
//        `description` cerut pe orice produs (raportul ar număra goluri pe care
//        oaspetele nu le vede).
//   MT2  vizibilitatea oglindește get_menu_for_restaurant (mig 321): ciornele,
//        produsele inactive și cele fără categorie, extra-urile unui produs
//        ascuns sau indisponibile, grupul nelegat de un produs vizibil (și
//        opțiunile lui), opțiunile indisponibile — toate ies; ce nu e trimis
//        lipsește. Control pozitiv: câte un rând complet vizibil din fiecare fel
//        rămâne. Mutația care pică: filtrul `is_draft` scos.
//   MT3  missingFields / reviewFields / langCoverage pe limbă, în TEXTE;
//        spațiile = lipsă; de verificat = doar câmpurile cerute; baza nu cere
//        nimic. Mutația care pică: acoperirea numărată în rânduri.
//   MT4  needsAiTranslation = regula „lipsă” pe fiecare fel; remapCategoryAi
//        mută descrierea în subtitlu; menuPreviewPath codifică slug-ul; roCount
//        dă pluralul românesc; filterUnits caută fără diacritice și păstrează
//        rândurile salvate; guestMenuLangs = regula paginii publice.
import { describe, it, expect } from 'vitest'
import {
  TR_TABLE,
  aiOptionRows,
  buildTranslationUnits,
  filterUnits,
  guestMenuLangs,
  langCoverage,
  menuPreviewPath,
  missingFields,
  needsAiTranslation,
  remapCategoryAi,
  reviewFields,
  roCount,
  trFieldsFor,
  type TrProductRow,
  type TrUnit,
} from '../menuTranslations'

const categories = [
  { id: 'c2', name: 'Băuturi', meta_text: null, display_order: 1, translations: null },
  {
    id: 'c1',
    name: 'Ciorbe',
    meta_text: 'Servite cu pâine',
    display_order: 0,
    translations: { en: { name: 'Soups' } },
  },
]
const visibleProduct = (over: Partial<TrProductRow> = {}): TrProductRow => ({
  id: 'p1',
  name: 'Ciorbă de burtă',
  description: 'Cu smântână',
  category_id: 'c1',
  is_active: true,
  is_draft: false,
  display_order: 0,
  translations: null,
  ...over,
})
const products = [
  visibleProduct({ id: 'p2', name: 'Limonadă', description: '  ', category_id: 'c2' }),
  visibleProduct(),
  visibleProduct({ id: 'p-draft', is_draft: true }),
  visibleProduct({ id: 'p-off', is_active: false }),
  visibleProduct({ id: 'p-nocat', category_id: null }),
]
const groups = [
  { id: 'g1', name: 'Mărime', display_order: 0, translations: null },
  { id: 'g-unlinked', name: 'Nefolosit', display_order: 1, translations: null },
  { id: 'g-hidden', name: 'Doar pe ciornă', display_order: 2, translations: null },
]
const options = [
  { id: 'o2', modifier_group_id: 'g1', name: 'Mare', is_available: true, display_order: 1, translations: null },
  { id: 'o1', modifier_group_id: 'g1', name: 'Mică', is_available: true, display_order: 0, translations: null },
  { id: 'o-off', modifier_group_id: 'g1', name: 'Gigant', is_available: false, display_order: 2, translations: null },
  { id: 'o-un', modifier_group_id: 'g-unlinked', name: 'X', is_available: true, display_order: 0, translations: null },
]
const extras = [
  { id: 'e1', product_id: 'p1', name: 'Ardei iute', is_available: true, display_order: 0, translations: null },
  { id: 'e-off', product_id: 'p1', name: 'Smântână', is_available: false, display_order: 1, translations: null },
  { id: 'e-draft', product_id: 'p-draft', name: 'Pâine', is_available: true, display_order: 0, translations: null },
]
const links = [
  { product_id: 'p1', modifier_group_id: 'g1' },
  { product_id: 'p-draft', modifier_group_id: 'g-hidden' },
]

const full = () => buildTranslationUnits({ categories, products, groups, options, extras, links })
const byKey = (units: TrUnit[], key: string) => {
  const u = units.find((x) => x.key === key)
  if (!u) throw new Error(`${key} lipsește`)
  return u
}

describe('buildTranslationUnits', () => {
  it('MT1 chei, tabele, câmpuri, context și ordinea meniului', () => {
    const units = full()
    expect(units.map((u) => u.key)).toEqual([
      'category:c1',
      'category:c2',
      'product:p1',
      'product:p2',
      'group:g1',
      'option:o1',
      'option:o2',
      'extra:e1',
    ])
    expect(units.map((u) => u.table)).toEqual([
      'categories',
      'categories',
      'products',
      'products',
      'modifier_groups',
      'modifier_options',
      'modifier_options',
      'product_extras',
    ])
    expect(byKey(units, 'category:c1').fields).toEqual(['name', 'meta_text'])
    expect(byKey(units, 'category:c2').fields).toEqual(['name'])
    expect(byKey(units, 'product:p1').fields).toEqual(['name', 'description'])
    // descriere doar cu spații = fără descriere
    expect(byKey(units, 'product:p2').fields).toEqual(['name'])
    expect(byKey(units, 'product:p1').contextLabel).toBe('Ciorbe')
    expect(byKey(units, 'option:o1').contextLabel).toBe('Mărime')
    expect(byKey(units, 'extra:e1').contextLabel).toBe('Ciorbă de burtă')
    // Contextul AI: doar pe felurile noi.
    expect(byKey(units, 'group:g1').aiContext).toBe('Grup de opțiuni (ex.: Mică, Mare)')
    expect(byKey(units, 'option:o1').aiContext).toBe('Opțiune din grupul «Mărime»')
    expect(byKey(units, 'extra:e1').aiContext).toBe('Extra plătit la produsul «Ciorbă de burtă»')
    expect(byKey(units, 'product:p1').aiContext).toBeUndefined()
    expect(byKey(units, 'category:c1').aiContext).toBeUndefined()
    expect(TR_TABLE.extra).toBe('product_extras')
  })

  it('MT2 vizibilitatea = filtrele meniului public (control: un rând vizibil din fiecare fel)', () => {
    const keys = full().map((u) => u.key)
    for (const hidden of [
      'product:p-draft',
      'product:p-off',
      'product:p-nocat',
      'extra:e-off',
      'extra:e-draft',
      'group:g-unlinked',
      'option:o-un',
      'group:g-hidden',
      'option:o-off',
    ]) {
      expect(keys, hidden).not.toContain(hidden)
    }
    for (const shown of ['category:c1', 'product:p1', 'group:g1', 'option:o1', 'extra:e1']) {
      expect(keys, shown).toContain(shown)
    }
    // Ce nu e trimis lipsește (planul fără opțiuni nu le încarcă).
    const lean = buildTranslationUnits({ categories, products })
    expect(lean.every((u) => u.kind === 'category' || u.kind === 'product')).toBe(true)
    // Grupurile fără legături nu pot fi decise → lipsesc.
    expect(buildTranslationUnits({ categories, products, groups, options }).some((u) => u.kind === 'group')).toBe(false)
  })
})

describe('acoperirea pe limbă', () => {
  const units = buildTranslationUnits({
    categories: [
      { id: 'c1', name: 'Ciorbe', meta_text: 'Cu pâine', display_order: 0, translations: { en: { name: 'Soups', meta_text: '  ' } } },
    ],
    products: [
      visibleProduct({
        translations: {
          en: { name: 'Tripe soup', description: 'With cream', ai_fields: ['description'] },
          de: { name: 'Kuttelsuppe', ai_fields: ['name', 'meta_text'] },
        },
      }),
    ],
  })

  it('MT3 lipsă / de verificat / acoperire, în texte', () => {
    const cat = byKey(units, 'category:c1')
    const prod = byKey(units, 'product:p1')
    expect(missingFields(cat, 'en')).toEqual(['meta_text'])
    expect(missingFields(prod, 'de')).toEqual(['description'])
    expect(reviewFields(prod, 'en')).toEqual(['description'])
    // meta_text nu e cerut pe produs → nu e „de verificat”
    expect(reviewFields(prod, 'de')).toEqual(['name'])
    expect(langCoverage(units, 'en')).toEqual({ total: 4, done: 3, missing: 1, review: 1 })
    expect(langCoverage(units, 'de')).toEqual({ total: 4, done: 1, missing: 3, review: 1 })
    expect(langCoverage(units, 'ro')).toEqual({ total: 0, done: 0, missing: 0, review: 0 })
    expect(missingFields(prod, 'fr', 'fr')).toEqual([])
  })

  it('MT4 regula AI = regula „lipsă”', () => {
    for (const u of units) {
      for (const lang of ['en', 'de', 'it']) {
        expect(needsAiTranslation(u.fields, u.translations, [lang]), `${u.key} ${lang}`).toBe(
          missingFields(u, lang).length > 0,
        )
      }
    }
    expect(trFieldsFor('category', { name: 'A', meta_text: 'B', description: 'C' })).toEqual(['name', 'meta_text'])
    expect(trFieldsFor('extra', { name: 'A', description: 'C' })).toEqual(['name'])
  })
})

describe('utilitare', () => {
  it('MT4 remapCategoryAi, menuPreviewPath, roCount', () => {
    expect(
      remapCategoryAi({ c1: { en: { name: 'Soups', description: 'With bread' }, de: { name: 'Suppen' } } }),
    ).toEqual({ c1: { en: { name: 'Soups', meta_text: 'With bread' }, de: { name: 'Suppen' } } })
    expect(menuPreviewPath('la bunica/2', 'en')).toBe('/m/la%20bunica%2F2?lang=en')
    expect([1, 2, 19, 20, 101, 120].map((n) => roCount(n, 'text', 'texte'))).toEqual([
      '1 text',
      '2 texte',
      '19 texte',
      '20 de texte',
      '101 texte',
      '120 de texte',
    ])
    expect(roCount(0, 'text', 'texte')).toBe('0 texte')
  })

  it('MT4 filterUnits: filtru, căutare fără diacritice, rândurile salvate rămân', () => {
    const units = buildTranslationUnits({
      categories: [{ id: 'c1', name: 'Ciorbe', meta_text: null, display_order: 0, translations: { en: { name: 'Soups' } } }],
      products: [visibleProduct({ translations: { en: { name: 'Tripe soup', description: 'Cream', ai_fields: ['name'] } } })],
    })
    expect(filterUnits(units, 'en', 'missing', '').map((u) => u.key)).toEqual([])
    expect(filterUnits(units, 'en', 'review', '').map((u) => u.key)).toEqual(['product:p1'])
    expect(filterUnits(units, 'en', 'all', 'ciorb').map((u) => u.key)).toEqual(['category:c1', 'product:p1'])
    expect(filterUnits(units, 'en', 'all', 'CIORBĂ').map((u) => u.key)).toEqual(['product:p1'])
    expect(filterUnits(units, 'en', 'all', 'tripe').map((u) => u.key)).toEqual(['product:p1'])
    expect(filterUnits(units, 'en', 'missing', '', { keep: new Set(['category:c1']) }).map((u) => u.key)).toEqual([
      'category:c1',
    ])
  })

  it('MT4 guestMenuLangs = regula paginii publice; aiOptionRows poartă contextul', () => {
    const units = full()
    expect(guestMenuLangs(units, ['en', 'de'], 'ro')).toEqual(['en'])
    expect(guestMenuLangs(units, ['de'], 'ro')).toEqual([])
    const rows = aiOptionRows(units)
    expect(rows.groups.map((r) => r.id)).toEqual(['g1'])
    expect(rows.options.map((r) => [r.id, r.context])).toEqual([
      ['o1', 'Opțiune din grupul «Mărime»'],
      ['o2', 'Opțiune din grupul «Mărime»'],
    ])
    expect(rows.extras[0]).toMatchObject({ id: 'e1', name: 'Ardei iute' })
  })
})
