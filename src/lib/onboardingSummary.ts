// ─────────────────────────────────────────────────────────────
// onboardingSummary.ts — ce arată ecranul final al onboarding-ului.
//
// Defectul (ux-owner-final-screen): ecranul „Ești gata!” bifa HARD-CODAT
// „Meniu configurat” și „Mese și QR-uri” chiar și când patronul sărise peste
// ambii pași — un restaurant gol, fără nicio masă, primea patru bife verzi. Aici
// bifele se calculează din ce s-a întâmplat REAL în pașii 2 și 3, iar ecranul
// știe ce QR are de dat la tipărit (mesele create sau QR-ul general al meniului).
// Pur, fără React, ca să poată fi testat direct.
// ─────────────────────────────────────────────────────────────

/** Ce a rămas după Pasul 2 (meniul). */
export type MenuOutcome = { kind: 'products'; count: number } | { kind: 'skipped' }

/** O masă creată la Pasul 3, cu token-ul QR (null = token-ul nu s-a creat). */
export interface CreatedTable {
  name: string
  token: string | null
}

/** Ce a rămas după Pasul 3 (mesele). */
export type TablesOutcome =
  | { kind: 'tables'; tables: CreatedTable[]; qrOk: boolean }
  | { kind: 'pickup' }
  | { kind: 'general-qr' }
  | { kind: 'skipped' }

export type SummaryKey =
  | 'restaurant'
  | 'menu-products'
  | 'menu-empty'
  | 'tables-qr'
  | 'tables-no-qr'
  | 'pickup'
  | 'general-qr'
  | 'tables-skipped'
  | 'orders-ready'
  | 'menu-qr-ready'

export interface SummaryItem {
  key: SummaryKey
  done: boolean
  /** Numărul de produse / mese, unde are sens. */
  count?: number
}

/** Mesele care au chiar un QR de tipărit (token creat). */
export function printableTables(tables: TablesOutcome): Array<{ name: string; token: string }> {
  if (tables.kind !== 'tables') return []
  return tables.tables.flatMap((t) => (t.token ? [{ name: t.name, token: t.token }] : []))
}

/**
 * Bifele ecranului final, în ordine: restaurantul, meniul, mesele, apoi starea
 * QR-ului pentru oaspeți. `canOrder` = planul permite comenzi prin QR
 * (`order_qr`); necunoscut se dă `false` (formularea adevărată pe orice plan).
 * „Gata de comenzi” cere în plus un meniu cu produse ȘI un QR prin care
 * oaspetele chiar poate comanda (masă cu QR sau ridicare).
 */
export function onboardingSummary(
  menu: MenuOutcome,
  tables: TablesOutcome,
  canOrder: boolean,
): SummaryItem[] {
  const hasMenu = menu.kind === 'products' && menu.count > 0
  const printable = printableTables(tables).length
  const items: SummaryItem[] = [{ key: 'restaurant', done: true }]
  items.push(
    hasMenu && menu.kind === 'products'
      ? { key: 'menu-products', done: true, count: menu.count }
      : { key: 'menu-empty', done: false },
  )
  switch (tables.kind) {
    case 'tables':
      items.push(
        printable > 0
          ? { key: 'tables-qr', done: true, count: printable }
          : { key: 'tables-no-qr', done: false, count: tables.tables.length },
      )
      break
    case 'pickup':
      items.push({ key: 'pickup', done: true })
      break
    case 'general-qr':
      items.push({ key: 'general-qr', done: true })
      break
    case 'skipped':
      items.push({ key: 'tables-skipped', done: false })
      break
  }
  const orderable = printable > 0 || tables.kind === 'pickup'
  items.push(
    canOrder
      ? { key: 'orders-ready', done: hasMenu && orderable }
      : { key: 'menu-qr-ready', done: hasMenu },
  )
  return items
}
