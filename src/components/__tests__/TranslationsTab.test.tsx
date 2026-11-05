// Meniu → Traduceri (lotul O6c). Hook-urile de date, modulul de I/O și lotul AI
// sunt false; raportul (lib/menuTranslations) și scriitorii (lib/i18nMenu) sunt
// cei REALI.
//
//   TR1  pastilele de limbă arată „lipsă” / „de verificat” pe limbă; filtrul
//        implicit „Lipsă” arată doar rândurile cu goluri. Control: un rând
//        tradus complet apare doar sub „Toate”. Mutația care pică: filtrul
//        implicit „Toate”.
//   TR2  „Salvează” pe un rând cheamă saveRowTranslations cu tabela, id-ul și
//        un mutate = applyManualEdit; rândul rămâne cu „✓ Salvat”; o eroare de
//        server apare sub rând (role=alert) și ciorna rămâne. Mutația care pică:
//        rândul salvat scos din listă (lista sare sub deget).
//   TR3  un rând marcat are insigna și „Confirmă”, al cărui mutate scoate doar
//        marcajele limbii alese și lasă celelalte limbi neatinse.
//   TR4  fără `canTranslateAi` butonul AI lipsește; cu el, deschide lotul AI cu
//        translateOnly și rândurile de opțiuni vizibile, iar la final filtrul
//        trece pe „De verificat”.
//   TR5  `showOptions` false sau null → opțiunile nu se citesc și secțiunile
//        lor lipsesc; o eroare doar pe opțiuni e o notă, restul rămâne editabil.
//   TR6  fără limbi: starea goală, cu „Alege limbile” doar pentru admin.
//   TR7  „Previzualizează” deschide /m/<slug>?lang=en; dezactivat (cu
//        explicație) pe o limbă pe care oaspeții n-o văd încă; ascuns fără slug.
//   TR8  eroarea de citire a produselor/categoriilor → QueryError cu
//        „Reîncearcă”, niciodată „tradus complet”. Control: aceleași date citite
//        cu succes arată procentul.
//   TR9  ciornele supraviețuiesc schimbării limbii; „Salvează tot” le salvează
//        pe rând și se oprește la prima eroare (restul rămân).
//   TR10 (recenzia O6c) „tradus complet” doar când ecranul a văzut tot: pe
//        planul NECUNOSCUT (opțiunile necitite) și pe o listă de produse plină
//        până la plafonul PostgREST (1000, posibil tăiată) apare o notă, nu
//        „complet”. Control: același meniu tradus, pe planul fără opțiuni și
//        sub plafon, e „complet”. [PICĂ: `!wantOptions` în optionsComplete;
//        fără verificarea plafonului]
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Category, Product } from '../../hooks/useData'
import type { Translations } from '../../lib/i18nMenu'

const h = vi.hoisted(() => ({
  products: [] as unknown[],
  categories: [] as unknown[],
  pError: null as string | null,
  cError: null as string | null,
  refetchProducts: vi.fn(async () => {}),
  refetchCats: vi.fn(async () => {}),
  load: vi.fn(),
  save: vi.fn(),
  aiProps: null as Record<string, unknown> | null,
}))

vi.mock('../../hooks/useData', () => ({
  useProducts: () => ({
    products: h.products,
    loading: false,
    error: h.pError,
    refetch: h.refetchProducts,
  }),
  useCategories: () => ({
    categories: h.categories,
    loading: false,
    error: h.cError,
    refetch: h.refetchCats,
  }),
}))
vi.mock('../../lib/menuTranslationsData', () => ({
  loadTranslationOptions: h.load,
  saveRowTranslations: h.save,
}))
vi.mock('../AiBulkGenerate', async () => {
  const { createElement } = await import('react')
  return {
    default: (props: { onDone: () => void }) => {
      h.aiProps = props as unknown as Record<string, unknown>
      return createElement('button', { type: 'button', onClick: props.onDone }, 'ai-stub-done')
    },
  }
})

import TranslationsTab from '../TranslationsTab'
import { applyManualEdit } from '../../lib/i18nMenu'

function category(id: string, name: string, translations: Translations | null = null): Category {
  return { id, restaurant_id: 'r1', name, emoji: '🍽️', display_order: id === 'c1' ? 0 : 1, meta_text: null, translations }
}
function product(id: string, over: Partial<Product>): Product {
  return {
    id,
    restaurant_id: 'r1',
    category_id: 'c1',
    name: id,
    description: null,
    price: 10,
    emoji: '🍽️',
    image_url: null,
    is_active: true,
    is_daily_special: false,
    is_sold_out: false,
    is_draft: false,
    display_order: 0,
    allergens: [],
    dietary_tags: [],
    prep_time_minutes: null,
    portion_size: null,
    vat_group: 1,
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    ai_generated_fields: [],
    translations: null,
    ...over,
  }
}

const OPTIONS = {
  groups: [{ id: 'g1', name: 'Mărime', display_order: 0, translations: null }],
  options: [{ id: 'o1', modifier_group_id: 'g1', name: 'Mică', is_available: true, display_order: 0, translations: null }],
  extras: [{ id: 'e1', product_id: 'p1', name: 'Bacon', is_available: true, display_order: 0, translations: null }],
  links: [{ product_id: 'p1', modifier_group_id: 'g1' }],
}

let seq = 0
function renderTab(over: Partial<Parameters<typeof TranslationsTab>[0]> = {}) {
  seq += 1
  return render(
    <TranslationsTab
      // Un restaurant nou pe test: limba aleasă se ține minte per restaurant.
      restaurantId={`r-${seq}`}
      slug="la-bunica"
      menuLanguages={['en', 'de']}
      baseLang="ro"
      canTranslateAi={false}
      showOptions={false}
      isFlipbook={false}
      {...over}
    />,
  )
}

const rowOf = (label: string): HTMLElement => {
  const form = screen.getByLabelText(label).closest('form')
  if (!form) throw new Error(`rândul pentru ${label} lipsește`)
  return form
}

beforeEach(() => {
  h.categories = [category('c1', 'Ciorbe', { en: { name: 'Soups' } }), category('c2', 'Băuturi')]
  h.products = [
    product('p1', {
      name: 'Ciorbă de burtă',
      description: 'Cu smântână',
      translations: { en: { name: 'Tripe soup', description: 'With sour cream', ai_fields: ['description'] } },
    }),
    product('p2', { name: 'Limonadă', category_id: 'c2' }),
  ]
  h.pError = null
  h.cError = null
  h.refetchProducts.mockClear()
  h.refetchCats.mockClear()
  h.load.mockReset()
  h.load.mockResolvedValue(OPTIONS)
  h.save.mockReset()
  h.save.mockImplementation(async (_table: string, _id: string, mutate: (t: Translations) => Translations) =>
    mutate({}),
  )
  h.aiProps = null
})

describe('TranslationsTab — raportul pe limbă', () => {
  it('TR1 pastilele numără pe limbă; „Lipsă” arată doar golurile (control: „Toate”)', async () => {
    renderTab()
    expect(screen.getByRole('button', { name: /English · 2 lipsă · 1 de verificat/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /Deutsch · 5 lipsă/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Lipsă (2)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Nume în English pentru «Băuturi»')).toBeInTheDocument()
    expect(screen.getByLabelText('Nume în English pentru «Limonadă»')).toBeInTheDocument()
    expect(screen.queryByLabelText('Nume în English pentru «Ciorbe»')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Toate' }))
    expect(screen.getByLabelText('Nume în English pentru «Ciorbe»')).toHaveValue('Soups')
  })

  it('TR2 „Salvează” scrie rândul cu applyManualEdit, rămâne „✓ Salvat”; eroarea stă sub rând', async () => {
    renderTab()
    await userEvent.type(screen.getByLabelText('Nume în English pentru «Băuturi»'), 'Drinks')
    await userEvent.click(within(rowOf('Nume în English pentru «Băuturi»')).getByRole('button', { name: 'Salvează' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
    const [table, id, mutate] = h.save.mock.calls[0] as [string, string, (t: Translations) => Translations]
    expect([table, id]).toEqual(['categories', 'c2'])
    const fresh: Translations = { de: { name: 'Getränke' } }
    expect(mutate(fresh)).toEqual(applyManualEdit(fresh, 'en', { name: 'Drinks' }, 'ro'))
    const saved = rowOf('Nume în English pentru «Băuturi»')
    expect(await within(saved).findByText('✓ Salvat')).toBeInTheDocument()
    expect(screen.getByLabelText('Nume în English pentru «Băuturi»')).toHaveValue('Drinks')

    h.save.mockRejectedValueOnce(Object.assign(new Error('permission denied for table products'), { code: '42501' }))
    await userEvent.type(screen.getByLabelText('Nume în English pentru «Limonadă»'), 'Lemonade')
    await userEvent.click(within(rowOf('Nume în English pentru «Limonadă»')).getByRole('button', { name: 'Salvează' }))
    const alert = await within(rowOf('Nume în English pentru «Limonadă»')).findByRole('alert')
    expect(alert).toHaveTextContent('Nu ai drepturi pentru această acțiune.')
    expect(screen.getByLabelText('Nume în English pentru «Limonadă»')).toHaveValue('Lemonade')
  })

  it('TR3 „Confirmă” scoate doar marcajele limbii alese', async () => {
    renderTab()
    await userEvent.click(screen.getByRole('button', { name: 'De verificat (1)' }))
    const row = rowOf('Nume în English pentru «Ciorbă de burtă»')
    expect(within(row).getByText('✨ tradus automat — verifică')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Confirmă' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
    const [table, id, mutate] = h.save.mock.calls[0] as [string, string, (t: Translations) => Translations]
    expect([table, id]).toEqual(['products', 'p1'])
    expect(
      mutate({
        en: { name: 'Tripe soup', description: 'With sour cream', ai_fields: ['description'] },
        de: { name: 'Kuttelsuppe', ai_fields: ['name'] },
      }),
    ).toEqual({
      en: { name: 'Tripe soup', description: 'With sour cream' },
      de: { name: 'Kuttelsuppe', ai_fields: ['name'] },
    })
  })
})

describe('TranslationsTab — AI, opțiuni, previzualizare', () => {
  it('TR4 butonul AI doar cu permisiune; lotul primește opțiunile; la final „De verificat”', async () => {
    const { unmount } = renderTab()
    expect(screen.queryByRole('button', { name: /Tradu automat ce lipsește/ })).not.toBeInTheDocument()
    unmount()

    renderTab({ canTranslateAi: true, showOptions: true })
    // 7 texte pe meniu (2 en + 5 de) + 3 rânduri de opțiuni × 2 limbi.
    const ai = await screen.findByRole('button', { name: '✨ Tradu automat ce lipsește (13)' })
    await waitFor(() => expect(ai).toBeEnabled())
    await userEvent.click(ai)
    const done = await screen.findByRole('button', { name: 'ai-stub-done' })
    expect(h.aiProps).toMatchObject({ translateOnly: true, baseLang: 'ro' })
    expect(h.aiProps?.optionRows).toEqual({
      groups: [{ id: 'g1', name: 'Mărime', translations: null, context: 'Grup de opțiuni (ex.: Mică)' }],
      options: [{ id: 'o1', name: 'Mică', translations: null, context: 'Opțiune din grupul «Mărime»' }],
      extras: [{ id: 'e1', name: 'Bacon', translations: null, context: 'Extra plătit la produsul «Ciorbă de burtă»' }],
    })
    expect((h.aiProps?.products as Product[]).map((p) => p.id)).toEqual(['p1', 'p2'])
    await userEvent.click(done)
    expect(await screen.findByRole('button', { name: /^De verificat/ })).toHaveAttribute('aria-pressed', 'true')
    expect(h.refetchProducts).toHaveBeenCalled()
    expect(h.refetchCats).toHaveBeenCalled()
    await waitFor(() => expect(h.load).toHaveBeenCalledTimes(2))
  })

  it('TR5 fără planul cu opțiuni nu se citesc; eroarea pe opțiuni e doar o notă', async () => {
    for (const showOptions of [false, null]) {
      const { unmount } = renderTab({ showOptions })
      expect(screen.getByLabelText('Nume în English pentru «Băuturi»')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /Opțiuni/ })).not.toBeInTheDocument()
      unmount()
    }
    expect(h.load).not.toHaveBeenCalled()

    renderTab({ showOptions: true })
    expect(await screen.findByRole('heading', { name: /Opțiuni/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Nume în English pentru «Mică»')).toBeInTheDocument()
  })

  it('TR5b o eroare doar pe opțiuni lasă restul editabil', async () => {
    h.load.mockRejectedValue(new Error('boom'))
    renderTab({ showOptions: true })
    expect(
      await screen.findByText('Opțiuni și extra-uri: Nu am putut citi opțiunile și extra-urile.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Opțiuni/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Nume în English pentru «Băuturi»')).toBeInTheDocument()
  })

  it('TR6 fără limbi: starea goală; „Alege limbile” doar pentru admin', async () => {
    const onOpen = vi.fn()
    const { unmount } = renderTab({ menuLanguages: [], onOpenLanguageSettings: onOpen })
    expect(screen.getByText('Meniul e oferit doar în Română')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Alege limbile' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    unmount()
    renderTab({ menuLanguages: ['ro'] })
    expect(screen.getByText('Proprietarul alege limbile meniului din Setări.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Alege limbile' })).not.toBeInTheDocument()
  })

  it('TR7 previzualizarea în limba aleasă', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { unmount } = renderTab()
    await userEvent.click(screen.getByRole('button', { name: 'Previzualizează în English' }))
    expect(open).toHaveBeenCalledWith('/m/la-bunica?lang=en', '_blank', 'noopener')
    // Germana nu are încă nicio traducere de categorie/produs → oaspeții n-o văd.
    await userEvent.click(screen.getByRole('button', { name: /Deutsch · 5 lipsă/ }))
    expect(screen.getByRole('button', { name: 'Previzualizează în Deutsch' })).toBeDisabled()
    expect(screen.getByText('Apare clienților după prima traducere a unei categorii sau a unui produs.')).toBeInTheDocument()
    unmount()
    renderTab({ slug: undefined })
    expect(screen.queryByRole('button', { name: /Previzualizează/ })).not.toBeInTheDocument()
    open.mockRestore()
  })

  it('TR8 eroarea de citire → „Reîncearcă”, niciodată „tradus complet” (control: procentul)', async () => {
    h.pError = 'permission denied for table products'
    const { unmount } = renderTab()
    expect(screen.getByText('Nu ai drepturi pentru această acțiune.')).toBeInTheDocument()
    expect(screen.queryByText(/tradus complet/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    expect(h.refetchProducts).toHaveBeenCalled()
    unmount()
    h.pError = null
    renderTab()
    expect(screen.getByText('3 din 5 texte traduse (60%)')).toBeInTheDocument()
  })

  it('TR9 ciornele trec peste schimbarea limbii; „Salvează tot” se oprește la prima eroare', async () => {
    renderTab()
    await userEvent.type(screen.getByLabelText('Nume în English pentru «Băuturi»'), 'Drinks')
    await userEvent.click(screen.getByRole('button', { name: /Deutsch · 5 lipsă/ }))
    await userEvent.type(screen.getByLabelText('Nume în Deutsch pentru «Băuturi»'), 'Getränke')
    expect(screen.getByText('Ai 2 rânduri nesalvate')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /English · 2 lipsă/ }))
    expect(screen.getByLabelText('Nume în English pentru «Băuturi»')).toHaveValue('Drinks')

    h.save.mockRejectedValueOnce(new Error('boom'))
    await userEvent.click(screen.getByRole('button', { name: 'Salvează tot' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Ai 2 rânduri nesalvate')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Salvează tot' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(3))
    expect(screen.queryByText(/rânduri nesalvate|rând nesalvat/)).not.toBeInTheDocument()
  })
})

describe('TranslationsTab — „complet” doar pe date întregi', () => {
  const translated = (id: string, cat = 'c1') =>
    product(id, { name: id, category_id: cat, translations: { en: { name: `${id} EN` } } })
  beforeEach(() => {
    h.categories = [category('c1', 'Ciorbe', { en: { name: 'Soups' } })]
    h.products = [translated('p1'), translated('p2')]
  })

  it('TR10 control: planul fără opțiuni, sub plafon → „complet”', () => {
    renderTab({ menuLanguages: ['en'], showOptions: false })
    expect(screen.getByText('Meniul e tradus complet în English.')).toBeInTheDocument()
  })

  it('TR10 planul necunoscut → notă, nu „complet”', () => {
    renderTab({ menuLanguages: ['en'], showOptions: null })
    expect(screen.queryByText(/tradus complet/)).not.toBeInTheDocument()
    expect(screen.getByText(/Nu știm încă dacă planul include opțiunile/)).toBeInTheDocument()
    expect(h.load).not.toHaveBeenCalled()
  })

  it('TR10 lista de produse la plafon → notă, nu „complet”', () => {
    h.products = Array.from({ length: 1000 }, (_, i) => translated(`p${i}`))
    renderTab({ menuLanguages: ['en'], showOptions: false })
    expect(screen.queryByText(/tradus complet/)).not.toBeInTheDocument()
    expect(screen.getByText(/Ecranul le vede doar pe primele 1000/)).toBeInTheDocument()
  })
})
