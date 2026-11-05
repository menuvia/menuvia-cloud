// Ce limbă vede personalul (lotul L0b).
//   RL1  ordinea: URL → cont → stocare → browser → site.
//   RL2  o limbă INACTIVĂ se sare (nu oprește căutarea); azi doar româna e
//        activă, deci orice preferință dă 'ro' (fundația e invizibilă).
//   RL3  conturile dinainte de mig 323 ('ro') rămân în română chiar cu
//        browserul și stocarea în engleză — decizia fondatorului.
//   RL4  subeticheta primară: 'fr-CA' → 'fr'; gunoiul se ignoră.
import { describe, it, expect } from 'vitest'
import { resolveUiLang } from '../resolveLang'
import type { StaffLang } from '../langs'

const ALL: readonly StaffLang[] = ['ro', 'en', 'fr', 'de']

describe('resolveUiLang', () => {
  it('RL1 ordinea surselor', () => {
    const base = { enabled: ALL, siteLang: 'ro' }
    expect(resolveUiLang({ ...base, urlLang: 'de', profileLang: 'fr', storedLang: 'en' })).toBe('de')
    expect(resolveUiLang({ ...base, profileLang: 'fr', storedLang: 'en', navigatorLangs: ['de'] })).toBe('fr')
    expect(resolveUiLang({ ...base, storedLang: 'en', navigatorLangs: ['de'] })).toBe('en')
    expect(resolveUiLang({ ...base, navigatorLangs: ['it-IT', 'de-AT'] })).toBe('de')
    expect(resolveUiLang({ ...base, siteLang: 'en' })).toBe('en')
    expect(resolveUiLang({ enabled: ALL })).toBe('ro')
  })

  it('RL2 limbile inactive se sar; azi totul dă română', () => {
    expect(resolveUiLang({ enabled: ['ro', 'en'], urlLang: 'fr', profileLang: 'en' })).toBe('en')
    expect(resolveUiLang({ urlLang: 'fr', profileLang: 'en', storedLang: 'de', navigatorLangs: ['en'], siteLang: 'en' })).toBe('ro')
  })

  it('RL3 contul vechi în română bate browserul și stocarea', () => {
    expect(resolveUiLang({ enabled: ALL, profileLang: 'ro', storedLang: 'en', navigatorLangs: ['en-US'] })).toBe('ro')
  })

  it('RL4 subeticheta primară și gunoiul', () => {
    expect(resolveUiLang({ enabled: ALL, navigatorLangs: ['fr-CA'] })).toBe('fr')
    expect(resolveUiLang({ enabled: ALL, urlLang: 'xx', profileLang: '', storedLang: '  ', siteLang: 'zz' })).toBe('ro')
    expect(resolveUiLang({ enabled: ALL, urlLang: 'EN' })).toBe('en')
  })
})
