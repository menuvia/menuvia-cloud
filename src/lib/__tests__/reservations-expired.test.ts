// Jumătatea de CLIENT a mig 289 (D1): statusul `expired` pe rezervări.
//
//   E1  `expired` e TERMINAL pentru ecranul de confirmare (o retrimitere
//       idempotentă care întoarce un rând expirat nu are voie să-l prezinte
//       drept „rezervare primită").
//   E2  fiecare status are etichetă românească, iar `expired` nu se confundă
//       cu „Anulată" sau „No-show" (decizia D1: nu amestecăm „nu s-a confirmat
//       niciodată" cu „a anulat clientul").
//   E3  filtrul secțiunii „Neconfirmate / expirate": `pending` din trecut FĂRĂ
//       limită inferioară (cer o decizie, oricât de vechi), `expired` DOAR din
//       ultimele 7 zile (terminal, fără acțiuni — altfel secțiunea crește la
//       nesfârșit), `confirmed` mai vechi de 48h; lasă în pace `seated` /
//       `completed`.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: { rpc: vi.fn() } }))

import {
  RESERVATION_STATUS_LABEL,
  STALE_CONFIRMED_HOURS,
  STALE_EXPIRED_DAYS,
  TERMINAL_RESERVATION_STATUSES,
  buildStaleReservationsFilter,
  isTerminalReservation,
} from '../reservations'

describe('rezervări expirate (mig 289)', () => {
  it('E1: expired e terminal, la fel ca cancelled/no_show; stările vii nu', () => {
    expect(isTerminalReservation('expired')).toBe(true)
    expect(TERMINAL_RESERVATION_STATUSES).toContain('expired')
    for (const alive of ['pending', 'confirmed', 'seated', 'completed']) {
      expect(isTerminalReservation(alive)).toBe(false)
    }
  })

  it('E2: eticheta „Expirată” există și e distinctă de anulată/no-show', () => {
    expect(RESERVATION_STATUS_LABEL.expired).toBe('Expirată')
    expect(RESERVATION_STATUS_LABEL.expired).not.toBe(RESERVATION_STATUS_LABEL.cancelled)
    expect(RESERVATION_STATUS_LABEL.expired).not.toBe(RESERVATION_STATUS_LABEL.no_show)
    // niciun status fără etichetă (Record-ul e exhaustiv, dar o valoare goală ar trece de tipuri)
    for (const label of Object.values(RESERVATION_STATUS_LABEL)) {
      expect(label.trim().length).toBeGreaterThan(0)
    }
  })

  it('E3: pending fără limită inferioară, expired doar ultimele 7 zile, confirmed > 48h', () => {
    const now = new Date('2026-10-01T12:00:00.000Z')
    const f = buildStaleReservationsFilter(now)
    const clauses = f.split(/,(?=and\()/)
    expect(clauses).toHaveLength(3)
    // pending din trecut, până la ACUM — fără limită inferioară
    expect(clauses).toContain('and(status.eq.pending,starts_at.lt.2026-10-01T12:00:00.000Z)')
    // expired: fereastră de 7 zile (terminal, fără acțiuni — nu crește la nesfârșit)
    expect(STALE_EXPIRED_DAYS).toBe(7)
    expect(clauses).toContain(
      'and(status.eq.expired,starts_at.gte.2026-09-24T12:00:00.000Z,starts_at.lt.2026-10-01T12:00:00.000Z)',
    )
    // confirmed: doar mai vechi de 48h
    expect(STALE_CONFIRMED_HOURS).toBe(48)
    expect(clauses).toContain('and(status.eq.confirmed,starts_at.lt.2026-09-29T12:00:00.000Z)')
    // limita inferioară există DOAR pe expired; expired nu mai e grupat cu pending
    for (const c of clauses) {
      if (!c.includes('status.eq.expired')) expect(c).not.toContain('starts_at.gte')
    }
    expect(f).not.toContain('status.in.(pending,expired)')
    expect(f).not.toContain('starts_at.gt.')
    expect(f).not.toContain('seated')
    expect(f).not.toContain('completed')
  })
})
