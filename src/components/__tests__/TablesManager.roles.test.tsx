// Mese & QR — fiecare rol vede doar ce poate face, iar un refuz NU se arată ca
// succes.
//
//   RQ1  partenerul (`canRotateQr={false}`, mig 286): fără „Regenerează QR"
//        (`rotate_qr_token` verifică membership-ul real, fără escape de partener).
//        Mutația care pică: butonul randat necondiționat (codul vechi).
//   RQ2  control pozitiv: owner/manager (implicit) văd „Regenerează QR".
//   RD1  ștergerea refuzată de RLS — PostgREST răspunde 200 cu ZERO rânduri și
//        FĂRĂ eroare → mesajul de drepturi, NU „Masă ștearsă".
//        Mutația care pică: `.delete().eq(...)` fără `.select('id')` și fără
//        numărarea rândurilor (codul vechi: `if (error) throw` → „Masă ștearsă").
//   RD2  control pozitiv: un rând șters → „Masă ștearsă".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Restaurant } from '../../hooks/useData'

const h = vi.hoisted(() => ({
  deleteResult: { data: [] as unknown[] | null, error: null as { message: string } | null },
  deletes: 0,
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
  const tokenRow = {
    id: 'tk1',
    restaurant_id: 'r1',
    table_id: 't1',
    token: 'abc123',
    is_active: true,
    created_at: '2026-10-01T10:00:00Z',
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'tables')
          return {
            select: () => ({
              eq: () => ({ order: () => Promise.resolve({ data: [tableRow], error: null }) }),
            }),
            delete: () => ({
              eq: () => ({
                select: () => {
                  h.deletes += 1
                  return Promise.resolve(h.deleteResult)
                },
              }),
            }),
          }
        if (table === 'qr_tokens')
          return {
            select: () => ({
              in: () => ({ eq: () => Promise.resolve({ data: [tokenRow], error: null }) }),
            }),
          }
        throw new Error('tabelă neașteptată: ' + table)
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
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
  h.deletes = 0
  h.deleteResult = { data: [], error: null }
})

describe('TablesManager — QR-ul pe rol', () => {
  it('RQ1 partenerul nu vede „Regenerează QR"', async () => {
    render(<TablesManager restaurant={restaurant} canRotateQr={false} />)
    // Masa e randată (control): acțiunile ei de editare sunt acolo.
    expect(await screen.findByRole('button', { name: 'Editează masă' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Regenerează QR' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generează QR' })).not.toBeInTheDocument()
  })

  it('RQ2 control: owner/manager văd „Regenerează QR"', async () => {
    render(<TablesManager restaurant={restaurant} />)
    expect(await screen.findByRole('button', { name: 'Regenerează QR' })).toBeInTheDocument()
  })
})

describe('TablesManager — ștergerea refuzată nu e „ștearsă"', () => {
  async function deleteTable() {
    const user = userEvent.setup()
    render(<TablesManager restaurant={restaurant} />)
    await user.click(await screen.findByRole('button', { name: 'Șterge masă' }))
    await user.click(screen.getByRole('button', { name: 'Șterge' }))
  }

  it('RD1 zero rânduri șterse → „Nu ai drepturi…", nu „Masă ștearsă"', async () => {
    h.deleteResult = { data: [], error: null }
    await deleteTable()
    expect(await screen.findByText('Nu ai drepturi pentru această acțiune.')).toBeInTheDocument()
    expect(screen.queryByText('Masă ștearsă')).not.toBeInTheDocument()
    expect(h.deletes).toBe(1)
  })

  it('RD2 control: un rând șters → „Masă ștearsă"', async () => {
    h.deleteResult = { data: [{ id: 't1' }], error: null }
    await deleteTable()
    expect(await screen.findByText('Masă ștearsă')).toBeInTheDocument()
    expect(screen.queryByText('Nu ai drepturi pentru această acțiune.')).not.toBeInTheDocument()
  })
})
