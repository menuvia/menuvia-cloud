// Decizii pure ale paginii de invitație de rețea.
//
//   SF1  calea de înscriere: cu `next` sigur, codificat, pe rolul corect
//   SF2  token cu formă greșită → null (nu punem gunoi într-un ?next=)
//   SF3  calea produsă trece de validarea open-redirect și NU conține nimic în afară de token
//   SF4  câmpuri valide → ok, CUI normalizat
//   SF5  telefon scurt/lung și CUI cu cifră de control greșită → mesaje clare
//   SF6  calea de bază (fără token) pe rol
//   SF7  linkul de invitație: baza publică + calea rolului + token, fără slash dublu
//   SF8  versiunea de contract: DRAFT / goală / caractere interzise refuzate local
//   SF9  tranzițiile de stare oglindesc serverul (closed e terminal, pending/rejected nu se ating)
//   SF10 lista „Rețeaua”: doar conturi din rețea, șefii înaintea agenților, agenții orfani nu se pierd
import { describe, it, expect } from 'vitest'
import {
  INVITE_BASE_PATH,
  buildInviteLink,
  checkContractVersionInput,
  checkInviteFields,
  networkRows,
  nextStatusesFor,
  signupPathForInvite,
} from '../salesInviteFlow'
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
    for (const bad of [
      '',
      'scurt',
      TOKEN + 'x',
      TOKEN.slice(1),
      `${TOKEN.slice(0, 42)}/`,
      '//evil.com',
    ]) {
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

describe('ecranul fondatorului', () => {
  it('SF7: linkul de invitație', () => {
    expect(buildInviteLink('head', TOKEN, 'https://menuvia.ro')).toBe(
      `https://menuvia.ro/sef-vanzari/${TOKEN}`,
    )
    expect(buildInviteLink('agent', TOKEN, 'https://menuvia.ro//')).toBe(
      `https://menuvia.ro/echipa/${TOKEN}`,
    )
  })

  it('SF8: versiunea de contract', () => {
    expect(checkContractVersionInput(' 1.0 ')).toEqual({ ok: true, version: '1.0' })
    expect(checkContractVersionInput('agent-1.0_rev2')).toEqual({
      ok: true,
      version: 'agent-1.0_rev2',
    })
    for (const bad of [
      '',
      '   ',
      'agent-1.0-DRAFT',
      'draft',
      '1.0 final',
      '-1.0',
      'a'.repeat(41),
      'ă1',
    ]) {
      const r = checkContractVersionInput(bad)
      expect(r.ok).toBe(false)
    }
    const d = checkContractVersionInput('v1-Draft')
    expect(d.ok === false && d.message).toBe(SALES_FAILURE_MESSAGES.draft_version)
    const i = checkContractVersionInput('1.0 final')
    expect(i.ok === false && i.message).toBe(SALES_FAILURE_MESSAGES.invalid_version)
  })

  it('SF9: tranziții de stare', () => {
    expect(nextStatusesFor('active')).toEqual(['suspended', 'closed'])
    expect(nextStatusesFor('suspended')).toEqual(['active', 'closed'])
    expect(nextStatusesFor('closed')).toEqual([])
    expect(nextStatusesFor('pending')).toEqual([])
    expect(nextStatusesFor('rejected')).toEqual([])
  })

  it('SF10: lista Rețeaua', () => {
    const row = (
      id: string,
      status: string,
      parent: string | null,
      extra: Record<string, unknown> = {},
    ) => ({
      affiliate_id: id,
      status,
      parent_affiliate_id: parent,
      full_name: null,
      email: null,
      referral_code: `COD-${id}`,
      ...extra,
    })
    const rows = [
      row('a1', 'active', 'h1', { full_name: 'Agent Unu' }),
      row('p1', 'pending', null),
      row('h1', 'active', null, { email: 'sef@x.test' }),
      row('r1', 'rejected', 'h1'),
      row('o1', 'suspended', 'h-lipsa'),
      row('h2', 'closed', null, { erased_at: '2026-10-01T00:00:00Z' }),
    ]
    const out = networkRows(rows)
    expect(out.map((r) => r.affiliateId)).toEqual(['h1', 'a1', 'h2', 'o1'])
    expect(out.map((r) => r.name)).toEqual(['sef@x.test', 'Agent Unu', '(cont șters)', 'COD-o1'])
  })
})
