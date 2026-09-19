// Teste pe `usePWAInstall` (RESID-15).
//
// De ce există fișierul ăsta separat de `PWAPrompt.test.tsx`: acolo întregul
// modul `lib/pwa` e mock-uit (`vi.mock('../../lib/pwa')`), deci implementarea
// REALĂ a hook-ului nu e atinsă de niciun test — exact clasa de gol pe care o
// vânăm peste tot. Aici se randează hook-ul adevărat.
//
// Clasa de defect: în Safari cu „Block All Cookies" (și în unele webview-uri)
// obiectul `localStorage` EXISTĂ, dar orice acces la el ARUNCĂ `SecurityError`.
// Garda de dinainte era `typeof localStorage === 'undefined'`, care acoperă
// DOAR SSR-ul. Cum citirea stă în inițializatorul de `useState`, iar `PWAPrompt`
// e montat GLOBAL în `App.tsx` (deci și pe meniul QR), throw-ul urca până la
// singurul `ErrorBoundary` — care înfășoară tot arborele. Rezultatul nu era „un
// card PWA lipsă", ci ecranul de eroare în locul aplicației.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { usePWAInstall } from '../pwa'

const INSTALL_DISMISSED_KEY = 'pwa-install-dismissed'

function breakStorage(): void {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError')
  })
}

describe('usePWAInstall — storage ostil (RESID-15)', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('W1 storage care ARUNCĂ la citire → hook-ul se montează, nu aruncă', () => {
    breakStorage()
    // Pe implementarea veche asta arunca `SecurityError` din inițializatorul de
    // `useState` și ducea toată aplicația în ErrorBoundary.
    expect(() => renderHook(() => usePWAInstall())).not.toThrow()
  })

  it('W2 storage care ARUNCĂ la citire → fail-open: `dismissed` e false, cardul poate apărea', () => {
    breakStorage()
    const { result } = renderHook(() => usePWAInstall())
    // Nu putem citi `dismissed` direct (nu e expus), dar contractul observabil e
    // că hook-ul întoarce un API complet, utilizabil.
    expect(typeof result.current.dismiss).toBe('function')
    expect(typeof result.current.install).toBe('function')
    expect(result.current.canInstall).toBe(false)
  })

  it('W3 `dismiss()` nu aruncă atunci când scrierea eșuează', () => {
    breakStorage()
    const { result } = renderHook(() => usePWAInstall())
    expect(() => act(() => result.current.dismiss())).not.toThrow()
    expect(result.current.canInstall).toBe(false)
  })

  it('W4 pe un storage SĂNĂTOS amânarea se persistă și se citește înapoi', () => {
    // Controlul pozitiv: fără el, W1–W3 ar trece și cu o implementare care nu
    // atinge deloc storage-ul — adică cu funcționalitatea ștearsă, nu reparată.
    const { result } = renderHook(() => usePWAInstall())
    act(() => result.current.dismiss())
    expect(localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe('1')
  })
})
