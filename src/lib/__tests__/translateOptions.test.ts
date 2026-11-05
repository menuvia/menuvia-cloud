// Opțiunile, grupurile și extra-urile traduse (lotul O6b, audit nov 2026 OPT-5).
//   TV1  localizeProduct traduce și grupurile, opțiunile și extra-urile;
//        fără traducere rămâne originalul. [PICĂ: localizarea veche doar pe
//        name/description — „Mărime”/„Mare” rămâneau în română]
//   TV2  trMeta: subtitlul categoriei pe limba cerută, originalul pe bază.
import { describe, it, expect } from 'vitest'
import { localizeProduct } from '../menuRefresh'
import { trMeta } from '../i18nMenu'
import { makeGroup, makeOption, makeProduct } from '../../components/__tests__/fixtures'

describe('traducerile opțiunilor', () => {
  it('TV1 grupurile, opțiunile și extra-urile se traduc', () => {
    const p = makeProduct({
      name: 'Pizza',
      modifier_groups: [
        makeGroup({
          name: 'Mărime',
          translations: { en: { name: 'Size' } },
          modifier_options: [
            makeOption({ name: 'Mare', translations: { en: { name: 'Large' } } }),
            makeOption({ name: 'Mică' }),
          ],
        }),
      ],
      extras: [
        { id: 'e1', name: 'Brânză extra', price: 4, emoji: null, display_order: 0, is_available: true, translations: { en: { name: 'Extra cheese' } } },
      ],
    })
    const en = localizeProduct(p, 'en')
    expect(en.modifier_groups[0].name).toBe('Size')
    expect(en.modifier_groups[0].modifier_options.map((o) => o.name)).toEqual(['Large', 'Mică'])
    expect(en.extras[0].name).toBe('Extra cheese')
    // Pe bază: același obiect.
    expect(localizeProduct(p, 'ro')).toBe(p)
  })

  it('TV2 subtitlul categoriei', () => {
    const c = { meta_text: 'Toate cu blat subțire', translations: { en: { meta_text: 'All thin crust' } } }
    expect(trMeta(c, 'en')).toBe('All thin crust')
    expect(trMeta(c, 'de')).toBe('Toate cu blat subțire')
    expect(trMeta(c, 'ro')).toBe('Toate cu blat subțire')
  })
})
