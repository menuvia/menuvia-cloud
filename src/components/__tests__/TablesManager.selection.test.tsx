// Mese & QR (lotul C5b): ordinea naturală a listei, PDF-ul doar pentru mesele
// alese, mesele fără QR numărate (nu sărite tăcut), zona și activarea în lot,
// cardul PDF al unei mese. Partea pură (domeniul PDF-ului) e în
// src/lib/__tests__/tableSelection.test.ts (QG1–QG4), comparatorul în
// src/lib/__tests__/tableSort.test.ts (TN1–TN5).
// Mock-ul de `tables` întoarce rândurile în ordinea de TEXT a lui
// `.order('name')` (Masa 1, Masa 10, Masa 2, Masa 3), ca serverul.
//   QG5  lista e în ordinea NATURALĂ (Masa 1, 2, 3, 10), iar PDF-ul fără
//        selecție o moștenește; Masa 3 (fără QR) NU intră, dar toast-ul o
//        numără și notița o spune, cu „Generează QR-urile lipsă” — care
//        inserează token DOAR pentru ea (ensureTokens), fără nicio rotire.
//        Mutațiile care pică: `sortTablesByName` scos din load() (ordinea
//        10 înaintea lui 2) și toast-ul vechi „PDF descărcat” necondiționat
//        (fără numărul celor lăsate pe dinafară).
//   QG6  control POZITIV al selecției: cu O SINGURĂ masă nu există bife și nici
//        bară, iar butonul își păstrează eticheta de dinainte („Descarcă
//        QR-uri”) — testele existente (o masă) rămân valabile.
//   QG7  bifate Masa 10 și Masa 1 → butonul spune „Descarcă QR (2 mese)” și
//        PDF-ul are EXACT cele două carduri, în ordinea listei. Mutația care
//        pică: `downloadPdf` pe toată lista (comportamentul vechi: 3 carduri).
//   QG8  partenerul (`canRotateQr={false}`) setează zona pentru două mese
//        dintr-un foc: UN singur UPDATE `.in('id', …)` cu `.eq(restaurant_id)`
//        și `.select('id')`, toast-ul cu numărul, modalul se închide, zona
//        apare pe rânduri după reîncărcare. Control pozitiv pentru QG9.
//   QG9  UPDATE-ul refuzat de RLS (200, ZERO rânduri) → mesajul de drepturi,
//        NU „Zona a fost setată”, iar modalul rămâne deschis. Mutația care
//        pică: `zeroRowsAsDenied` scos (orice răspuns fără eroare = succes).
//   QG10 „Dezactivează mesele selectate” → `{ is_active: false }` pe exact
//        selecția, toast-ul la singular românesc („1 masă dezactivată”).
//   QG11 „Card PDF” pe rând: un singur card (masa rândului), format pliabil,
//        prefixul de fișier din slug; masa fără QR n-are butonul. Mutația care
//        pică: cardul construit din toată lista.
// Filtrele după o reîncărcare (recenzia lotului C5b; partea pură = ZF1–ZF2 în
// tableSelection.test.ts). Lista, „Selectează tot” și PDF-ul lucrează pe lista
// FILTRATĂ, deci un filtru rămas fără ieșire golea ecranul ȘI schimba ce se
// tipărea. Mutația care pică ZF3, ZF4 și ZF6: împăcarea filtrelor scoasă din
// `load()` (filtrul rămâne pe zona dispărută / căutarea ascunsă filtrează).
//   ZF3  Terasa filtrată, „Selectează tot (5)”, redenumită „Terasă” în lot →
//        filtrul URMEAZĂ mesele (select-ul arată „Terasă”, aceleași 5 rânduri),
//        nu „Nicio masă…” sub un select care afișa „Toate zonele” fără să
//        răspundă. Pică și fără `follow` (filtrul golit: 10 rânduri).
//   ZF4  aceeași selecție, zona scoasă (câmp gol), fără alte zone → select-ul
//        dispare și lista revine întreagă (înainte: goală și fără niciun
//        control care s-o readucă, până la remontarea filei).
//   ZF5  control POZITIV: mutarea a 2 din 5 mese în „Bar” lasă filtrul pe
//        Terasa (încă are mese) — pică dacă filtrul ar sări mereu pe zona nouă
//        sau s-ar goli la orice reîncărcare.
//   ZF6  9 mese, căutarea „Masa 1” (control: filtrează la un rând), ștearsă
//        Masa 1 → 8 mese: câmpul se ascunde ȘI se golește, lista arată cele 8.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Restaurant } from '../../hooks/useData'

type Row = Record<string, unknown>
interface UpdateCall {
  patch: Row
  eqs: Array<[string, unknown]>
  ids: string[]
}

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  tokens: [] as Row[],
  tokenInserts: [] as Row[][],
  updates: [] as UpdateCall[],
  updateDeny: false,
  download: vi.fn<(input: Record<string, unknown>) => Promise<string>>(() =>
    Promise.resolve('qr.pdf'),
  ),
}))

vi.mock('../../hooks/useFeatures', () => ({
  useFeatures: () => ({ features: null, loading: false, has: () => false, limit: () => null }),
}))
vi.mock('qrcode', () => ({
  default: { toDataURL: () => Promise.resolve('data:image/png;base64,x') },
}))
vi.mock('../../lib/qrPdf', () => ({
  downloadQrPdf: h.download,
  QR_PDF_NO_CARDS_HINT: 'qr_pdf_no_cards',
}))
vi.mock('../../lib/supabase', () => {
  const ok = <T,>(v: T) => Promise.resolve(v)
  // `select(...).eq(...)` se așteaptă direct (ensureTokens) SAU continuă cu
  // `.order(...)` (load) / `.not(...)` (zonele din modalul mesei).
  const tablesSelect = () => ({
    eq: () => {
      const res = () => ({ data: h.rows.map((r) => ({ ...r })), error: null })
      return {
        order: () => ok(res()),
        not: () => ok({ data: [], error: null }),
        then: (onOk: (v: unknown) => unknown, onKo?: (e: unknown) => unknown) =>
          ok(res()).then(onOk, onKo),
      }
    },
  })
  // update(patch).eq(...).in('id', ids).select('id') — aplică patch-ul pe
  // fixture (ca reîncărcarea să-l vadă), sau răspunde cu ZERO rânduri (RLS).
  const tablesUpdate = (patch: Row) => {
    const call: UpdateCall = { patch, eqs: [], ids: [] }
    const b = {
      eq: (c: string, v: unknown) => {
        call.eqs.push([c, v])
        return b
      },
      in: (_c: string, v: string[]) => {
        call.ids = [...v]
        return b
      },
      select: () => {
        h.updates.push(call)
        if (h.updateDeny) return ok({ data: [], error: null })
        for (const r of h.rows) if (call.ids.includes(r.id as string)) Object.assign(r, patch)
        return ok({ data: call.ids.map((id) => ({ id })), error: null })
      },
    }
    return b
  }
  // delete().eq('id', id).select('id') — scoate rândul din fixture.
  const tablesDelete = () => ({
    eq: (_c: string, id: unknown) => ({
      select: () => {
        h.rows = h.rows.filter((r: Row) => r.id !== id)
        return ok({ data: [{ id }], error: null })
      },
    }),
  })
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'tables')
          return { select: tablesSelect, update: tablesUpdate, delete: tablesDelete }
        if (table === 'qr_tokens')
          return {
            select: () => ({
              in: () => ({ eq: () => ok({ data: h.tokens.map((t) => ({ ...t })), error: null }) }),
            }),
            insert: (rows: Row[]) => {
              h.tokenInserts.push(rows)
              for (const r of rows)
                h.tokens.push({
                  id: `tk-${String(r.table_id)}`,
                  restaurant_id: r.restaurant_id,
                  table_id: r.table_id,
                  token: `tok-${String(r.table_id)}`,
                  is_active: true,
                  expires_at: null,
                  created_at: '2026-10-01T10:00:00Z',
                })
              return ok({ error: null })
            },
          }
        throw new Error('tabelă neașteptată: ' + table)
      },
      rpc: () => ok({ data: null, error: null }),
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
  language: 'ro',
} as unknown as Restaurant

const table = (id: string, name: string, slug: string): Row => ({
  id,
  restaurant_id: 'r1',
  name,
  slug,
  seats: 4,
  zone: null,
  is_active: true,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
})
const token = (tableId: string): Row => ({
  id: `tk-${tableId}`,
  restaurant_id: 'r1',
  table_id: tableId,
  token: `tok-${tableId}`,
  is_active: true,
  expires_at: null,
  created_at: '2026-10-01T10:00:00Z',
})

beforeEach(() => {
  // Ordinea de TEXT, ca `.order('name')`.
  h.rows = [
    table('t1', 'Masa 1', 'masa-1'),
    table('t10', 'Masa 10', 'masa-10'),
    table('t2', 'Masa 2', 'masa-2'),
    table('t3', 'Masa 3', 'masa-3'),
  ]
  h.tokens = [token('t1'), token('t10'), token('t2')]
  h.tokenInserts = []
  h.updates = []
  h.updateDeny = false
  h.download.mockReset()
  h.download.mockImplementation(() => Promise.resolve('qr.pdf'))
})

const rowOrder = () =>
  screen
    .getAllByRole('checkbox')
    .map((c) => (c.getAttribute('aria-label') ?? '').replace(/^Selectează /, ''))
const cardLabels = (call = 0) =>
  ((h.download.mock.calls[call]![0] as { cards: Array<{ label: string }> }).cards ?? []).map(
    (c) => c.label,
  )

async function openPdfMenu(
  user: ReturnType<typeof userEvent.setup>,
  trigger: string,
  format: RegExp,
) {
  await user.click(screen.getByRole('button', { name: trigger }))
  await user.click(screen.getByRole('menuitem', { name: format }))
}

describe('Mese & QR — ordine, selecție, PDF', () => {
  it('QG5: ordine naturală; PDF-ul numără masa fără QR și oferă scurtătura', async () => {
    const user = userEvent.setup()
    render(<TablesManager restaurant={restaurant} canRotateQr />)
    await screen.findByRole('checkbox', { name: 'Selectează Masa 10' })
    expect(rowOrder()).toEqual(['Masa 1', 'Masa 2', 'Masa 3', 'Masa 10'])

    await openPdfMenu(user, 'Descarcă QR-uri', /Grilă/)
    await waitFor(() => expect(h.download).toHaveBeenCalledTimes(1))
    expect(cardLabels()).toEqual(['Masa 1', 'Masa 2', 'Masa 10'])
    expect(
      await screen.findByText('PDF descărcat — 1 masă a rămas pe dinafară'),
    ).toBeInTheDocument()
    expect(screen.queryByText('PDF descărcat')).not.toBeInTheDocument()
    expect(screen.getByText('1 masă fără QR n-a intrat în PDF.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Generează QR-urile lipsă' }))
    expect(
      await screen.findByText('QR-urile lipsă au fost generate. Descarcă din nou PDF-ul.'),
    ).toBeInTheDocument()
    expect(h.tokenInserts).toEqual([[{ restaurant_id: 'r1', table_id: 't3' }]])
    expect(screen.queryByText('1 masă fără QR n-a intrat în PDF.')).not.toBeInTheDocument()
  })

  it('QG6: control — o singură masă: fără bife, fără bară, eticheta de dinainte', async () => {
    h.rows = [table('t1', 'Masa 1', 'masa-1')]
    h.tokens = [token('t1')]
    render(<TablesManager restaurant={restaurant} canRotateQr />)
    expect(await screen.findByRole('button', { name: 'Descarcă QR-uri' })).toBeInTheDocument()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByRole('group', { name: 'Mesele selectate' })).not.toBeInTheDocument()
    // Cardul PDF al mesei există și cu o singură masă.
    expect(screen.getByRole('button', { name: 'Card PDF pentru Masa 1' })).toBeInTheDocument()
  })

  it('QG7: PDF-ul doar pentru mesele bifate, în ordinea listei', async () => {
    const user = userEvent.setup()
    render(<TablesManager restaurant={restaurant} canRotateQr />)
    await user.click(await screen.findByRole('checkbox', { name: 'Selectează Masa 10' }))
    await user.click(screen.getByRole('checkbox', { name: 'Selectează Masa 1' }))
    const bar = screen.getByRole('group', { name: 'Mesele selectate' })
    expect(within(bar).getByText('2 mese selectate')).toBeInTheDocument()

    await openPdfMenu(user, 'Descarcă QR (2 mese)', /Grilă/)
    await waitFor(() => expect(h.download).toHaveBeenCalledTimes(1))
    expect(cardLabels()).toEqual(['Masa 1', 'Masa 10'])
    expect(h.download.mock.calls[0]![0]).toMatchObject({
      format: 'grid',
      canOrder: false,
      menuLanguage: 'ro',
    })
    expect(await screen.findByText('PDF descărcat')).toBeInTheDocument()

    // „Selectează tot” → toate patru; „Deselectează” → eticheta de dinainte.
    await user.click(within(bar).getByRole('button', { name: 'Selectează tot (4)' }))
    expect(screen.getByRole('button', { name: 'Descarcă QR (4 mese)' })).toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: 'Deselectează' }))
    expect(screen.getByRole('button', { name: 'Descarcă QR-uri' })).toBeInTheDocument()
  })

  it('QG8: partenerul setează zona pentru două mese dintr-un singur UPDATE', async () => {
    const user = userEvent.setup()
    render(<TablesManager restaurant={restaurant} canRotateQr={false} />)
    await user.click(await screen.findByRole('checkbox', { name: 'Selectează Masa 3' }))
    await user.click(screen.getByRole('checkbox', { name: 'Selectează Masa 2' }))
    await user.click(screen.getByRole('button', { name: 'Setează zona…' }))
    const dialog = screen.getByRole('dialog', { name: 'Zona pentru 2 mese' })
    await user.type(within(dialog).getByLabelText('Zonă'), 'Terasa')
    await user.click(within(dialog).getByRole('button', { name: 'Salvează' }))

    expect(await screen.findByText('Zona a fost setată pentru 2 mese')).toBeInTheDocument()
    expect(h.updates).toEqual([
      { patch: { zone: 'Terasa' }, eqs: [['restaurant_id', 'r1']], ids: ['t2', 't3'] },
    ])
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Zona pentru 2 mese' })).not.toBeInTheDocument(),
    )
    expect(await screen.findAllByText('Terasa')).toHaveLength(2)
  })

  it('QG9: UPDATE-ul refuzat de RLS nu se anunță ca succes', async () => {
    h.updateDeny = true
    const user = userEvent.setup()
    render(<TablesManager restaurant={restaurant} canRotateQr={false} />)
    await user.click(await screen.findByRole('checkbox', { name: 'Selectează Masa 2' }))
    await user.click(screen.getByRole('button', { name: 'Setează zona…' }))
    const dialog = screen.getByRole('dialog', { name: 'Zona pentru 1 masă' })
    await user.type(within(dialog).getByLabelText('Zonă'), 'Bar')
    await user.click(within(dialog).getByRole('button', { name: 'Salvează' }))

    expect(await screen.findByText('Nu ai drepturi pentru această acțiune.')).toBeInTheDocument()
    expect(h.updates).toHaveLength(1)
    expect(screen.queryByText(/Zona a fost setată/)).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Zona pentru 1 masă' })).toBeInTheDocument()
  })

  it('QG10: dezactivarea în lot atinge exact selecția', async () => {
    const user = userEvent.setup()
    render(<TablesManager restaurant={restaurant} canRotateQr />)
    await user.click(await screen.findByRole('checkbox', { name: 'Selectează Masa 1' }))
    await user.click(screen.getByRole('button', { name: 'Dezactivează mesele selectate' }))
    expect(await screen.findByText('1 masă dezactivată')).toBeInTheDocument()
    expect(h.updates).toEqual([
      { patch: { is_active: false }, eqs: [['restaurant_id', 'r1']], ids: ['t1'] },
    ])
    expect(await screen.findByText('Inactiv')).toBeInTheDocument()
  })

  it('QG11: cardul PDF al unei mese are doar masa rândului', async () => {
    const user = userEvent.setup()
    render(<TablesManager restaurant={restaurant} canRotateQr />)
    await user.click(await screen.findByRole('button', { name: 'Card PDF pentru Masa 2' }))
    const menu = screen.getByRole('menu', { name: 'Formatul cardului pentru Masa 2' })
    await user.click(within(menu).getByRole('menuitem', { name: /Card pliabil/ }))
    await waitFor(() => expect(h.download).toHaveBeenCalledTimes(1))
    const input = h.download.mock.calls[0]![0] as { cards: Array<{ label: string; url: string }> }
    expect(input).toMatchObject({
      format: 'tent',
      filePrefix: 'QR-masa-2',
      canOrder: false,
      menuLanguage: 'ro',
    })
    expect(input.cards).toHaveLength(1)
    expect(input.cards[0]!.label).toBe('Masa 2')
    expect(input.cards[0]!.url).toMatch(/\/q\/tok-t2$/)
    expect(await screen.findByText('Card PDF descărcat pentru Masa 2')).toBeInTheDocument()
    // Masa fără QR nu are card de tipărit.
    expect(screen.queryByRole('button', { name: 'Card PDF pentru Masa 3' })).not.toBeInTheDocument()
  })
})

/** Masa 1…Masa N, toate cu QR; zona aleasă per index (0-based). */
function seedTables(n: number, zoneOf: (i: number) => string | null) {
  h.rows = Array.from({ length: n }, (_, i) => ({
    ...table(`t${i + 1}`, `Masa ${i + 1}`, `masa-${i + 1}`),
    zone: zoneOf(i),
  }))
  h.tokens = h.rows.map((r: Row) => token(r.id as string))
}
const masa = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `Masa ${from + i}`)
const zoneSelect = () => screen.getByRole('combobox', { name: 'Filtrează după zonă' })
const NO_MATCHES = 'Nicio masă nu corespunde filtrelor.'

/** Filtrează pe Terasa (5 mese) și deschide „Setează zona…” pe `pick` din ele. */
async function zoneBulkOnTerasa(
  user: ReturnType<typeof userEvent.setup>,
  pick: 'all' | string[],
): Promise<HTMLElement> {
  await screen.findByRole('checkbox', { name: 'Selectează Masa 10' })
  await user.selectOptions(zoneSelect(), 'Terasa')
  expect(rowOrder()).toEqual(masa(1, 5))
  const bar = screen.getByRole('group', { name: 'Mesele selectate' })
  if (pick === 'all') {
    await user.click(within(bar).getByRole('button', { name: 'Selectează tot (5)' }))
  } else {
    for (const name of pick) await user.click(screen.getByRole('checkbox', { name: `Selectează ${name}` }))
  }
  await user.click(within(bar).getByRole('button', { name: 'Setează zona…' }))
  const n = pick === 'all' ? 5 : pick.length
  return screen.getByRole('dialog', { name: `Zona pentru ${n} mese` })
}

describe('Mese & QR — filtrele urmează lista după reîncărcare', () => {
  it('ZF3: zona redenumită pe toate mesele ei → filtrul o urmează, lista nu se golește', async () => {
    seedTables(10, (i) => (i < 5 ? 'Terasa' : 'Interior'))
    const user = userEvent.setup()
    render(<TablesManager restaurant={restaurant} canRotateQr />)
    const dialog = await zoneBulkOnTerasa(user, 'all')
    await user.type(within(dialog).getByLabelText('Zonă'), 'Terasă')
    await user.click(within(dialog).getByRole('button', { name: 'Salvează' }))

    expect(await screen.findByText('Zona a fost setată pentru 5 mese')).toBeInTheDocument()
    expect(h.updates).toEqual([
      {
        patch: { zone: 'Terasă' },
        eqs: [['restaurant_id', 'r1']],
        ids: ['t1', 't2', 't3', 't4', 't5'],
      },
    ])
    // Select-ul arată „Terasă” DOAR după reîncărcare (înainte: „Terasa”).
    await waitFor(() => expect(zoneSelect()).toHaveValue('Terasă'))
    expect(rowOrder()).toEqual(masa(1, 5))
    expect(screen.queryByText(NO_MATCHES)).not.toBeInTheDocument()
  })

  it('ZF4: zona scoasă de pe toate mesele ei, fără alte zone → lista revine întreagă', async () => {
    seedTables(10, (i) => (i < 5 ? 'Terasa' : null))
    const user = userEvent.setup()
    render(<TablesManager restaurant={restaurant} canRotateQr />)
    const dialog = await zoneBulkOnTerasa(user, 'all')
    // Câmpul gol = fără zonă.
    await user.click(within(dialog).getByRole('button', { name: 'Salvează' }))

    expect(await screen.findByText('Zona a fost scoasă de pe 5 mese')).toBeInTheDocument()
    expect(h.updates.map((u: UpdateCall) => u.patch)).toEqual([{ zone: null }])
    await waitFor(() => expect(rowOrder()).toEqual(masa(1, 10)))
    // Nicio zonă rămasă: select-ul nu se mai randează — și nici nu mai e nevoie.
    expect(screen.queryByRole('combobox', { name: 'Filtrează după zonă' })).not.toBeInTheDocument()
    expect(screen.queryByText(NO_MATCHES)).not.toBeInTheDocument()
  })

  it('ZF5: control — mutarea parțială lasă filtrul pe zona veche, care încă are mese', async () => {
    seedTables(10, (i) => (i < 5 ? 'Terasa' : 'Interior'))
    const user = userEvent.setup()
    render(<TablesManager restaurant={restaurant} canRotateQr />)
    const dialog = await zoneBulkOnTerasa(user, ['Masa 1', 'Masa 2'])
    await user.type(within(dialog).getByLabelText('Zonă'), 'Bar')
    await user.click(within(dialog).getByRole('button', { name: 'Salvează' }))

    expect(await screen.findByText('Zona a fost setată pentru 2 mese')).toBeInTheDocument()
    expect(h.updates.map((u: UpdateCall) => u.ids)).toEqual([['t1', 't2']])
    await waitFor(() => expect(rowOrder()).toEqual(masa(3, 5)))
    expect(zoneSelect()).toHaveValue('Terasa')
  })

  it('ZF6: ștergerea care coboară lista la 8 mese ascunde căutarea și o golește', async () => {
    seedTables(9, () => null)
    const user = userEvent.setup()
    render(<TablesManager restaurant={restaurant} canRotateQr />)
    await screen.findByRole('checkbox', { name: 'Selectează Masa 9' })
    await user.type(screen.getByRole('textbox', { name: 'Caută masă după nume' }), 'Masa 1')
    // Control pozitiv: cu 9 mese căutarea se vede și filtrează.
    expect(rowOrder()).toEqual(['Masa 1'])

    await user.click(screen.getByRole('button', { name: 'Șterge masă' }))
    const dialog = screen.getByRole('dialog', { name: 'Șterge masă' })
    await user.click(within(dialog).getByRole('button', { name: 'Șterge' }))

    expect(await screen.findByText('Masă ștearsă')).toBeInTheDocument()
    await waitFor(() => expect(rowOrder()).toEqual(masa(2, 9)))
    expect(screen.queryByRole('textbox', { name: 'Caută masă după nume' })).not.toBeInTheDocument()
    expect(screen.queryByText(NO_MATCHES)).not.toBeInTheDocument()
  })
})
