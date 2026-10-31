// Mese & QR: generarea în lot nu anunță „fiecare cu QR-ul ei” când verificarea
// token-urilor a picat (recenzie CodeRabbit pe #319). `ensureTokens` afișa
// eroarea și se întorcea normal, iar apelantul punea imediat dedesubt toast-ul
// de succes — toast-urile se stivuiesc, deci patronul vedea ambele mesaje.
//
//   TK2  citirea token-urilor din ensureTokens pică → apare eroarea, NU apare
//        succesul și nu se inserează niciun token. Mutația care pică: apelul
//        `toast(`${rows.length} mese create, fiecare cu QR-ul ei`)` fără
//        condiția pe rezultatul lui ensureTokens (comportamentul vechi).
//   TK2b control pozitiv: citire reușită → token-uri inserate + succesul afișat
//        (altfel TK2 ar trece și cu generarea ruptă de tot).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Restaurant } from '../../hooks/useData'

type Row = Record<string, unknown>
type Result = { data: Row[] | null; error: { message: string } | null }

const h = vi.hoisted(() => ({
  tableRows: [] as Record<string, unknown>[],
  tokenReads: [] as Array<{
    data: Record<string, unknown>[] | null
    error: { message: string } | null
  }>,
  tokenInserts: 0,
}))

vi.mock('../../hooks/useFeatures', () => ({
  useFeatures: () => ({ features: null, loading: false, has: () => false, limit: () => null }),
}))
vi.mock('qrcode', () => ({
  default: { toDataURL: () => Promise.resolve('data:image/png;base64,x') },
}))
vi.mock('../../lib/supabase', () => {
  // `select(...).eq(...)` se așteaptă direct (ensureTokens) SAU continuă cu
  // `.order(...)` (load): același obiect trebuie să fie și promisiune, și să
  // aibă `order`.
  const tablesQuery = () => {
    const res = (): Result => ({ data: h.tableRows.map((r) => ({ ...r })), error: null })
    return Object.assign(Promise.resolve(res()), { order: () => Promise.resolve(res()) })
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'tables')
          return {
            select: () => ({ eq: () => tablesQuery() }),
            insert: (rows: Row[]) => {
              rows.forEach((r, i) => {
                h.tableRows.push({
                  ...r,
                  id: `t${h.tableRows.length + i + 1}`,
                  seats: null,
                  zone: null,
                  is_active: true,
                  created_at: '2026-10-01T10:00:00Z',
                  updated_at: '2026-10-01T10:00:00Z',
                })
              })
              return Promise.resolve({ error: null })
            },
          }
        if (table === 'qr_tokens')
          return {
            select: () => ({
              in: () => ({
                eq: () => Promise.resolve(h.tokenReads.shift() ?? { data: [], error: null }),
              }),
            }),
            insert: () => {
              h.tokenInserts += 1
              return Promise.resolve({ error: null })
            },
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
  h.tableRows = []
  h.tokenReads = []
  h.tokenInserts = 0
})

async function generate(n: string): Promise<void> {
  render(<TablesManager restaurant={restaurant} />)
  const input = await screen.findByLabelText('Numărul de mese')
  fireEvent.change(input, { target: { value: n } })
  fireEvent.click(screen.getByRole('button', { name: 'Generează mese și QR-uri' }))
  // Butonul iese din „Se generează...” abia după toast-ul de succes (dacă există).
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Se generează...' })).not.toBeInTheDocument(),
  )
}

describe('TablesManager — generarea în lot și verificarea QR-urilor', () => {
  it('TK2 verificarea token-urilor pică → eroarea, fără „fiecare cu QR-ul ei”', async () => {
    // Prima citire de token-uri e cea din ensureTokens (lista pornește goală,
    // deci load() inițial nu citește token-uri).
    h.tokenReads = [{ data: null, error: { message: 'boom' } }]
    await generate('2')
    expect(await screen.findByText(/Nu am putut verifica QR-urile existente/)).toBeInTheDocument()
    expect(screen.queryByText(/fiecare cu QR-ul ei/)).not.toBeInTheDocument()
    expect(h.tokenInserts).toBe(0)
  })

  it('TK2b control: verificare reușită → token-uri inserate și succesul afișat', async () => {
    await generate('2')
    expect(await screen.findByText('2 mese create, fiecare cu QR-ul ei')).toBeInTheDocument()
    expect(h.tokenInserts).toBe(1)
    expect(screen.queryByText(/Nu am putut verifica QR-urile existente/)).not.toBeInTheDocument()
  })
})
