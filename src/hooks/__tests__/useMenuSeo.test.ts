// useMenuSeo aplică SEO-ul meniului în <head> și îl reface la plecare (lotul
// C8e; calculul e testat pur în src/lib/__tests__/menuSeo.test.ts).
//
//   MSE5  în engleză: titlul, og:locale (suprascris din index.html), canonicul
//         `?lang=en`, câte un `<link rel=alternate hreflang>` per limbă +
//         x-default și `og:locale:alternate`; JSON-LD cu `inLanguage`.
//         [PICĂ: hook-ul de dinainte — titlu „— Meniu”, fără hreflang]
//   MSE6  schimbarea limbii (rerender) înlocuiește setul, nu-l dublează; la
//         demontare titlul, og:locale și canonicul de dinainte revin, iar
//         elementele create dispar. [PICĂ: alternativele adăugate fără
//         curățenie → 8 link-uri după rerender]
//   MSE7  adresele vin din `publicBaseUrl` (VITE_APP_URL când e setat), nu din
//         originea ferestrei. [PICĂ: `window.location.origin` readus]
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMenuSeo } from '../useMenuSeo'
import { makeCategory, makeProduct, makeRestaurant } from '../../components/__tests__/fixtures'
import { Tf } from '../../lib/guestI18n'
import type { Category } from '../../lib/qr'

const restaurant = makeRestaurant({ name: 'Bistro', slug: 'bistro', language: 'ro' })
const categories: Category[] = [makeCategory({ name: 'Soups', products: [makeProduct({ name: 'Soup' })] })]
const LANGS: readonly string[] = ['en', 'de']

const alternates = () =>
  Array.from(document.head.querySelectorAll('link[rel="alternate"]')).map(
    (l) => `${l.getAttribute('hreflang')}=${l.getAttribute('href')}`,
  )
const meta = (sel: string) => document.head.querySelector(sel)?.getAttribute('content') ?? null

beforeEach(() => {
  document.head.innerHTML = '<meta property="og:locale" content="ro_RO" />'
  document.title = 'Menuvia'
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('useMenuSeo', () => {
  it('MSE5 în engleză: titlu, og:locale, canonic, hreflang, JSON-LD', () => {
    const origin = window.location.origin
    vi.stubEnv('VITE_APP_URL', '')
    const { unmount } = renderHook(() => useMenuSeo(restaurant, categories, 'RON', 'en', LANGS))
    expect(document.title).toBe(Tf('en', 'seo_menu_title', { name: 'Bistro' }))
    expect(meta('meta[property="og:locale"]')).toBe('en_GB')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${origin}/m/bistro?lang=en`,
    )
    expect(alternates()).toEqual([
      `ro=${origin}/m/bistro`,
      `en=${origin}/m/bistro?lang=en`,
      `de=${origin}/m/bistro?lang=de`,
      `x-default=${origin}/m/bistro`,
    ])
    const altLocales = Array.from(document.head.querySelectorAll('meta[property="og:locale:alternate"]')).map(
      (m) => m.getAttribute('content'),
    )
    expect(altLocales).toEqual(['ro_RO', 'de_DE'])
    const ld = JSON.parse(document.getElementById('menuvia-menu-jsonld')?.textContent ?? '{}') as {
      hasMenu?: { inLanguage?: string }
    }
    expect(ld.hasMenu?.inLanguage).toBe('en')
    unmount()
  })

  it('MSE6 schimbarea limbii înlocuiește setul; demontarea reface <head>', () => {
    vi.stubEnv('VITE_APP_URL', '')
    const { rerender, unmount } = renderHook(
      ({ lang }: { lang: string }) => useMenuSeo(restaurant, categories, 'RON', lang, LANGS),
      { initialProps: { lang: 'en' } },
    )
    rerender({ lang: 'de' })
    expect(alternates()).toHaveLength(4)
    expect(document.head.querySelectorAll('meta[property="og:locale:alternate"]')).toHaveLength(2)
    expect(document.head.querySelectorAll('#menuvia-menu-jsonld')).toHaveLength(1)
    expect(meta('meta[property="og:locale"]')).toBe('de_DE')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toMatch(/\?lang=de$/)

    unmount()
    expect(document.title).toBe('Menuvia')
    expect(meta('meta[property="og:locale"]')).toBe('ro_RO')
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
    expect(alternates()).toEqual([])
    expect(document.head.querySelectorAll('meta[property="og:locale:alternate"]')).toHaveLength(0)
    expect(document.getElementById('menuvia-menu-jsonld')).toBeNull()
    expect(meta('meta[property="og:title"]')).toBeNull()
  })

  it('MSE7 adresele pe publicBaseUrl (VITE_APP_URL), nu pe originea ferestrei', () => {
    vi.stubEnv('VITE_APP_URL', 'https://meniu.example')
    const { unmount } = renderHook(() => useMenuSeo(restaurant, categories, 'RON', 'ro', LANGS))
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://meniu.example/m/bistro',
    )
    expect(meta('meta[property="og:url"]')).toBe('https://meniu.example/m/bistro')
    unmount()
  })
})
