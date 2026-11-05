// Setări → Asistent AI: configurația BYO (lotul O7a, pierderi de date).
//
// Bug-ul: `getAiConfig` întorcea `null` și pe o citire EȘUATĂ (supabase-js pune
// eroarea în `{ error }`, nu aruncă), deci tab-ul arăta formularul implicit
// (OpenAI, activ, fără cheie) ca pentru un restaurant fără rând salvat, iar
// „Salvează" era activ. Un click după un blip de rețea trimitea
// provider=openai / model=gpt-4o-mini / enabled=true, iar ai-config.js (ramura
// non-custom: furnizor schimbat, fără cheie nouă) golea `api_key_encrypted` —
// cheia BYO pierdută, furnizorul și modelul resetate, opt-out-ul anulat.
//
// `getAiConfig` rămâne REAL (mock parțial pe lib/ai, doar `saveAiConfig` e
// înlocuit), deci testele de mai jos prind și mutațiile din lib, nu doar din
// componentă.
//   AIS1  citirea eșuată blochează salvarea: mesaj explicit, fără „Salvează",
//         fără formularul implicit (bifa „Activează" ar minți).
//         Mutațiile care pică: (a) revenirea la `if (error || !data) return
//         null` în getAiConfig; (b) în componentă, respingerea mapată pe
//         „fără rând" / 'ready'.
//   AIS2  CONTROL POZITIV al lui AIS1: „Reîncearcă" citește din nou, iar
//         „Salvează" trimite configurația REALĂ (anthropic, dezactivat), nu
//         implicitul. Fără el, AIS1 ar trece și cu butonul șters de tot.
//         Mutația care pică: `reloadKey` scos din dependențele efectului.
//   AIS3  respingerea de transport (fetch picat) = eroare de citire.
//         Mutația care pică: fără handler de respingere pe getAiConfig în
//         Promise.all (load rămâne pe „Se încarcă..." cu unhandled rejection).
//   AIS4  „fără rând" e un răspuns VALID și păstrează implicitul documentat
//         (activ, OpenAI, cheia platformei — ca ai-generate-image.test.js).
//         Mutația care pică: `if (error || !data) throw` (orice cont nou ar
//         rămâne blocat).
//   AIS5  schimbarea restaurantului nu cară configurația precedentă (selectorul
//         din DashboardPage nu demontează tab-ul).
//         Mutația care pică: ramura veche „fără rând" care făcea doar
//         `setEnabled(true)` — trimitea anthropic/claude-sonnet-4-6 pentru r2.
//   AIS6  un răspuns ÎNTÂRZIAT pentru restaurantul anterior nu suprascrie
//         formularul curent.
//         Mutația care pică: `if (cancelled) return` scos din efect.
//   AIS7  (recenzia CodeRabbit pe #353) mesajul unui restaurant („Configurație
//         salvată”) nu rămâne pe ecran sub restaurantul următor. Control: el
//         chiar apare după salvare.
//         Mutația care pică: `setMsg(null)` scos din efectul de încărcare.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

interface ConfigRead {
  data: unknown
  error: { message: string; code: string } | null
}

const h = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  saveAiConfig: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({ maybeSingle: () => h.maybeSingle(id) }),
      }),
    }),
    // getAiQuota (REAL) → `ai_get_quota`; null = cardul de consum nu apare.
    rpc: (fn: string, args: unknown) => h.rpc(fn, args),
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  },
}))

vi.mock('../../lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/ai')>()
  return { ...actual, saveAiConfig: h.saveAiConfig }
})

import AiSettingsTab from '../AiSettingsTab'

const READ_FAILED: ConfigRead = { data: null, error: { message: 'Failed to fetch', code: '' } }
const NO_ROW: ConfigRead = { data: null, error: null }
const ANTHROPIC_ROW: ConfigRead = {
  data: {
    restaurant_id: 'r1',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    base_url: null,
    enabled: false,
  },
  error: null,
}

const ERROR_TEXT = /Nu am putut citi configurația AI/
const SAVE = { name: 'Salvează configurația' }
const ENABLE = { name: /Activează asistentul AI/ }

beforeEach(() => {
  h.maybeSingle.mockReset()
  h.rpc.mockReset().mockResolvedValue({ data: null, error: null })
  h.saveAiConfig.mockReset().mockResolvedValue({
    ok: true,
    config: {
      restaurant_id: 'r1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      base_url: null,
      enabled: true,
      key_masked: null,
    },
  })
})

describe('AiSettingsTab — citirea configurației salvate', () => {
  it('AIS1: citirea eșuată blochează salvarea și nu arată implicitul', async () => {
    h.maybeSingle.mockResolvedValue(READ_FAILED)
    render(<AiSettingsTab restaurantId="r1" />)

    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('button', SAVE)).toBeNull()
    expect(screen.queryByRole('checkbox', ENABLE)).toBeNull()
    expect(h.saveAiConfig).not.toHaveBeenCalled()
  })

  it('AIS2: „Reîncearcă" citește din nou și „Salvează" păstrează config-ul REAL', async () => {
    h.maybeSingle.mockResolvedValueOnce(READ_FAILED).mockResolvedValueOnce(ANTHROPIC_ROW)
    render(<AiSettingsTab restaurantId="r1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Reîncearcă' }))

    const save = await screen.findByRole('button', SAVE)
    expect(screen.queryByText(ERROR_TEXT)).toBeNull()
    expect(screen.getByRole('checkbox', ENABLE)).not.toBeChecked()
    await userEvent.click(save)

    await waitFor(() => expect(h.saveAiConfig).toHaveBeenCalledTimes(1))
    expect(h.saveAiConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurant_id: 'r1',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        base_url: null,
        enabled: false,
        api_key: undefined,
      }),
    )
    expect(h.maybeSingle).toHaveBeenCalledTimes(2)
  })

  it('AIS3: respingerea de transport e tratată ca eroare de citire', async () => {
    h.maybeSingle.mockRejectedValue(new TypeError('Load failed'))
    render(<AiSettingsTab restaurantId="r1" />)

    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('button', SAVE)).toBeNull()
  })

  it('AIS4: fără rând salvat = activ pe OpenAI, salvarea merge', async () => {
    h.maybeSingle.mockResolvedValue(NO_ROW)
    render(<AiSettingsTab restaurantId="r1" />)

    const save = await screen.findByRole('button', SAVE)
    expect(screen.queryByText(ERROR_TEXT)).toBeNull()
    expect(screen.getByRole('checkbox', ENABLE)).toBeChecked()
    await userEvent.click(save)

    await waitFor(() => expect(h.saveAiConfig).toHaveBeenCalledTimes(1))
    expect(h.saveAiConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurant_id: 'r1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        base_url: null,
        enabled: true,
      }),
    )
  })
})

describe('AiSettingsTab — schimbarea restaurantului', () => {
  it('AIS5: config-ul restaurantului anterior nu rămâne pe ecran și nu pleacă la salvare', async () => {
    h.maybeSingle.mockImplementation(async (id: string) => (id === 'r1' ? ANTHROPIC_ROW : NO_ROW))
    const view = render(<AiSettingsTab restaurantId="r1" />)

    await userEvent.click(await screen.findByRole('button', { name: /Avansat/ }))
    expect(screen.getByText(/salvată ✓/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', ENABLE)).not.toBeChecked()

    view.rerender(<AiSettingsTab restaurantId="r2" />)

    // r2 n-are rând → bifat (r1 era dezactivat): semnul că a sosit citirea lui r2.
    await waitFor(() => expect(screen.getByRole('checkbox', ENABLE)).toBeChecked())
    expect(h.maybeSingle).toHaveBeenCalledWith('r2')
    expect(screen.queryByText(/salvată ✓/)).toBeNull()

    await userEvent.click(screen.getByRole('button', SAVE))
    await waitFor(() => expect(h.saveAiConfig).toHaveBeenCalledTimes(1))
    expect(h.saveAiConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurant_id: 'r2',
        provider: 'openai',
        model: 'gpt-4o-mini',
        enabled: true,
      }),
    )
  })

  it('AIS7: mesajul de salvare al lui r1 nu rămâne sub r2', async () => {
    h.maybeSingle.mockResolvedValue(NO_ROW)
    const view = render(<AiSettingsTab restaurantId="r1" />)
    await userEvent.click(await screen.findByRole('button', SAVE))
    expect(await screen.findByText(/Configurație salvată/)).toBeInTheDocument()

    view.rerender(<AiSettingsTab restaurantId="r2" />)
    await waitFor(() => expect(h.maybeSingle).toHaveBeenCalledWith('r2'))
    await screen.findByRole('button', SAVE)
    expect(screen.queryByText(/Configurație salvată/)).toBeNull()
  })

  it('AIS6: un răspuns întârziat pentru restaurantul anterior nu suprascrie formularul', async () => {
    let resolveR1: (v: ConfigRead) => void = () => undefined
    const r1Pending = new Promise<ConfigRead>((resolve) => {
      resolveR1 = resolve
    })
    h.maybeSingle.mockImplementation((id: string) =>
      id === 'r1' ? r1Pending : Promise.resolve(NO_ROW),
    )
    const view = render(<AiSettingsTab restaurantId="r1" />)
    await waitFor(() => expect(h.maybeSingle).toHaveBeenCalledWith('r1'))

    view.rerender(<AiSettingsTab restaurantId="r2" />)
    await screen.findByRole('button', SAVE)

    // Abia ACUM sosește răspunsul (vechi) pentru r1, cu rândul anthropic.
    // Un macrotask (setTimeout 0) golește TOT lanțul de microtask-uri
    // (getAiConfig → .then → Promise.all → load), deci pe codul fără gardă
    // rândul lui r1 ar fi deja pe ecran la verificarea de mai jos.
    await act(async () => {
      resolveR1(ANTHROPIC_ROW)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.getByRole('checkbox', ENABLE)).toBeChecked()
    await userEvent.click(screen.getByRole('button', SAVE))
    await waitFor(() => expect(h.saveAiConfig).toHaveBeenCalledTimes(1))
    expect(h.saveAiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ restaurant_id: 'r2', provider: 'openai', model: 'gpt-4o-mini' }),
    )
  })
})
