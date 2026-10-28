// src/lib/__tests__/phone.test.ts
// PH-4: telefonul oaspetelui pleacă în E.164, cu prefixul de țară VIZIBIL.
// fn_sms_normalize_ro_phone (mig 228) face din orice „07” + 8 cifre un +407…,
// deci un număr străin scris în format național ajungea la un străin din RO.
import { describe, it, expect } from 'vitest'
import { toE164, isInternationalInput, CALLING_CODES, DEFAULT_CALLING_CODE, FREE_CALLING_CODE } from '../phone'
import { PUBLIC_MENU_STRINGS } from '../publicMenuStrings'

describe('toE164 (PH-4)', () => {
  it('PH1 implicitul românesc: 0722… / 722… / separatori → +40722…', () => {
    for (const raw of ['0722 123 456', '722123456', '0722-123-456', ' 0722.123.456 ']) expect(toE164('40', raw)).toBe('+40722123456')
  })
  it('PH2 „+” = deja internațional, selectul e ignorat', () => {
    expect(toE164('40', '+46 70 123 45 67')).toBe('+46701234567')
    expect(toE164('33', '+46701234567')).toBe('+46701234567')
  })
  it('PH3 „00” = deja internațional', () => {
    expect(toE164('40', '0046 70 123 45 67')).toBe('+46701234567')
    expect(toE164('40', '0040 722 123 456')).toBe('+40722123456')
  })
  it('PH4 țara aleasă + forma națională', () => {
    expect(toE164('46', '070-123 45 67')).toBe('+46701234567')
    expect(toE164('41', '079 123 45 67')).toBe('+41791234567')
    expect(toE164('33', '07 12 34 56 78')).toBe('+33712345678')
    expect(toE164('44', '07700 900123')).toBe('+447700900123')
    expect(toE164('373', '069 123 456')).toBe('+37369123456')
  })
  it('PH5 Italia își PĂSTREAZĂ 0-ul', () => {
    expect(toE164('39', '06 1234 5678')).toBe('+390612345678')
    expect(toE164('39', '347 123 4567')).toBe('+393471234567')
  })
  it('PH6 Ungaria: trunchiul e 06', () => {
    expect(toE164('36', '06 20 123 4567')).toBe('+36201234567')
    expect(toE164('36', '20 123 4567')).toBe('+36201234567')
  })
  it('PH7 US/CA: trunchiul e 1', () => {
    expect(toE164('1', '1 555 123 4567')).toBe('+15551234567')
    expect(toE164('1', '(555) 123-4567')).toBe('+15551234567')
  })
  it('PH8 trunchi rătăcit după prefix', () => {
    expect(toE164('40', '+40 0722 123 456')).toBe('+40722123456')
    expect(toE164('40', '+40 (0)722 123 456')).toBe('+40722123456')
    expect(toE164('40', '+44 (0)7700 900123')).toBe('+447700900123')
  })
  it('PH9 „40722…” fără + pe RO = deja cu prefix (paritate mig 228:199)', () => {
    expect(toE164('40', '40722123456')).toBe('+40722123456')
  })
  it('PH10 opțiunea liberă: fără prefix NU se ghicește +40', () => {
    expect(toE164(FREE_CALLING_CODE, '46701234567')).toBe('+46701234567')
    expect(toE164(FREE_CALLING_CODE, '0701234567')).toBeNull()
  })
  it('PH11 invalid → null', () => {
    for (const raw of ['', '   ', 'abc', '12345', '+1234567890123456']) expect(toE164('40', raw)).toBeNull()
    expect(toE164('99', '0701234567')).toBeNull()
  })
  it('PH12 miezul bug-ului: cu altă țară aleasă, forma națională NU iese +40', () => {
    for (const [cc, raw] of [['46', '0701234567'], ['41', '0791234567'], ['33', '0712345678']] as const) {
      const out = toE164(cc, raw)
      expect(out).not.toBeNull()
      expect(out?.startsWith('+40')).toBe(false)
    }
  })
  it('PH13 tabela: RO primul și implicit, coduri unice și prefix-free', () => {
    expect(DEFAULT_CALLING_CODE).toBe('40')
    expect(CALLING_CODES[0]).toEqual({ label: 'RO', cc: '40', trunk: '0' })
    for (const a of CALLING_CODES) for (const b of CALLING_CODES) if (a !== b) expect(b.cc.startsWith(a.cc)).toBe(false)
    expect(CALLING_CODES.some((c) => c.cc === FREE_CALLING_CODE)).toBe(false)
  })
  it('PH14 isInternationalInput', () => {
    expect(isInternationalInput('+40')).toBe(true)
    expect(isInternationalInput(' 0046 70')).toBe(true)
    expect(isInternationalInput('0722')).toBe(false)
  })
  it('PH15 cheile au toate cele 7 limbi, ne-goale (TOATĂ tabela, inclusiv guestStrings)', () => {
    // Extins de la cele 4 chei de telefon la toată tabela (PR 3, i18n oaspete):
    // o cheie nouă fără o limbă face T() să întoarcă undefined la runtime.
    const keys = Object.keys(PUBLIC_MENU_STRINGS) as Array<keyof typeof PUBLIC_MENU_STRINGS>
    expect(keys).toContain('phone_invalid')
    for (const k of keys)
      for (const l of ['ro', 'en', 'de', 'fr', 'it', 'hu', 'es'] as const) expect(PUBLIC_MENU_STRINGS[k][l].trim().length).toBeGreaterThan(0)
  })
})
