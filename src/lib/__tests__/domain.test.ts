// Site-ul curent (menuvia.ro vs un host .com) — lib/domain.ts.
//   DM1  doar menuvia.com + subdomeniile lui → 'com'
//   DM2  orice altceva → 'ro' (localhost, preview-uri, .ro, agenții, look-alike)
//   DM3  originile/hostname-urile canonice — MEREU .ro (D3: .com nu ne aparține)
//   DM4  domeniile platformei (white-label nu se aplică pe ele)
//   DM5  limba implicită a UI-ului pe site
//   DM6  redirect-urile de auth: .ro → EXACT `VITE_APP_URL || origin`
//        (comportamentul de dinainte); un host .com → TOT .ro, niciodată .com
//   DM7  URL-urile publice (QR, meniu): același contract ca DM6
//   DM8  CLICHET: pe NICIUN host (nici .com) baza generată nu conține
//        domeniul .com
import { describe, it, expect } from 'vitest'
import {
  CONTACT_EMAIL,
  authRedirectBase,
  publicBaseUrl,
  MENUVIA_ROOT_DOMAINS,
  currentSite,
  defaultUiLang,
  isMenuviaRootHost,
  siteHost,
  siteOrigin,
} from '../domain'

describe('currentSite', () => {
  it('DM1: menuvia.com, www și subdomeniile → com (case/punct final tolerate)', () => {
    for (const h of ['menuvia.com', 'www.menuvia.com', 'app.menuvia.com', 'MENUVIA.COM', 'menuvia.com.']) {
      expect(currentSite(h)).toBe('com')
    }
  })

  it('DM2: tot restul → ro (comportamentul de azi)', () => {
    for (const h of [
      'menuvia.ro',
      'www.menuvia.ro',
      'staging.menuvia.ro',
      'localhost',
      '127.0.0.1',
      'menuvia.netlify.app',
      'deploy-preview-12--menuvia.netlify.app',
      'meniu.agentie.ro',
      'evilmenuvia.com',
      'menuvia.com.evil.io',
      'menuvia.co',
      '',
    ]) {
      expect(currentSite(h)).toBe('ro')
    }
  })

  it('DM3: origini și hostname-uri canonice', () => {
    expect(siteOrigin()).toBe('https://menuvia.ro')
    expect(siteHost()).toBe('menuvia.ro')
    // Adresa de contact rămâne pe .ro (singurul domeniu cu email).
    expect(CONTACT_EMAIL).toBe('contact@menuvia.ro')
  })

  it('DM4: domeniile platformei includ .ro ȘI .com', () => {
    expect([...MENUVIA_ROOT_DOMAINS]).toEqual(['menuvia.ro', 'menuvia.com'])
    for (const h of ['menuvia.ro', 'x.menuvia.ro', 'menuvia.com', 'www.menuvia.com']) {
      expect(isMenuviaRootHost(h)).toBe(true)
    }
    for (const h of ['agentie.ro', 'evilmenuvia.com', 'menuvia.ro.evil.io', 'localhost']) {
      expect(isMenuviaRootHost(h)).toBe(false)
    }
  })

  it('DM5: limba implicită — ro pe .ro, en pe .com', () => {
    expect(defaultUiLang('ro')).toBe('ro')
    expect(defaultUiLang('com')).toBe('en')
  })
})

describe('baza link-urilor generate', () => {
  const PINNED = 'https://menuvia.ro' // VITE_APP_URL din netlify.toml (production)

  it('DM6: auth — un host .com cade pe .ro, .ro neschimbat', () => {
    expect(authRedirectBase('menuvia.com', PINNED, 'https://menuvia.com')).toBe(PINNED)
    expect(authRedirectBase('www.menuvia.com', PINNED, 'https://www.menuvia.com')).toBe(PINNED)
    // fără VITE_APP_URL: tot .ro, nu originea .com curentă
    expect(authRedirectBase('menuvia.com', undefined, 'https://menuvia.com')).toBe('https://menuvia.ro')
    // .ro și tot ce nu e .com: EXACT `VITE_APP_URL || origin`
    for (const [host, vite, origin] of [
      ['menuvia.ro', PINNED, 'https://menuvia.ro'],
      ['menuvia.netlify.app', PINNED, 'https://menuvia.netlify.app'],
      ['deploy-preview-7--menuvia.netlify.app', '', 'https://deploy-preview-7--menuvia.netlify.app'],
      ['localhost', undefined, 'http://localhost:5173'],
      ['menuvia.com.evil.example', PINNED, 'https://menuvia.com.evil.example'],
    ] as const) {
      expect(authRedirectBase(host, vite, origin)).toBe(vite || origin)
    }
  })

  it('DM7: public — un host .com cade pe .ro, .ro neschimbat', () => {
    expect(publicBaseUrl('www.menuvia.com', PINNED, 'https://www.menuvia.com')).toBe(PINNED)
    expect(publicBaseUrl('menuvia.com', PINNED, 'https://menuvia.com')).toBe(PINNED)
    expect(publicBaseUrl('menuvia.com', undefined, 'https://menuvia.com')).toBe('https://menuvia.ro')
    expect(publicBaseUrl('menuvia.com', '', 'https://menuvia.com')).toBe('https://menuvia.ro')
    expect(publicBaseUrl('menuvia.ro', PINNED, 'https://menuvia.ro')).toBe(PINNED)
    expect(publicBaseUrl('menuvia.netlify.app', PINNED, 'https://menuvia.netlify.app')).toBe(PINNED)
    expect(publicBaseUrl('localhost', '', 'http://localhost:5173')).toBe('http://localhost:5173')
    expect(publicBaseUrl('localhost', null, 'http://localhost:5173')).toBe('http://localhost:5173')
  })

  it('DM8: niciun host (inclusiv .com) nu produce o bază cu domeniul .com', () => {
    const hosts = [
      'menuvia.com',
      'www.menuvia.com',
      'app.menuvia.com',
      'MENUVIA.COM',
      'menuvia.ro',
      'localhost',
      'menuvia.netlify.app',
    ]
    for (const h of hosts) {
      const origin = `https://${h}`
      for (const vite of [PINNED, undefined, null, '']) {
        const bases = [authRedirectBase(h, vite, origin), publicBaseUrl(h, vite, origin)]
        // Pe hosturile .com baza NU poate fi originea .com (nici a lui, nici www).
        if (currentSite(h) === 'com') {
          for (const b of bases) expect(b).not.toMatch(/menuvia\.com/i)
        }
      }
    }
    expect(siteOrigin()).not.toMatch(/menuvia\.com/i)
    expect(siteHost()).not.toMatch(/menuvia\.com/i)
  })
})
