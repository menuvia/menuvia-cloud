// src/lib/agentCode.ts
// Codul de agent la ÎNSCRIERE (mig 301, pachetul 7 / PR-5a).
//
// Până acum atribuirea agentului trăia doar în cookie-ul `mv_ref` și se
// consemna la checkout. Acum codul intră în `user_metadata.agent_code` la
// `signUp`, iar un trigger din bază (AFTER INSERT pe `profiles`) creează
// atribuirea — deci merge și când confirmarea emailului se face pe ALT
// dispozitiv, și pe planul gratuit. Un cod greșit NU blochează niciodată
// înscrierea pe server; aici decidem doar ce trimitem și ce îi spunem omului.
//
// Reguli (oglindă a lui `resolve_referral_code`, mig 295):
//   • forma acceptată: `^[a-z0-9-]{2,40}$` (cod 097 SAU vanity), lowercase;
//   • un cod TASTAT bate codul din link/cookie (alegere explicită);
//   • un cod din link pe care omul l-a scos („Nu e agentul meu") nu se trimite;
//   • un cod tastat cu formă proastă sau CUNOSCUT-necunoscut (serverul a
//     răspuns „nu există") oprește trimiterea formularului cu un mesaj — un typo
//     la dictare altfel ar pierde atribuirea fără ca cineva să afle; o eroare
//     de rețea/plafon NU oprește nimic (serverul rămâne autoritatea).
//
// Funcțiile pure (normalizare, alegere, rezolvare cu lookup injectat) sunt
// testate fără rețea; `lookupAgentCode` e singurul care vorbește cu serverul.

import { supabase } from './supabase'

const AGENT_CODE_SHAPE = /^[a-z0-9-]{2,40}$/

/** Lowercase, FĂRĂ spații (un cod dictat se scrie adesea cu pauze), max 40. */
export function normalizeAgentCode(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '').slice(0, 40)
}

/** Forma acceptată de server (cod sau vanity). */
export function isAgentCodeShape(value: string): boolean {
  return AGENT_CODE_SHAPE.test(value)
}

export type AgentChoice =
  | { source: 'none' }
  | { source: 'link'; code: string }
  | { source: 'typed'; code: string; shapeOk: boolean }

/**
 * Ce cod pleacă la înscriere. Tastat > link/cookie; link-ul scos de om nu pleacă.
 * Un șir tastat doar din spații numără ca „nimic tastat".
 */
export function pickAgentCandidate(
  typedRaw: string,
  stored: string | null,
  dismissed: boolean,
): AgentChoice {
  const typed = normalizeAgentCode(typedRaw)
  if (typed !== '') return { source: 'typed', code: typed, shapeOk: isAgentCodeShape(typed) }
  if (stored && !dismissed) return { source: 'link', code: stored }
  return { source: 'none' }
}

export type AgentCodeLookup =
  | { state: 'valid'; code: string }
  | { state: 'unknown' }
  | { state: 'error' }

/**
 * Rezolvă un cod/vanity la codul CANONIC prin `resolve_referral_code` (anon).
 * `unknown` doar când serverul a răspuns clar „nu există"; orice altceva
 * (eroare, DB fără mig 295, plafonul global) → `error`: nu știm, nu blocăm.
 */
export async function lookupAgentCode(candidate: string): Promise<AgentCodeLookup> {
  try {
    const { data, error } = await supabase.rpc('resolve_referral_code', { p_code: candidate })
    if (error || !data || typeof data !== 'object') return { state: 'error' }
    const body = data as { referral_code?: unknown; rate_limited?: unknown }
    if (body.rate_limited === true) return { state: 'error' }
    if (typeof body.referral_code === 'string' && body.referral_code !== '') {
      return { state: 'valid', code: body.referral_code }
    }
    return { state: 'unknown' }
  } catch {
    return { state: 'error' }
  }
}

export type SubmitAgentCode =
  | { ok: true; code: string | null }
  | { ok: false; problem: 'shape' | 'unknown' }

/**
 * Decizia de la „Creează cont", cu lookup-ul injectat (testabil fără rețea).
 *   none  → nu trimitem nimic;
 *   link  → codul din link/cookie pleacă ca atare (a fost deja verificat la
 *           afișarea bannerului, iar serverul îl re-validează oricum);
 *   typed → forma proastă / „nu există" OPRESC formularul; valid → codul
 *           canonic; eroare de lookup → pleacă tastatul, serverul decide.
 */
export async function resolveAgentCodeForSubmit(
  choice: AgentChoice,
  lookup: (candidate: string) => Promise<AgentCodeLookup> = lookupAgentCode,
): Promise<SubmitAgentCode> {
  if (choice.source === 'none') return { ok: true, code: null }
  if (choice.source === 'link') return { ok: true, code: choice.code }
  if (!choice.shapeOk) return { ok: false, problem: 'shape' }
  const res = await lookup(choice.code)
  if (res.state === 'unknown') return { ok: false, problem: 'unknown' }
  if (res.state === 'valid') return { ok: true, code: res.code }
  return { ok: true, code: choice.code }
}
