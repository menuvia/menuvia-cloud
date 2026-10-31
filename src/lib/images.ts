// ─────────────────────────────────────────────────────────────
// images — convenții de URL pentru imaginile de produs (OPT-6)
//
// Upload-ul (ProductsTab) urcă originalul {uuid}.{ext} + thumb-ul de ~320px
// {uuid}_t.{ext} în același folder. `ext` e `webp` unde browserul codează WebP
// și `jpg` pe Safari (iPhone), care nu codează WebP din canvas — vezi
// lib/imageEncode. Cardurile derivă URL-ul thumb-ului prin convenție și cad pe
// original prin fallback-ul onError din BlurImage — imagini vechi (fără thumb)
// și URL-uri externe funcționează neschimbat.
//
// `png` apare pe Safari pentru surse cu transparență (lib/imageEncode,
// `mayHaveAlpha`). Excepția: imaginile generate de AI (`product-images/ai/…png`,
// funcția ai-generate-image) NU au pereche `_t` — pentru ele nu derivăm nimic,
// altfel fiecare card ar face întâi o cerere 404.
// ─────────────────────────────────────────────────────────────

const THUMB_EXT = /\.(webp|jpg|png)$/

/**
 * URL-ul thumb-ului derivat prin convenție, sau null dacă URL-ul nu e un
 * .webp/.jpg/.png urcat din panou în storage-ul nostru (ex. imagine AI sau
 * externă) — apelantul folosește atunci originalul direct.
 */
export function thumbUrlFor(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null
  if (!imageUrl.includes('/product-images/')) return null
  if (imageUrl.includes('/product-images/ai/')) return null
  const m = THUMB_EXT.exec(imageUrl)
  if (!m) return null
  const ext = m[1]
  const base = imageUrl.slice(0, -(ext.length + 1))
  if (base.endsWith('_t')) return imageUrl
  return `${base}_t.${ext}`
}
