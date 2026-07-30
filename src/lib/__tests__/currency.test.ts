// Teste pe afișarea prețurilor multi-monedă (mig 205) — fundația
// expansiunii internaționale pe planurile 1-2 (docs/PLAN_1M.md).
import { describe, it, expect } from 'vitest'
import { fmtPrice, resolveMenuCurrency, currencyLabel, currencyDecimals } from '../currency'

describe('fmtPrice — afișarea prețului în meniul client', () => {
  it('RON păstrează formatul istoric „12.50 lei" (default, apeluri vechi identice)', () => {
    expect(fmtPrice(12.5)).toBe('12.50 lei')
    expect(fmtPrice(12.5, 'RON')).toBe('12.50 lei')
  })

  it('EUR/BGN/MDL — sufix cu 2 zecimale', () => {
    expect(fmtPrice(12.5, 'EUR')).toBe('12.50 €')
    expect(fmtPrice(9, 'BGN')).toBe('9.00 лв')
    expect(fmtPrice(45, 'MDL')).toBe('45.00 lei')
  })

  it('HUF se afișează întreg (uzanța pieței maghiare)', () => {
    expect(fmtPrice(1200, 'HUF')).toBe('1200 Ft')
    expect(fmtPrice(1200.6, 'HUF')).toBe('1201 Ft')
  })

  it('USD/GBP — simbol prefixat', () => {
    expect(fmtPrice(9.99, 'USD')).toBe('$9.99')
    expect(fmtPrice(9.99, 'GBP')).toBe('£9.99')
  })
})

describe('resolveMenuCurrency — coerce fail-safe din DB', () => {
  it('valorile suportate trec, orice altceva cade pe RON', () => {
    expect(resolveMenuCurrency('EUR')).toBe('EUR')
    expect(resolveMenuCurrency('RON')).toBe('RON')
    expect(resolveMenuCurrency('XYZ')).toBe('RON')
    expect(resolveMenuCurrency(null)).toBe('RON')
    expect(resolveMenuCurrency(undefined)).toBe('RON')
    expect(resolveMenuCurrency(42)).toBe('RON')
  })
})

describe('currencyLabel / currencyDecimals — layout-ul split din carduri', () => {
  it('eticheta e simbolul monedei (mereu sufix în carduri)', () => {
    expect(currencyLabel()).toBe('lei')
    expect(currencyLabel('EUR')).toBe('€')
    expect(currencyLabel('USD')).toBe('$')
  })

  it('zecimalele urmează moneda (HUF fără fracție)', () => {
    expect(currencyDecimals('RON')).toBe(2)
    expect(currencyDecimals('HUF')).toBe(0)
  })
})
