// Decizii pure ale paginii de invitație de rețea.
//
//   SF1  calea de înscriere: cu `next` sigur, codificat, pe rolul corect
//   SF2  token cu formă greșită → null (nu punem gunoi într-un ?next=)
//   SF3  calea produsă trece de validarea open-redirect și NU conține nimic în afară de token
//   SF4  câmpuri valide → ok, CUI normalizat
//   SF5  telefon scurt/lung și CUI cu cifră de control greșită → mesaje clare
//   SF6  calea de bază (fără token) pe rol
//   SF7  linkul de invitație: baza publică + calea rolului + token, fără slash dublu
//   SF8  versiunea de contract: oglinda EXACTĂ a serverului (mig 304: `^v?[0-9]+(\.[0-9]+)*$`,
//        max 20, „draft” refuzat înaintea formei)
//   SF9  tranzițiile de stare oglindesc serverul (closed e terminal, pending/rejected nu se ating)
//   SF10 lista „Rețeaua”: doar conturi din rețea, șefii înaintea agenților, agenții orfani nu se pierd
//   SF11 poarta contractului: acceptarea e permisă DOAR pe sha256(text local) === amprenta publicată
//   SF12 refuzurile serverului legate de un câmp (cui_conflict / cui_invalid / phone_required)
//   SF13 calea invitației CU token (reîncărcare / ?next=), amprenta scurtată, eticheta versiunii
import { describe, it, expect } from 'vitest'
import {
  INVITE_BASE_PATH,
  buildInviteLink,
  checkContractVersionInput,
  checkInviteFields,
  contractGate,
  contractVersionLabel,
  fieldForSalesReason,
  invitePathWithToken,
  networkRows,
  nextStatusesFor,
  shortHash,
  signupPathForInvite,
} from '../salesInviteFlow'
import { nextFromSearch } from '../authRedirect'
import { SALES_FAILURE_MESSAGES, SALES_SERVER_REASONS, SalesNetworkError } from '../salesNetwork'

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

  it('SF8: versiunea de contract (oglinda serverului)', () => {
    expect(checkContractVersionInput(' 1.0 ')).toEqual({ ok: true, version: '1.0' })
    for (const good of ['1', 'v2', '1.0.3', '10.20.30', 'v1.0', '1'.repeat(20)]) {
      expect(checkContractVersionInput(good), good).toEqual({ ok: true, version: good })
    }
    // Forme pe care serverul le respinge cu invalid_version (înainte, clientul
    // accepta `agent-1.0_rev2`, deci fondatorul afla abia de la server).
    for (const bad of [
      'agent-1.0_rev2',
      'V1.0',
      '1.',
      '.1',
      '1..0',
      '1.0 final',
      '-1.0',
      '1'.repeat(21),
      'ă1',
      'null',
    ]) {
      const r = checkContractVersionInput(bad)
      expect(r.ok === false && r.message, bad).toBe(SALES_FAILURE_MESSAGES.invalid_version)
    }
    for (const empty of ['', '   ']) expect(checkContractVersionInput(empty).ok).toBe(false)
    // „draft” are prioritate (paritate cu ordinea din SQL): mesajul specific, nu cel de formă.
    for (const draft of ['agent-1.0-DRAFT', 'draft', 'v1-Draft']) {
      const d = checkContractVersionInput(draft)
      expect(d.ok === false && d.message, draft).toBe(SALES_FAILURE_MESSAGES.draft_version)
    }
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

describe('poarta contractului', () => {
  const TEXT = 'TEXTUL CONTRACTULUI v1.0'
  const HASH = 'a'.repeat(64)
  const ready = { status: 'ready', hash: HASH } as const

  it('SF11: acceptare DOAR pe amprenta publicată', () => {
    expect(contractGate(null, null, TEXT, ready)).toEqual({ state: 'unpublished' })
    expect(contractGate('1.0', HASH, null, { status: 'none' })).toEqual({
      state: 'missing_text',
      version: '1.0',
    })
    expect(contractGate('1.0', HASH, TEXT, { status: 'pending' })).toEqual({
      state: 'checking',
      version: '1.0',
    })
    expect(contractGate('1.0', HASH, TEXT, ready)).toEqual({
      state: 'ready',
      version: '1.0',
      text: TEXT,
      hash: HASH,
    })
    // Mutația „orice hash calculat e bun” (fără comparație) face aceste două să pice.
    expect(contractGate('1.0', 'b'.repeat(64), TEXT, ready)).toEqual({
      state: 'mismatch',
      version: '1.0',
    })
    expect(contractGate('1.0', null, TEXT, ready)).toEqual({ state: 'mismatch', version: '1.0' })
    const err = new SalesNetworkError('hash_unavailable')
    expect(contractGate('1.0', HASH, TEXT, { status: 'error', error: err })).toEqual({
      state: 'hash_error',
      version: '1.0',
      message: SALES_FAILURE_MESSAGES.hash_unavailable,
    })
  })

  it('SF12: refuzurile legate de un câmp', () => {
    expect(fieldForSalesReason('cui_conflict')).toBe('cui')
    expect(fieldForSalesReason('cui_invalid')).toBe('cui')
    expect(fieldForSalesReason('phone_required')).toBe('phone')
    // Orice alt motiv rămâne mesaj general (anti-oracol: invite_invalid nu se lipește de un câmp).
    const others = SALES_SERVER_REASONS.filter(
      (r) => r !== 'cui_conflict' && r !== 'cui_invalid' && r !== 'phone_required',
    )
    for (const r of others) expect(fieldForSalesReason(r), r).toBeNull()
    expect(fieldForSalesReason('network')).toBeNull()
  })

  it('SF13: calea cu token, amprenta scurtată, eticheta versiunii', () => {
    expect(invitePathWithToken('head', ` ${TOKEN} `)).toBe(`/sef-vanzari/${TOKEN}`)
    expect(invitePathWithToken('agent', TOKEN)).toBe(`/echipa/${TOKEN}`)
    expect(invitePathWithToken('head', '//evil.com')).toBeNull()
    expect(shortHash('0123456789abcdef'.repeat(4))).toBe('0123456789ab…')
    expect(shortHash('abc')).toBe('abc')
    expect(contractVersionLabel('1.0')).toBe('v1.0')
    expect(contractVersionLabel('v2')).toBe('v2')
  })
})
