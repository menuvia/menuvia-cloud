// Helper-ul async `confirm()` și tipurile lui, separate de ConfirmDialog.tsx
// (care e rezervat pentru componente, ca să nu spargă HMR/react-refresh).
// Singleton-ul `pushDialog` e setat de <ConfirmRoot/> la mount și folosit aici.

export interface ConfirmOptions {
  title: string
  description?: string
  /** Eticheta butonului de confirmare. Default: "Confirmă". */
  confirmLabel?: string
  /** Eticheta butonului de anulare. Default: "Anulează". */
  cancelLabel?: string
  /** Pentru acțiuni distructive (șterge / anulează) — buton roșu. */
  destructive?: boolean
}

// State module-level partajat cu ConfirmRoot. Singura instanță vie a
// dialogului e cea montată în App.
let pushDialog: ((opts: ConfirmOptions) => Promise<boolean>) | null = null

/** API intern — folosit de ConfirmRoot ca să se înregistreze la mount. */
export function _setConfirmHandler(
  handler: ((opts: ConfirmOptions) => Promise<boolean>) | null,
) {
  pushDialog = handler
}

/**
 * Înlocuitor async pentru `window.confirm`.
 *
 * Necesită <ConfirmRoot /> montat o singură dată în root.
 *
 * ```ts
 * if (await confirm({ title: 'Șterge produsul?', destructive: true })) {
 *   // ...
 * }
 * ```
 */
export async function confirm(opts: ConfirmOptions): Promise<boolean> {
  if (!pushDialog) {
    console.warn('[confirm] <ConfirmRoot /> nu e montat; folosesc window.confirm fallback.')
    return Promise.resolve(window.confirm(opts.title))
  }
  return pushDialog(opts)
}
