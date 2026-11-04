// ─────────────────────────────────────────────────────────────
// Motorul comun de selecție a opțiunilor (lotul O4b, audit nov 2026 OPT-4 /
// OPT-6 / OPT-10 / OPT-12). Pur, fără React.
//
// Fișa oaspetelui (ProductSheet) și fișa ospătarului (ModifierSheet) își
// numărau fiecare opțiunile alese în felul ei: fișa oaspetelui număra ORICE
// id din stare, chiar și unul care nu mai exista după o reîmprospătare a
// meniului, deci „Adaugă” se activa cu un grup obligatoriu gol și serverul
// respingea comanda. Acum ambele trec prin aceleași reguli, care oglindesc
// create_order (mig 191/317):
//   - contează doar opțiunile care EXISTĂ în grup și sunt disponibile;
//   - fiecare grup cere cel puțin minimul efectiv (`modifierGroupMin`) și cel
//     mult maximul lui (1 pe un grup single);
//   - un grup obligatoriu fără nicio opțiune disponibilă face produsul
//     necomandabil — fișa nu mai e o fundătură (OPT-4);
//   - pe un grup OPȚIONAL single, a doua atingere pe aceeași opțiune o
//     deselectează (OPT-6); pe unul obligatoriu rămâne radio.
// ─────────────────────────────────────────────────────────────
import type { SelectedModifier } from './orders'
import { modifierGroupMin, type Category, type ModifierGroup, type ModifierOption, type Product } from './qr'

/** Alegerea per grup: id (single), mulțime de id-uri (multiple) sau nimic. */
export type OptionSelections = Record<string, string | Set<string> | null>

type GroupLike = Pick<
  ModifierGroup,
  'id' | 'name' | 'selection_type' | 'is_required' | 'min_select' | 'max_select' | 'modifier_options'
>

export function isMultiSelection(v: string | Set<string> | null | undefined): v is Set<string> {
  return v instanceof Set
}

/** Opțiunile pe care le poate alege cineva acum. */
export function availableOptions(g: Pick<ModifierGroup, 'modifier_options'>): ModifierOption[] {
  return g.modifier_options.filter((o) => o.is_available !== false)
}

/** Maximul efectiv al grupului: 1 pe single, `max_select` (sau nelimitat) pe multiple. */
export function groupMax(g: Pick<ModifierGroup, 'selection_type' | 'max_select'>): number | null {
  return g.selection_type === 'single' ? 1 : g.max_select
}

/** Opțiunile ALESE care există și sunt disponibile, în ordinea grupului. */
export function selectedOptions(g: GroupLike, selections: OptionSelections): ModifierOption[] {
  const sel = selections[g.id]
  if (sel == null) return []
  const has = (id: string): boolean => (isMultiSelection(sel) ? sel.has(id) : sel === id)
  return availableOptions(g).filter((o) => has(o.id))
}

/** Câte opțiuni valide sunt alese în grup (cele dispărute nu se numără). */
export function selectedCount(g: GroupLike, selections: OptionSelections): number {
  return selectedOptions(g, selections).length
}

/** Grupul nu poate fi satisfăcut cu opțiunile disponibile acum. */
export function groupImpossible(g: GroupLike): boolean {
  return availableOptions(g).length < modifierGroupMin(g)
}

/**
 * Produsul nu se poate comanda din cauza opțiunilor: un grup cere mai multe
 * opțiuni decât sunt disponibile (de pildă „Blat”, obligatoriu, cu toate
 * blaturile marcate indisponibile). Serverul l-ar respinge oricum.
 */
export function productOptionsUnavailable(p: Pick<Product, 'modifier_groups'>): boolean {
  return (p.modifier_groups ?? []).some(groupImpossible)
}

/** Grupurile care încă cer o alegere (sub minim), în ordinea fișei. */
export function missingGroups<G extends GroupLike>(groups: readonly G[], selections: OptionSelections): G[] {
  return groups.filter((g) => selectedCount(g, selections) < modifierGroupMin(g))
}

/** Toate grupurile sunt între minim și maxim. */
export function selectionsComplete(groups: readonly GroupLike[], selections: OptionSelections): boolean {
  return groups.every((g) => {
    const n = selectedCount(g, selections)
    const max = groupMax(g)
    return n >= modifierGroupMin(g) && (max == null || n <= max)
  })
}

/**
 * Atingerea unei opțiuni. Single: o alege; a doua atingere pe aceeași o
 * deselectează DOAR dacă grupul e opțional. Multiple: bifează/debifează, fără
 * să treacă de maxim. O opțiune indisponibilă nu se poate alege.
 */
export function toggleOption(g: GroupLike, selections: OptionSelections, optionId: string): OptionSelections {
  const option = g.modifier_options.find((o) => o.id === optionId)
  const current = selections[g.id]
  if (g.selection_type === 'single') {
    if (current === optionId) {
      return modifierGroupMin(g) === 0 ? { ...selections, [g.id]: null } : selections
    }
    if (!option || option.is_available === false) return selections
    return { ...selections, [g.id]: optionId }
  }
  const set = new Set(isMultiSelection(current) ? current : [])
  if (set.has(optionId)) {
    set.delete(optionId)
    return { ...selections, [g.id]: set }
  }
  if (!option || option.is_available === false) return selections
  const max = groupMax(g)
  if (max != null && selectedCount(g, selections) >= max) return selections
  set.add(optionId)
  return { ...selections, [g.id]: set }
}

/**
 * Scoate din alegeri id-urile care nu mai există sau nu mai sunt disponibile
 * (meniul s-a reîmprospătat cu fișa deschisă, OPT-10). Întoarce ACEEAȘI
 * referință când nu e nimic de scos, ca un efect să nu randeze degeaba.
 */
export function pruneSelections(groups: readonly GroupLike[], selections: OptionSelections): OptionSelections {
  let changed = false
  const next: OptionSelections = { ...selections }
  for (const [gid, sel] of Object.entries(selections)) {
    const g = groups.find((x) => x.id === gid)
    if (sel == null) continue
    const valid = new Set(g ? availableOptions(g).map((o) => o.id) : [])
    if (isMultiSelection(sel)) {
      const kept = new Set([...sel].filter((id) => valid.has(id)))
      if (kept.size !== sel.size) {
        next[gid] = kept
        changed = true
      }
    } else if (!valid.has(sel)) {
      next[gid] = null
      changed = true
    }
  }
  return changed ? next : selections
}

/** Alegerile de pornire dintr-o linie existentă (doar opțiunile încă valabile). */
export function initialSelections(
  groups: readonly GroupLike[],
  chosen: readonly Pick<SelectedModifier, 'group_id' | 'option_id'>[],
): OptionSelections {
  const init: OptionSelections = {}
  for (const g of groups) {
    const valid = new Set(availableOptions(g).map((o) => o.id))
    const ids = chosen.filter((s) => s.group_id === g.id && valid.has(s.option_id)).map((s) => s.option_id)
    init[g.id] = g.selection_type === 'single' ? (ids[0] ?? null) : new Set(ids)
  }
  return init
}

/** Diferența de preț a opțiunilor alese (doar cele valide). */
export function selectionDelta(groups: readonly GroupLike[], selections: OptionSelections): number {
  return groups.reduce(
    (sum, g) => sum + selectedOptions(g, selections).reduce((s, o) => s + o.price_delta, 0),
    0,
  )
}

/** Opțiunile alese, în forma liniei din coș / comenzii. */
export function buildSelectedModifiers(
  groups: readonly GroupLike[],
  selections: OptionSelections,
): SelectedModifier[] {
  return groups.flatMap((g) =>
    selectedOptions(g, selections).map((o) => ({
      group_id: g.id,
      group_name: g.name,
      option_id: o.id,
      option_name: o.name,
      price_delta: o.price_delta,
    })),
  )
}

/**
 * Meniul de AFIȘARE: un produs pe care opțiunile îl fac imposibil de comandat
 * (grup obligatoriu fără opțiuni disponibile) apare „Epuizat”, ca pe toate
 * cardurile, în coș și la adăugarea rapidă — nu ca o fișă care nu se poate
 * trimite niciodată (OPT-4). Întoarce ACEEAȘI referință când nu e nimic de
 * marcat (memo-urile paginilor rămân stabile).
 */
export function markUnorderableProducts(categories: Category[]): Category[] {
  let changed = false
  const next = categories.map((c) => {
    let catChanged = false
    const products = (c.products ?? []).map((p) => {
      if (p.is_sold_out || !productOptionsUnavailable(p)) return p
      catChanged = true
      return { ...p, is_sold_out: true }
    })
    if (!catChanged) return c
    changed = true
    return { ...c, products }
  })
  return changed ? next : categories
}
