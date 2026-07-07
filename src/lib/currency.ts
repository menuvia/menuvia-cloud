// ─────────────────────────────────────────────────────────────
// currency.ts — afișarea prețurilor în meniul client (mig 205)
// ─────────────────────────────────────────────────────────────
// Fundația expansiunii internaționale pe planurile 1–2 (docs/PLAN_1M.md):
// meniul e deja în 7 limbi, moneda vine din `restaurants.menu_currency`.
// DOAR afișare — abonamentele Stripe și fiscalizarea RO nu trec pe aici.
//
// Convenție de afișare: RON păstrează formatul istoric „12,50 lei" (sufix,
// ca peste tot în piața RO); restul monedelor folosesc simbolul standard
// prefixat/sufixat după uzanța locală.

export const MENU_CURRENCIES = ['RON', 'EUR', 'HUF', 'BGN', 'MDL', 'USD', 'GBP'] as const
export type MenuCurrency = (typeof MENU_CURRENCIES)[number]

interface CurrencyDisplay {
  /** Eticheta afișată lângă preț. */
  symbol: string
  /** Simbol înainte (true) sau după sumă (false). */
  prefix: boolean
  /** Zecimale afișate (HUF se afișează întreg, ca în piața maghiară). */
  decimals: number
}

const DISPLAY: Record<MenuCurrency, CurrencyDisplay> = {
  RON: { symbol: 'lei', prefix: false, decimals: 2 },
  EUR: { symbol: '€', prefix: false, decimals: 2 },
  HUF: { symbol: 'Ft', prefix: false, decimals: 0 },
  BGN: { symbol: 'лв', prefix: false, decimals: 2 },
  MDL: { symbol: 'lei', prefix: false, decimals: 2 },
  USD: { symbol: '$', prefix: true, decimals: 2 },
  GBP: { symbol: '£', prefix: true, decimals: 2 },
}

/** Coerce jsonb/text din DB la o monedă suportată; orice altceva → RON. */
export function resolveMenuCurrency(raw: unknown): MenuCurrency {
  return typeof raw === 'string' && (MENU_CURRENCIES as readonly string[]).includes(raw)
    ? (raw as MenuCurrency)
    : 'RON'
}

/**
 * Formatarea unui preț pentru meniul client: `fmtPrice(12.5)` → „12.50 lei",
 * `fmtPrice(12.5, 'EUR')` → „12.50 €", `fmtPrice(1200, 'HUF')` → „1200 Ft".
 * Default RON — apelurile existente rămân identice vizual cu istoricul.
 */
export function fmtPrice(amount: number, currency: MenuCurrency = 'RON'): string {
  const d = DISPLAY[currency]
  const value = amount.toFixed(d.decimals)
  return d.prefix ? `${d.symbol}${value}` : `${value} ${d.symbol}`
}
