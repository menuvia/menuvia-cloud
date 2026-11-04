// ─────────────────────────────────────────────────────────────
// Legăturile produs ↔ grup de opțiuni (lotul O1b, audit nov 2026 MENU-02).
//
// Meniul oaspetelui și fișa ospătarului arată opțiunile unui produs DOAR din
// `product_modifier_groups`, iar nimic din aplicație nu scria acolo: grupurile
// create în Meniu → Opțiuni n-ajungeau la niciun produs. Scrierea trece prin
// două RPC-uri (mig 319) care înlocuiesc ATOMIC lista: un eșec la mijloc nu
// lasă produsul cu jumătate din grupuri.
//
// Funcțiile ARUNCĂ un `Error` real cu `hint`/`code` (ca `createOrder`), ca
// apelantul să arate cauza prin `toUserMessage`. Pe o bază fără mig 319
// (PGRST202 — clientul a ajuns înaintea migrației) cad pe scrierea directă în
// tabelă, sub aceeași politică RLS, în doi pași.
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase'

export interface ModifierGroupLink {
  product_id: string
  modifier_group_id: string
  display_order: number
}

interface RpcErrorShape {
  message?: string
  code?: string
  hint?: string | null
}

function toError(e: RpcErrorShape, fallback: string): Error {
  return Object.assign(new Error(e.message || fallback), { code: e.code, hint: e.hint ?? undefined })
}

function isMissingRpc(e: RpcErrorShape): boolean {
  return e.code === 'PGRST202' || /could not find the function/i.test(e.message ?? '')
}

// Citirile listelor merg pe PAGINI. PostgREST taie TĂCUT orice răspuns la
// `max_rows` (1000 pe Supabase), fără eroare: 250 de produse × 4 grupuri
// întorceau 1000 de legături arbitrare, iar „Alege produsele” pornea cu bife
// lipsă și, la salvare, DEZLEGA produsele nebifate (recenzia O1b). Pagina e
// sub plafon, ca o pagină plină să însemne mereu „mai urmează”.
export const LINK_PAGE_SIZE = 500
// Id-urile filtrului stau în URL (`in.(…)`, ~39 de octeți pe UUID codificat):
// peste ~200 de id-uri gateway-ul răspunde 414. Grupurile sunt puține, dar
// le trimitem tot în loturi.
const ID_BATCH = 100

interface PageResult<T> {
  data: T[] | null
  error: RpcErrorShape | null
}

async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  fallback: string,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += LINK_PAGE_SIZE) {
    const { data, error } = await page(from, from + LINK_PAGE_SIZE - 1)
    if (error) throw toError(error, fallback)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < LINK_PAGE_SIZE) return out
  }
}

/**
 * Toate legăturile grupurilor date (pentru numărători și „Alege produsele”).
 * Se citesc pe GRUPURI, nu pe produse: un restaurant are puține grupuri și
 * oricâte produse, iar lista de produse în URL pica la ~200 de produse.
 */
export async function fetchModifierGroupLinks(groupIds: readonly string[]): Promise<ModifierGroupLink[]> {
  const out: ModifierGroupLink[] = []
  for (let i = 0; i < groupIds.length; i += ID_BATCH) {
    const batch = groupIds.slice(i, i + ID_BATCH)
    const rows = await fetchAllPages<ModifierGroupLink>(
      (from, to) =>
        supabase
          .from('product_modifier_groups')
          .select('product_id, modifier_group_id, display_order')
          .in('modifier_group_id', batch)
          .order('modifier_group_id')
          .order('product_id')
          .range(from, to),
      'Nu am putut citi opțiunile produselor.',
    )
    out.push(...rows)
  }
  return out
}

/** Produsele restaurantului pentru „Alege produsele” (toate, nu primele 1000). */
export async function fetchLinkableProducts(restaurantId: string): Promise<{ id: string; name: string }[]> {
  return fetchAllPages<{ id: string; name: string }>(
    (from, to) =>
      supabase
        .from('products')
        .select('id,name')
        .eq('restaurant_id', restaurantId)
        .order('name')
        .order('id')
        .range(from, to),
    'Nu am putut citi produsele.',
  )
}

/** Grupurile unui produs, în ordinea fișei. */
export async function fetchProductGroupIds(productId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('product_modifier_groups')
    .select('modifier_group_id, display_order')
    .eq('product_id', productId)
    .order('display_order')
  if (error) throw toError(error, 'Nu am putut citi opțiunile produsului.')
  return ((data ?? []) as { modifier_group_id: string }[]).map((r) => r.modifier_group_id)
}

/** Înlocuiește grupurile produsului; ordinea din listă = ordinea din fișă. */
export async function setProductModifierGroups(productId: string, groupIds: readonly string[]): Promise<void> {
  const { error } = await supabase.rpc('set_product_modifier_groups', {
    p_product_id: productId,
    p_group_ids: [...groupIds],
  })
  if (!error) return
  if (!isMissingRpc(error)) throw toError(error, 'Nu am putut salva opțiunile produsului.')
  // Bază fără mig 319: aceeași politică RLS, în doi pași.
  let del = supabase.from('product_modifier_groups').delete().eq('product_id', productId)
  if (groupIds.length > 0) del = del.not('modifier_group_id', 'in', `(${groupIds.join(',')})`)
  const delRes = await del
  if (delRes.error) throw toError(delRes.error, 'Nu am putut salva opțiunile produsului.')
  if (groupIds.length === 0) return
  const upRes = await supabase.from('product_modifier_groups').upsert(
    groupIds.map((gid, i) => ({ product_id: productId, modifier_group_id: gid, display_order: i })),
    { onConflict: 'product_id,modifier_group_id' },
  )
  if (upRes.error) throw toError(upRes.error, 'Nu am putut salva opțiunile produsului.')
}

/** Înlocuiește produsele care folosesc grupul (legăturile noi intră ultimele). */
export async function setModifierGroupProducts(groupId: string, productIds: readonly string[]): Promise<void> {
  const { error } = await supabase.rpc('set_modifier_group_products', {
    p_group_id: groupId,
    p_product_ids: [...productIds],
  })
  if (!error) return
  if (!isMissingRpc(error)) throw toError(error, 'Nu am putut salva produsele grupului.')
  let del = supabase.from('product_modifier_groups').delete().eq('modifier_group_id', groupId)
  if (productIds.length > 0) del = del.not('product_id', 'in', `(${productIds.join(',')})`)
  const delRes = await del
  if (delRes.error) throw toError(delRes.error, 'Nu am putut salva produsele grupului.')
  if (productIds.length === 0) return
  const upRes = await supabase.from('product_modifier_groups').upsert(
    productIds.map((pid) => ({ product_id: pid, modifier_group_id: groupId, display_order: 99 })),
    { onConflict: 'product_id,modifier_group_id', ignoreDuplicates: true },
  )
  if (upRes.error) throw toError(upRes.error, 'Nu am putut salva produsele grupului.')
}
