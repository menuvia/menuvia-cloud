// Mese & QR: token-urile NECUNOSCUTE nu se tratează ca „mese fără QR”
// (code-health-qr-token-unknown-rotates). Un token nou activ oprește QR-ul deja
// tipărit pe masă (trigger mig 119), iar butonul „Generează QR” al unei mese
// fără token rotește DIRECT, fără confirmare.
//
//   TK1  citirea token-urilor pică → lista intră pe eroare, cu Reîncearcă; niciun
//        „Generează QR”, nicio rotire și nicio inserare de token. Mutația care
//        pică: `if (tkErr) throw tkErr` scos din load() (comportamentul vechi:
//        toate mesele „Fără QR”, fiecare cu „Generează QR”).
//   TK1b control pozitiv: citire reușită, masă FĂRĂ token → „Generează QR” apare
//        (altfel TK1 ar trece și cu lista ruptă de tot).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Restaurant } from '../../hooks/useData'

const h = vi.hoisted(() => ({
  tokensResult: { data: [] as unknown[] | null, error: null as { message: string } | null },
  rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  inserts: [] as string[],
}))

vi.mock('../../hooks/useFeatures', () => ({
  useFeatures: () => ({ features: null, loading: false, has: () => false, limit: () => null }),
}))
vi.mock('qrcode', () => ({
  default: { toDataURL: () => Promise.resolve('data:image/png;base64,x') },
}))
vi.mock('../../lib/supabase', () => {
  const tableRow = {
    id: 't1',
    restaurant_id: 'r1',
    name: 'Masa 1',
    slug: 'masa-1',
    seats: 4,
    zone: null,
    is_active: true,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'tables')
          return {
            select: () => ({
              eq: () => ({ order: () => Promise.resolve({ data: [tableRow], error: null }) }),
            }),
          }
        if (table === 'qr_tokens')
          return {
            select: () => ({ in: () => ({ eq: () => Promise.resolve(h.tokensResult) }) }),
            insert: () => {
              h.inserts.push('qr_tokens')
              return Promise.resolve({ error: null })
            },
          }
        throw new Error('tabelă neașteptată: ' + table)
      },
      rpc: h.rpc,
    },
  }
})

import TablesManager from '../TablesManager'

const restaurant = {
  id: 'r1',
  name: 'La Bella',
  slug: 'la-bella',
  primary_color: '#C8963C',
  pickup_settings: null,
} as unknown as Restaurant

beforeEach(() => {
  h.rpc.mockClear()
  h.inserts.length = 0
  h.tokensResult = { data: [], error: null }
})

describe('TablesManager — token-uri QR necunoscute', () => {
  it('TK1 citirea token-urilor pică → eroare cu Reîncearcă, fără „Generează QR”', async () => {
    h.tokensResult = { data: null, error: { message: 'boom' } }
    render(<TablesManager restaurant={restaurant} />)
    expect((await screen.findAllByText('Nu s-au putut încărca mesele')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /reîncearcă/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generează QR' })).not.toBeInTheDocument()
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.inserts).toHaveLength(0)
  })

  it('TK1b control: citire reușită, masă fără token → „Generează QR”', async () => {
    render(<TablesManager restaurant={restaurant} />)
    expect(await screen.findByRole('button', { name: 'Generează QR' })).toBeInTheDocument()
    expect(screen.queryByText('Nu s-au putut încărca mesele')).not.toBeInTheDocument()
  })
})
