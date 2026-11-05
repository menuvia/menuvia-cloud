// ─────────────────────────────────────────────────────────────
// Citirile și scrierile ecranului Meniu → Traduceri (lotul O6c).
//
// Singurul modul al ecranului care atinge Supabase; raportul e pur
// (lib/menuTranslations.ts). Produsele și categoriile vin din hook-urile
// existente (useProducts/useCategories, ca tab-ul Produse); aici: grupurile,
// opțiunile, extra-urile și legăturile, pe PAGINI (PostgREST taie tăcut la
// `max_rows`), cu id-urile filtrului în loturi de 100 (URL-ul `in.(…)`).
//
// Toate tabelele atinse sunt în suprafața politicilor de partener (mig 286):
// citire + scriere pe categories, products, modifier_groups, modifier_options,
// product_extras; citire pe product_modifier_groups. `select('*')` (precedentul
// O6b): pe o bază fără mig 321 citirea merge, iar scrierea pică vizibil.
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase'
import { fetchAllPages, fetchModifierGroupLinks } from './modifierLinks'
import { zeroRowsAsDenied } from './userMessages'
import type { Translations } from './i18nMenu'
import type { TrExtraRow, TrGroupRow, TrLinkRow, TrOptionRow, TrTable } from './menuTranslations'

const ID_BATCH = 100

export interface TranslationOptions {
  groups: TrGroupRow[]
  options: TrOptionRow[]
  extras: TrExtraRow[]
  links: TrLinkRow[]
}

const trOf = (v: unknown): Translations | null => (v as Translations | null | undefined) ?? null
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

/** Grupurile restaurantului, opțiunile lor, extra-urile produselor date și legăturile. */
export async function loadTranslationOptions(
  restaurantId: string,
  productIds: readonly string[],
): Promise<TranslationOptions> {
  const groupRows = await fetchAllPages<Record<string, unknown>>(
    (from, to) =>
      supabase
        .from('modifier_groups')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('display_order')
        .order('id')
        .range(from, to),
    'Nu am putut citi grupurile de opțiuni.',
  )
  const groups: TrGroupRow[] = groupRows.map((g) => ({
    id: str(g.id),
    name: str(g.name),
    display_order: num(g.display_order),
    translations: trOf(g.translations),
  }))
  const groupIds = groups.map((g) => g.id)

  const optionRows: Record<string, unknown>[] = []
  for (let i = 0; i < groupIds.length; i += ID_BATCH) {
    const batch = groupIds.slice(i, i + ID_BATCH)
    optionRows.push(
      ...(await fetchAllPages<Record<string, unknown>>(
        (from, to) =>
          supabase
            .from('modifier_options')
            .select('*')
            .in('modifier_group_id', batch)
            .order('display_order')
            .order('id')
            .range(from, to),
        'Nu am putut citi opțiunile.',
      )),
    )
  }
  const options: TrOptionRow[] = optionRows.map((o) => ({
    id: str(o.id),
    modifier_group_id: str(o.modifier_group_id),
    name: str(o.name),
    is_available: o.is_available === true,
    display_order: num(o.display_order),
    translations: trOf(o.translations),
  }))

  const extraRows: Record<string, unknown>[] = []
  for (let i = 0; i < productIds.length; i += ID_BATCH) {
    const batch = productIds.slice(i, i + ID_BATCH)
    extraRows.push(
      ...(await fetchAllPages<Record<string, unknown>>(
        (from, to) =>
          supabase
            .from('product_extras')
            .select('*')
            .in('product_id', batch)
            .order('display_order')
            .order('id')
            .range(from, to),
        'Nu am putut citi extra-urile.',
      )),
    )
  }
  const extras: TrExtraRow[] = extraRows.map((e) => ({
    id: str(e.id),
    product_id: str(e.product_id),
    name: str(e.name),
    is_available: e.is_available === true,
    display_order: num(e.display_order),
    translations: trOf(e.translations),
  }))

  const links: TrLinkRow[] = (await fetchModifierGroupLinks(groupIds)).map((l) => ({
    product_id: l.product_id,
    modifier_group_id: l.modifier_group_id,
  }))
  return { groups, options, extras, links }
}

/**
 * Scrie traducerile UNUI rând: le RE-CITEȘTE întâi (o limbă scrisă între timp
 * din altă fișă sau alt tab nu se pierde), aplică `mutate` pe rândul proaspăt,
 * scrie, iar 0 rânduri scrise = refuz de drepturi (RLS), nu succes. Întoarce
 * ce s-a scris — ecranul își reface rândul din asta, nu din presupunerea lui.
 * Nu e atomic (citire + scriere, ~100 ms); atomicitatea ar cere un RPC.
 */
export async function saveRowTranslations(
  table: TrTable,
  id: string,
  mutate: (fresh: Translations) => Translations,
): Promise<Translations> {
  const read = await supabase.from(table).select('translations').eq('id', id).maybeSingle()
  if (read.error) {
    throw codedError(read.error.message || 'Nu am putut citi traducerile.', read.error.code ?? '')
  }
  if (!read.data) throw codedError('Elementul nu mai e în meniu.', 'not_found')
  const fresh = trOf((read.data as { translations?: unknown }).translations) ?? {}
  const next = mutate(fresh)
  const res = await supabase.from(table).update({ translations: next }).eq('id', id).select('id, translations')
  const denied = zeroRowsAsDenied(res)
  if (denied) throw codedError(denied.message, denied.code)
  const row = (res.data ?? [])[0] as { translations?: unknown } | undefined
  return trOf(row?.translations) ?? next
}
