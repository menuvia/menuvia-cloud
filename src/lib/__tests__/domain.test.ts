// Site-ul curent (menuvia.ro vs menuvia.com) — lib/domain.ts.
//   DM1  doar menuvia.com + subdomeniile lui → 'com'
//   DM2  orice altceva → 'ro' (localhost, preview-uri, .ro, agenții, look-alike)
//   DM3  originile/hostname-urile canonice
//   DM4  domeniile platformei (white-label nu se aplică pe ele)
//   DM5  limba implicită a UI-ului pe site
import { describe, it, expect } from 'vitest'
import {
  CONTACT_EMAIL,
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
