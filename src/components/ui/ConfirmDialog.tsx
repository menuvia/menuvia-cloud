import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import '../../styles/components/confirm-dialog.css'

interface ConfirmOptions {
  title: string
  description?: string
  /** Eticheta butonului de confirmare. Default: "Confirmă". */
  confirmLabel?: string
  /** Eticheta butonului de anulare. Default: "Anulează". */
  cancelLabel?: string
  /** Variant pentru butonul de confirmare. Default: "primary"; folosește
   *  "danger" pentru acțiuni distructive (șterge, anulează comandă). */
  destructive?: boolean
}

interface DialogState extends ConfirmOptions {
  open: boolean
  resolve?: (v: boolean) => void
}

// State global ca apelul din afara arborelui React (event handler simplu)
// să poată invoca dialogul. Singura instanță e ConfirmRoot, montat în App.
let pushDialog: ((opts: ConfirmOptions) => Promise<boolean>) | null = null

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

export function ConfirmRoot() {
  const [state, setState] = useState<DialogState>({
    open: false,
    title: '',
  })

  useEffect(() => {
    pushDialog = (opts) =>
      new Promise<boolean>((resolve) => {
        setState({ ...opts, open: true, resolve })
      })
    return () => {
      pushDialog = null
    }
  }, [])

  const close = useCallback(
    (value: boolean) => {
      state.resolve?.(value)
      setState((s) => ({ ...s, open: false, resolve: undefined }))
    },
    [state],
  )

  // ESC anulează; Enter confirmă.
  useEffect(() => {
    if (!state.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false)
      else if (e.key === 'Enter') close(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.open, close])

  if (!state.open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="confirm-backdrop"
      onClick={() => close(false)}
      role="presentation"
    >
      <div
        className="confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={state.description ? 'confirm-desc' : undefined}
      >
        <h3 id="confirm-title" className="confirm-dialog__title">
          {state.title}
        </h3>
        {state.description && (
          <p id="confirm-desc" className="confirm-dialog__desc">
            {state.description}
          </p>
        )}
        <div className="confirm-dialog__actions">
          <Button variant="ghost" onClick={() => close(false)}>
            {state.cancelLabel ?? 'Anulează'}
          </Button>
          <Button
            variant={state.destructive ? 'danger' : 'primary'}
            onClick={() => close(true)}
            autoFocus
          >
            {state.confirmLabel ?? 'Confirmă'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
