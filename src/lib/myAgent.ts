// myAgent.ts — apelurile RPC pentru cardul „Agentul tău Menuvia” (mig 303).
// Logica pură (validare, linkuri) stă în agentContact.ts.
import { supabase } from './supabase'
import { parseMyAgent, type MyAgentResult } from './agentContact'

/**
 * `get_my_agent`: ARUNCĂ pe eroare de rețea / drepturi (nu confundăm un blip cu
 * „fără agent”); întoarce `null` pe o formă necunoscută de răspuns.
 */
export async function getMyAgent(restaurantId: string): Promise<MyAgentResult | null> {
  const { data, error } = await supabase.rpc('get_my_agent', { p_restaurant: restaurantId })
  if (error) throw new Error(error.message)
  return parseMyAgent(data)
}

// Cardul de pe Acasă, cel din Setări și butonul „Ajutor” se montează împreună:
// cererile simultane pe același restaurant împart UN singur apel. Intrarea dispare
// la rezolvare, deci un `reload` după o acțiune face mereu un apel proaspăt.
const inflight = new Map<string, Promise<MyAgentResult | null>>()

export function loadMyAgent(restaurantId: string): Promise<MyAgentResult | null> {
  const existing = inflight.get(restaurantId)
  if (existing) return existing
  const p = getMyAgent(restaurantId).finally(() => {
    inflight.delete(restaurantId)
  })
  inflight.set(restaurantId, p)
  return p
}

export interface AgentActionResult {
  ok: boolean
  error?: string
  state?: string
}

/**
 * Ownerul acordă accesul agentului din card, FĂRĂ să aștepte o cerere și pe ORICE
 * plan (mig 303). Gate-ul real e în RPC (doar ownerul real, atribuire activă).
 */
export async function ownerGrantPartnerAccess(attributionId: string): Promise<AgentActionResult> {
  const { data, error } = await supabase.rpc('owner_grant_partner_access', {
    p_attribution_id: attributionId,
  })
  if (error) throw new Error(error.message)
  return data as AgentActionResult
}
