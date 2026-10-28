// Teste pe importul AI al meniului — „nu mai pierde munca” (pachetul 10).
//   AM1  draftul rămas în sessionStorage se oferă la redeschidere: „Reia importul”
//   AM2  un tap pe fundal NU închide ecranul de revizuire (✕ da); pe upload, da
//   AM3  fiecare modificare din revizuire se salvează în draft
//   AM4  plafonul planului: UN singur mesaj înainte de salvare, Salvează dezactivat
//   AM5  respingerea de plafon de la server: UN singur mesaj, fără inserări pe rând,
//        draftul rămâne
//   AM6  import reușit → draftul se șterge (o reluare ar duplica produsele)
//   AM7  storage care ARUNCĂ → importul merge, fără banner și fără excepții
//   AM8  promptul poartă moneda restaurantului (EUR) și rămâne „lei” când nu o știm
//   AM9  cât există un draft nesalvat, input-ul de poze e dezactivat (o extragere nouă
//        nu-l poate înlocui tăcut); „Renunță la draft” cere confirmare
//   AM10 import parțial: în draft rămân EXACT produsele nesalvate + rândurile
//        neselectate; cele salvate dispar; ecranul „done” spune câte au rămas
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadImportDraft, saveImportDraft, type ImportDraftProduct } from '../../lib/aiImportDraft'

interface AiCall {
  restaurant_id: string
  messages: Array<{ role: string; content: unknown }>
}
interface DbResult {
  data?: unknown
  error?: { hint?: string; message: string } | null
}

const aiMenuImport = vi.fn<(input: AiCall) => Promise<{ text: string }>>()
const createMany = vi.fn<(rows: unknown) => Promise<DbResult>>()
const createOne = vi.fn<(row: unknown) => Promise<DbResult>>()
const createCategory = vi.fn<(row: unknown) => Promise<DbResult>>()
const maybeSingle = vi.fn<() => DbResult>()
const confirmMock = vi.hoisted(() =>
  vi.fn<(opts: { title: string; destructive?: boolean }) => Promise<boolean>>(),
)
vi.mock('../ui/confirm', () => ({ confirm: confirmMock }))

vi.mock('../../lib/ai', () => ({
  aiMenuImport: (input: AiCall) => aiMenuImport(input),
}))
vi.mock('../../hooks/useData', () => ({
  useProducts: () => ({
    createMany: (rows: unknown) => createMany(rows),
    create: (row: unknown) => createOne(row),
  }),
  useCategories: () => ({ categories: [], create: (row: unknown) => createCategory(row) }),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }) }),
  },
}))

import AiMenuImport from '../AiMenuImport'

const RID = 'r1'
const STORAGE_KEY = `menuvia.ai_import_draft.${RID}`

function draft(over: Partial<ImportDraftProduct> = {}): ImportDraftProduct {
  return {
    name: 'Pizza',
    description: '',
    price: 32,
    emoji: '🍕',
    category_id: '',
    category_name: '',
    include: true,
    ...over,
  }
}

function seed(drafts: ImportDraftProduct[] = [draft(), draft({ name: 'Paste', price: 28 })]): void {
  saveImportDraft(RID, drafts)
}

function renderImport(props: { remainingSlots?: number } = {}) {
  const onClose = vi.fn()
  const onImported = vi.fn()
  const utils = render(
    <AiMenuImport restaurantId={RID} onClose={onClose} onImported={onImported} {...props} />,
  )
  return { onClose, onImported, ...utils }
}

const spies: Array<{ mockRestore: () => void }> = []

beforeEach(() => {
  sessionStorage.clear()
  aiMenuImport.mockReset()
  createMany.mockReset().mockResolvedValue({ data: [{}, {}], error: null })
  createOne.mockReset().mockResolvedValue({ data: {}, error: null })
  createCategory.mockReset()
  maybeSingle.mockReset().mockReturnValue({ data: null, error: { message: 'n/a' } })
  confirmMock.mockReset().mockResolvedValue(true)
})

afterEach(() => {
  while (spies.length) spies.pop()?.mockRestore()
  sessionStorage.clear()
})

describe('AiMenuImport — draft și plafon', () => {
  it('AM1: draftul din sessionStorage se oferă și se reia', async () => {
    seed()
    renderImport()
    expect(await screen.findByTestId('resume-import')).toHaveTextContent('2 produse extrase')
    await userEvent.click(screen.getByRole('button', { name: 'Reia importul' }))
    expect(await screen.findByText(/Am găsit 2 produse/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('Pizza')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Paste')).toBeInTheDocument()
    expect(screen.queryByTestId('resume-import')).not.toBeInTheDocument()
  })

  it('AM1b: fără draft nu există banner; „Renunță la draft” cere confirmare', async () => {
    const { unmount } = renderImport()
    expect(await screen.findByText('Alege pozele')).toBeInTheDocument()
    expect(screen.queryByTestId('resume-import')).not.toBeInTheDocument()
    unmount()

    seed()
    renderImport()
    // Fără confirmare, draftul NU se șterge.
    confirmMock.mockResolvedValueOnce(false)
    await userEvent.click(await screen.findByRole('button', { name: 'Renunță la draft' }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(confirmMock.mock.calls[0]![0].destructive).toBe(true)
    expect(screen.getByTestId('resume-import')).toBeInTheDocument()
    expect(loadImportDraft(RID)?.drafts).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'Renunță la draft' }))
    await waitFor(() => expect(screen.queryByTestId('resume-import')).not.toBeInTheDocument())
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('AM9: cât există un draft nesalvat, poze noi nu se pot alege (nu-l înlocuiesc tăcut)', async () => {
    seed()
    const { container } = renderImport()
    await screen.findByTestId('resume-import')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeDisabled()
    expect(screen.getByTestId('resume-import')).toHaveTextContent(/reia-l sau renunță la el/)
    expect(aiMenuImport).not.toHaveBeenCalled()
    // După renunțarea explicită, input-ul se activează (control pozitiv).
    await userEvent.click(screen.getByRole('button', { name: 'Renunță la draft' }))
    await waitFor(() => expect(container.querySelector('input[type="file"]')).toBeEnabled())
  })

  it('AM2: tap pe fundal nu închide revizuirea (✕ da); pe upload, fundalul închide', async () => {
    seed()
    const { onClose, container } = renderImport()
    // Control pozitiv: pe ecranul de upload, fundalul închide.
    await screen.findByTestId('resume-import')
    await userEvent.click(container.firstChild as Element)
    expect(onClose).toHaveBeenCalledTimes(1)

    onClose.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Reia importul' }))
    await screen.findByText(/Am găsit 2 produse/)
    await userEvent.click(container.firstChild as Element)
    expect(onClose).not.toHaveBeenCalled()
    // ✕ rămâne calea explicită de închidere, iar draftul e încă acolo.
    await userEvent.click(screen.getByRole('button', { name: 'Închide' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(loadImportDraft(RID)?.drafts).toHaveLength(2)
  })

  it('AM3: modificările din revizuire se salvează în draft', async () => {
    seed()
    renderImport()
    await userEvent.click(await screen.findByRole('button', { name: 'Reia importul' }))
    const first = await screen.findByDisplayValue('Pizza')
    await userEvent.clear(first)
    await userEvent.type(first, 'Pizza Margherita')
    await waitFor(() =>
      expect(loadImportDraft(RID)?.drafts.map((d) => d.name)).toEqual(['Pizza Margherita', 'Paste']),
    )
    await userEvent.click(screen.getAllByRole('checkbox')[1]!)
    await waitFor(() => expect(loadImportDraft(RID)?.drafts[1]?.include).toBe(false))
  })

  it('AM4: plafonul planului — UN mesaj, Salvează dezactivat, apoi se deblochează', async () => {
    seed()
    renderImport({ remainingSlots: 1 })
    await userEvent.click(await screen.findByRole('button', { name: 'Reia importul' }))
    const alert = await screen.findByTestId('plan-limit')
    expect(alert).toHaveTextContent(/mai permite 1 produs,/)
    expect(alert).toHaveTextContent(/Debifează 1 produs/)
    expect(screen.getAllByTestId('plan-limit')).toHaveLength(1)
    const save = screen.getByRole('button', { name: /^Salvează/ })
    expect(save).toBeDisabled()
    await userEvent.click(save)
    expect(createMany).not.toHaveBeenCalled()

    // Debifez un produs → încape; mesajul dispare, butonul se activează.
    await userEvent.click(screen.getAllByRole('checkbox')[1]!)
    expect(screen.queryByTestId('plan-limit')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Salvează/ })).toBeEnabled()
  })

  it('AM5: respingere de plafon de la server — un singur mesaj, fără inserări pe rând, draftul rămâne', async () => {
    seed()
    createMany.mockResolvedValueOnce({
      data: null,
      error: { hint: 'product_limit', message: 'Limită produse atinsă: maxim 15 pe planul curent.' },
    })
    renderImport() // fără remainingSlots: decide serverul
    await userEvent.click(await screen.findByRole('button', { name: 'Reia importul' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Salvează 2 produse/ }))
    expect(await screen.findByText(/Nimic nu a fost salvat\. Limită produse atinsă/)).toBeInTheDocument()
    expect(createOne).not.toHaveBeenCalled() // fără bucla de N inserări
    // Rămânem în revizuire; draftul e intact și butonul reîncercabil.
    expect(screen.getByRole('button', { name: /^Salvează 2 produse/ })).toBeEnabled()
    expect(loadImportDraft(RID)?.drafts).toHaveLength(2)
  })

  it('AM5b: plafon atins în bucla pe rând — oprește la primul, un singur mesaj', async () => {
    seed([draft(), draft({ name: 'Paste' }), draft({ name: 'Supă' })])
    createMany.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } })
    createOne
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValue({ data: null, error: { hint: 'product_limit', message: 'Limită produse atinsă' } })
    renderImport()
    await userEvent.click(await screen.findByRole('button', { name: 'Reia importul' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Salvează 3 produse/ }))
    expect(await screen.findByText(/1 produse salvate, 1 probleme/)).toBeInTheDocument()
    expect(createOne).toHaveBeenCalledTimes(2) // al treilea nici nu se încearcă
    expect(screen.getAllByText(/limita de produse a planului a fost atinsă/)).toHaveLength(1)
    // Draftul păstrează produsul care a atins plafonul ȘI pe cel neîncercat; cel salvat dispare.
    expect(loadImportDraft(RID)?.drafts.map((d) => d.name)).toEqual(['Paste', 'Supă'])
    expect(screen.getByTestId('left-in-draft')).toHaveTextContent(/2 produse au rămas în draft/)
  })

  it('AM10: import parțial — în draft rămân nesalvatele + neselectatele, nu și cele salvate', async () => {
    seed([draft({ name: 'Pizza' }), draft({ name: 'Paste' }), draft({ name: 'Supă', include: false })])
    createMany.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } })
    createOne
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'network blip' } })
    const { onImported } = renderImport()
    await userEvent.click(await screen.findByRole('button', { name: 'Reia importul' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Salvează 2 produse/ }))
    expect(await screen.findByText(/1 produse salvate, 1 probleme/)).toBeInTheDocument()
    expect(onImported).toHaveBeenCalledWith(1)
    expect(screen.getByTestId('left-in-draft')).toHaveTextContent(/1 produs a rămas în draft/)
    const left = loadImportDraft(RID)?.drafts
    expect(left?.map((d) => d.name)).toEqual(['Paste', 'Supă'])
    expect(left?.map((d) => d.include)).toEqual([true, false]) // neselectatul rămâne neselectat
  })

  it('AM6: import reușit — draftul se șterge, callerul află numărul', async () => {
    seed()
    const { onImported } = renderImport()
    await userEvent.click(await screen.findByRole('button', { name: 'Reia importul' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Salvează 2 produse/ }))
    expect(await screen.findByText('2 produse adăugate!')).toBeInTheDocument()
    expect(onImported).toHaveBeenCalledWith(2)
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(screen.queryByTestId('left-in-draft')).not.toBeInTheDocument()
  })

  it('AM6b: nimic salvat (toate eșuează) — draftul NU se șterge', async () => {
    seed()
    createMany.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } })
    createOne.mockResolvedValue({ data: null, error: { message: 'network blip' } })
    renderImport()
    await userEvent.click(await screen.findByRole('button', { name: 'Reia importul' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Salvează 2 produse/ }))
    expect(await screen.findByText(/0 produse salvate/)).toBeInTheDocument()
    expect(loadImportDraft(RID)?.drafts).toHaveLength(2)
    expect(screen.getByTestId('left-in-draft')).toHaveTextContent(/2 produse au rămas în draft/)
  })
})

describe('AiMenuImport — storage care aruncă și prompt', () => {
  function breakStorage(): void {
    const boom = (): never => {
      throw new DOMException('denied', 'SecurityError')
    }
    spies.push(
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom),
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom),
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom),
    )
  }

  async function uploadMenuPhoto(container: HTMLElement): Promise<void> {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(['x'], 'meniu.png', { type: 'image/png' }))
  }

  const promptOf = (): string => {
    const call = aiMenuImport.mock.calls[0]![0]
    const parts = call.messages[0]!.content as Array<{ type: string; text?: string }>
    return parts.find((p) => p.type === 'text')?.text ?? ''
  }

  it('AM7: storage care aruncă — importul merge până la revizuire, fără banner și fără excepții', async () => {
    breakStorage()
    aiMenuImport.mockResolvedValue({ text: '[{"name":"Pizza","price":32,"category":null}]' })
    const { container } = renderImport()
    expect(await screen.findByText('Alege pozele')).toBeInTheDocument()
    expect(screen.queryByTestId('resume-import')).not.toBeInTheDocument()
    await uploadMenuPhoto(container)
    expect(await screen.findByText(/Am găsit 1 produse/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('Pizza')).toBeInTheDocument()
  })

  it('AM8: promptul poartă moneda restaurantului; fără metadate rămâne „lei”', async () => {
    aiMenuImport.mockResolvedValue({ text: '[{"name":"Pizza","price":32,"category":null}]' })
    maybeSingle.mockReturnValue({ data: { currency: 'EUR', language: 'ro' }, error: null })
    const first = renderImport()
    await uploadMenuPhoto(first.container)
    await screen.findByText(/Am găsit 1 produse/)
    expect(promptOf()).toContain('(EUR)')
    expect(promptOf()).not.toContain('în lei')
    first.unmount()

    aiMenuImport.mockClear()
    maybeSingle.mockReturnValue({ data: null, error: { message: 'n/a' } })
    const second = renderImport()
    await uploadMenuPhoto(second.container)
    await screen.findByText(/Am găsit 1 produse/)
    expect(promptOf()).toContain('Prețurile în lei')
  })
})
