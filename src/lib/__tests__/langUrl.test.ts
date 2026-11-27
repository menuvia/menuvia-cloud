// `?lang=` în adresa paginilor publice, roboții de indexare și limba de pornire
// a paginii de rezervare (lotul C8e, src/lib/i18nMenu.ts). Prefixul HRF:
// verificat cu grep în src/, tests/, e2e/, supabase/, docs/ și CLAUDE.md.
//
//   HRF1  searchWithLang pune/scoate DOAR `lang`: `?cancel=` rămâne, `lang=EN`
//         vechi e înlocuit, fără parametri → șir gol (nu un `?` orfan).
//         [PICĂ: o variantă care construiește `?lang=x` de la zero — pierde
//         codul de anulare din linkul de pe ecranul de succes]
//   HRF2  replaceUrlLang rescrie adresa curentă fără intrare nouă în istoric
//         (history.length neschimbat), păstrând calea, ceilalți parametri și
//         hash-ul; `null` scoate parametrul. Control: aceeași limbă → niciun
//         replaceState. [PICĂ: pushState în loc de replaceState → HRF2]
//   HRF3  isLikelyCrawler: Googlebot / Bingbot / Applebot / YandexBot /
//         Google-InspectionTool DA; Chrome, Safari pe iPhone și un telefon
//         CUBOT (conține „bot” ca subșir) NU. [PICĂ: `/bot/i` fără graniță →
//         CUBOT; regex fără `googlebot` → Googlebot]
//   HRF4  initialReservePageLang: `?lang=` câștigă (orice din cele 7, și baza),
//         apoi browserul (dacă e una din cele 7), apoi BAZA localului — nu EN;
//         un robot sare peste browser. [PICĂ: fallback-ul vechi pe 'en'; robotul
//         care primește limba browserului]
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  searchWithLang,
  replaceUrlLang,
  isLikelyCrawler,
  initialReservePageLang,
  langFromSearch,
} from '../i18nMenu'

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('searchWithLang', () => {
  it('HRF1 pune sau scoate doar `lang`, restul parametrilor rămâne', () => {
    expect(searchWithLang('?cancel=AB12CD34', 'de')).toBe('?cancel=AB12CD34&lang=de')
    expect(searchWithLang('?lang=EN&cancel=AB12', 'fr')).toBe('?lang=fr&cancel=AB12')
    expect(searchWithLang('?lang=en&cancel=AB12', null)).toBe('?cancel=AB12')
    expect(searchWithLang('?lang=en', null)).toBe('')
    expect(searchWithLang('', 'ro')).toBe('?lang=ro')
    // Ce scrie, citește înapoi (semantica O6c).
    expect(langFromSearch(searchWithLang('?x=1', 'hu'))).toBe('hu')
  })
})

describe('replaceUrlLang', () => {
  it('HRF2 rescrie adresa fără intrare nouă în istoric; aceeași limbă nu atinge nimic', () => {
    window.history.replaceState(null, '', '/rezervare/bistro?cancel=AB12#sus')
    const before = window.history.length
    replaceUrlLang('de')
    expect(window.location.pathname).toBe('/rezervare/bistro')
    expect(window.location.search).toBe('?cancel=AB12&lang=de')
    expect(window.location.hash).toBe('#sus')
    expect(window.history.length).toBe(before)

    // Control: limba e deja în adresă → niciun replaceState.
    const spy = vi.spyOn(window.history, 'replaceState')
    replaceUrlLang('de')
    expect(spy).not.toHaveBeenCalled()

    replaceUrlLang(null)
    expect(window.location.search).toBe('?cancel=AB12')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('isLikelyCrawler', () => {
  it('HRF3 roboții cunoscuți DA, browserele și telefonul CUBOT NU', () => {
    const bots = [
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
      'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 (compatible; Google-InspectionTool/1.0;)',
    ]
    const people = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 10; CUBOT_X19) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    ]
    for (const ua of bots) expect(isLikelyCrawler(ua), ua).toBe(true)
    for (const ua of people) expect(isLikelyCrawler(ua), ua).toBe(false)
    expect(isLikelyCrawler(undefined)).toBe(false)
    expect(isLikelyCrawler('')).toBe(false)
  })
})

describe('initialReservePageLang', () => {
  it('HRF4 `?lang=` → browser → baza localului; robotul sare peste browser', () => {
    const base = { browserLang: 'en', crawler: false, base: 'ro' }
    expect(initialReservePageLang({ ...base, search: '?lang=hu' })).toBe('hu')
    // Și baza poate fi cerută explicit (linkul „Vezi meniul”/anulare din RO).
    expect(initialReservePageLang({ ...base, search: '?cancel=AB&lang=RO' })).toBe('ro')
    // Cod necunoscut în URL → mai departe, la browser.
    expect(initialReservePageLang({ ...base, search: '?lang=pl' })).toBe('en')
    expect(initialReservePageLang({ ...base, search: '' })).toBe('en')
    // Browser nesuportat → BAZA localului (francez), nu engleza de dinainte.
    expect(initialReservePageLang({ search: '', browserLang: null, crawler: false, base: 'fr' })).toBe('fr')
    expect(initialReservePageLang({ search: '', browserLang: 'pl', crawler: false, base: 'ro' })).toBe('ro')
    // Robotul: baza, chiar cu browserul în engleză; `?lang=` rămâne respectat.
    expect(initialReservePageLang({ ...base, crawler: true, search: '' })).toBe('ro')
    expect(initialReservePageLang({ ...base, crawler: true, search: '?lang=de' })).toBe('de')
  })
})
