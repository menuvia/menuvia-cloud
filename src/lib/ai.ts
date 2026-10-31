// ─────────────────────────────────────────────────────────────
// ai.ts — Client pentru platforma AI (chatbot + import meniu + admin)
// ─────────────────────────────────────────────────────────────
// Apelează funcțiile Netlify `ai-config` (salvare cheie BYO criptată) și
// `ai-proxy` (chat/vision multi-provider cu metering), plus RPC-urile de
// cotă/admin din mig 168. Cheia API NU trece niciodată prin client în clar
// la citire — se trimite o singură dată la salvare și se întoarce mascată.
import { supabase } from './supabase'
import { fnUrl } from './fn'
import { ALLERGENS, DIETARY_TAGS } from './constants'
import { MENU_LANGS, type Translations } from './i18nMenu'

// ── Tipuri ───────────────────────────────────────────────────
export type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'custom'
export type AiFeature = 'chat' | 'menu_import' | 'nutrition' | 'translate'

export interface AiConfig {
  restaurant_id: string
  provider: AiProvider
  model: string
  base_url: string | null
  enabled: boolean
}

export interface AiQuota {
  period_start: string
  included_tokens: number
  used_tokens: number
  included_remaining: number
  credit_balance: number
}

export interface AiOverviewRow {
  restaurant_id: string
  restaurant_name: string
  included_tokens: number | null
  used_tokens: number | null
  credit_balance: number | null
  tokens_30d: number
  cost_30d: number
}

// Parte dintr-un mesaj (text sau imagine base64) — forma provider-neutră
// pe care `ai-proxy` o adaptează la fiecare furnizor.
export type AiPart =
  | { type: 'text'; text: string }
  | { type: 'image'; media_type: string; data: string }

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string | AiPart[]
}

export interface AiProxyResponse {
  text: string
  provider: AiProvider
  model: string
  usage: {
    input_tokens: number
    output_tokens: number
    included_remaining?: number
    credit_balance?: number
    recorded_tokens?: number
  }
}

// ── Contractul de eroare (netlify/functions/lib/aiErrors.js) ──
// Orice răspuns non-200 al funcțiilor AI e `{ error: <română>, code }`. Clientul
// afișează mesajul serverului DOAR când vine cu cod (contractul nou, garantat
// în română); fără cod — server vechi, proxy, pagină HTML de eroare, timeout de
// platformă — mesajul se alege după status, tot în română. Textul brut al unui
// corp fără cod (ex. „Forbidden") nu ajunge NICIODATĂ în fața patronului.
export interface AiErrorInfo {
  code: string
  message: string
  /** Codul HTTP; 0 = cererea n-a ajuns la server (rețea). */
  status: number
}

/** Eroarea aruncată de apelurile AI — poartă codul și statusul. */
export type AiError = Error & { code: string; status: number }

const NETWORK_FAILURE: Omit<AiErrorInfo, 'status'> = {
  code: 'network',
  message: 'Nu am putut contacta serverul. Verifică internetul și reîncearcă.',
}

function fallbackForStatus(status: number): Omit<AiErrorInfo, 'status'> {
  if (status === 0) return NETWORK_FAILURE
  if (status === 401)
    return { code: 'auth_invalid', message: 'Sesiunea a expirat. Intră din nou în cont.' }
  if (status === 403) {
    return {
      code: 'forbidden',
      message: 'Nu ai drepturi să folosești asistentul AI pentru acest restaurant.',
    }
  }
  if (status === 413) {
    return {
      code: 'payload_too_large',
      message: 'Pozele trimise sunt prea mari. Încearcă cu mai puține poze sau cu poze mai mici.',
    }
  }
  if (status === 429) {
    return {
      code: 'rate_limited',
      message: 'Prea multe cereri către asistentul AI. Așteaptă puțin și reîncearcă.',
    }
  }
  if (status === 504) {
    return {
      code: 'provider_timeout',
      message: 'Asistentul AI a răspuns prea greu. Reîncearcă în câteva momente.',
    }
  }
  if (status === 502 || status === 503) {
    return {
      code: 'provider_failed',
      message: 'Asistentul AI nu a putut răspunde acum. Reîncearcă în câteva momente.',
    }
  }
  if (status >= 500) {
    return {
      code: 'server_error',
      message: 'Eroare pe server la asistentul AI. Reîncearcă în câteva momente.',
    }
  }
  return { code: 'request_failed', message: 'Cererea către asistentul AI n-a reușit. Reîncearcă.' }
}

/**
 * Traduce un răspuns non-200 al unei funcții AI într-o eroare afișabilă.
 *
 * @param status codul HTTP (0 pentru „n-am ajuns la server")
 * @param body corpul parsat, sau `null` dacă nu era JSON
 */
export function describeAiError(status: number, body: unknown): AiErrorInfo {
  const obj =
    typeof body === 'object' && body !== null ? (body as { error?: unknown; code?: unknown }) : null
  const code = obj && typeof obj.code === 'string' && obj.code.trim() ? obj.code.trim() : null
  const message = obj && typeof obj.error === 'string' && obj.error.trim() ? obj.error.trim() : null
  const fallback = fallbackForStatus(status)
  if (code) return { code, message: message ?? fallback.message, status }
  return { ...fallback, status }
}

function toAiError(info: AiErrorInfo): AiError {
  const err = new Error(info.message) as AiError
  err.code = info.code
  err.status = info.status
  return err
}

function errorMeta(e: unknown): { code?: unknown; status?: unknown } {
  return typeof e === 'object' && e !== null ? (e as { code?: unknown; status?: unknown }) : {}
}

/** Cota AI e epuizată (sau limitată): un lot trebuie să se oprească. */
export function isAiQuotaError(e: unknown): boolean {
  const m = errorMeta(e)
  return m.code === 'quota_exceeded' || m.status === 429
}

// Erori de CONFIGURARE: nu țin de produsul curent, deci se repetă identic la
// fiecare apel. Un lot (AiBulkGenerate) le raportează o singură dată și nu mai
// cheamă serverul pentru restul produselor.
const CONFIG_ERROR_CODES = new Set([
  'server_config',
  'auth_missing',
  'auth_invalid',
  'forbidden',
  'ai_disabled',
  'provider_key_missing',
  'key_load_failed',
  'model_missing',
  'base_url_rejected',
  'provider_no_images',
])

export function isAiConfigError(e: unknown): boolean {
  const code = errorMeta(e).code
  return typeof code === 'string' && CONFIG_ERROR_CODES.has(code)
}

// ── Helper auth ──────────────────────────────────────────────
async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    throw toAiError({
      code: 'auth_missing',
      message: 'Nu ești autentificat. Intră din nou în cont.',
      status: 401,
    })
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }
}

async function postFn<T>(fn: string, payload: unknown): Promise<T> {
  const headers = await authHeaders()
  // Erorile se construiesc în afara blocurilor catch (regula eslint
  // `preserve-caught-error`; `cause` nu e disponibil cu lib ES2020): un
  // `TypeError: Failed to fetch` ajungea altfel ca atare, în engleză, în toast.
  let res: Response | null = null
  try {
    res = await fetch(fnUrl(fn), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
  } catch {
    // Rețea / CORS / abort: `res` rămâne null.
  }
  if (!res) throw toAiError({ ...NETWORK_FAILURE, status: 0 })

  // Corpul se citește o singură dată; un corp ne-JSON (429 gol de la un proxy,
  // HTML de eroare, timeout de platformă) rămâne `null`, iar statusul se păstrează
  // — isAiQuotaError testează și `status === 429`, altfel un lot ar continua să
  // lovească o cotă epuizată apel după apel (review audit v3).
  let body: unknown = null
  let parsed = false
  try {
    body = await res.json()
    parsed = true
  } catch {
    // Corp ne-JSON: `body` rămâne null, `parsed` false.
  }
  if (!res.ok) throw toAiError(describeAiError(res.status, parsed ? body : null))
  if (!parsed) {
    throw toAiError({
      code: 'bad_response',
      message: 'Răspuns neașteptat de la server. Reîncearcă în câteva momente.',
      status: res.status,
    })
  }
  return body as T
}

// ── Config BYO (Faza B) ──────────────────────────────────────
// Citește config-ul curent (fără cheie — RLS column-level o ascunde).
export async function getAiConfig(restaurantId: string): Promise<AiConfig | null> {
  const { data, error } = await supabase
    .from('ai_provider_configs')
    .select('restaurant_id, provider, model, base_url, enabled')
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (error || !data) return null
  return data as AiConfig
}

export async function saveAiConfig(input: {
  restaurant_id: string
  provider: AiProvider
  model: string
  base_url?: string | null
  api_key?: string // gol/absent = nu schimba cheia existentă
  enabled: boolean
}): Promise<{ ok: boolean; config: AiConfig & { key_masked: string | null } }> {
  return postFn('ai-config', input)
}

// ── Proxy AI (Faza C + D) ────────────────────────────────────
export async function aiChat(input: {
  restaurant_id: string
  messages: AiMessage[]
  system?: string
  max_tokens?: number
}): Promise<AiProxyResponse> {
  return postFn('ai-proxy', { ...input, feature: 'chat' as AiFeature })
}

export async function aiMenuImport(input: {
  restaurant_id: string
  messages: AiMessage[]
  system?: string
  max_tokens?: number
}): Promise<AiProxyResponse> {
  return postFn('ai-proxy', { ...input, feature: 'menu_import' as AiFeature })
}

// ── Cotă (Faza B/F) ──────────────────────────────────────────
export async function getAiQuota(restaurantId: string): Promise<AiQuota | null> {
  const { data, error } = await supabase.rpc('ai_get_quota', { p_restaurant_id: restaurantId })
  if (error || !data) return null
  return data as AiQuota
}

// ── Admin fondator (Faza E) ──────────────────────────────────
// Tristate: true = admin, false = NU (răspuns valid), null = nu am putut verifica
// (eroare de rețea/infra). Consumatorii NU trebuie să trateze null drept „interzis"
// (un blip de rețea scotea fondatorul din /founder — audit founder, MEDIUM). Un
// downgrade la false se face DOAR pe un `false` valid (fără eroare).
export async function isPlatformAdmin(): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('is_platform_admin')
  if (error) return null
  return data === true
}

export async function getAdminAiOverview(): Promise<AiOverviewRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_overview')
  if (error || !data) return []
  return data as AiOverviewRow[]
}

export async function setAiLimit(
  restaurantId: string,
  includedTokens: number,
): Promise<{ restaurant_id: string; included_tokens: number }> {
  const { data, error } = await supabase.rpc('admin_set_ai_limit', {
    p_restaurant_id: restaurantId,
    p_included_tokens: includedTokens,
  })
  if (error) throw error
  return data as { restaurant_id: string; included_tokens: number }
}

// ── Generare imagine produs (OpenAI/Gemini) ──────────────────
export async function generateProductImage(input: {
  restaurant_id: string
  product_id: string
  name: string
  description?: string | null
  category?: string | null
}): Promise<{ image_url: string }> {
  return postFn('ai-generate-image', input)
}

// ── Estimare macronutrienți + sugestii alergeni/tag-uri ──────
export interface NutritionResult {
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  allergens: string[]
  dietary_tags: string[]
}

function parseNutrition(text: string): NutritionResult {
  const clean = text.replace(/```json|```/g, '').trim()
  let raw: unknown
  try {
    raw = JSON.parse(clean)
  } catch {
    const m = clean.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('Răspuns AI neparsabil')
    raw = JSON.parse(m[0])
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const num = (v: unknown): number | null =>
    typeof v === 'number' && isFinite(v) && v >= 0 ? v : null
  const allergenIds = new Set(ALLERGENS.map((a) => a.id as string))
  const tagIds = new Set(DIETARY_TAGS.map((t) => t.id as string))
  const arr = (v: unknown, allowed: Set<string>): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && allowed.has(x)) : []
  return {
    calories: num(o.calories),
    protein_g: num(o.protein_g),
    carbs_g: num(o.carbs_g),
    fat_g: num(o.fat_g),
    allergens: arr(o.allergens, allergenIds),
    dietary_tags: arr(o.dietary_tags, tagIds),
  }
}

export async function generateNutrition(input: {
  restaurant_id: string
  name: string
  description?: string | null
  category?: string | null
}): Promise<NutritionResult> {
  const allergenList = ALLERGENS.map((a) => a.id).join(', ')
  const tagList = DIETARY_TAGS.map((t) => t.id).join(', ')
  const system = [
    'Ești un asistent culinar care estimează valori nutriționale pentru produse de meniu.',
    'Răspunzi DOAR cu un obiect JSON (fără markdown, fără text) de forma:',
    '{"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "allergens": string[], "dietary_tags": string[]}',
    'Valorile nutriționale sunt per porție, estimate rezonabil. Numere, fără unități.',
    `allergens: alege DOAR din [${allergenList}]. dietary_tags: alege DOAR din [${tagList}].`,
    'Dacă nu ești sigur de un câmp, pune null (la numere) sau [] (la liste). NU inventa alergeni.',
  ].join('\n')
  const userText = `Produs: „${input.name}"${input.category ? ` (categoria: ${input.category})` : ''}${input.description ? `. Descriere: ${input.description}` : ''}`
  const res = await postFn<AiProxyResponse>('ai-proxy', {
    feature: 'nutrition' as AiFeature,
    restaurant_id: input.restaurant_id,
    system,
    messages: [{ role: 'user', content: userText }],
    max_tokens: 500,
  })
  return parseNutrition(res.text)
}

// ── Traducere AI a meniului (multilingv) ─────────────────────
// Item traductibil (produs SAU categorie). `description` opțional (categoriile
// n-au descriere).
export interface TranslatableItem {
  id: string
  name: string
  description?: string | null
}

// Traduce MAI MULTE iteme de meniu într-un SINGUR apel AI — mult mai eficient
// decât un apel per produs (mai puține round-trip-uri, mai puțină latență, un
// singur system-prompt în loc de N). Întoarce `{ <id>: Translations }` doar
// pentru itemele traduse cu succes. Robust: itemele lipsă/nevalide se sar
// (rămân în română), fără să pice tot lotul.
export async function aiTranslateBatch(input: {
  restaurant_id: string
  items: TranslatableItem[]
  targetLangs: string[]
}): Promise<Record<string, Translations>> {
  const langs = input.targetLangs.filter((c) => c !== 'ro')
  if (langs.length === 0 || input.items.length === 0) return {}
  const langList = langs
    .map((c) => {
      const l = MENU_LANGS.find((x) => x.code === c)
      return l ? `${c} (${l.label})` : c
    })
    .join(', ')
  const system = [
    'Ești un traducător profesionist de meniuri de restaurant.',
    `Traduci o listă de iteme de meniu din română în limbile: ${langList}.`,
    'Primești un array JSON de forma [{"id","name","description"}].',
    'Răspunzi DOAR cu un obiect JSON (fără markdown, fără text) keyed pe id:',
    '{"<id>": {"en": {"name": "...", "description": "..."}, "de": {...}}, ...}',
    'Folosește EXACT id-urile primite drept chei și codurile de limbă cerute.',
    'Păstrează denumirile proprii și brandurile. Dacă un item n-are descriere,',
    'omite câmpul "description". Traduceri naturale, apetisante și scurte.',
  ].join('\n')
  const payload = JSON.stringify(
    input.items.map((it) => ({
      id: it.id,
      name: it.name,
      description: it.description ?? undefined,
    })),
  )
  const res = await postFn<AiProxyResponse>('ai-proxy', {
    feature: 'translate' as AiFeature,
    restaurant_id: input.restaurant_id,
    system,
    messages: [{ role: 'user', content: payload }],
    // Buget de tokeni scalat cu volumul: ~90 tokeni/(item×limbă) + overhead
    // (descrierile pot fi lungi). Dimensiunea lotului e aleasă de apelant în
    // funcție de nr. de limbi ca acest buget să NU atingă plafonul → fără
    // trunchiere de răspuns.
    max_tokens: Math.min(4000, 600 + input.items.length * langs.length * 130),
  })
  return parseTranslateBatch(res.text, new Set(input.items.map((i) => i.id)), langs)
}

// Recuperează un obiect JSON dintr-un răspuns TRUNCHIAT (max_tokens atins la
// mijloc): taie la ultima intrare de nivel-1 complet închisă și închide obiectul
// exterior. Astfel itemele deja traduse integral la începutul lotului NU se
// pierd (restul rămân netraduse și vor fi reîncercate la rularea următoare).
function salvageTruncatedJsonObject(s: string): string | null {
  let depth = 0
  let inStr = false
  let esc = false
  let lastTopLevelClose = -1
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 1) lastTopLevelClose = i // o intrare de nivel-1 tocmai s-a închis
    }
  }
  if (lastTopLevelClose < 0) return null
  return s.slice(0, lastTopLevelClose + 1) + '}'
}

// Parsează răspunsul batch: obiect keyed pe id → Translations. Păstrează doar
// id-urile cerute, limbile cerute și câmpurile nevide. Robust la markdown-fence
// și la trunchierea răspunsului (recuperează itemele complete).
function parseTranslateBatch(
  text: string,
  ids: Set<string>,
  langs: string[],
): Record<string, Translations> {
  const clean = text.replace(/```json|```/g, '').trim()
  const from = clean.startsWith('{') ? clean : clean.slice(clean.indexOf('{'))
  let raw: unknown
  try {
    raw = JSON.parse(clean)
  } catch {
    const m = clean.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        raw = JSON.parse(m[0])
      } catch {
        raw = undefined
      }
    }
    if (raw === undefined) {
      // Ultima șansă: răspuns trunchiat → salvăm intrările complete.
      const salvaged = from.startsWith('{') ? salvageTruncatedJsonObject(from) : null
      if (!salvaged) throw new Error('Răspuns AI neparsabil')
      raw = JSON.parse(salvaged)
    }
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
  const out: Record<string, Translations> = {}
  for (const [id, entry] of Object.entries(o)) {
    if (!ids.has(id) || !entry || typeof entry !== 'object') continue
    const perLang = entry as Record<string, unknown>
    const tr: Translations = {}
    for (const code of langs) {
      const val = perLang[code]
      if (!val || typeof val !== 'object') continue
      const e = val as Record<string, unknown>
      const name = str(e.name)
      const description = str(e.description)
      if (name || description) {
        tr[code] = {}
        if (name) tr[code].name = name
        if (description) tr[code].description = description
      }
    }
    if (Object.keys(tr).length > 0) out[id] = tr
  }
  return out
}

// ── Top-up credite (Faza F) ──────────────────────────────────
// Pornește un checkout Stripe pentru cumpărarea de tokens AI suplimentari.
// La plată, webhook-ul Stripe apelează ai_add_credits.
export async function buyAiCredits(input: {
  restaurant_id: string
  pack: 'small' | 'medium' | 'large'
}): Promise<{ url: string }> {
  return postFn('ai-credits-checkout', input)
}
