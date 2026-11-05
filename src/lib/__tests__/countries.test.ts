// Țara restaurantului (mig 296) — lib/countries.ts.
//   CN1  codurile respectă CHECK-ul din DB (^[A-Z]{2}$), unice, RO primul
//   CN2  monedele sunt TOATE în whitelist-ul CHECK-ului din mig 205
//   CN3  patch-ul post-creare: null pe RO (zero apeluri pe fluxul românesc),
//        țară+monedă+fus pe restul; cod necunoscut → null
//   CN4  normalizare
//   CN5  câmpul din Setări: ascuns pe .ro pentru un local RO (UI neschimbat),
//        vizibil pe .com și pentru orice local deja în afara RO
import { describe, it, expect } from 'vitest'
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  countrySettingVisible,
  normalizeCountry,
  restaurantCountryPatch,
  regionalPatchFrom,
  followCountryDefaults,
  timeZoneOptions,
} from '../countries'
import { MENU_CURRENCIES } from '../currency'

describe('countries', () => {
  it('CN1: coduri ISO alpha-2, unice, RO primul', () => {
    const codes = COUNTRIES.map((c) => c.code)
    expect(codes[0]).toBe('RO')
    expect(DEFAULT_COUNTRY).toBe('RO')
    expect(new Set(codes).size).toBe(codes.length)
    for (const c of codes) expect(c).toMatch(/^[A-Z]{2}$/)
  })

  it('CN2: monedele sunt în whitelist-ul DB (mig 205)', () => {
    for (const c of COUNTRIES) {
      expect((MENU_CURRENCIES as readonly string[]).includes(c.currency)).toBe(true)
      expect(c.timezone).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$/)
    }
  })

  it('CN3: patch-ul post-creare', () => {
    expect(restaurantCountryPatch('RO')).toBeNull()
    expect(restaurantCountryPatch('XX')).toBeNull()
    expect(restaurantCountryPatch('')).toBeNull()
    expect(restaurantCountryPatch('DE')).toEqual({
      country: 'DE',
      currency: 'EUR',
      timezone: 'Europe/Berlin',
    })
    expect(restaurantCountryPatch('GB')?.currency).toBe('GBP')
    expect(restaurantCountryPatch('BG')?.currency).toBe('EUR')
  })

  it('CN4: normalizare', () => {
    expect(normalizeCountry(' de ')).toBe('DE')
    expect(normalizeCountry('ZZ')).toBeNull()
    expect(normalizeCountry(42)).toBeNull()
  })
})

describe('countrySettingVisible', () => {
  it('CN5: .ro + RO ascuns; .com sau non-RO vizibil', () => {
    for (const c of ['RO', 'ro', ' RO ', null, undefined, '']) {
      expect(countrySettingVisible('ro', c)).toBe(false)
    }
    expect(countrySettingVisible('ro', 'DE')).toBe(true)
    expect(countrySettingVisible('ro', 'CH')).toBe(true) // țară setată de suport, în afara listei
    for (const c of ['RO', 'DE', null]) expect(countrySettingVisible('com', c)).toBe(true)
  })
})

// Lotul G1 — setările regionale.
//   CN6  regionalPatchFrom: o locație nouă copiază doar câmpurile VALIDE care
//        diferă de default-urile din DB; un local românesc nu copiază nimic
//        (null = niciun apel). Mutația care pică: patch-ul întreg mereu (un
//        local RO ar face un UPDATE în plus la fiecare creare).
//   CN7  followCountryDefaults: moneda și fusul urmează țara nouă DOAR dacă
//        erau default-urile țării vechi; o alegere de mână rămâne.
//        Mutația care pică: suprascrierea necondiționată (prețurile în lei ale
//        unui local din Germania ar trece pe EUR la orice schimbare de țară).
//   CN8  timeZoneOptions: valoarea curentă primul, fusurile țărilor, fără
//        duplicate.
describe('setările regionale (lotul G1)', () => {
  it('CN6 regionalPatchFrom', () => {
    expect(regionalPatchFrom(null)).toBeNull()
    expect(
      regionalPatchFrom({ country: 'RO', currency: 'RON', timezone: 'Europe/Bucharest', language: 'ro' }),
    ).toBeNull()
    expect(
      regionalPatchFrom({ country: 'de', currency: 'EUR', timezone: 'Europe/Berlin', language: 'de' }),
    ).toEqual({ country: 'DE', currency: 'EUR', timezone: 'Europe/Berlin', language: 'de' })
    // Doar câmpurile care diferă; cele invalide se sar.
    expect(
      regionalPatchFrom({ country: 'RO', currency: 'EUR', timezone: 'Mars/Olympus', language: 'xx' }),
    ).toEqual({ currency: 'EUR' })
    expect(regionalPatchFrom({ country: 'ZZ', currency: 'JPY', timezone: '', language: null })).toBeNull()
  })

  it('CN7 followCountryDefaults', () => {
    // Default-urile României → ale Germaniei.
    expect(followCountryDefaults('RO', 'DE', { currency: 'RON', timezone: 'Europe/Bucharest' })).toEqual({
      currency: 'EUR',
      timezone: 'Europe/Berlin',
    })
    // Moneda aleasă de mână rămâne; fusul implicit urmează.
    expect(followCountryDefaults('RO', 'DE', { currency: 'USD', timezone: 'Europe/Bucharest' })).toEqual({
      currency: 'USD',
      timezone: 'Europe/Berlin',
    })
    // Țara veche necunoscută = România.
    expect(followCountryDefaults(null, 'GB', { currency: 'RON', timezone: 'Europe/Bucharest' })).toEqual({
      currency: 'GBP',
      timezone: 'Europe/London',
    })
    // Țara nouă necunoscută: nimic nu se schimbă.
    expect(followCountryDefaults('RO', 'ZZ', { currency: 'RON', timezone: 'Europe/Bucharest' })).toEqual({
      currency: 'RON',
      timezone: 'Europe/Bucharest',
    })
  })

  it('CN8 timeZoneOptions', () => {
    const opts = timeZoneOptions('America/Los_Angeles')
    expect(opts[0]).toBe('America/Los_Angeles')
    expect(opts).toContain('Europe/Bucharest')
    expect(opts).toContain('Asia/Nicosia')
    expect(new Set(opts).size).toBe(opts.length)
    expect(timeZoneOptions(null)[0]).toBe('Europe/Bucharest')
  })
})
