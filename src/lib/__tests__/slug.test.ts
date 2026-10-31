// Linkul public al meniului din numele localului (ux-owner-slug, audit oct 2026).
//
//   SG1  diacriticele românești devin litere, nu separatori: „Casa Țărănească”
//        → casa-taraneasca (regula veche dădea casa-r-neasc). Mutația care pică:
//        revenirea la `toLowerCase().replace(/[^a-z0-9]+/g, '-')`.
//   SG2  ș/ț cu SEDILĂ (ş/ţ, tastaturile vechi) și literele fără descompunere NFD
//        (ß, ł) — mutația „fără harta NON_DECOMPOSABLE” pică pe strasse/lodz.
//   SG3  forma finală: fără cratime la capete, separatorii comasați, plafon de
//        lungime fără cratimă la final; un nume fără litere cade pe fallback.
//   SG4  la TASTARE separatorul final rămâne (altfel „pizza-” nu se poate scrie),
//        dar diacriticele se scot la fel — mutația „slugify complet la tastare” pică.
import { describe, it, expect } from 'vitest'
import { SLUG_MAX_LENGTH, slugify, slugifyWhileTyping } from '../slug'

describe('slugify', () => {
  it('SG1 diacriticele românești devin litere', () => {
    expect(slugify('Casa Țărănească')).toBe('casa-taraneasca')
    expect(slugify('Cafeneaua Șură')).toBe('cafeneaua-sura')
    expect(slugify('Bistro „Î la Ăla”')).toBe('bistro-i-la-ala')
    expect(slugify('Café Müller')).toBe('cafe-muller')
  })

  it('SG2 sedila veche și literele fără descompunere', () => {
    expect(slugify('Bistro Ştefan Ţepeş')).toBe('bistro-stefan-tepes')
    expect(slugify('Straße 1')).toBe('strasse-1')
    expect(slugify('Łódź Pub')).toBe('lodz-pub')
  })

  it('SG3 capete curate, separatori comasați, plafon, fallback', () => {
    expect(slugify('  --La Bella!!  Trattoria--  ')).toBe('la-bella-trattoria')
    const long = slugify('a'.repeat(SLUG_MAX_LENGTH - 1) + ' bcd')
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(long.endsWith('-')).toBe(false)
    expect(slugify('🍕🍕')).toBe('restaurant')
    expect(slugify('', 'masa')).toBe('masa')
  })
})

describe('slugifyWhileTyping', () => {
  it('SG4 păstrează separatorul tastat, scoate diacriticele', () => {
    expect(slugifyWhileTyping('pizza-')).toBe('pizza-')
    expect(slugifyWhileTyping('Țară Nouă')).toBe('tara-noua')
    expect(slugifyWhileTyping('la bella')).toBe('la-bella')
  })
})
