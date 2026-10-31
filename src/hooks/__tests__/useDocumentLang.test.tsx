// `<html lang>` urmează limba oaspetelui (a11y-guest-html-lang, WCAG 3.1.1).
//
//   DL1  setează limba cât e montat, o schimbă la rerandare, o reface la
//        demontare (navigarea SPA înapoi nu moștenește limba meniului).
//   DL2  limbă necunoscută (null/gol) → nu atinge atributul.
//
// Mutație care pică: un hook gol (fără setAttribute) → DL1; fără cleanup → DL1
// (rămâne 'de' după unmount).
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDocumentLang } from '../useDocumentLang'

beforeEach(() => {
  document.documentElement.setAttribute('lang', 'ro')
})

describe('useDocumentLang', () => {
  it('DL1 setează, urmează și reface `<html lang>`', () => {
    const { rerender, unmount } = renderHook(({ l }: { l: string }) => useDocumentLang(l), {
      initialProps: { l: 'en' },
    })
    expect(document.documentElement.getAttribute('lang')).toBe('en')
    rerender({ l: 'de' })
    expect(document.documentElement.getAttribute('lang')).toBe('de')
    unmount()
    expect(document.documentElement.getAttribute('lang')).toBe('ro')
  })

  it('DL2 limba necunoscută nu atinge atributul', () => {
    const { unmount } = renderHook(() => useDocumentLang(null))
    expect(document.documentElement.getAttribute('lang')).toBe('ro')
    unmount()
    expect(document.documentElement.getAttribute('lang')).toBe('ro')
  })
})
