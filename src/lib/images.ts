// ─────────────────────────────────────────────────────────────
// images — convenții de URL pentru imaginile de produs (OPT-6)
//
// Upload-ul (ProductsTab) urcă originalul {uuid}.webp + thumb-ul de ~320px
// {uuid}_t.webp în același folder. Cardurile derivă URL-ul thumb-ului prin
// convenție și cad pe original prin fallback-ul onError din BlurImage —
// imagini vechi (fără thumb) și URL-uri externe funcționează neschimbat.
// ─────────────────────────────────────────────────────────────

/**
 * URL-ul thumb-ului derivat prin convenție, sau null dacă URL-ul nu e un
 * .webp din storage-ul nostru (ex. imagine AI externă) — apelantul folosește
 * atunci originalul direct.
 */
export function thumbUrlFor(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null
  if (!imageUrl.includes('/product-images/')) return null
  if (!imageUrl.endsWith('.webp')) return null
  if (imageUrl.endsWith('_t.webp')) return imageUrl
  return imageUrl.slice(0, -'.webp'.length) + '_t.webp'
}
