// ─────────────────────────────────────────────────────────────
// Coșul oaspetelui față de meniul DE ACUM (lotul O4a, audit nov 2026 OPT-2 /
// OPT-14). Piese PURE, fără React.
//
// Coșul ține instantanee: prețul produsului, opțiunile și extra-urile alese
// la adăugare. Meniul se poate schimba între timp: o opțiune devine
// indisponibilă, un grup devine obligatoriu, un extra e scos, un preț se
// schimbă. Serverul (create_order, mig 191/317) recalculează TOTUL din baza
// de date, deci:
//   - o linie al cărei conținut nu mai există e respinsă (`invalid_options`,
//     `missing_required_group`, `invalid_extras`). Oaspetele trebuie să vadă
//     CARE linie, nu un mesaj generic care se repetă la fiecare trimitere;
//   - o linie validă se taxează la prețul DE ACUM, deci coșul trebuie să
//     arate prețul de acum. Altfel totalul din coș minte.
//
// `cartLineIssue` spune ce e în neregulă cu o linie (null = nimic).
// `repriceCart` aduce prețurile liniilor VALIDE la meniul curent. Numele NU
// se ating: meniul vine în română, iar coșul ține numele în limba aleasă.
// ─────────────────────────────────────────────────────────────
import type { CartItem } from './orders'
import { modifierGroupMin, type Category, type Product } from './qr'

/** `unavailable` = produsul nu mai e în meniu; `options_changed` = opțiunile
 *  sau extra-urile alese nu mai corespund meniului. */
export type CartLineIssue = 'sold_out' | 'unavailable' | 'options_changed'

export function productIndex(categories: readonly Category[]): Map<string, Product> {
  const map = new Map<string, Product>()
  for (const c of categories) for (const p of c.products ?? []) map.set(p.id, p)
  return map
}

/** Opțiunile și extra-urile liniei încă se potrivesc cu produsul? */
function optionsStillValid(item: CartItem, product: Product): boolean {
  const groups = product.modifier_groups ?? []
  const perGroup = new Map<string, number>()
  const seen = new Set<string>()
  for (const m of item.selected_modifiers) {
    const g = groups.find((x) => x.id === m.group_id)
    const o = g?.modifier_options.find((x) => x.id === m.option_id)
    if (!g || !o || o.is_available === false || seen.has(m.option_id)) return false
    seen.add(m.option_id)
    perGroup.set(g.id, (perGroup.get(g.id) ?? 0) + 1)
  }
  for (const g of groups) {
    const n = perGroup.get(g.id) ?? 0
    if (n < modifierGroupMin(g)) return false
    const max = g.selection_type === 'single' ? 1 : g.max_select
    if (max != null && n > max) return false
  }
  const extras = product.extras ?? []
  const seenExtra = new Set<string>()
  for (const e of item.selected_extras ?? []) {
    const x = extras.find((y) => y.id === e.id)
    if (!x || x.is_available === false || seenExtra.has(e.id)) return false
    seenExtra.add(e.id)
  }
  return true
}

/**
 * Ce e în neregulă cu linia, față de meniul curent. `menu` gol = meniul nu e
 * cunoscut (încă se încarcă): nu inventăm probleme.
 */
export function cartLineIssue(item: CartItem, menu: ReadonlyMap<string, Product>): CartLineIssue | null {
  if (menu.size === 0) return null
  const product = menu.get(item.product_id)
  if (!product || product.is_draft) return 'unavailable'
  if (product.is_sold_out) return 'sold_out'
  return optionsStillValid(item, product) ? null : 'options_changed'
}

/** Câte linii au fiecare tip de problemă. */
export function cartIssueCounts(
  cart: readonly CartItem[],
  menu: ReadonlyMap<string, Product>,
): Record<CartLineIssue, number> {
  const counts: Record<CartLineIssue, number> = { sold_out: 0, unavailable: 0, options_changed: 0 }
  for (const item of cart) {
    const issue = cartLineIssue(item, menu)
    if (issue) counts[issue]++
  }
  return counts
}

/**
 * Textul de sub coș pentru problemele lui: opțiuni schimbate → „scoate și
 * adaugă din nou”; produs scos din meniu → doar „scoate” (nu se mai poate
 * adăuga); epuizat → mesajul de epuizare. Null = nimic de spus.
 */
export function cartIssueNoticeKey(
  counts: Record<CartLineIssue, number>,
): 'cart_changed_notice' | 'cart_unavailable_notice' | 'cart_sold_out_notice' | null {
  if (counts.options_changed > 0) return 'cart_changed_notice'
  if (counts.unavailable > 0) return 'cart_unavailable_notice'
  if (counts.sold_out > 0) return 'cart_sold_out_notice'
  return null
}

function samePrice(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100)
}

/**
 * Prețurile liniilor VALIDE aduse la meniul de acum. Liniile cu probleme
 * rămân cum sunt (oaspetele le scoate). Întoarce ACEEAȘI referință când nu s-a
 * schimbat nimic, ca un `setCart(prev => …)` să nu provoace o randare.
 */
export function repriceCart(
  cart: CartItem[],
  menu: ReadonlyMap<string, Product>,
): { cart: CartItem[]; changed: boolean } {
  let changed = false
  const next = cart.map((item) => {
    if (cartLineIssue(item, menu) !== null) return item
    const product = menu.get(item.product_id)
    if (!product) return item
    let lineChanged = !samePrice(item.unit_price_snapshot, product.price)
    const modifiers = item.selected_modifiers.map((m) => {
      const o = product.modifier_groups
        .find((g) => g.id === m.group_id)
        ?.modifier_options.find((x) => x.id === m.option_id)
      if (!o || samePrice(o.price_delta, m.price_delta)) return m
      lineChanged = true
      return { ...m, price_delta: o.price_delta }
    })
    const extras = item.selected_extras?.map((e) => {
      const x = product.extras.find((y) => y.id === e.id)
      if (!x || samePrice(x.price, e.price)) return e
      lineChanged = true
      return { ...e, price: x.price }
    })
    if (!lineChanged) return item
    changed = true
    return {
      ...item,
      unit_price_snapshot: product.price,
      selected_modifiers: modifiers,
      ...(extras ? { selected_extras: extras } : {}),
    }
  })
  return changed ? { cart: next, changed } : { cart, changed }
}
