// Deciziile pure ale panoului de vânzări (lib/salesPanel.ts, pachetul 8b-2).
//
//   SL1  titlul după rol: șef / agent / program public = agent / NECUNOSCUT = neutru
//        (mutația „undefined → Agent de vânzări” pică: un șef cu rețeaua căzută ar fi
//        numit agent)
//   SL2  „Banii tăi”: câștigat + plătit; disponibil peste prag; în plată
//   SL3  disponibil SUB prag → spune că se adună (mutația care ignoră belowMinimum pică)
//   SL4  nimic câștigat → propoziție de pornire, nu „0,00 RON”
//   SL5  contactul: patronii apar MEREU (și ca nume afișat oricum), rețeaua doar pe rol
//        (mutația care scoate rândul despre patroni — reziduul de la răscumpărare — pică)
//   SL6  plafonul de invitații: plin → nu mai poți crea; plafon necunoscut (0) → decide serverul
import { describe, it, expect } from 'vitest'
import { contactAudience, inviteSlots, moneySentences, salesRoleTitle } from '../salesPanel'
import type { EarningsSummary } from '../affiliateEarnings'

const fmt = (c: number) => `${(c / 100).toFixed(2)} lei`

function sum(over: Partial<EarningsSummary> = {}): EarningsSummary {
  return {
    availableCents: 0,
    pendingCents: 0,
    netEarnedCents: 0,
    inProgressCents: 0,
    minPayoutCents: 5000,
    belowMinimum: true,
    serverNet: true,
    ...over,
  }
}

describe('salesRoleTitle', () => {
  it('SL1: titlul după rol', () => {
    expect(salesRoleTitle('head')).toBe('Șef de vânzări')
    expect(salesRoleTitle('agent')).toBe('Agent de vânzări')
    expect(salesRoleTitle(null)).toBe('Agent de vânzări')
    expect(salesRoleTitle(undefined)).toBe('Panoul de vânzări')
  })
})

describe('moneySentences', () => {
  it('SL2: câștigat, plătit, disponibil și în plată', () => {
    const m = moneySentences(
      sum({
        netEarnedCents: 120000,
        availableCents: 30000,
        belowMinimum: false,
        inProgressCents: 10000,
      }),
      50000,
      fmt,
    )
    expect(m.earned).toBe(
      'Ai câștigat 1200.00 lei până acum (net, după stornări), iar 500.00 lei ți-au fost deja plătiți.',
    )
    expect(m.payout).toBe('Poți primi acum 300.00 lei; 100.00 lei sunt deja în plată.')
  })

  it('SL3: disponibil sub prag → se adună la următoarea plată', () => {
    const m = moneySentences(
      sum({ netEarnedCents: 3000, availableCents: 3000, belowMinimum: true }),
      0,
      fmt,
    )
    expect(m.payout).toBe(
      'Ai 30.00 lei disponibili, sub pragul de 50.00 lei, așa că se adună la următoarea plată.',
    )
    expect(m.earned).toBe('Ai câștigat 30.00 lei până acum (net, după stornări).')
  })

  it('SL4: nimic câștigat → propoziție de pornire; doar perioada de siguranță', () => {
    expect(moneySentences(sum(), 0, fmt).earned).toMatch(/^Încă n-ai câștigat nimic/)
    expect(moneySentences(sum(), 0, fmt).payout).toBe('Nu ai încă bani disponibili pentru plată.')
    expect(moneySentences(sum({ netEarnedCents: 900, pendingCents: 900 }), 0, fmt).payout).toBe(
      'Nu ai încă bani disponibili: 9.00 lei sunt în perioada de siguranță.',
    )
  })
})

describe('contactAudience', () => {
  it('SL5: patronii mereu, rețeaua după rol, retragerea oricând', () => {
    for (const role of ['head', 'agent', null] as const) {
      for (const shared of [true, false]) {
        const text = contactAudience(role, shared).join(' ')
        expect(text).toMatch(/patronii restaurantelor aduse de tine/)
        expect(text).toMatch(/proprietarul fiecărui restaurant adus de tine/)
        expect(text).toMatch(/Poți opri oricând/)
      }
    }
    expect(contactAudience('head', false).join(' ')).toMatch(/agenții din echipa ta/)
    expect(contactAudience('agent', false).join(' ')).toMatch(/șeful tău de vânzări/)
    expect(contactAudience(null, false).join(' ')).not.toMatch(/agenții din echipa ta|șeful tău/)
    // Starea curentă schimbă timpul verbului, nu audiența.
    expect(contactAudience('head', true).join(' ')).toMatch(/îți văd acum/)
    expect(contactAudience('head', false).join(' ')).toMatch(/Dacă pornești opțiunea/)
  })
})

describe('inviteSlots', () => {
  const inv = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `i${i}`,
      note: null,
      createdAt: '2026-10-01T00:00:00Z',
      expiresAt: '2026-10-15T00:00:00Z',
    }))

  it('SL6: plafonul de invitații deschise', () => {
    expect(
      inviteSlots({ openInvites: inv(2), limits: { openInvitesMax: 20, inviteTtlDays: 14 } }),
    ).toEqual({
      open: 2,
      max: 20,
      canCreate: true,
    })
    expect(
      inviteSlots({ openInvites: inv(20), limits: { openInvitesMax: 20, inviteTtlDays: 14 } })
        .canCreate,
    ).toBe(false)
    expect(
      inviteSlots({ openInvites: inv(3), limits: { openInvitesMax: 0, inviteTtlDays: 0 } })
        .canCreate,
    ).toBe(true)
  })
})
