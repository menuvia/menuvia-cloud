// Formatele personalului (lotul L0b).
//   SF1  în română: BYTE-identic cu helperii de azi (fmtPrice, formatTimeInZone).
//   SF2  altă limbă: forma limbii, moneda și fusul RESTAURANTULUI.
//   SF3  eticheta: limbă + țară când Intl o știe (en-US → 12h), altfel europeană.
//   SF4  intrări invalide → '' (randare), monedă necunoscută → RON.
import { describe, it, expect } from 'vitest'
import { makeFormatters, staffLocale } from '../format'
import { fmtPrice } from '../../lib/currency'
import { formatTimeInZone } from '../../lib/dates'

const ISO = '2026-09-04T21:30:00Z' // 00:30 pe 5 sept la București (EEST)

describe('format', () => {
  it('SF1 română = helperii de azi', () => {
    const f = makeFormatters('ro')
    expect(f.money(12.5)).toBe(fmtPrice(12.5))
    expect(f.money(1200, 'HUF')).toBe(fmtPrice(1200, 'HUF'))
    expect(f.time(ISO)).toBe(formatTimeInZone(ISO))
    expect(f.time(ISO)).toBe('00:30')
    expect(f.date(ISO)).toBe('05.09.2026')
  })

  it('SF2 franceză: forma limbii, moneda și fusul localului', () => {
    const f = makeFormatters('fr')
    expect(f.money(12.5, 'EUR')).toMatch(/^12,50\s€$/)
    expect(f.time(ISO, 'Europe/Bucharest')).toBe('00:30')
    expect(f.time(ISO, 'Europe/Paris')).toBe('23:30')
    expect(f.date(ISO, 'Europe/Paris')).toBe('04/09/2026')
    expect(makeFormatters('de').money(12.5, 'RON')).toMatch(/^12,50\sRON$/)
  })

  it('SF3 eticheta de formatare', () => {
    expect(staffLocale('en')).toBe('en-GB')
    expect(staffLocale('en', 'us')).toBe('en-US')
    expect(staffLocale('fr', 'CH')).toBe('fr-CH')
    expect(staffLocale('de', '12')).toBe('de-DE')
    expect(makeFormatters('en', 'US').time(ISO, 'Europe/Bucharest')).toMatch(/^12:30\s?AM$/i)
  })

  it('SF4 intrări invalide', () => {
    const f = makeFormatters('en')
    expect(f.time('nu e dată')).toBe('')
    expect(f.date(null)).toBe('')
    expect(f.money(5, 'XYZ')).toMatch(/RON/)
  })
})
