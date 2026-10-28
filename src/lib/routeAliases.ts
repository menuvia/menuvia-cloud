// ─────────────────────────────────────────────────────────────
// routeAliases.ts — căi vechi sau alternative care duc la o rută canonică.
//
// `/preturi` (varianta românească pe care o scriu oamenii și o ghicesc
// motoarele de căutare) ajungea pe pagina 404; ruta reală a prețurilor e
// `/pricing`. Redirectul HTTP real stă în `netlify.toml` (301); asta e plasa
// din client, pentru VPS și preview-uri, unde fișierul nu se aplică.
// ─────────────────────────────────────────────────────────────

/** cale veche → cale canonică */
export const LEGACY_PATH_REDIRECTS: Readonly<Record<string, string>> = {
  '/preturi': '/pricing',
}

/**
 * Calea canonică pentru un `pathname` cu alias, sau null. Slash-ul final și
 * majusculele nu contează (`/Preturi/` = `/preturi`); query-ul nu face parte
 * din `pathname`, deci se păstrează la apelant.
 */
export function legacyPathRedirect(pathname: string): string | null {
  const normalized = pathname.toLowerCase().replace(/\/+$/, '') || '/'
  return Object.prototype.hasOwnProperty.call(LEGACY_PATH_REDIRECTS, normalized)
    ? LEGACY_PATH_REDIRECTS[normalized]
    : null
}
