// Jumătatea de CLIENT a mig 289 (D1): statusul `expired` pe rezervări.
//
//   E1  `expired` e TERMINAL pentru ecranul de confirmare (o retrimitere
//       idempotentă care întoarce un rând expirat nu are voie să-l prezinte
//       drept „rezervare primită").
//   E2  fiecare status are etichetă românească, iar `expired` nu se confundă
//       cu „Anulată" sau „No-show" (decizia D1: nu amestecăm „nu s-a confirmat
//       niciodată" cu „a anulat clientul").
//   E3  filtrul secțiunii „Neconfirmate / expirate" NU are filtru de dată
//       inferior (rândurile vechi de luni trebuie să apară) și lasă în pace
//       `confirmed` recent / `seated` / `completed`.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: { rpc: vi.fn() } }))

import {
  RESERVATION_STATUS_LABEL,
  STALE_CONFIRMED_HOURS,
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

  it('E3: filtrul stale e fără limită inferioară și respectă pragul de 48h pe confirmed', () => {
    const now = new Date('2026-10-01T12:00:00.000Z')
    const f = buildStaleReservationsFilter(now)
    // pending + expired din trecut, până la ACUM
    expect(f).toContain('and(status.in.(pending,expired),starts_at.lt.2026-10-01T12:00:00.000Z)')
    // confirmed: doar mai vechi de 48h
    expect(STALE_CONFIRMED_HOURS).toBe(48)
    expect(f).toContain('and(status.eq.confirmed,starts_at.lt.2026-09-29T12:00:00.000Z)')
    // fără limită inferioară de dată și fără alte statusuri
    expect(f).not.toContain('starts_at.gt')
    expect(f).not.toContain('starts_at.gte')
    expect(f).not.toContain('seated')
    expect(f).not.toContain('completed')
  })
})
