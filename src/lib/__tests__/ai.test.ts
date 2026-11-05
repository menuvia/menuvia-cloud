// Teste pe contractul de eroare al apelurilor AI din client (lib/ai.ts).
//
// Serverul (netlify/functions/lib/aiErrors.js) întoarce acum `{ error, code }`
// cu mesaj în română. Clientul trebuie să:
//   AIC1  păstreze mesajul și codul serverului când vin cu cod (contractul nou);
//   AIC2  NU afișeze textul unui corp FĂRĂ cod (server vechi: „Forbidden") —
//         îl înlocuiește cu un mesaj românesc după status. Mutația care pică:
//         vechiul `if (body?.error) msg = body.error`.
//   AIC3  păstreze statusul pe corpuri ne-JSON (429 gol de la un proxy, 502 HTML
//         de platformă) — isAiQuotaError oprește lotul pe `status === 429`;
//   AIC4  transforme o cădere de rețea (`TypeError: Failed to fetch`) într-o
//         eroare românească cu cod `network`, status 0. Mutația care pică:
//         `fetch` neîmpachetat (TypeError-ul ajungea în toast, în engleză);
//   AIC5  trateze un 200 cu corp ne-JSON (pagina SPA servită în locul
//         funcției) ca `bad_response`, nu ca SyntaxError brut;
//   AIC6  ofere un mesaj românesc pentru FIECARE status (describeAiError pur);
//   AIC7  clasifice corect erorile pentru loturi: cotă vs. configurare.
//   AIT1  (lotul O6c) traducerea în lot trimite `context` DOAR pe itemele care
//         îl au, iar promptul spune că nu se traduce și nu se întoarce.
//         Mutația care pică: `context` scos din payload sau rândul din prompt
//         scos (un `context` gol pe itemele fără el ar ieși tot din
//         JSON.stringify, deci nu e o mutație observabilă).
//   AIT2  un răspuns care întoarce `context` sau `ai_fields` produce doar
//         nume/descriere — marcajul de verificare îl pune clientul, nu AI-ul.
//
// getAiConfig — eroare ≠ fără rând (lotul O7a). supabase-js pune eroarea în
// `{ error }`; vechiul `if (error || !data) return null` o făcea identică cu
// „restaurantul n-are rând salvat", iar AiSettingsTab arăta formularul implicit
// — un „Salvează" după un blip ștergea cheia BYO.
//   AIR1  o citire eșuată RESPINGE cu un Error real care păstrează `code`.
//         Mutația care pică: revenirea la `if (error || !data) return null`.
//   AIR2  „fără rând" (`data: null`, fără eroare) rezolvă la `null`, nu aruncă
//         — un cont nou rămâne pe implicitul documentat (activ, cheia
//         platformei). Mutația care pică: `if (error || !data) throw`.
//   AIR3  control pozitiv: rândul trece neatins, iar SELECT-ul cere EXACT
//         coloanele cu grant (fără `api_key_encrypted`, revocată pentru
//         authenticated — 42501, care cu noul fail-closed ar bloca salvarea pe
//         VECI). Mutația care pică: `api_key_encrypted` adăugat în select.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { getSessionMock, fromMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })),
  fromMock: vi.fn(),
}))
vi.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: getSessionMock },
    rpc: vi.fn(),
    from: fromMock,
  },
}))

import {
  aiTranslateBatch,
  describeAiError,
  generateProductImage,
  getAiConfig,
  isAiConfigError,
  isAiQuotaError,
  type AiError,
} from '../ai'

const ROMANIAN = /[ăâîșțĂÂÎȘȚ]/
const fetchMock = vi.fn()

// Răspunsuri false minimale (ce citește postFn: ok, status, json()) — fără
// dependența de `Response` din mediul jsdom.
interface FakeResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}
function jsonResponse(status: number, body: unknown): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
function textResponse(status: number): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0')
    },
  }
}

const input = { restaurant_id: 'r1', product_id: 'p1', name: 'Pizza' }

async function rejection(): Promise<AiError> {
  try {
    await generateProductImage(input)
  } catch (e) {
    return e as AiError
  }
  throw new Error('apelul trebuia să fie respins')
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('postFn — contractul de eroare AI', () => {
  it('AIC1: cu cod → mesajul și codul serverului rămân neatinse', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        error:
          'Generarea de imagini merge doar cu OpenAI sau Gemini. Schimbă furnizorul în Setări → Asistent AI.',
        code: 'provider_no_images',
      }),
    )
    const e = await rejection()
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('provider_no_images')
    expect(e.status).toBe(400)
    expect(e.message).toMatch(/^Generarea de imagini merge doar cu OpenAI sau Gemini/)
  })

  it('AIC2: fără cod (server vechi) → textul englezesc NU ajunge la patron', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'Forbidden' }))
    const e = await rejection()
    expect(e.message).not.toBe('Forbidden')
    expect(e.message).toMatch(ROMANIAN)
    expect(e.code).toBe('forbidden')
    expect(e.status).toBe(403)
  })

  it('AIC3: corp ne-JSON → statusul se păstrează, mesaj românesc', async () => {
    fetchMock.mockResolvedValueOnce(textResponse(429))
    const quota = await rejection()
    expect(quota.status).toBe(429)
    expect(isAiQuotaError(quota)).toBe(true)
    expect(quota.message).toMatch(ROMANIAN)

    fetchMock.mockResolvedValueOnce(textResponse(502))
    const gw = await rejection()
    expect(gw.status).toBe(502)
    expect(gw.code).toBe('provider_failed')
    expect(gw.message).toMatch(ROMANIAN)
  })

  it('AIC4: rețeaua căzută → cod `network`, status 0, mesaj românesc', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const e = await rejection()
    expect(e.code).toBe('network')
    expect(e.status).toBe(0)
    expect(e.message).not.toMatch(/Failed to fetch/)
    expect(e.message).toMatch(ROMANIAN)
  })

  it('AIC5: 200 cu corp ne-JSON → bad_response, nu SyntaxError', async () => {
    fetchMock.mockResolvedValueOnce(textResponse(200))
    const e = await rejection()
    expect(e).not.toBeInstanceOf(SyntaxError)
    expect(e.code).toBe('bad_response')
    expect(e.message).toMatch(ROMANIAN)
  })

  it('control: 200 cu JSON → rezultatul trece neatins', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { image_url: 'https://cdn.test/p.png' }))
    await expect(generateProductImage(input)).resolves.toEqual({
      image_url: 'https://cdn.test/p.png',
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/ai-generate-image$/)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('fără sesiune → eroare românească cu cod, fără cerere', async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } } as never)
    const e = await rejection()
    expect(e.code).toBe('auth_missing')
    expect(e.message).toMatch(ROMANIAN)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('describeAiError — pur', () => {
  it('AIC6: fiecare status are mesaj românesc; corpul fără cod e ignorat', () => {
    for (const status of [0, 400, 401, 403, 404, 413, 429, 500, 502, 503, 504]) {
      const info = describeAiError(status, { error: 'Internal thing went wrong' })
      expect(info.status).toBe(status)
      expect(info.message, `status ${status}`).toMatch(ROMANIAN)
      expect(info.message).not.toMatch(/Internal thing/)
      expect(info.code).toMatch(/^[a-z_]+$/)
    }
    expect(describeAiError(0, null).code).toBe('network')
    expect(describeAiError(504, null).code).toBe('provider_timeout')
  })

  it('AIC6b: cod fără mesaj → codul se păstrează, mesajul vine din status', () => {
    const info = describeAiError(400, { code: 'ai_disabled', error: '   ' })
    expect(info.code).toBe('ai_disabled')
    expect(info.message).toMatch(ROMANIAN)
  })

  it('AIC7: clasificarea pentru loturi', () => {
    const mk = (code: string, status: number) => Object.assign(new Error('x'), { code, status })
    expect(isAiQuotaError(mk('quota_exceeded', 429))).toBe(true)
    expect(isAiQuotaError(mk('rate_limited', 429))).toBe(true)
    expect(isAiQuotaError(mk('provider_failed', 502))).toBe(false)
    for (const code of ['provider_no_images', 'ai_disabled', 'provider_key_missing', 'forbidden']) {
      expect(isAiConfigError(mk(code, 400)), code).toBe(true)
    }
    // Eșecul unui singur produs NU oprește lotul.
    for (const code of [
      'image_failed',
      'provider_failed',
      'provider_timeout',
      'product_not_found',
      'network',
    ]) {
      expect(isAiConfigError(mk(code, 502)), code).toBe(false)
    }
    expect(isAiConfigError(null)).toBe(false)
    expect(isAiConfigError('provider_no_images')).toBe(false)
  })
})

describe('aiTranslateBatch — contextul itemelor (lotul O6c)', () => {
  const body = () => {
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    return JSON.parse(String(init.body)) as {
      system: string
      messages: { content: string }[]
    }
  }

  it('AIT1 `context` pleacă doar pe itemele care îl au; promptul îl explică', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: '{}' }))
    await aiTranslateBatch({
      restaurant_id: 'r1',
      items: [
        { id: 'o1', name: 'Mare', context: 'Opțiune din grupul «Mărime»' },
        { id: 'p1', name: 'Supă', description: 'Caldă' },
      ],
      targetLangs: ['en'],
    })
    const b = body()
    expect(JSON.parse(b.messages[0].content)).toEqual([
      { id: 'o1', name: 'Mare', context: 'Opțiune din grupul «Mărime»' },
      { id: 'p1', name: 'Supă', description: 'Caldă' },
    ])
    expect(b.system).toContain('`context` e doar pentru înțelegere: nu-l traduce și nu-l întoarce.')
  })

  it('AIT2 răspunsul cu `context` / `ai_fields` dă doar nume și descriere', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        text: JSON.stringify({
          o1: { en: { name: 'Large', context: 'Option from group', ai_fields: ['name'] } },
        }),
      }),
    )
    const out = await aiTranslateBatch({
      restaurant_id: 'r1',
      items: [{ id: 'o1', name: 'Mare', context: 'Opțiune din grupul «Mărime»' }],
      targetLangs: ['en'],
    })
    expect(out).toEqual({ o1: { en: { name: 'Large' } } })
  })
})

// Builder minimal pentru `from().select().eq().maybeSingle()`; păstrează
// argumentele ca AIR3 să poată verifica SELECT-ul.
interface ConfigRead {
  data: unknown
  error: { message: string; code: string } | null
}
interface ConfigBuilder {
  select: (cols: string) => ConfigBuilder
  eq: (col: string, val: string) => ConfigBuilder
  maybeSingle: () => Promise<ConfigRead>
}
function configBuilder(result: ConfigRead) {
  const select = vi.fn()
  const eq = vi.fn()
  const builder: ConfigBuilder = {
    select: (cols: string) => {
      select(cols)
      return builder
    },
    eq: (col: string, val: string) => {
      eq(col, val)
      return builder
    },
    maybeSingle: async () => result,
  }
  fromMock.mockReturnValue(builder)
  return { select, eq }
}

describe('getAiConfig — eroare ≠ fără rând', () => {
  beforeEach(() => {
    fromMock.mockReset()
  })

  it('AIR1: citirea eșuată RESPINGE cu Error real, cu `code` păstrat', async () => {
    configBuilder({
      data: null,
      error: { message: 'canceling statement due to statement timeout', code: '57014' },
    })
    let caught: unknown = null
    try {
      await getAiConfig('r1')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error & { code?: string }).code).toBe('57014')
  })

  it('AIR2: fără rând salvat → null, fără excepție', async () => {
    configBuilder({ data: null, error: null })
    await expect(getAiConfig('r1')).resolves.toBeNull()
  })

  it('AIR3: control pozitiv — rândul trece neatins, SELECT fără coloana cheii', async () => {
    const row = {
      restaurant_id: 'r1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      base_url: null,
      enabled: false,
    }
    const { select, eq } = configBuilder({ data: row, error: null })
    await expect(getAiConfig('r1')).resolves.toEqual(row)
    expect(fromMock).toHaveBeenCalledWith('ai_provider_configs')
    expect(select).toHaveBeenCalledWith('restaurant_id, provider, model, base_url, enabled')
    expect(eq).toHaveBeenCalledWith('restaurant_id', 'r1')
  })
})
