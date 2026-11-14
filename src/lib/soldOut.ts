// ─────────────────────────────────────────────────────────────
// „Epuizat” — starea produsului și calea personalului (mig 313, lotul B).
//
// `products.is_sold_out` e starea EFECTIVĂ (o citește meniul public), iar
// `products.sold_out_source` spune de ce: 'stock' = automat, un ingredient al
// rețetei e sub o porție; 'manual' + epuizat = blocat de om; 'manual' +
// disponibil = deblocat de om deși stocul e încă sub porție (ține până când
// stocul revine peste prag); null = disponibil, regula de stoc armată.
//
// Ospătarul și bucătarul NU au UPDATE pe `products` (politica „admin write”),
// deci marcarea trece EXCLUSIV prin RPC-ul `set_product_sold_out` (DEFINER,
// gate `is_member`). `setProductSoldOut` aruncă un `Error` REAL cu hint/code
// (contractul `createOrder`), ca ecranul să afișeze motivul prin toUserMessage.
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase'

export type SoldOutSource = 'manual' | 'stock' | null

export interface SoldOutState {
  is_sold_out: boolean
  sold_out_source: SoldOutSource
}

type SoldOutRpcError = Error & { hint?: string; code?: string }

function asSource(v: unknown): SoldOutSource {
  return v === 'manual' || v === 'stock' ? v : null
}

/** Marchează un produs epuizat / disponibil prin RPC-ul personalului. */
export async function setProductSoldOut(
  productId: string,
  soldOut: boolean,
): Promise<SoldOutState> {
  const { data, error } = await supabase.rpc('set_product_sold_out', {
    p_product_id: productId,
    p_sold_out: soldOut,
  })
  if (error) {
    const err = new Error(error.message || 'Nu s-a putut actualiza produsul') as SoldOutRpcError
    err.hint = error.hint ?? undefined
    err.code = error.code ?? undefined
    throw err
  }
  const row = (data ?? {}) as { is_sold_out?: unknown; sold_out_source?: unknown }
  return {
    is_sold_out: row.is_sold_out === true,
    sold_out_source: asSource(row.sold_out_source),
  }
}

/** RPC-ul lipsește (frontend deployat înaintea migrației 313). */
export function isMissingSoldOutRpc(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return code === 'PGRST202'
}

/** Sursa stării, ca DATE: de ce e produsul epuizat (`stock` / `manual`) sau
 *  că a fost deblocat de mână (`unblocked`); `null` = nimic de spus. Regula
 *  e UNA: o citesc eticheta românească de mai jos, panoul „Epuizate” al
 *  personalului (StaffSoldOutSheet, tradus în `orders` — lotul L4c) și lista
 *  din fila Produse (tradusă în `products` — lotul L5a). */
export type SoldOutSourceKind = 'stock' | 'manual' | 'unblocked'

export function soldOutSourceKind(
  isSoldOut: boolean,
  source: SoldOutSource | undefined,
): SoldOutSourceKind | null {
  if (isSoldOut) return source === 'stock' ? 'stock' : 'manual'
  if (source === 'manual') return 'unblocked'
  return null
}

const SOURCE_LABEL_RO: Record<SoldOutSourceKind, string> = {
  stock: 'din stoc',
  manual: 'manual',
  unblocked: 'deblocat manual',
}

/**
 * Eticheta sursei, în română: de ce e produsul epuizat, sau că a fost deblocat
 * de mână. `null` = nimic de spus. Nu o mai randează niciun ecran (ProductsTab
 * a trecut pe `soldOutSourceKind` + namespace-ul `products` în lotul L5a); a
 * rămas ORACOLUL românesc al insignei „EPUIZAT · …” din listă (testul LV9).
 */
export function soldOutSourceLabel(
  isSoldOut: boolean,
  source: SoldOutSource | undefined,
): string | null {
  const kind = soldOutSourceKind(isSoldOut, source)
  return kind == null ? null : SOURCE_LABEL_RO[kind]
}

/**
 * Starea „Epuizat” pe care omul a ALES-o în formularul de produs, sau `null`
 * dacă n-a mutat comutatorul față de cum s-a deschis formularul. Formularul nu
 * trimite `is_sold_out` în PATCH (PRODUCT_UPDATE_FIELDS, mig 313): o listă
 * încărcată înainte ca stocul să epuizeze produsul ar fi trimis `false` și l-ar
 * fi deblocat tăcut. Doar o schimbare FĂCUTĂ în formular pleacă, prin RPC.
 */
export function soldOutFormTarget(
  opened: { is_sold_out?: boolean | null } | null | undefined,
  form: { is_sold_out?: boolean | null },
): boolean | null {
  if (typeof form.is_sold_out !== 'boolean') return null
  const before = opened?.is_sold_out === true
  return form.is_sold_out === before ? null : form.is_sold_out
}

/** Rândul unui produs în panoul „Epuizate” al personalului. */
export interface StaffSoldOutProduct {
  id: string
  name: string
  emoji: string | null
  is_sold_out: boolean
  sold_out_source: SoldOutSource
  display_order: number
}

const STAFF_COLUMNS = 'id, name, emoji, is_sold_out, display_order'

/**
 * Produsele active, publicate, ale restaurantului — epuizatele întâi, apoi în
 * ordinea meniului. Citire sub RLS „products: member read all” (orice membru).
 * Pe o bază fără mig 313 coloana `sold_out_source` lipsește (42703): reîncercăm
 * fără ea, iar sursa rămâne necunoscută. Aruncă pe orice altă eroare.
 */
export async function fetchStaffSoldOutProducts(
  restaurantId: string,
): Promise<StaffSoldOutProduct[]> {
  const query = (columns: string) =>
    supabase
      .from('products')
      .select(columns)
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .eq('is_draft', false)
      .order('display_order')
  let res = await query(`${STAFF_COLUMNS}, sold_out_source`)
  if (res.error?.code === '42703') res = await query(STAFF_COLUMNS)
  if (res.error) {
    const err = new Error(res.error.message || 'Nu s-au putut încărca produsele') as SoldOutRpcError
    err.code = res.error.code ?? undefined
    throw err
  }
  const rows = (res.data ?? []) as unknown as Array<Record<string, unknown>>
  return rows
    .map((r) => ({
      id: String(r.id),
      name: typeof r.name === 'string' ? r.name : '',
      emoji: typeof r.emoji === 'string' ? r.emoji : null,
      is_sold_out: r.is_sold_out === true,
      sold_out_source: asSource(r.sold_out_source),
      display_order: typeof r.display_order === 'number' ? r.display_order : 0,
    }))
    .sort(
      (a, b) => Number(b.is_sold_out) - Number(a.is_sold_out) || a.display_order - b.display_order,
    )
}
