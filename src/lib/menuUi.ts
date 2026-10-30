// ─────────────────────────────────────────────────────────────
// menuUi — helperi PURI de interfață pentru meniurile oaspetelui (/q și /m):
// eticheta accesibilă a barei de coș, ținta de derulare la schimbarea
// categoriei și prefetch-ul chunk-urilor după primul paint. Fără React, ca
// să fie testați direct (src/lib/__tests__/menuUi.test.ts, BL1–BL5).
// ─────────────────────────────────────────────────────────────
import { T, type PublicMenuStringKey } from './publicMenuStrings'

/**
 * Numele accesibil al barei de coș / „Lista mea" (ux-guest-12). Înainte bara
 * avea `aria-label` FIX („Comanda mea"), care înlocuia tot conținutul vizibil:
 * cititorul de ecran nu afla niciodată câte produse sunt și cât costă. Coș gol
 * → doar eticheta de bază; altfel „<bază> · N produse · <total>".
 */
export function cartBarLabel(
  lang: string,
  base: PublicMenuStringKey,
  count: number,
  totalLabel: string,
): string {
  const label = T(lang, base)
  if (count <= 0) return label
  const word = count === 1 ? T(lang, 'item_one') : T(lang, 'item_many')
  return `${label} · ${count} ${word} · ${totalLabel}`
}

/** Înălțimea barei de categorii lipite sus, când n-o putem măsura (fallback). */
export const CATEGORY_TABS_HEIGHT = 56

/**
 * Unde derulăm pagina când oaspetele schimbă categoria (ux-guest-6). Lista
 * nouă trebuie să înceapă imediat sub bara de categorii lipită sus; altfel,
 * cine schimba categoria de jos din listă rămânea la mijlocul produselor noi.
 *
 * `listTop` = poziția listei în viewport (getBoundingClientRect().top),
 * `scrollY` = derularea curentă, `stickyBottom` = marginea de jos a barei.
 * `null` = lista e deja vizibilă sub bară (oaspetele e sus) → nu mișcăm nimic.
 */
export function listScrollTarget(
  listTop: number,
  scrollY: number,
  stickyBottom: number = CATEGORY_TABS_HEIGHT,
): number | null {
  if (!Number.isFinite(listTop) || !Number.isFinite(scrollY)) return null
  if (listTop >= stickyBottom) return null
  return Math.max(0, Math.round(scrollY + listTop - stickyBottom))
}

/** Marginea de jos a barei de categorii (măsurată), cu fallback pe constantă. */
export function stickyTabsBottom(): number {
  if (typeof document === 'undefined') return CATEGORY_TABS_HEIGHT
  const el = document.querySelector('[data-testid="category-tabs"]')
  const bottom = el?.getBoundingClientRect().bottom
  return bottom != null && Number.isFinite(bottom) && bottom > 0 ? bottom : CATEGORY_TABS_HEIGHT
}

type ChunkLoader = () => Promise<unknown>

/** Fallback-ul fără requestIdleCallback (Safari): după primul paint, nu în el. */
export const PREFETCH_FALLBACK_DELAY_MS = 800

/**
 * Cere chunk-urile foilor (fișa produsului, coșul, rezervarea) când browserul
 * e liber, după ce meniul s-a randat (perf-guest-5). Fără prefetch, primul tap
 * pe un produs aștepta descărcarea chunk-ului abia atunci — pe 4G, sute de ms
 * în care nu se întâmpla nimic vizibil.
 *
 * Sare complet pe Save-Data (oaspetele a cerut explicit date puține). Fiecare
 * import are `.catch` propriu: un chunk care nu se descarcă acum se va cere
 * din nou la tap (`lazy`), iar o respingere neprinsă ar fi unhandled rejection
 * în browserul oaspetelui. Întoarce funcția de anulare (cleanup de efect).
 */
export function prefetchOnIdle(loaders: readonly ChunkLoader[]): () => void {
  if (typeof window === 'undefined' || loaders.length === 0) return () => undefined
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (conn?.saveData === true) return () => undefined
  const run = (): void => {
    for (const load of loaders) {
      try {
        void load().catch(() => undefined)
      } catch {
        /* un loader care aruncă sincron nu oprește restul */
      }
    }
  }
  // `globalThis`, nu `window`: în browser sunt același obiect, iar în teste
  // e cel pe care vi.stubGlobal îl înlocuiește.
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(run, { timeout: 3000 })
    return () => w.cancelIdleCallback?.(id)
  }
  const t = setTimeout(run, PREFETCH_FALLBACK_DELAY_MS)
  return () => clearTimeout(t)
}
