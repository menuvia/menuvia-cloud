// Țara restaurantului (mig 296) — lib/countries.ts.
//   CN1  codurile respectă CHECK-ul din DB (^[A-Z]{2}$), unice, RO primul
//   CN2  monedele sunt TOATE în whitelist-ul CHECK-ului din mig 205
//   CN3  patch-ul post-creare: null pe RO (zero apeluri pe fluxul românesc),
//        țară+monedă+fus pe restul; cod necunoscut → null
//   CN4  normalizare
import { describe, it, expect } from 'vitest'
import { COUNTRIES, DEFAULT_COUNTRY, normalizeCountry, restaurantCountryPatch } from '../countries'
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
