import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { _setConfirmHandler, type ConfirmOptions } from './confirm'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import '../../styles/components/confirm-dialog.css'

interface DialogState extends ConfirmOptions {
  open: boolean
  resolve?: (v: boolean) => void
}

/**
 * Singleton — montează o singură dată în root. Înregistrează handler-ul
 * pe care `confirm()` (din ./confirm) îl va apela ca să afișeze dialogul.
 */
export function ConfirmRoot() {
  const [state, setState] = useState<DialogState>({ open: false, title: '' })
  // Host-ul rămâne montat mereu → blocăm scroll-ul doar cât dialogul e deschis.
  useBodyScrollLock(state.open)

  useEffect(() => {
    _setConfirmHandler(
      (opts) =>
        new Promise<boolean>((resolve) => {
          setState({ ...opts, open: true, resolve })
        }),
    )
    return () => {
      _setConfirmHandler(null)
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
    <div className="confirm-backdrop" onClick={() => close(false)} role="presentation">
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
