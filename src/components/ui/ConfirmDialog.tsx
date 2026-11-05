import { useCallback, useEffect, useState } from 'react'
import { FocusTrap } from './FocusTrap'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { _setConfirmHandler, type ConfirmOptions } from './confirm'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { chromeT } from '../../i18n/chrome'
import { useChrome } from '../../i18n/useChromeLang'
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
  // Butoanele implicite urmează limba paginii (`<html lang>`, lotul L1); când
  // tabelul a căzut pe altă limbă, doar ele își declară limba (titlul și
  // descrierea sunt textul paginii).
  const { lang, fallback } = useChrome()

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

  // Tastatura (audit a11y oct 2026): Escape anulează, prin capcana de focus —
  // doar când confirmarea e dialogul din vârf, deci nu închide și modalul de
  // dedesubt. Enter NU mai are ascultător global: acela confirma acțiunea
  // distructivă chiar cu focusul pe „Anulează" (keydown-ul ajungea la `window`
  // înaintea click-ului nativ al butonului focusat). Enter activează acum
  // butonul FOCUSAT, ca în orice dialog nativ — iar focusul pornește pe
  // confirmare (autoFocus), deci „Enter = confirmă" rămâne valabil cât timp
  // utilizatorul nu a mutat focusul.
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
        <FocusTrap onEscape={() => close(false)} />
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
            {state.cancelLabel ?? <span lang={fallback}>{chromeT(lang, 'confirm_cancel')}</span>}
          </Button>
          <Button
            variant={state.destructive ? 'danger' : 'primary'}
            onClick={() => close(true)}
            autoFocus
          >
            {state.confirmLabel ?? <span lang={fallback}>{chromeT(lang, 'confirm_ok')}</span>}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
