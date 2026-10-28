// Decizii pure ale paginii de invitație de rețea.
//
//   SF1  calea de înscriere: cu `next` sigur, codificat, pe rolul corect
//   SF2  token cu formă greșită → null (nu punem gunoi într-un ?next=)
//   SF3  calea produsă trece de validarea open-redirect și NU conține nimic în afară de token
//   SF4  câmpuri valide → ok, CUI normalizat
//   SF5  telefon scurt/lung și CUI cu cifră de control greșită → mesaje clare
//   SF6  calea de bază (fără token) pe rol
import { describe, it, expect } from 'vitest'
import { INVITE_BASE_PATH, checkInviteFields, signupPathForInvite } from '../salesInviteFlow'
import { nextFromSearch } from '../authRedirect'
import { SALES_FAILURE_MESSAGES } from '../salesNetwork'

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'

describe('signupPathForInvite', () => {
  it('SF1: /auth?mode=signup cu next codificat, pe rolul corect', () => {
    expect(signupPathForInvite('head', TOKEN)).toBe(
      `/auth?mode=signup&lang=ro&next=${encodeURIComponent(`/sef-vanzari/${TOKEN}`)}`,
    )
    expect(signupPathForInvite('agent', TOKEN)).toBe(
      `/auth?mode=signup&lang=ro&next=${encodeURIComponent(`/echipa/${TOKEN}`)}`,
    )
  })

  it('SF2: token cu formă greșită → null', () => {
    for (const bad of ['', 'scurt', TOKEN + 'x', TOKEN.slice(1), `${TOKEN.slice(0, 42)}/`, '//evil.com']) {
      expect(signupPathForInvite('head', bad)).toBeNull()
    }
  })

  it('SF3: next-ul produs revine EXACT la invitație prin validarea AuthPage', () => {
    const path = signupPathForInvite('agent', TOKEN)
    expect(path).not.toBeNull()
    const search = (path as string).slice((path as string).indexOf('?'))
    expect(nextFromSearch(search)).toBe(`/echipa/${TOKEN}`)
  })
})

describe('checkInviteFields', () => {
  it('SF4: câmpuri valide', () => {
    const r = checkInviteFields(' 0722 123 456 ', 'RO 14399840')
    expect(r.ok).toBe(true)
    expect(r.phone).toBe('0722 123 456')
    expect(r.cui).toBe('14399840')
    expect(r.phoneError).toBeNull()
    expect(r.cuiError).toBeNull()
  })

  it('SF5: telefon și CUI invalide', () => {
    const shortPhone = checkInviteFields('123', '14399840')
    expect(shortPhone.ok).toBe(false)
    expect(shortPhone.phoneError).toBe(SALES_FAILURE_MESSAGES.phone_required)
    expect(shortPhone.cuiError).toBeNull()

    expect(checkInviteFields('1'.repeat(33), '14399840').ok).toBe(false)

    const badCui = checkInviteFields('0722123456', '14399841')
    expect(badCui.ok).toBe(false)
    expect(badCui.cui).toBeNull()
    expect(badCui.cuiError).toBe(SALES_FAILURE_MESSAGES.cui_invalid)
    expect(badCui.phoneError).toBeNull()

    expect(checkInviteFields('', '').ok).toBe(false)
  })
})

describe('INVITE_BASE_PATH', () => {
  it('SF6: căile de bază nu conțin token', () => {
    expect(INVITE_BASE_PATH.head).toBe('/sef-vanzari')
    expect(INVITE_BASE_PATH.agent).toBe('/echipa')
  })
})
