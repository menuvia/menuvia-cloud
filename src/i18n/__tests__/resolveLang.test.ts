// Ce limbă vede personalul (lotul L0b).
//   RL1  ordinea: URL → cont → stocare → browser → site.
//   RL2  o limbă INACTIVĂ se sare (nu oprește căutarea); azi doar româna e
//        activă, deci orice preferință dă 'ro' (fundația e invizibilă).
//   RL3  conturile dinainte de mig 323 ('ro') rămân în română chiar cu
//        browserul și stocarea în engleză — decizia fondatorului.
//   RL4  subeticheta primară: 'fr-CA' → 'fr'; gunoiul se ignoră.
//   FL1  drumul de dinaintea panoului (lotul L2a): URL → cont → stocare → site,
//        pe româna și engleza de azi (E4a) — engleza NU așteaptă panoul.
//   FL2  limbile browserului nu contează: un român cu browserul în engleză
//        rămâne pe română pe menuvia.ro (ca înainte de L2a). Mutația care pică:
//        `resolveFunnelLang` care trece `navigatorLangs` mai departe.
//   FL3  FUNNEL_LANGS = româna + engleza + tot ce s-a activat pentru personal;
//        franceza și germana NU, cât timp panoul nu le are.
import { describe, it, expect } from 'vitest'
import { resolveFunnelLang, resolveUiLang } from '../resolveLang'
import { ENABLED_STAFF_LANGS, FUNNEL_LANGS, type StaffLang } from '../langs'

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

describe('resolveFunnelLang', () => {
  it('FL1 ordinea: URL → cont → stocare → site, cu engleza activă', () => {
    expect(resolveFunnelLang({ urlLang: 'en', profileLang: 'ro', storedLang: 'ro' })).toBe('en')
    expect(resolveFunnelLang({ profileLang: 'ro', storedLang: 'en', siteLang: 'en' })).toBe('ro')
    expect(resolveFunnelLang({ storedLang: 'en', siteLang: 'ro' })).toBe('en')
    expect(resolveFunnelLang({ siteLang: 'en' })).toBe('en')
    expect(resolveFunnelLang({})).toBe('ro')
    // Contul NOU (null, mig 323) nu oprește căutarea.
    expect(resolveFunnelLang({ profileLang: null, storedLang: 'en' })).toBe('en')
  })

  it('FL2 browserul nu contează (nici nu poate fi trecut)', () => {
    // Tipul nu acceptă `navigatorLangs`; un apel forțat tot nu-l folosește.
    const forced = { siteLang: 'ro', navigatorLangs: ['en-US'] } as unknown as Parameters<typeof resolveFunnelLang>[0]
    expect(resolveFunnelLang(forced)).toBe('ro')
  })

  it('FL3 româna, engleza și limbile activate; franceza/germana abia odată cu panoul', () => {
    expect(FUNNEL_LANGS).toContain('ro')
    expect(FUNNEL_LANGS).toContain('en')
    for (const l of ENABLED_STAFF_LANGS) expect(FUNNEL_LANGS).toContain(l)
    for (const l of ['fr', 'de'] as const) {
      expect(FUNNEL_LANGS.includes(l)).toBe(ENABLED_STAFF_LANGS.includes(l))
      if (!ENABLED_STAFF_LANGS.includes(l)) expect(resolveFunnelLang({ urlLang: l, storedLang: l })).toBe('ro')
    }
  })
})
