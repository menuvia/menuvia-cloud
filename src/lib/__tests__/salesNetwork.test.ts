// Teste pentru stratul de client al rețelei de vânzări pe invitații (mig 302).
//
//   SN1  clasificarea erorilor de transport (PGRST202/42883 → „indisponibil",
//        42501, JWT, fără cod = rețea, restul necunoscut); mesajul brut NU iese
//   SN2  fiecare motiv are mesaj românesc; invite_invalid are UNUL singur
//   SN3  CLICHET DE DRIFT: motivele din migrația 302 == motivele clientului
//   SN4  get_sales_network → camelCase; contact ascuns; formă proastă → eroare
//   SN5  răscumpărarea: funcția și argumentele corecte, refuz → SalesNetworkError
//        fără token în mesaj, dublu-submit (`already`)
//   SN6  RPC nedeployat / eroare de rețea / promisiune respinsă → mesaje românești,
//        niciodată obiectul brut
//   SN7  RPC-urile de șef și de fondator: argumente, parsare, lista cere array
//   SN8  CUI: oglinda clientului == regulile din SQL (CUI-uri reale)
//   SN9  sha256Hex: vectori cunoscuți, UTF-8; fără crypto.subtle → eroare clară
//   SN10 forma tokenului
//   SN11 tokenul nu se persistă și nu se loghează: sursa nu atinge console /
//        storage / location
import { readFileSync, readdirSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import {
  SALES_FAILURE_MESSAGES,
  SALES_SERVER_REASONS,
  SalesNetworkError,
  adminCreateHeadInvite,
  adminListInvites,
  adminRevokeInvite,
  adminSetAffiliateStatus,
  adminSetContractVersion,
  classifyRpcError,
  createAgentInvite,
  describeSalesError,
  fetchSalesNetwork,
  isInviteTokenShape,
  isValidRoCui,
  normalizeRoCui,
  parseSalesNetwork,
  redeemSalesInvite,
  revokeAgentInvite,
  setMyContactSharing,
  sha256Hex,
  type RedeemInviteInput,
} from '../salesNetwork'

const ROOT = process.cwd()
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe' // 43 de caractere

function ok(data: unknown) {
  return Promise.resolve({ data, error: null })
}
function fail(code: string | undefined, message = 'boom') {
  return Promise.resolve({ data: null, error: { code, message } })
}

async function rejection(p: Promise<unknown>): Promise<SalesNetworkError> {
  try {
    await p
  } catch (e) {
    if (e instanceof SalesNetworkError) return e
    // Altceva decât SalesNetworkError: îl aruncăm mai departe NESCHIMBAT (testul pică cu cauza reală).
    throw e
  }
  throw new Error('promisiunea nu a fost respinsă')
}

beforeEach(() => {
  rpcMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SN1 clasificarea erorilor RPC', () => {
  it('funcție inexistentă → unavailable (PGRST202 și 42883)', () => {
    expect(classifyRpcError({ code: 'PGRST202', message: 'x' }).reason).toBe('unavailable')
    expect(classifyRpcError({ code: '42883', message: 'x' }).reason).toBe('unavailable')
  })
  it('42501 → forbidden; JWT → unauthenticated; fără cod → network; alt cod → unknown', () => {
    expect(classifyRpcError({ code: '42501', message: 'x' }).reason).toBe('forbidden')
    expect(classifyRpcError({ code: 'PGRST301', message: 'x' }).reason).toBe('unauthenticated')
    expect(classifyRpcError({ code: '', message: 'Failed to fetch' }).reason).toBe('network')
    expect(classifyRpcError({ message: 'Failed to fetch' }).reason).toBe('network')
    expect(classifyRpcError({ code: '23505', message: 'x' }).reason).toBe('unknown')
  })
  it('păstrează codul și NU scurge mesajul brut', () => {
    const e = classifyRpcError({ code: '23505', message: 'duplicate key value (secret=abc123)' })
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('23505')
    expect(e.message).not.toContain('abc123')
    expect(e.message).toBe(SALES_FAILURE_MESSAGES.unknown)
  })
})

describe('SN2 mesaje românești', () => {
  it('fiecare motiv are un mesaj ne-gol, terminat cu punct', () => {
    for (const [reason, msg] of Object.entries(SALES_FAILURE_MESSAGES)) {
      expect(msg.length, reason).toBeGreaterThan(10)
      expect(msg.endsWith('.'), reason).toBe(true)
    }
    for (const r of SALES_SERVER_REASONS) expect(SALES_FAILURE_MESSAGES[r], r).toBeTruthy()
  })
  it('invite_invalid e UN singur mesaj, fără detalii care ar face oracol', () => {
    const msg = SALES_FAILURE_MESSAGES.invite_invalid
    // spune doar „expirată / folosită / retrasă" ca ansamblu, nu care dintre ele
    expect(msg).toMatch(/expirată, deja folosită sau retrasă/)
    expect(new SalesNetworkError('invite_invalid').message).toBe(msg)
  })
  it('describeSalesError nu scurge un Error străin', () => {
    expect(describeSalesError(new Error('SECRET'))).toBe(SALES_FAILURE_MESSAGES.unknown)
    expect(describeSalesError({ message: 'SECRET' })).toBe(SALES_FAILURE_MESSAGES.unknown)
    expect(describeSalesError(new SalesNetworkError('rate_limited'))).toBe(
      SALES_FAILURE_MESSAGES.rate_limited,
    )
  })
})

describe('SN3 drift: motivele din migrația 302 == motivele clientului', () => {
  it('mulțimile sunt egale în ambele sensuri', () => {
    const dir = join(ROOT, 'supabase', 'migrations')
    const file = readdirSync(dir).find((f) => f.includes('migration_302_'))
    expect(file, 'migrația 302 lipsește').toBeTruthy()
    const sql = readFileSync(join(dir, file ?? ''), 'utf8')
    const server = new Set([...sql.matchAll(/'reason',\s*'([a-z_]+)'/g)].map((m) => m[1]))
    expect(server.size).toBeGreaterThan(20) // control pozitiv: regex-ul chiar prinde ceva
    const client = new Set<string>(SALES_SERVER_REASONS)
    expect([...server].filter((r) => !client.has(r)).sort()).toEqual([])
    expect([...client].filter((r) => !server.has(r)).sort()).toEqual([])
  })
})

describe('SN4 get_sales_network', () => {
  const payload = {
    ok: true,
    role: 'head',
    status: 'active',
    affiliate_id: 'aff-1',
    contact_sharing: true,
    contract: {
      current_version: '1.0',
      accepted_version: '1.0',
      accepted_at: '2026-10-28T10:00:00Z',
      needs_acceptance: false,
    },
    head: null,
    team: [
      {
        affiliate_id: 'aff-2',
        ordinal: 1,
        status: 'active',
        joined_at: '2026-10-29T10:00:00Z',
        contact_shared: false,
        name: null,
        phone: null,
        email: null,
        clients_total: 3,
        clients_active: 2,
        agent_earned_ron_cents: 9960,
        head_bonus_ron_cents: 1992,
        last_sale_at: '2026-11-01T10:00:00Z',
      },
      {
        affiliate_id: 'aff-3',
        ordinal: 2,
        status: 'suspended',
        joined_at: '2026-10-30T10:00:00Z',
        contact_shared: true,
        name: 'Dan',
        phone: '0722',
        email: 'dan@x.ro',
        clients_total: 0,
        clients_active: 0,
        agent_earned_ron_cents: 0,
        head_bonus_ron_cents: 0,
        last_sale_at: null,
      },
    ],
    open_invites: [
      {
        id: 'inv-1',
        note: 'pentru Ana',
        created_at: '2026-10-28T10:00:00Z',
        expires_at: '2026-11-11T10:00:00Z',
      },
    ],
    limits: { open_invites_max: 20, invite_ttl_days: 14 },
  }

  it('mapează în camelCase, cu contactul ascuns păstrat ca null', async () => {
    rpcMock.mockReturnValueOnce(ok(payload))
    const n = await fetchSalesNetwork()
    expect(rpcMock).toHaveBeenCalledWith('get_sales_network', undefined)
    expect(n.role).toBe('head')
    expect(n.contract).toEqual({
      currentVersion: '1.0',
      acceptedVersion: '1.0',
      acceptedAt: '2026-10-28T10:00:00Z',
      needsAcceptance: false,
    })
    expect(n.team).toHaveLength(2)
    expect(n.team[0]).toMatchObject({
      affiliateId: 'aff-2',
      contactShared: false,
      name: null,
      phone: null,
      email: null,
      clientsTotal: 3,
      agentEarnedRonCents: 9960,
      headBonusRonCents: 1992,
    })
    expect(n.team[1]).toMatchObject({ contactShared: true, name: 'Dan', lastSaleAt: null })
    expect(n.openInvites).toEqual([
      {
        id: 'inv-1',
        note: 'pentru Ana',
        createdAt: '2026-10-28T10:00:00Z',
        expiresAt: '2026-11-11T10:00:00Z',
      },
    ])
    expect(n.limits).toEqual({ openInvitesMax: 20, inviteTtlDays: 14 })
  })

  it('cont din afara rețelei: role null, fără echipă', () => {
    const n = parseSalesNetwork({
      ok: true,
      role: null,
      status: null,
      affiliate_id: null,
      contact_sharing: false,
      contract: {
        current_version: null,
        accepted_version: null,
        accepted_at: null,
        needs_acceptance: false,
      },
      head: null,
      team: [],
      open_invites: [],
      limits: { open_invites_max: 20, invite_ttl_days: 14 },
    })
    expect(n.role).toBeNull()
    expect(n.contract.currentVersion).toBeNull()
    expect(n.team).toEqual([])
  })

  it('agent: cardul șefului, cu contact doar când e partajat', () => {
    const n = parseSalesNetwork({
      ...payload,
      role: 'agent',
      team: [],
      open_invites: [],
      head: {
        affiliate_id: 'h',
        status: 'active',
        contact_shared: true,
        name: 'Ion',
        phone: '0722',
        email: 'i@x.ro',
      },
    })
    expect(n.head).toEqual({
      affiliateId: 'h',
      status: 'active',
      contactShared: true,
      name: 'Ion',
      phone: '0722',
      email: 'i@x.ro',
    })
  })

  it('formă proastă → SalesNetworkError(unknown), nu undefined în UI', async () => {
    rpcMock.mockReturnValueOnce(ok(null))
    expect((await rejection(fetchSalesNetwork())).reason).toBe('unknown')
    rpcMock.mockReturnValueOnce(ok([1, 2]))
    expect((await rejection(fetchSalesNetwork())).reason).toBe('unknown')
    rpcMock.mockReturnValueOnce(ok({ ...payload, team: [{ affiliate_id: 1 }] }))
    expect((await rejection(fetchSalesNetwork())).reason).toBe('unknown')
    rpcMock.mockReturnValueOnce(ok({ ok: false, reason: 'unauthenticated' }))
    expect((await rejection(fetchSalesNetwork())).reason).toBe('unauthenticated')
  })
})

describe('SN5 răscumpărarea', () => {
  const input: RedeemInviteInput = {
    token: `  ${TOKEN}  `,
    phone: ' 0722 111 222 ',
    cui: ' RO 14399840 ',
    contractVersion: '1.0',
    contractHash: 'a'.repeat(64),
    shareContact: true,
  }

  it('șef: redeem_sales_head_invite cu argumentele curățate', async () => {
    rpcMock.mockReturnValueOnce(
      ok({
        ok: true,
        affiliate_id: 'a1',
        role: 'head',
        status: 'active',
        referral_code: 'abc2345',
        parent_affiliate_id: null,
      }),
    )
    const r = await redeemSalesInvite('head', input)
    expect(rpcMock).toHaveBeenCalledWith('redeem_sales_head_invite', {
      p_token: TOKEN,
      p_phone: '0722 111 222',
      p_cui: 'RO 14399840',
      p_contract_version: '1.0',
      p_contract_hash: 'a'.repeat(64),
      p_share_contact: true,
    })
    expect(r).toEqual({
      affiliateId: 'a1',
      role: 'head',
      status: 'active',
      referralCode: 'abc2345',
      parentAffiliateId: null,
      already: false,
    })
  })

  it('agent: redeem_agent_invite; dublu-submit → already', async () => {
    rpcMock.mockReturnValueOnce(
      ok({
        ok: true,
        already: true,
        affiliate_id: 'a2',
        role: 'agent',
        status: 'active',
        referral_code: 'xyz2345',
        parent_affiliate_id: 'h1',
      }),
    )
    const r = await redeemSalesInvite('agent', { ...input, shareContact: false })
    expect(rpcMock.mock.calls[0]?.[0]).toBe('redeem_agent_invite')
    expect(rpcMock.mock.calls[0]?.[1]).toMatchObject({ p_share_contact: false })
    expect(r.already).toBe(true)
    expect(r.parentAffiliateId).toBe('h1')
  })

  it('refuzurile serverului → SalesNetworkError cu mesajul românesc, FĂRĂ token', async () => {
    for (const reason of [
      'invite_invalid',
      'cui_invalid',
      'contract_not_published',
      'contract_version_mismatch',
      'rate_limited',
      'already_affiliate',
    ] as const) {
      rpcMock.mockReturnValueOnce(ok({ ok: false, reason }))
      const e = await rejection(redeemSalesInvite('head', input))
      expect(e.reason).toBe(reason)
      expect(e.message).toBe(SALES_FAILURE_MESSAGES[reason])
      expect(e.message).not.toContain(TOKEN)
      expect(JSON.stringify(e)).not.toContain(TOKEN)
    }
  })

  it('un reason necunoscut al serverului → unknown (nu e propagat ca text)', async () => {
    rpcMock.mockReturnValueOnce(ok({ ok: false, reason: 'ceva_nou_din_viitor' }))
    const e = await rejection(redeemSalesInvite('head', input))
    expect(e.reason).toBe('unknown')
    expect(e.message).not.toContain('ceva_nou')
  })
})

describe('SN6 transport', () => {
  it('RPC nedeployat → unavailable, mesaj românesc, Error real', async () => {
    rpcMock.mockReturnValueOnce(
      fail('PGRST202', 'Could not find the function public.get_sales_network'),
    )
    const e = await rejection(fetchSalesNetwork())
    expect(e).toBeInstanceOf(Error)
    expect(e.reason).toBe('unavailable')
    expect(e.code).toBe('PGRST202')
    expect(e.message).toBe(SALES_FAILURE_MESSAGES.unavailable)
    expect(e.message).not.toContain('Could not find')
  })
  it('eroare fără cod și promisiune respinsă → network', async () => {
    rpcMock.mockReturnValueOnce(fail(undefined, 'TypeError: Failed to fetch'))
    expect((await rejection(fetchSalesNetwork())).reason).toBe('network')
    rpcMock.mockReturnValueOnce(Promise.reject(new Error('socket hang up')))
    const e = await rejection(fetchSalesNetwork())
    expect(e.reason).toBe('network')
    expect(e.message).not.toContain('socket')
  })
  it('42501 la un RPC de fondator → forbidden', async () => {
    rpcMock.mockReturnValueOnce(fail('42501', 'Acces interzis'))
    expect((await rejection(adminListInvites())).reason).toBe('forbidden')
  })
})

describe('SN7 RPC-uri de șef și de fondator', () => {
  it('createAgentInvite: token întors, nota blank → null', async () => {
    rpcMock.mockReturnValue(
      ok({
        ok: true,
        invite_id: 'i1',
        kind: 'agent',
        token: TOKEN,
        expires_at: '2026-11-11T00:00:00Z',
      }),
    )
    const c = await createAgentInvite('   ')
    expect(rpcMock).toHaveBeenCalledWith('create_agent_invite', { p_note: null })
    expect(c).toEqual({
      inviteId: 'i1',
      kind: 'agent',
      token: TOKEN,
      expiresAt: '2026-11-11T00:00:00Z',
    })
    await createAgentInvite(' pentru Ana ')
    expect(rpcMock).toHaveBeenLastCalledWith('create_agent_invite', { p_note: 'pentru Ana' })
  })
  it('createAgentInvite: refuzuri (plafon, fără contract)', async () => {
    rpcMock.mockReturnValueOnce(ok({ ok: false, reason: 'too_many_open_invites' }))
    expect((await rejection(createAgentInvite())).reason).toBe('too_many_open_invites')
    rpcMock.mockReturnValueOnce(ok({ ok: false, reason: 'contract_not_published' }))
    expect((await rejection(createAgentInvite())).reason).toBe('contract_not_published')
  })
  it('revokeAgentInvite și setMyContactSharing', async () => {
    rpcMock.mockReturnValueOnce(ok({ ok: true }))
    await revokeAgentInvite('i1')
    expect(rpcMock).toHaveBeenLastCalledWith('revoke_agent_invite', { p_invite_id: 'i1' })
    rpcMock.mockReturnValueOnce(ok({ ok: true, contact_sharing: false }))
    expect(await setMyContactSharing(false)).toBe(false)
    expect(rpcMock).toHaveBeenLastCalledWith('set_my_contact_sharing', { p_share: false })
  })
  it('adminCreateHeadInvite: email/notă goale → null', async () => {
    rpcMock.mockReturnValue(
      ok({
        ok: true,
        invite_id: 'i2',
        kind: 'head',
        token: TOKEN,
        expires_at: '2026-11-11T00:00:00Z',
      }),
    )
    await adminCreateHeadInvite(' A@B.ro ', '')
    expect(rpcMock).toHaveBeenLastCalledWith('admin_create_sales_head_invite', {
      p_email: 'A@B.ro',
      p_note: null,
    })
    await adminCreateHeadInvite()
    expect(rpcMock).toHaveBeenLastCalledWith('admin_create_sales_head_invite', {
      p_email: null,
      p_note: null,
    })
  })
  it('adminListInvites cere array și parsează stările; fără token/hash în tip', async () => {
    rpcMock.mockReturnValueOnce(
      ok([
        {
          id: 'i1',
          kind: 'head',
          state: 'open',
          email: 'a@b.ro',
          note: null,
          created_at: 'c',
          expires_at: 'e',
          used_at: null,
          revoked_at: null,
          invited_by_affiliate_id: null,
          invited_by_name: null,
          used_by_affiliate_id: null,
          used_by_name: null,
        },
        {
          id: 'i2',
          kind: 'agent',
          state: 'used',
          email: null,
          note: 'n',
          created_at: 'c',
          expires_at: 'e',
          used_at: 'u',
          revoked_at: null,
          invited_by_affiliate_id: 'h',
          invited_by_name: 'Ion',
          used_by_affiliate_id: 'a',
          used_by_name: 'Ana',
        },
      ]),
    )
    const list = await adminListInvites()
    expect(list.map((i) => i.state)).toEqual(['open', 'used'])
    expect(Object.keys(list[0] ?? {})).not.toContain('token')
    expect(Object.keys(list[0] ?? {})).not.toContain('tokenHash')
    rpcMock.mockReturnValueOnce(ok({ ok: true }))
    expect((await rejection(adminListInvites())).reason).toBe('unknown')
    rpcMock.mockReturnValueOnce(ok([{ id: 'x', kind: 'head', state: 'ciudat' }]))
    expect((await rejection(adminListInvites())).reason).toBe('unknown')
  })
  it('adminRevokeInvite, adminSetAffiliateStatus, adminSetContractVersion', async () => {
    rpcMock.mockReturnValueOnce(ok({ ok: true }))
    await adminRevokeInvite('i1')
    expect(rpcMock).toHaveBeenLastCalledWith('admin_revoke_affiliate_invite', { p_invite_id: 'i1' })
    rpcMock.mockReturnValueOnce(ok({ ok: true, status: 'suspended' }))
    expect(await adminSetAffiliateStatus('a1', 'suspended', '  verificare  ')).toBe('suspended')
    expect(rpcMock).toHaveBeenLastCalledWith('admin_set_affiliate_status', {
      p_affiliate_id: 'a1',
      p_status: 'suspended',
      p_reason: 'verificare',
    })
    rpcMock.mockReturnValueOnce(ok({ ok: false, reason: 'reason_required' }))
    expect((await rejection(adminSetAffiliateStatus('a1', 'active', ''))).reason).toBe(
      'reason_required',
    )
    rpcMock.mockReturnValueOnce(ok({ ok: true, version: null, previous: '1.0' }))
    expect(await adminSetContractVersion(null)).toBeNull()
    expect(rpcMock).toHaveBeenLastCalledWith('admin_set_sales_contract_version', {
      p_version: null,
    })
    rpcMock.mockReturnValueOnce(ok({ ok: false, reason: 'draft_version' }))
    expect((await rejection(adminSetContractVersion('1.0-DRAFT'))).reason).toBe('draft_version')
  })
})

describe('SN8 CUI (oglinda clientului == SQL)', () => {
  it('CUI-uri reale valide, cu/fără RO, spații, litere mici', () => {
    for (const c of [
      '5022670',
      'RO5022670',
      'ro 5022670',
      ' RO 14399840 ',
      '2816464',
      '9010105',
      '11588780',
      '18547290',
      '19',
    ]) {
      expect(isValidRoCui(c), c).toBe(true)
    }
    expect(normalizeRoCui(' ro 14399840 ')).toBe('14399840')
  })
  it('invalide: cifră de control, lungime, litere, gol, zero în față', () => {
    for (const c of [
      '5022671',
      '14399841',
      '1',
      '12345678901',
      '50226a0',
      '',
      'RO',
      'RO-5022670',
      '5022 670x',
      '0000000',
      '05022670',
      '10',
    ]) {
      expect(isValidRoCui(c), c).toBe(false)
    }
  })
})

describe('SN9 sha256Hex', () => {
  it('vectori cunoscuți (SHA-256) și UTF-8', async () => {
    vi.stubGlobal('crypto', webcrypto)
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(await sha256Hex('Ștefan')).toBe(
      '7ededa8a107600b7972405a1ed40177e67dfbb8f984ad3a68517ee97b04f801c',
    )
  })
  it('fără crypto.subtle → hash_unavailable, nu un hash fals', async () => {
    vi.stubGlobal('crypto', {})
    const e = await rejection(sha256Hex('abc'))
    expect(e.reason).toBe('hash_unavailable')
  })
})

describe('SN10 forma tokenului', () => {
  it('43 de caractere URL-safe', () => {
    expect(isInviteTokenShape(TOKEN)).toBe(true)
    expect(isInviteTokenShape(` ${TOKEN} `)).toBe(true)
    expect(isInviteTokenShape(TOKEN.slice(1))).toBe(false)
    expect(isInviteTokenShape(`${TOKEN}A`)).toBe(false)
    expect(isInviteTokenShape(`${TOKEN.slice(0, 42)}+`)).toBe(false)
    expect(isInviteTokenShape('')).toBe(false)
  })
})

describe('SN11 tokenul nu se persistă și nu se loghează', () => {
  it('sursa nu atinge console / storage / location / cookie', () => {
    const src = readFileSync(join(ROOT, 'src', 'lib', 'salesNetwork.ts'), 'utf8')
    // comentariile pot pomeni cuvintele; scanăm doar codul
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const banned of [
      'console.',
      'localStorage',
      'sessionStorage',
      'document.cookie',
      'location.',
      'history.',
    ]) {
      expect(code.includes(banned), banned).toBe(false)
    }
  })
})
