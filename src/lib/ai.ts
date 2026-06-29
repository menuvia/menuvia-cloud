// ─────────────────────────────────────────────────────────────
// ai.ts — Client pentru platforma AI (chatbot + import meniu + admin)
// ─────────────────────────────────────────────────────────────
// Apelează funcțiile Netlify `ai-config` (salvare cheie BYO criptată) și
// `ai-proxy` (chat/vision multi-provider cu metering), plus RPC-urile de
// cotă/admin din mig 168. Cheia API NU trece niciodată prin client în clar
// la citire — se trimite o singură dată la salvare și se întoarce mascată.
import { supabase } from './supabase'

// ── Tipuri ───────────────────────────────────────────────────
export type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'custom'
export type AiFeature = 'chat' | 'menu_import'

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

// ── Helper auth ──────────────────────────────────────────────
async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Nu ești autentificat.')
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }
}

async function postFn<T>(fn: string, payload: unknown): Promise<T> {
  const headers = await authHeaders()
  const res = await fetch(`/.netlify/functions/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string; code?: string }
      if (body?.error) msg = body.error
      const err = new Error(msg) as Error & { code?: string; status?: number }
      err.code = body?.code
      err.status = res.status
      throw err
    } catch (e) {
      if (e instanceof Error) throw e
      throw new Error(msg)
    }
  }
  return (await res.json()) as T
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
export async function isPlatformAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_platform_admin')
  if (error) return false
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

// ── Top-up credite (Faza F) ──────────────────────────────────
// Pornește un checkout Stripe pentru cumpărarea de tokens AI suplimentari.
// La plată, webhook-ul Stripe apelează ai_add_credits.
export async function buyAiCredits(input: {
  restaurant_id: string
  pack: 'small' | 'medium' | 'large'
}): Promise<{ url: string }> {
  return postFn('ai-credits-checkout', input)
}
