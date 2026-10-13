// Site-ul curent (menuvia.ro vs menuvia.com) — lib/domain.ts.
//   DM1  doar menuvia.com + subdomeniile lui → 'com'
//   DM2  orice altceva → 'ro' (localhost, preview-uri, .ro, agenții, look-alike)
//   DM3  originile/hostname-urile canonice
//   DM4  domeniile platformei (white-label nu se aplică pe ele)
//   DM5  limba implicită a UI-ului pe site
//   DM6  redirect-urile de auth: .com → originea curentă; .ro → EXACT
//        `VITE_APP_URL || origin` (comportamentul de dinainte)
//   DM7  URL-urile publice (QR, meniu): .com → https://menuvia.com canonic;
//        .ro → EXACT `VITE_APP_URL || origin`
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
    expect(siteOrigin('ro')).toBe('https://menuvia.ro')
    expect(siteOrigin('com')).toBe('https://menuvia.com')
    expect(siteHost('ro')).toBe('menuvia.ro')
    expect(siteHost('com')).toBe('menuvia.com')
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

  it('DM6: auth — .com pe originea curentă, .ro neschimbat', () => {
    expect(authRedirectBase('menuvia.com', PINNED, 'https://menuvia.com')).toBe('https://menuvia.com')
    expect(authRedirectBase('www.menuvia.com', PINNED, 'https://www.menuvia.com')).toBe(
      'https://www.menuvia.com',
    )
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

  it('DM7: public — .com canonic (fără www), .ro neschimbat', () => {
    expect(publicBaseUrl('www.menuvia.com', PINNED, 'https://www.menuvia.com')).toBe('https://menuvia.com')
    expect(publicBaseUrl('menuvia.com', PINNED, 'https://menuvia.com')).toBe('https://menuvia.com')
    expect(publicBaseUrl('menuvia.ro', PINNED, 'https://menuvia.ro')).toBe(PINNED)
    expect(publicBaseUrl('menuvia.netlify.app', PINNED, 'https://menuvia.netlify.app')).toBe(PINNED)
    expect(publicBaseUrl('localhost', '', 'http://localhost:5173')).toBe('http://localhost:5173')
    expect(publicBaseUrl('localhost', null, 'http://localhost:5173')).toBe('http://localhost:5173')
  })
})
