// Unde au voie cardurile PWA (ux-owner-pwa-card-funnel + perf-guest-7, partea A).
// Cardurile sunt dialoguri fixate jos: „Instalează Menuvia” apărea la 30 s în
// mijlocul înscrierii și al onboarding-ului, peste butoanele pasului, iar pe
// meniul oaspetelui (/q, /m, /rezervare) apăreau carduri despre aplicația de
// staff, doar în română.
//
//   PA1  rutele: oaspetele și înscrierea → nu; dashboard / bucătărie / ospătar → da.
//        Mutația care pică: o regulă care lasă /q/ sau /auth
//   PA2  suprimarea (onboarding-ul nu e o rută): se cumulează, eliberarea e
//        idempotentă — o eliberare dublă nu are voie să reaprindă cardurile
//        cât altă suprimare e activă
//   PA3  hook-ul reacționează la suprimare și la navigare (ROUTE_CHANGE_EVENT)
//   PA4  cablajul: App montează PWAPrompt DOAR prin poartă, iar onboarding-ul îl
//        suprimă. Mutația care pică: `<PWAPrompt />` global, ca înainte
//   PA5  routerul anunță ruta după FIECARE commit (efect pe `state`), deci și
//        `replace()` chemat din randare — sesiune expirată pe /dashboard → /auth
//        — închide cardul deschis (recenzie CodeRabbit pe #319). Clichet pe
//        sursă: o randare reală a lui AppRouter cere tot contextul de auth și
//        restaurante. Mutația care pică: efectul scos sau legat de `[]`.
//   PA6  `beforeinstallprompt` se prinde din ENTRY (pwaGate), nu din chunk-ul
//        PWAPrompt: pe /q, /m și /auth chunk-ul nu se mai încarcă, deci un
//        ascultător doar în lib/pwa.ts lipsea la o încărcare directă — Chrome pe
//        Android își arăta mini-infobar-ul nativ peste meniul oaspetelui, iar
//        promptul (emis o dată pe încărcare) se pierdea până la /dashboard.
//        Fișierul NU importă lib/pwa. Mutația care pică: ascultătorul înapoi
//        doar în lib/pwa.ts (evenimentul nu mai e oprit, promptul nu e păstrat).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  PWA_INSTALLABLE_EVENT,
  deferredInstallPromptEvent,
  pwaPromptAllowedNow,
  pwaPromptAllowedOnPath,
  suppressPwaPrompts,
  usePwaPromptAllowed,
} from '../pwaGate'
import { ROUTE_CHANGE_EVENT } from '../routeEvents'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('pwaGate', () => {
  it('PA1 oaspetele și înscrierea fără carduri; ecranele de staff cu', () => {
    for (const p of [
      '/q/abc123',
      '/m/la-bella',
      '/rezervare/la-bella',
      '/auth',
      '/reset-password',
      '/invite/tok',
      '/sef-vanzari',
      '/sef-vanzari/tok',
      '/echipa',
      '/echipa/tok',
    ]) {
      expect(pwaPromptAllowedOnPath(p), p).toBe(false)
    }
    for (const p of ['/dashboard', '/kitchen', '/waiter', '/', '/founder']) {
      expect(pwaPromptAllowedOnPath(p), p).toBe(true)
    }
  })

  it('PA2 suprimările se cumulează; eliberarea e idempotentă', () => {
    window.history.replaceState({}, '', '/dashboard')
    expect(pwaPromptAllowedNow()).toBe(true)
    const a = suppressPwaPrompts()
    const b = suppressPwaPrompts()
    expect(pwaPromptAllowedNow()).toBe(false)
    a()
    a() // a doua eliberare a aceleiași suprimări nu contează
    expect(pwaPromptAllowedNow()).toBe(false)
    b()
    expect(pwaPromptAllowedNow()).toBe(true)
  })

  it('PA3 hook-ul urmează suprimarea și navigarea', () => {
    window.history.replaceState({}, '', '/dashboard')
    const { result } = renderHook(() => usePwaPromptAllowed())
    expect(result.current).toBe(true)
    const releases: Array<() => void> = []
    act(() => {
      releases.push(suppressPwaPrompts())
    })
    expect(result.current).toBe(false)
    act(() => releases.forEach((r) => r()))
    expect(result.current).toBe(true)
    act(() => {
      window.history.pushState({}, '', '/m/la-bella')
      window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT))
    })
    expect(result.current).toBe(false)
  })

  it('PA4 App montează cardurile doar prin poartă; onboarding-ul le suprimă', () => {
    const app = read('src/App.tsx')
    const mount = app.slice(
      app.indexOf('function PwaPromptMount()'),
      app.indexOf('function AppRouter()'),
    )
    expect(mount).toContain('usePwaPromptAllowed()')
    expect(mount).toContain('<PWAPrompt />')
    // `<PWAPrompt />` apare o singură dată în App: în interiorul porții.
    expect(app.split('<PWAPrompt />').length - 1).toBe(1)
    expect(app).toContain('<PwaPromptMount />')
    expect(read('src/pages/OnboardingPage.tsx')).toContain('useSuppressPwaPrompts()')
    expect(read('src/components/PWAPrompt.tsx')).toContain(
      'if (!pwaPromptAllowedNow()) return null',
    )
  })

  it('PA5 routerul anunță ruta după fiecare commit, inclusiv după replace() din randare', () => {
    const app = read('src/App.tsx')
    const router = app.slice(app.indexOf('function AppRouter()'))
    // Efectul stă înaintea oricărui `return` al routerului (regula hook-urilor),
    // deci și înaintea randării care face replace('/auth').
    const effect = router.indexOf(
      'useEffect(() => {\n    window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT))\n  }, [state])',
    )
    expect(effect).toBeGreaterThan(-1)
    expect(effect).toBeLessThan(router.indexOf('\n    return '))
    expect(effect).toBeLessThan(router.indexOf('replace(authPathWithNext('))
  })

  it('PA6 promptul de instalare se prinde din entry, fără chunk-ul cardurilor', () => {
    const installable = vi.fn()
    window.addEventListener(PWA_INSTALLABLE_EVENT, installable)
    try {
      const ev = new Event('beforeinstallprompt', { cancelable: true })
      window.dispatchEvent(ev)
      // Oprit: fără mini-infobar-ul nativ al lui Chrome (pe meniul oaspetelui).
      expect(ev.defaultPrevented).toBe(true)
      // Păstrat: cardul de pe /dashboard îl găsește după navigarea din /auth.
      expect(deferredInstallPromptEvent()).toBe(ev)
      expect(installable).toHaveBeenCalledTimes(1)
      window.dispatchEvent(new Event('appinstalled'))
      expect(deferredInstallPromptEvent()).toBeNull()
    } finally {
      window.removeEventListener(PWA_INSTALLABLE_EVENT, installable)
    }
  })
})
