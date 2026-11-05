// Teste pe lotul „Generează AI pentru meniu" (AiBulkGenerate).
//
// O eroare de CONFIGURARE (furnizor fără imagini, AI dezactivat, cheie lipsă)
// se repetă identic la fiecare produs. Înainte, lotul chema serverul pentru
// FIECARE produs și umplea lista cu N erori identice — iar textul de sub bifă
// promitea că „imaginile vor fi sărite".
//   ABG1  eroare de configurare la imagini → serverul e chemat O DATĂ, un
//         singur mesaj „Imagini oprite", restul produselor sărite. Mutația
//         care pică: vechiul `isQuota` singur (fără ramura isAiConfigError).
//   ABG2  control: eșecul unui SINGUR produs (image_failed) nu oprește lotul.
//   ABG3  imaginile oprite NU opresc nutriția: macronutrienții continuă.
//   ABG4  `translateOnly` (agentul de vânzări — ai-proxy îi permite doar
//         `menu_import` + `translate`): fără bifele de imagini/macronutrienți,
//         butonul face doar traduceri. Mutația care pică: prop-ul ignorat
//         (bifele randate, `doImages`/`doNutrition` pornite → 403 pe nutriție).
//   ABG5  control: fără prop, bifele și „Generează pentru N produse" rămân.
//   ABG6  pe un meniu cu altă bază (fr), traducerea AI pleacă din bază și
//         include româna ca țintă (recenzia O6a).
//
// Lotul O6c (traducerile vizibile și marcate „de verificat”):
//   ABG7  cu `optionRows` (ecranul Traduceri), grupurile, opțiunile și
//         extra-urile pleacă în loturi PROPRII, cu context, și se scriu în
//         modifier_groups / modifier_options / product_extras. Mutația care
//         pică: `optionRows` ignorat.
//   ABG8  ce se scrie poartă `ai_fields` doar pe câmpurile completate; textul
//         manual și marcajele existente rămân. Mutația care pică: vechiul
//         merge local `{ ...ai, ...existing }` (fără marcaj).
//   ABG9  subtitlul categoriei pleacă drept descriere și se salvează ca
//         `meta_text`; o categorie fără subtitlu nu primește niciodată unul
//         (chiar dacă AI-ul îl inventează). Mutația care pică: `remap` scos.
//   ABG10 fără `optionRows` (tab-ul Produse) niciun fel nou nu e atins, iar
//         forma itemelor rămâne cea de dinainte; „Verifică traducerile” apare
//         doar cu `onOpenTranslations` și îl cheamă.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Category, Product } from '../../hooks/useData'
import type { TranslatableItem } from '../../lib/ai'
import type { Translations } from '../../lib/i18nMenu'

const { genImage, genNutrition, translate, updateEq, writes } = vi.hoisted(() => ({
  genImage: vi.fn(),
  genNutrition: vi.fn(),
  translate: vi.fn(),
  updateEq: vi.fn(async () => ({ error: null })),
  // Tabela și corpul fiecărei scrieri (updateEq își păstrează argumentele).
  writes: [] as { table: string; payload: { translations?: Translations } }[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: { translations?: Translations }) => {
        writes.push({ table, payload })
        return { eq: updateEq }
      },
    }),
    auth: { getSession: vi.fn() },
    rpc: vi.fn(),
  },
}))
// Doar apelurile de rețea sunt false; clasificarea erorilor (isAiConfigError /
// isAiQuotaError) e cea REALĂ din lib/ai.
vi.mock('../../lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/ai')>()
  return {
    ...actual,
    generateProductImage: genImage,
    generateNutrition: genNutrition,
    aiTranslateBatch: translate,
  }
})

import AiBulkGenerate from '../AiBulkGenerate'

function product(id: string, over: Record<string, unknown> = {}): Product {
  return {
    id,
    restaurant_id: 'r1',
    category_id: null,
    name: `Produs ${id}`,
    description: null,
    image_url: null,
    calories: 120,
    ai_generated_fields: [],
    translations: null,
    ...over,
  } as unknown as Product
}

function aiErr(code: string, status: number, message: string): Error {
  return Object.assign(new Error(message), { code, status })
}

const NO_IMAGES =
  'Generarea de imagini merge doar cu OpenAI sau Gemini. Schimbă furnizorul în Setări → Asistent AI.'

function renderBulk(products: Product[]) {
  return render(
    <AiBulkGenerate
      restaurantId="r1"
      products={products}
      categories={[]}
      onClose={() => {}}
      onDone={() => {}}
    />,
  )
}

beforeEach(() => {
  genImage.mockReset()
  genNutrition.mockReset()
  translate.mockReset()
  updateEq.mockClear()
  writes.length = 0
})

describe('AiBulkGenerate — erori de configurare', () => {
  it('ABG1: furnizor fără imagini → un singur apel, un singur mesaj, restul sărite', async () => {
    genImage.mockRejectedValue(aiErr('provider_no_images', 400, NO_IMAGES))
    renderBulk([product('a'), product('b'), product('c')])
    await userEvent.click(screen.getByRole('button', { name: 'Generează pentru 3 produse' }))
    expect(await screen.findByText('Gata!')).toBeInTheDocument()
    expect(genImage).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText(/^Imagini oprite:/)).toHaveLength(1)
    expect(screen.queryAllByText(/\(imagine\):/)).toHaveLength(0)
  })

  it('ABG2 (control): eșecul unui singur produs nu oprește lotul', async () => {
    genImage.mockRejectedValue(
      aiErr('image_failed', 502, 'Generarea imaginii a eșuat la furnizor. Reîncearcă.'),
    )
    renderBulk([product('a'), product('b'), product('c')])
    await userEvent.click(screen.getByRole('button', { name: 'Generează pentru 3 produse' }))
    expect(await screen.findByText('Gata!')).toBeInTheDocument()
    expect(genImage).toHaveBeenCalledTimes(3)
    expect(screen.getAllByText(/\(imagine\):/)).toHaveLength(3)
    expect(screen.queryByText(/^Imagini oprite:/)).not.toBeInTheDocument()
  })

  it('ABG3: imaginile oprite nu opresc macronutrienții', async () => {
    genImage.mockRejectedValue(aiErr('provider_no_images', 400, NO_IMAGES))
    genNutrition.mockResolvedValue({
      calories: 300,
      protein_g: 10,
      carbs_g: 30,
      fat_g: 12,
      allergens: [],
      dietary_tags: [],
    })
    renderBulk([product('a', { calories: null }), product('b', { calories: null })])
    await userEvent.click(screen.getByRole('button', { name: 'Generează pentru 2 produse' }))
    expect(await screen.findByText('Gata!')).toBeInTheDocument()
    expect(genImage).toHaveBeenCalledTimes(1)
    expect(genNutrition).toHaveBeenCalledTimes(2)
    expect(
      screen.getByText(/2 seturi de valori nutriționale · 0 imagini generate/),
    ).toBeInTheDocument()
  })
})

describe('AiBulkGenerate — doar traduceri pentru agent', () => {
  function renderLangs(translateOnly: boolean) {
    return render(
      <AiBulkGenerate
        restaurantId="r1"
        products={[product('a', { calories: null })]}
        categories={[]}
        menuLanguages={['ro', 'en']}
        translateOnly={translateOnly}
        onClose={() => {}}
        onDone={() => {}}
      />,
    )
  }

  it('ABG4: translateOnly → fără imagini/nutriție, doar „Generează traduceri"', () => {
    renderLangs(true)
    expect(screen.getByText(/Traduceri în 1 limbă/)).toBeInTheDocument()
    expect(screen.queryByText(/Imagini \(/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Macronutrienți/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generează traduceri' })).toBeInTheDocument()
  })

  it('ABG6: pe un meniu francez traducerea pleacă DIN franceză, inclusiv spre română', async () => {
    // Recenzia O6a. Mutația care pică: filtrul `c !== 'ro'` fix — româna nu
    // mai e țintă (1 limbă în loc de 2) și AI-ul primește „din română”.
    translate.mockResolvedValue({})
    render(
      <AiBulkGenerate
        restaurantId="r1"
        products={[product('a', { calories: null })]}
        categories={[]}
        menuLanguages={['ro', 'en']}
        baseLang="fr"
        translateOnly
        onClose={() => {}}
        onDone={() => {}}
      />,
    )
    expect(screen.getByText(/Traduceri în 2 limbi/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Generează traduceri' }))
    expect(await screen.findByText('Gata!')).toBeInTheDocument()
    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({ targetLangs: ['ro', 'en'], sourceLang: 'fr' }),
    )
  })

  it('ABG5: control — fără prop, bifele de imagini și nutriție rămân', () => {
    renderLangs(false)
    expect(screen.getByText(/Imagini \(/)).toBeInTheDocument()
    expect(screen.getByText(/Macronutrienți/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generează pentru 1 produs' })).toBeInTheDocument()
  })
})

// AI-ul fals: fiecare item primește `<nume> EN` (+ descriere dacă i s-a trimis).
function echoTranslate(extraDescription?: string) {
  translate.mockImplementation(async ({ items }: { items: TranslatableItem[] }) =>
    Object.fromEntries(
      items.map((it) => [
        it.id,
        {
          en: {
            name: `${it.name} EN`,
            ...(it.description ? { description: `${it.description} EN` } : {}),
            ...(extraDescription ? { description: extraDescription } : {}),
          },
        },
      ]),
    ),
  )
}

function category(id: string, over: Partial<Category> = {}): Category {
  return {
    id,
    restaurant_id: 'r1',
    name: `Categorie ${id}`,
    emoji: '🍽️',
    display_order: 0,
    meta_text: null,
    translations: null,
    ...over,
  }
}

describe('AiBulkGenerate — traducerile marcate (lotul O6c)', () => {
  it('ABG7: grupurile, opțiunile și extra-urile au loturi proprii, cu context', async () => {
    echoTranslate()
    render(
      <AiBulkGenerate
        restaurantId="r1"
        products={[]}
        categories={[]}
        menuLanguages={['en']}
        translateOnly
        optionRows={{
          groups: [{ id: 'g1', name: 'Mărime', translations: null, context: 'Grup de opțiuni (ex.: Mică)' }],
          options: [{ id: 'o1', name: 'Mică', translations: null, context: 'Opțiune din grupul «Mărime»' }],
          extras: [{ id: 'e1', name: 'Bacon', translations: { de: { name: 'Speck' } }, context: 'Extra plătit la produsul «Burger»' }],
        }}
        onClose={() => {}}
        onDone={() => {}}
      />,
    )
    expect(screen.getByText(/Traduceri în 1 limbă \(3 de tradus\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Generează traduceri' }))
    expect(await screen.findByText('Gata!')).toBeInTheDocument()
    const batches = translate.mock.calls.map((c) => (c[0] as { items: TranslatableItem[] }).items)
    expect(batches).toEqual([
      [{ id: 'g1', name: 'Mărime', context: 'Grup de opțiuni (ex.: Mică)' }],
      [{ id: 'o1', name: 'Mică', context: 'Opțiune din grupul «Mărime»' }],
      [{ id: 'e1', name: 'Bacon', context: 'Extra plătit la produsul «Burger»' }],
    ])
    expect(writes).toEqual([
      { table: 'modifier_groups', payload: { translations: { en: { name: 'Mărime EN', ai_fields: ['name'] } } } },
      { table: 'modifier_options', payload: { translations: { en: { name: 'Mică EN', ai_fields: ['name'] } } } },
      {
        table: 'product_extras',
        payload: { translations: { de: { name: 'Speck' }, en: { name: 'Bacon EN', ai_fields: ['name'] } } },
      },
    ])
    expect(updateEq.mock.calls).toEqual([
      ['id', 'g1'],
      ['id', 'o1'],
      ['id', 'e1'],
    ])
    expect(screen.getByText(/3 texte traduse — marcate/)).toBeInTheDocument()
  })

  it('ABG8: marcaj doar pe ce a completat AI-ul; textul manual și marcajele rămân', async () => {
    translate.mockResolvedValue({
      p1: {
        en: { name: 'AI soup', description: 'Hot' },
        de: { name: 'KI Suppe', description: 'Heiß' },
      },
    })
    render(
      <AiBulkGenerate
        restaurantId="r1"
        products={[
          product('p1', {
            name: 'Supă',
            description: 'Caldă',
            translations: { en: { name: 'Soup (manual)' }, de: { name: 'Suppe', ai_fields: ['name'] } },
          }),
        ]}
        categories={[]}
        menuLanguages={['en', 'de']}
        translateOnly
        onClose={() => {}}
        onDone={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generează traduceri' }))
    expect(await screen.findByText('Gata!')).toBeInTheDocument()
    expect(writes).toHaveLength(1)
    expect(writes[0].table).toBe('products')
    expect(writes[0].payload.translations).toEqual({
      en: { name: 'Soup (manual)', description: 'Hot', ai_fields: ['description'] },
      de: { name: 'Suppe', description: 'Heiß', ai_fields: ['name', 'description'] },
    })
  })

  it('ABG9: subtitlul pleacă drept descriere și revine ca meta_text; fără subtitlu, niciodată', async () => {
    // AI-ul „inventează” o descriere și pentru categoria fără subtitlu.
    echoTranslate('Inventat')
    render(
      <AiBulkGenerate
        restaurantId="r1"
        products={[]}
        categories={[category('c1', { name: 'Ciorbe', meta_text: 'Servite calde' }), category('c2', { name: 'Băuturi' })]}
        menuLanguages={['en']}
        translateOnly
        onClose={() => {}}
        onDone={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generează traduceri' }))
    expect(await screen.findByText('Gata!')).toBeInTheDocument()
    expect((translate.mock.calls[0][0] as { items: TranslatableItem[] }).items).toEqual([
      { id: 'c1', name: 'Ciorbe', description: 'Servite calde' },
      { id: 'c2', name: 'Băuturi' },
    ])
    expect(writes).toEqual([
      {
        table: 'categories',
        payload: { translations: { en: { name: 'Ciorbe EN', meta_text: 'Inventat', ai_fields: ['name', 'meta_text'] } } },
      },
      { table: 'categories', payload: { translations: { en: { name: 'Băuturi EN', ai_fields: ['name'] } } } },
    ])
  })

  it('ABG10: fără optionRows doar categorii + produse, cu forma veche; „Verifică traducerile” doar cu prop', async () => {
    echoTranslate()
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const { unmount } = render(
      <AiBulkGenerate
        restaurantId="r1"
        products={[product('p1', { name: 'Supă', description: 'Caldă' })]}
        categories={[category('c1', { name: 'Ciorbe' })]}
        menuLanguages={['en']}
        translateOnly
        onClose={onClose}
        onDone={() => {}}
        onOpenTranslations={onOpen}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generează traduceri' }))
    expect(await screen.findByText('Gata!')).toBeInTheDocument()
    expect(translate.mock.calls.map((c) => (c[0] as { items: TranslatableItem[] }).items)).toEqual([
      [{ id: 'c1', name: 'Ciorbe' }],
      [{ id: 'p1', name: 'Supă', description: 'Caldă' }],
    ])
    expect(writes.map((w) => w.table)).toEqual(['categories', 'products'])
    await userEvent.click(screen.getByRole('button', { name: 'Verifică traducerile' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledTimes(1)
    unmount()

    // Control: fără prop, butonul nu există.
    render(
      <AiBulkGenerate
        restaurantId="r1"
        products={[product('p2', { name: 'Ceai' })]}
        categories={[]}
        menuLanguages={['en']}
        translateOnly
        onClose={() => {}}
        onDone={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generează traduceri' }))
    expect(await screen.findByText('Gata!')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Verifică traducerile' })).not.toBeInTheDocument()
  })
})
