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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })),
}))
vi.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: getSessionMock },
    rpc: vi.fn(),
    from: vi.fn(),
  },
}))

import {
  describeAiError,
  generateProductImage,
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
