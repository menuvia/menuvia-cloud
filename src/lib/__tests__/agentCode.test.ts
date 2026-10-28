// Codul de agent la înscriere (mig 301): normalizare, alegerea codului care
// pleacă, decizia de la „Creează cont" (cu lookup injectat — fără rețea).
//
//   AS1  normalizeAgentCode: lowercase, FĂRĂ spații (cod dictat), max 40
//   AS2  isAgentCodeShape: cod sau vanity (cu cratimă), 2–40, fără altceva
//   AS3  pickAgentCandidate: tastat > link; link scos de om nu pleacă; doar
//        spații = nimic tastat
//   AS4  resolveAgentCodeForSubmit: none / link nu cheamă serverul
//   AS5  cod tastat cu formă proastă → problem 'shape', FĂRĂ apel la server
//   AS6  cod tastat pe care serverul îl declară inexistent → problem 'unknown'
//   AS7  cod tastat valid → codul CANONIC (vanity → codul real)
//   AS8  eroare de lookup (rețea / plafon / DB fără 295) → pleacă codul tastat;
//        serverul rămâne autoritatea, o eroare NU oprește înscrierea
import { describe, it, expect } from 'vitest'
import {
  isAgentCodeShape,
  normalizeAgentCode,
  isAgentFieldVisible,
  pickAgentCandidate,
  pickSubmitCandidate,
  resolveAgentCodeForSubmit,
  type AgentCodeLookup,
} from '../agentCode'

function lookupReturning(res: AgentCodeLookup) {
  const calls: string[] = []
  const fn = (candidate: string): Promise<AgentCodeLookup> => {
    calls.push(candidate)
    return Promise.resolve(res)
  }
  return { fn, calls }
}

describe('normalizeAgentCode / isAgentCodeShape', () => {
  it('AS1 lowercase, fără spații, max 40', () => {
    expect(normalizeAgentCode('  K7M2 XQ9 ')).toBe('k7m2xq9')
    expect(normalizeAgentCode('ION-Pop')).toBe('ion-pop')
    expect(normalizeAgentCode('a\tb\nc')).toBe('abc')
    expect(normalizeAgentCode('x'.repeat(100))).toHaveLength(40)
    expect(normalizeAgentCode('   ')).toBe('')
  })

  it('AS2 forma acceptată de server (cod sau vanity)', () => {
    for (const ok of ['k7m2xq9', 'ab', 'ion-pop', 'a1', 'x'.repeat(40), '55667788']) {
      expect(isAgentCodeShape(ok), ok).toBe(true)
    }
    for (const bad of ['', 'a', 'x'.repeat(41), 'Ion', 'ion pop', 'ion_pop', 'ion.pop', "a'b", 'a;b']) {
      expect(isAgentCodeShape(bad), bad).toBe(false)
    }
  })
})

describe('pickAgentCandidate', () => {
  it('AS3 tastat > link; link scos nu pleacă; spații = nimic', () => {
    expect(pickAgentCandidate('', null, false)).toEqual({ source: 'none' })
    expect(pickAgentCandidate('', 'linkcode1', false)).toEqual({ source: 'link', code: 'linkcode1' })
    expect(pickAgentCandidate('', 'linkcode1', true)).toEqual({ source: 'none' })
    expect(pickAgentCandidate('   ', 'linkcode1', false)).toEqual({ source: 'link', code: 'linkcode1' })
    // alegerea explicită bate link-ul, chiar nescos
    expect(pickAgentCandidate('Tastat 1', 'linkcode1', false)).toEqual({
      source: 'typed',
      code: 'tastat1',
      shapeOk: true,
    })
    // și după ce link-ul a fost scos
    expect(pickAgentCandidate('tastat1', 'linkcode1', true)).toEqual({
      source: 'typed',
      code: 'tastat1',
      shapeOk: true,
    })
    expect(pickAgentCandidate("a'b", null, false)).toEqual({ source: 'typed', code: "a'b", shapeOk: false })
    expect(pickAgentCandidate('x', null, false)).toEqual({ source: 'typed', code: 'x', shapeOk: false })
  })
})

describe('pickSubmitCandidate', () => {
  it('AS9 câmpul ascuns de banner nu bate codul verificat din link', () => {
    // tastat ÎNAINTE ca link-ul să se verifice; acum bannerul e afișat
    expect(
      pickSubmitCandidate({ typed: "a'b", stored: 'k7m2xq9', dismissed: false, linkVerified: true }),
    ).toEqual({ source: 'link', code: 'k7m2xq9' })
    expect(
      pickSubmitCandidate({ typed: 'ion-pop', stored: 'k7m2xq9', dismissed: false, linkVerified: true }),
    ).toEqual({ source: 'link', code: 'k7m2xq9' })
  })

  it('AS10 câmp vizibil → tastatul contează (link neverificat, sau scos de om)', () => {
    expect(
      pickSubmitCandidate({ typed: 'ion-pop', stored: 'k7m2xq9', dismissed: false, linkVerified: false }),
    ).toEqual({ source: 'typed', code: 'ion-pop', shapeOk: true })
    expect(
      pickSubmitCandidate({ typed: "a'b", stored: 'k7m2xq9', dismissed: true, linkVerified: true }),
    ).toEqual({ source: 'typed', code: "a'b", shapeOk: false })
    expect(isAgentFieldVisible(true, false)).toBe(false)
    expect(isAgentFieldVisible(true, true)).toBe(true)
    expect(isAgentFieldVisible(false, false)).toBe(true)
  })
})

describe('resolveAgentCodeForSubmit', () => {
  it('AS4 none și link nu cheamă serverul', async () => {
    const l = lookupReturning({ state: 'unknown' })
    expect(await resolveAgentCodeForSubmit({ source: 'none' }, l.fn)).toEqual({ ok: true, code: null })
    expect(await resolveAgentCodeForSubmit({ source: 'link', code: 'linkcode1' }, l.fn)).toEqual({
      ok: true,
      code: 'linkcode1',
    })
    expect(l.calls).toEqual([])
  })

  it('AS5 formă proastă → shape, fără apel', async () => {
    const l = lookupReturning({ state: 'valid', code: 'whatever' })
    const res = await resolveAgentCodeForSubmit({ source: 'typed', code: "a'b", shapeOk: false }, l.fn)
    expect(res).toEqual({ ok: false, problem: 'shape' })
    expect(l.calls).toEqual([])
  })

  it('AS6 serverul spune „nu există" → unknown (formularul se oprește)', async () => {
    const l = lookupReturning({ state: 'unknown' })
    const res = await resolveAgentCodeForSubmit({ source: 'typed', code: 'nuexista', shapeOk: true }, l.fn)
    expect(res).toEqual({ ok: false, problem: 'unknown' })
    expect(l.calls).toEqual(['nuexista'])
  })

  it('AS7 valid → codul canonic (vanity → codul real)', async () => {
    const l = lookupReturning({ state: 'valid', code: 'k7m2xq9' })
    const res = await resolveAgentCodeForSubmit({ source: 'typed', code: 'ion-pop', shapeOk: true }, l.fn)
    expect(res).toEqual({ ok: true, code: 'k7m2xq9' })
    expect(l.calls).toEqual(['ion-pop'])
  })

  it('AS8 eroare de lookup → pleacă codul tastat; nu oprește înscrierea', async () => {
    const l = lookupReturning({ state: 'error' })
    const res = await resolveAgentCodeForSubmit({ source: 'typed', code: 'k7m2xq9', shapeOk: true }, l.fn)
    expect(res).toEqual({ ok: true, code: 'k7m2xq9' })
  })
})
