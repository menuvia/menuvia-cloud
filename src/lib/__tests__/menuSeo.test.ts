// SEO-ul meniului public /m/:slug în limba AFIȘATĂ (lotul C8e, lib/menuSeo.ts).
// Prefixul MSE: verificat cu grep în src/, tests/, e2e/, supabase/, docs/ și
// CLAUDE.md. Partea de DOM (aplicarea în <head> și curățenia) e în
// src/hooks/__tests__/useMenuSeo.test.ts.
//
//   MSE1  pe limba de bază: titlul și descrierea vin din tabela oaspetelui în
//         limba bazei; canonicul e `/m/slug` FĂRĂ `?lang=`; sloganul localului
//         câștigă ca descriere. [PICĂ: titlul românesc fix „— Meniu” pe un
//         meniu francez]
//   MSE2  pe o limbă tradusă: titlul, descrierea (generică — sloganul nu are
//         traducere), canonicul `?lang=en`, og:locale `en_GB` + alternativele,
//         JSON-LD din categoriile TRADUSE cu `inLanguage` pe Menu și
//         `acceptsReservations` cu `?lang=en`. [PICĂ: canonicul fără `?lang=`;
//         JSON-LD fără inLanguage]
//   MSE3  hreflang: câte o intrare per limbă oferită (baza prima, ordinea
//         MENU_LANGS) + x-default pe bază; control: o singură limbă → nicio
//         alternativă și nici og:locale:alternate.
//   MSE4  adresele absolute pe baza primită (`publicBaseUrl`), fără dublu slash;
//         o limbă NEoferită descrie baza (pagina revine oricum pe bază).
import { describe, it, expect } from 'vitest'
import { buildMenuSeo, menuLangUrl, ogLocaleOf } from '../menuSeo'
import type { MenuSeo } from '../menuSeo'
import { makeCategory, makeProduct, makeRestaurant } from '../../components/__tests__/fixtures'
import { T } from '../publicMenuStrings'
import { Tf } from '../guestI18n'

const BASE_URL = 'https://meniu.example'

function seo(over: Partial<Parameters<typeof buildMenuSeo>[0]> = {}): MenuSeo {
  return buildMenuSeo({
    restaurant: makeRestaurant({ name: 'Bistro', slug: 'bistro', language: 'ro', tagline: 'Gătit în casă' }),
    categories: [],
    currency: 'RON',
    lang: 'ro',
    availableLangs: [],
    baseUrl: BASE_URL,
    ...over,
  })
}

describe('buildMenuSeo', () => {
  it('MSE1 limba de bază: titlu în limba bazei, canonicul fără ?lang=, sloganul ca descriere', () => {
    const ro = seo()
    expect(ro.title).toBe('Bistro — Meniu')
    expect(ro.description).toBe('Gătit în casă')
    expect(ro.canonical).toBe(`${BASE_URL}/m/bistro`)
    expect(ro.ogLocale).toBe('ro_RO')

    // Un meniu FRANCEZ (baza fr): titlul în franceză, nu „— Meniu”.
    const fr = seo({
      restaurant: makeRestaurant({ name: 'Chez Nous', slug: 'chez', language: 'fr', address: 'Rue 1' }),
      lang: 'fr',
    })
    expect(fr.title).toBe(Tf('fr', 'seo_menu_title', { name: 'Chez Nous' }))
    expect(fr.title).not.toContain('Meniu')
    expect(fr.description).toBe(Tf('fr', 'seo_menu_desc_addr', { name: 'Chez Nous', address: 'Rue 1' }))
    expect(fr.canonical).toBe(`${BASE_URL}/m/chez`)
    expect(fr.ogLocale).toBe('fr_FR')
  })

  it('MSE2 limba tradusă: text, canonic, og:locale și JSON-LD în engleză', () => {
    const soup = makeProduct({ name: 'Soup of the day', description: 'Hot', price: 19.5 })
    const cats = [makeCategory({ name: 'Soups', products: [soup] })]
    const en = seo({ lang: 'en', availableLangs: ['en', 'de'], categories: cats })
    expect(en.lang).toBe('en')
    expect(en.title).toBe(Tf('en', 'seo_menu_title', { name: 'Bistro' }))
    // Sloganul românesc nu are traducere — nu apare sub o pagină în engleză.
    expect(en.description).toBe(Tf('en', 'seo_menu_desc', { name: 'Bistro' }))
    expect(en.canonical).toBe(`${BASE_URL}/m/bistro?lang=en`)
    expect(en.ogLocale).toBe('en_GB')
    expect(en.ogLocaleAlternates).toEqual(['ro_RO', 'de_DE'])

    const ld = en.jsonLd as {
      url?: string
      description?: string
      acceptsReservations?: string
      hasMenu?: { inLanguage?: string; hasMenuSection?: Array<{ name: string; hasMenuItem: Array<{ name: string }> }> }
    }
    expect(ld.url).toBe(`${BASE_URL}/m/bistro?lang=en`)
    expect(ld.description).toBeUndefined()
    expect(ld.acceptsReservations).toBe(`${BASE_URL}/rezervare/bistro?lang=en`)
    expect(ld.hasMenu?.inLanguage).toBe('en')
    expect(ld.hasMenu?.hasMenuSection?.[0]?.name).toBe('Soups')
    expect(ld.hasMenu?.hasMenuSection?.[0]?.hasMenuItem[0]?.name).toBe('Soup of the day')
  })

  it('MSE3 hreflang per limbă oferită + x-default; o singură limbă → fără alternative', () => {
    const multi = seo({ lang: 'de', availableLangs: ['de', 'en'] })
    expect(multi.alternates).toEqual([
      { hreflang: 'ro', href: `${BASE_URL}/m/bistro` },
      { hreflang: 'en', href: `${BASE_URL}/m/bistro?lang=en` },
      { hreflang: 'de', href: `${BASE_URL}/m/bistro?lang=de` },
      { hreflang: 'x-default', href: `${BASE_URL}/m/bistro` },
    ])
    // Control: fără limbi în plus nu există nimic de adnotat.
    const single = seo()
    expect(single.alternates).toEqual([])
    expect(single.ogLocaleAlternates).toEqual([])
    // Pe bază, acceptsReservations rămâne fără `?lang=`.
    expect((single.jsonLd as { acceptsReservations?: string }).acceptsReservations).toBe(
      `${BASE_URL}/rezervare/bistro`,
    )
  })

  it('MSE4 adrese absolute fără dublu slash; limba neoferită descrie baza', () => {
    expect(menuLangUrl(`${BASE_URL}/`, 'bistro', 'en', 'ro')).toBe(`${BASE_URL}/m/bistro?lang=en`)
    expect(menuLangUrl(BASE_URL, 'bistro', 'ro', 'ro')).toBe(`${BASE_URL}/m/bistro`)
    expect(seo({ baseUrl: `${BASE_URL}//` }).canonical).toBe(`${BASE_URL}/m/bistro`)
    const stray = seo({ lang: 'it', availableLangs: ['en'] })
    expect(stray.lang).toBe('ro')
    expect(stray.canonical).toBe(`${BASE_URL}/m/bistro`)
    expect(stray.title).toBe(Tf('ro', 'seo_menu_title', { name: 'Bistro' }))
    expect(ogLocaleOf('hu')).toBe('hu_HU')
    // Cheile noi există în toate limbile (GK1 o cere pe toată tabela; aici
    // doar că titlul nu cade pe fallback-ul englezesc pe o limbă suportată).
    expect(T('es', 'seo_menu_title')).not.toBe(T('en', 'seo_menu_title'))
  })
})
