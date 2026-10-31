// ─────────────────────────────────────────────────────────────
// imageEncode — codarea pozelor redimensionate pe canvas, înainte de upload
//
// De ce există (audit perf oct 2026): `canvas.toBlob(cb, 'image/webp')` NU
// codează WebP în Safari (iPhone/iPad, și macOS pe versiunile fără encoder):
// specificația cere ca un tip nesuportat să cadă pe PNG, iar Safari întoarce
// un blob `image/png`. Codul vechi urca acel PNG sub nume `.webp` și cu
// `contentType: 'image/webp'` — o poză de produs de 1200 px ajungea la ~1–3 MB
// în loc de ~150 KB, la fel thumb-ul de pe carduri și cover-ul de 1600 px
// (elementul LCP al meniului public). Majoritatea patronilor fotografiază
// meniul cu iPhone-ul, deci aproape tot catalogul era afectat.
//
// Regula: tipul fișierului se decide din `blob.type` (ce a codat EFECTIV
// browserul), niciodată din ce am cerut. Fallback:
//   - fotografii (produse, cover, pagini de meniu) → JPEG, care se codează
//     peste tot și e de ~10× mai mic decât PNG-ul pe o fotografie;
//   - imagini cu transparență (logo) → PNG adevărat, cu extensie `.png` —
//     un JPEG ar înlocui fundalul transparent cu negru.
// ─────────────────────────────────────────────────────────────

/**
 * Sursa POATE avea transparență (PNG/WebP/GIF/AVIF descărcate de pe web, ex.
 * o sticlă decupată) → pe Safari păstrăm PNG-ul; o fotografie de pe telefon
 * (JPEG/HEIC) merge pe JPEG.
 */
export function mayHaveAlpha(mime: string): boolean {
  return /^image\/(png|webp|gif|avif)$/i.test(mime)
}

/** Ce avem nevoie de la un canvas — permite teste fără layout/encoder real. */
export interface BlobSource {
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void
}

export type ImageExt = 'webp' | 'jpg' | 'png'

export interface EncodedImage {
  blob: Blob
  ext: ImageExt
  contentType: 'image/webp' | 'image/jpeg' | 'image/png'
}

const EXT_BY_TYPE: Record<EncodedImage['contentType'], ImageExt> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

function isKnownType(t: string): t is EncodedImage['contentType'] {
  return t === 'image/webp' || t === 'image/jpeg' || t === 'image/png'
}

function toBlobAsync(source: BlobSource, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => source.toBlob((b) => resolve(b), type, quality))
}

/**
 * Blob-ul cu tipul REAL, sau null dacă browserul n-a codat nimic sau a codat
 * un tip pe care nu-l știm descrie corect (extensie + Content-Type).
 */
function described(blob: Blob | null): EncodedImage | null {
  if (!blob || blob.size === 0 || !isKnownType(blob.type)) return null
  return { blob, ext: EXT_BY_TYPE[blob.type], contentType: blob.type }
}

/**
 * Codează canvas-ul pentru upload: WebP unde browserul îl suportă, altfel
 * JPEG (sau PNG pentru `alpha: true`). Aruncă dacă nu iese nicio imagine
 * descriptibilă — apelantul are deja un toast de „upload eșuat".
 */
export async function encodeForUpload(
  source: BlobSource,
  opts: { quality: number; alpha?: boolean },
): Promise<EncodedImage> {
  const webp = await toBlobAsync(source, 'image/webp', opts.quality)
  if (webp?.type === 'image/webp') {
    const ok = described(webp)
    if (ok) return ok
  }
  // Safari a întors PNG (sau nimic) pentru WebP.
  if (opts.alpha) {
    const png = webp?.type === 'image/png' ? webp : await toBlobAsync(source, 'image/png')
    const ok = described(png)
    if (ok) return ok
  } else {
    const ok = described(await toBlobAsync(source, 'image/jpeg', opts.quality))
    if (ok) return ok
  }
  // Ultima plasă: ce a codat browserul, dar cu tipul lui ADEVĂRAT.
  const fallback = described(webp)
  if (fallback) return fallback
  throw new Error('Browserul nu a putut coda imaginea')
}

/**
 * Codează în ACELAȘI format ca originalul (thumb-ul trebuie să aibă aceeași
 * extensie, convenția `{uuid}_t.{ext}` din lib/images). Null dacă browserul
 * nu poate — thumb-ul e best-effort, cardurile cad pe original.
 */
export async function encodeSameFormat(
  source: BlobSource,
  like: EncodedImage,
  quality: number,
): Promise<EncodedImage | null> {
  const blob = await toBlobAsync(
    source,
    like.contentType,
    like.contentType === 'image/png' ? undefined : quality,
  )
  const out = described(blob)
  return out && out.contentType === like.contentType ? out : null
}
