// Traducerile din fișa produsului (lotul O6c): ProductTranslations (formularul)
// și ExtraTranslations (extra-urile, salvate pe loc).
//
//   PT1  „✨ Tradu automat” completează DOAR câmpurile goale ale formularului,
//        cu marcaj, fără niciun apel la bază, și păstrează un câmp tastat.
//        Mutația care pică: rezultatul AI pus peste formular (spread-ul vechi
//        `{ ...existing, ...ai }` — numele tastat se pierde).
//   PT2  editarea unui câmp marcat îi scoate marcajul; „Am verificat” curăță o
//        limbă. Mutația care pică: tastarea fără setTranslationValue (marcajul
//        rămâne pe un text scris de om).
//   PT3  fără `canTranslateAi` butonul lipsește (control: secțiunea e deschisă).
//   PT4  ExtraTranslations: salvarea cheamă saveRowTranslations pe
//        product_extras; un refuz (0 rânduri) dă un mesaj românesc; o ciornă
//        nesalvată se raportează (`onDirtyChange(id, true)`).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { Translations } from '../../../lib/i18nMenu'

const h = vi.hoisted(() => ({
  translate: vi.fn(),
  from: vi.fn(),
  save: vi.fn(),
  latest: null as Translations | null | undefined,
}))

vi.mock('../../../lib/ai', () => ({
  aiTranslateBatch: h.translate,
  isAiConfigError: () => false,
  isAiQuotaError: () => false,
  generateNutrition: vi.fn(),
  generateProductImage: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({ supabase: { from: h.from } }))
vi.mock('../../../lib/menuTranslationsData', () => ({ saveRowTranslations: h.save }))

import { ProductTranslations } from '../ProductTranslations'
import { ExtraTranslations } from '../ExtraTranslations'

function Harness({ initial, ai = true }: { initial: Translations | null; ai?: boolean }) {
  const [tr, setTr] = useState<Translations | null | undefined>(initial)
  h.latest = tr
  return (
    <ProductTranslations
      restaurantId="r1"
      name="Supă"
      description="Caldă"
      translations={tr}
      onChange={(update) => setTr((prev) => update(prev))}
      langs={['en', 'de']}
      baseLang="ro"
      canTranslateAi={ai}
      onToast={toast}
    />
  )
}
const toast = vi.fn()
const MARK = '✨ tradus automat — verifică'

beforeEach(() => {
  h.translate.mockReset()
  h.from.mockReset()
  h.save.mockReset()
  toast.mockReset()
  h.latest = null
})

async function openSection() {
  await userEvent.click(screen.getByRole('button', { name: /Traduceri \(opțional\)/ }))
}

describe('ProductTranslations — „Tradu automat” în formular', () => {
  it('PT1 completează doar golurile, cu marcaj, fără apel la bază; păstrează textul tastat', async () => {
    h.translate.mockResolvedValue({
      p: { en: { name: 'AI soup', description: 'Hot' }, de: { name: 'KI Suppe', description: 'Heiß' } },
    })
    render(<Harness initial={{ en: { name: 'My soup' } }} />)
    await openSection()
    await userEvent.click(screen.getByRole('button', { name: '✨ Tradu automat' }))
    await waitFor(() =>
      expect(h.latest).toEqual({
        en: { name: 'My soup', description: 'Hot', ai_fields: ['description'] },
        de: { name: 'KI Suppe', description: 'Heiß', ai_fields: ['name', 'description'] },
      }),
    )
    expect(h.translate).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ id: 'p', name: 'Supă', description: 'Caldă' }],
        targetLangs: ['en', 'de'],
        sourceLang: 'ro',
      }),
    )
    expect(screen.getAllByText(MARK)).toHaveLength(3)
    expect(screen.getByLabelText('Nume (English)')).toHaveValue('My soup')
    expect(toast).toHaveBeenCalledWith('Am completat 3 câmpuri — verifică-le, apoi Salvează.')
    expect(h.from).not.toHaveBeenCalled()
  })

  it('PT2 tastarea scoate marcajul câmpului; „Am verificat” curăță limba', async () => {
    render(
      <Harness
        initial={{
          en: { name: 'Soup', ai_fields: ['name'] },
          de: { name: 'Suppe', description: 'Heiß', ai_fields: ['name', 'description'] },
        }}
      />,
    )
    await openSection()
    expect(screen.getAllByText(MARK)).toHaveLength(3)
    await userEvent.type(screen.getByLabelText('Nume (Deutsch)'), '!')
    expect(h.latest?.de).toEqual({ name: 'Suppe!', description: 'Heiß', ai_fields: ['description'] })
    expect(screen.getAllByText(MARK)).toHaveLength(2)
    // Primul „Am verificat” e al englezei (ordinea limbilor).
    await userEvent.click(screen.getAllByRole('button', { name: 'Am verificat' })[0])
    expect(h.latest?.en).toEqual({ name: 'Soup' })
    expect(h.latest?.de).toEqual({ name: 'Suppe!', description: 'Heiß', ai_fields: ['description'] })
    expect(screen.getAllByText(MARK)).toHaveLength(1)
  })

  it('PT3 fără permisiunea AI butonul lipsește (control: secțiunea e deschisă)', async () => {
    render(<Harness initial={null} ai={false} />)
    await openSection()
    expect(screen.getByLabelText('Nume (English)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '✨ Tradu automat' })).not.toBeInTheDocument()
  })
})

describe('ExtraTranslations — traducerile unui extra, pe loc', () => {
  it('PT4 salvează pe product_extras, raportează ciorna, refuzul în română', async () => {
    const onSaved = vi.fn()
    const onDirty = vi.fn()
    h.save.mockImplementation(async (_t: string, _id: string, mutate: (t: Translations) => Translations) =>
      mutate({ en: { name: 'Bacon EN' } }),
    )
    render(
      <ExtraTranslations
        extra={{ id: 'e1', name: 'Bacon', translations: { en: { name: 'Bacon EN' } } }}
        langs={['en', 'de']}
        baseLang="ro"
        onSaved={onSaved}
        onDirtyChange={onDirty}
        onToast={toast}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Traduceri 1/2' }))
    const save = screen.getByRole('button', { name: 'Salvează traducerile' })
    expect(save).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Nume în Deutsch pentru «Bacon»'), 'Speck')
    expect(onDirty).toHaveBeenLastCalledWith('e1', true)
    await userEvent.click(save)
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('e1', { en: { name: 'Bacon EN' }, de: { name: 'Speck' } }))
    expect(h.save.mock.calls[0][0]).toBe('product_extras')
    expect(h.save.mock.calls[0][1]).toBe('e1')
    expect(onDirty).toHaveBeenLastCalledWith('e1', false)

    h.save.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: '42501' }))
    await userEvent.type(screen.getByLabelText('Nume în Deutsch pentru «Bacon»'), 'X')
    await userEvent.click(screen.getByRole('button', { name: 'Salvează traducerile' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Nu ai drepturi pentru această acțiune.', 'error'))
    expect(onDirty).toHaveBeenLastCalledWith('e1', true)
  })
})
