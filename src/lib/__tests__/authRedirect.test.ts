// Parametrul `?next=` de pe /auth (S1): doar cale INTERNĂ, niciodată open-redirect.
//
//   NX1  căi interne legitime trec neschimbate (inclusiv cu query)
//   NX2  CLICHET open-redirect: schemă, `//host`, `/\host`, `javascript:`, relativ,
//        goale/non-string, prea lungi — toate → null
//   NX3  capcanele de codificare: %2f%2f, %5c, %09, %0a, dublu codificat, spații,
//        newline, caractere de control — toate → null
//   NX4  /auth și sub-căile ei → null (buclă), dar /authors (alt prefix) trece
//   NX5  nextFromSearch: ia parametrul, aplică aceeași validare, fără parametru → null
//   NX6  authPathWithNext: produce /auth?next=<codificat>; rădăcina, /auth și
//        /dashboard simplu rămân pe /auth (decide rolul); dus-întors prin
//        nextFromSearch redă calea originală
import { describe, it, expect } from 'vitest'
import { authPathWithNext, nextFromSearch, safeNextPath } from '../authRedirect'

describe('safeNextPath', () => {
  it('NX1 căile interne legitime trec neschimbate', () => {
    for (const ok of [
      '/dashboard',
      '/waiter',
      '/kitchen',
      '/afiliat',
      '/dashboard?tab=billing',
      '/m/bistro-central',
      '/pricing?plan=growth&lang=ro',
      '/dashboard#sectiune',
    ]) {
      expect(safeNextPath(ok), ok).toBe(ok)
    }
  })

  it('NX2 open-redirect: orice nu e o cale internă cu UN singur / → null', () => {
    const bad: Array<string | null | undefined> = [
      null,
      undefined,
      '',
      'dashboard',
      'waiter',
      'https://evil.example/x',
      'http://evil.example',
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'mailto:a@b.ro',
      '/' + 'a'.repeat(400),
    ]
    for (const v of bad) expect(safeNextPath(v), String(v)).toBeNull()
  })

  it('NX3 capcane de codificare și caractere ascunse → null', () => {
    const bad = [
      '/%2f%2fevil.example', // //evil.example după decodare
      '/%2F%2Fevil.example',
      '/%5cevil.example', // /\evil.example
      '/%252f%252fevil.example', // dublu codificat
      '/%09/evil.example', // tab → browserul îl scoate: //evil.example
      '/%0a/evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/a b',
      '/a\u0000b',
      '/a\u007fb',
      '/ok\\..\\evil',
      '/%',
      '/%zz',
    ]
    for (const v of bad) expect(safeNextPath(v), JSON.stringify(v)).toBeNull()
  })

  it('NX4 /auth și sub-căile ei → null; alt prefix („/authors") trece', () => {
    for (const v of ['/auth', '/auth?lang=ro', '/auth/x', '/auth#h', '/auth?next=/waiter']) {
      expect(safeNextPath(v), v).toBeNull()
    }
    expect(safeNextPath('/authors')).toBe('/authors')
    expect(safeNextPath('/author?x=/auth')).toBe('/author?x=/auth')
  })

  it('NX5 `%25` rămas literal în query nu e respins (doar prima decodare e strictă)', () => {
    expect(safeNextPath('/dashboard?q=100%25')).toBe('/dashboard?q=100%25')
  })
})

describe('nextFromSearch', () => {
  it('NX6 citește și validează parametrul `next`', () => {
    expect(nextFromSearch('?next=%2Fwaiter')).toBe('/waiter')
    expect(nextFromSearch('?lang=ro&next=%2Fdashboard%3Ftab%3Dbilling')).toBe('/dashboard?tab=billing')
    expect(nextFromSearch('?next=//evil.example')).toBeNull()
    expect(nextFromSearch('?next=https%3A%2F%2Fevil.example')).toBeNull()
    expect(nextFromSearch('?lang=ro')).toBeNull()
    expect(nextFromSearch('')).toBeNull()
  })
})

describe('authPathWithNext', () => {
  it('NX7 produce /auth?next=… și dus-întors redă calea', () => {
    expect(authPathWithNext('/waiter', '')).toBe('/auth?next=%2Fwaiter')
    const p = authPathWithNext('/dashboard', '?tab=billing')
    expect(p).toBe('/auth?next=%2Fdashboard%3Ftab%3Dbilling')
    expect(nextFromSearch(p.slice('/auth'.length))).toBe('/dashboard?tab=billing')
    expect(nextFromSearch(authPathWithNext('/m/bistro', '').slice('/auth'.length))).toBe('/m/bistro')
  })

  it('NX8 rădăcina, /auth și /dashboard simplu nu poartă `next` (decide rolul)', () => {
    expect(authPathWithNext('/', '')).toBe('/auth')
    expect(authPathWithNext('', '')).toBe('/auth')
    expect(authPathWithNext('/auth', '?lang=ro')).toBe('/auth')
    expect(authPathWithNext('/dashboard', '')).toBe('/auth')
    expect(authPathWithNext('/dashboard', '?')).toBe('/auth')
  })

  it('NX9 o cale nesigură nu ajunge în `next`', () => {
    expect(authPathWithNext('//evil.example', '')).toBe('/auth')
    expect(authPathWithNext('/a b', '')).toBe('/auth')
  })
})
