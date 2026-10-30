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
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Product } from '../../hooks/useData'

const { genImage, genNutrition, translate, updateEq } = vi.hoisted(() => ({
  genImage: vi.fn(),
  genNutrition: vi.fn(),
  translate: vi.fn(),
  updateEq: vi.fn(async () => ({ error: null })),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ update: () => ({ eq: updateEq }) }),
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
