// ProductsCsvImport — gărzile anti-dublură ale RETRY-ului nu mai ignoră erorile
// (code-health-error-ignored-guards). Un retry după un eșec parțial se sprijină
// pe două citiri: numele produselor (dedup) și categoriile proaspete. O citire
// eșuată NU înseamnă „nimic importat încă".
//
//   CI1  baseline-ul (numele dinaintea primei încercări) nu se poate citi →
//        importul NU pornește: zero inserări
//        Mutația care pică: codul vechi (baseline gol, importul pornea oricum).
//   CI2  retry, categoriile proaspete NU se pot citi → nu se mai creează a doua
//        oară categoria unui request comis-dar-neconfirmat
//        Mutația care pică: `const { data: freshCats } = …` fără `error`.
//   CI3  retry, numele produselor NU se pot citi → nu se reinserează orbește
//        Mutația care pică: `if (current) dbNames = …` (dedup stins tăcut).
//   CI4  control pozitiv: retry cu citiri reușite → batch-ul deja comis e sărit
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

type Op = 'select' | 'insert'
interface Reply {
  data: unknown
  error: { message: string } | null
}
interface Call {
  table: string
  op: Op
}

const { log, script } = vi.hoisted(() => ({
  log: [] as Call[],
  // (tabelă, operație, a câta oară) → răspuns. Rescris de fiecare test.
  script: {
    fn: ((): Reply => ({ data: [], error: null })) as (t: string, o: Op, n: number) => Reply,
  },
}))

vi.mock('../../lib/supabase', () => {
  function chain(table: string) {
    let op: Op = 'select'
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'range', 'single', 'order']) {
      b[m] = vi.fn(() => b)
    }
    b.insert = vi.fn(() => {
      op = 'insert'
      return b
    })
    b.then = (onFulfilled: (v: Reply) => unknown, onRejected?: (e: unknown) => unknown) => {
      const n = log.filter((c: Call) => c.table === table && c.op === op).length
      log.push({ table, op })
      return Promise.resolve(script.fn(table, op, n)).then(onFulfilled, onRejected)
    }
    return b
  }
  return { supabase: { from: vi.fn((t: string) => chain(t)) } }
})

import ProductsCsvImport from '../ProductsCsvImport'

const CSV = 'nume,categorie,pret\nEspresso,Cafele,8\n'
const ok = (data: unknown): Reply => ({ data, error: null })
const fail: Reply = { data: null, error: { message: 'network' } }
type Script = (table: string, op: Op, nth: number) => Reply
function respond(fn: Script): void {
  script.fn = fn
}

function calls(table: string, op: Op): number {
  return log.filter((c: Call) => c.table === table && c.op === op).length
}

async function openPreviewAndImport() {
  render(
    <ProductsCsvImport
      restaurantId="r1"
      existingCategories={[]}
      onClose={vi.fn()}
      onDone={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByPlaceholderText('nume,categorie,pret,emoji,descriere,tva...'), {
    target: { value: CSV },
  })
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /Previzualizare/ }))
  await user.click(screen.getByRole('button', { name: /Importă 1 produse/ }))
  return user
}

async function retry(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Importă 1 produse/ }))
}

beforeEach(() => {
  log.length = 0
})

describe('ProductsCsvImport — gărzile retry-ului nu ignoră erorile', () => {
  it('CI1: baseline-ul nu se poate citi → importul nu pornește', async () => {
    respond((t, o) => (t === 'products' && o === 'select' ? fail : ok({ id: 'c1' })))
    await openPreviewAndImport()
    expect(await screen.findByText(/importul nu a pornit/)).toBeInTheDocument()
    expect(calls('categories', 'insert')).toBe(0)
    expect(calls('products', 'insert')).toBe(0)
  })

  it('CI2: retry fără categoriile proaspete → categoria nu se creează de două ori', async () => {
    respond((t, o) => {
      if (t === 'products' && o === 'select') return ok([])
      // Încercarea 1: categoria se COMITE, dar răspunsul se pierde pe rețea.
      if (t === 'categories' && o === 'insert') return fail
      // Retry: lista proaspătă de categorii nu se poate citi.
      if (t === 'categories' && o === 'select') return fail
      return ok(null)
    })
    const user = await openPreviewAndImport()
    expect(await screen.findByText(/Eroare la categoria/)).toBeInTheDocument()
    expect(calls('categories', 'insert')).toBe(1)

    await retry(user)
    expect(await screen.findByText(/ca să nu dublăm categorii/)).toBeInTheDocument()
    expect(calls('categories', 'insert')).toBe(1)
    expect(calls('products', 'insert')).toBe(0)
  })

  it('CI3: retry fără numele produselor → nu se reinserează orbește', async () => {
    respond((t, o, n) => {
      // Baseline-ul (prima citire) reușește; citirea de pe retry pică.
      if (t === 'products' && o === 'select') return n === 0 ? ok([]) : fail
      if (t === 'categories' && o === 'insert') return ok({ id: 'c1' })
      if (t === 'categories' && o === 'select') return ok([{ id: 'c1', name: 'Cafele' }])
      // Încercarea 1: batch-ul de produse se comite, ack-ul se pierde.
      if (t === 'products' && o === 'insert') return fail
      return ok(null)
    })
    const user = await openPreviewAndImport()
    expect(await screen.findByText(/Eroare la batch/)).toBeInTheDocument()
    expect(calls('products', 'insert')).toBe(1)

    await retry(user)
    expect(await screen.findByText(/ca să nu dublăm produse/)).toBeInTheDocument()
    expect(calls('products', 'insert')).toBe(1)
  })

  it('CI4: control pozitiv — retry cu citiri reușite sare batch-ul deja comis', async () => {
    respond((t, o, n) => {
      // Baseline gol; pe retry „Espresso" există deja (comis la încercarea 1).
      if (t === 'products' && o === 'select') return n === 0 ? ok([]) : ok([{ name: 'Espresso' }])
      if (t === 'categories' && o === 'insert') return ok({ id: 'c1' })
      if (t === 'categories' && o === 'select') return ok([{ id: 'c1', name: 'Cafele' }])
      if (t === 'products' && o === 'insert') return fail
      return ok(null)
    })
    const user = await openPreviewAndImport()
    expect(await screen.findByText(/Eroare la batch/)).toBeInTheDocument()

    await retry(user)
    await waitFor(() => expect(calls('products', 'select')).toBe(2))
    // Rândul deja comis e sărit: nicio a doua inserare, nicio eroare nouă.
    await waitFor(() => expect(screen.queryByText(/Eroare la batch/)).toBeNull())
    expect(calls('products', 'insert')).toBe(1)
    expect(calls('categories', 'insert')).toBe(1)
  })
})
