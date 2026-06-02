import { useCallback, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import '../../styles/components/modal.css'

type Size = 'sm' | 'md' | 'lg' | 'xl'

interface ModalProps {
  /** Controlled — afișează / ascunde modalul. */
  open: boolean
  onClose: () => void
  /** Titlu afișat în antet (folosit și ca aria-labelledby). Lipsa lui cere
   *  consumatorului să paseze `ariaLabel`. */
  title?: string
  /** Etichetă a11y când nu există title vizibil. */
  ariaLabel?: string
  size?: Size
  /** ESC închide. Default true. Dezactivează pentru flow-uri critice. */
  closeOnEsc?: boolean
  /** Click pe backdrop închide. Default true. */
  closeOnBackdrop?: boolean
  /** Ascunde butonul × din antet. Default false. */
  hideCloseButton?: boolean
  /** Conținut suplimentar în antet, la dreapta titlului (ex. badge status). */
  headerExtra?: React.ReactNode
  /** Footer cu acțiuni (butoane). Dacă absent, footerul nu se randează. */
  footer?: React.ReactNode
  children: React.ReactNode
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function Modal({
  open,
  onClose,
  title,
  ariaLabel,
  size = 'md',
  closeOnEsc = true,
  closeOnBackdrop = true,
  hideCloseButton = false,
  headerExtra,
  footer,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  // Stochează elementul focusat înainte de deschidere ca să-l restaurăm la close.
  const lastFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  // Focus management: la deschidere, mută focus în primul focusable;
  // la închidere, restaurează focus la origine.
  useEffect(() => {
    if (!open) return
    lastFocusRef.current = document.activeElement as HTMLElement | null
    const dlg = dialogRef.current
    if (dlg) {
      // Focus pe primul focusable din dialog; fallback pe dialog însuși.
      const first = dlg.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(first ?? dlg).focus()
    }
    return () => {
      lastFocusRef.current?.focus?.()
    }
  }, [open])

  // ESC închide + focus trap pe Tab cycling.
  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEsc) {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const dlg = dialogRef.current
      if (!dlg) return
      const focusables = dlg.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [closeOnEsc, onClose],
  )

  // Blocăm scroll-ul body-ului cât e modalul deschis.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={closeOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={`modal modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        {(title || !hideCloseButton || headerExtra) && (
          <div className="modal__header">
            {title && (
              <h2 id={titleId} className="modal__title">
                {title}
              </h2>
            )}
            <div className="modal__header-actions">
              {headerExtra}
              {!hideCloseButton && (
                <button
                  type="button"
                  className="modal__close"
                  onClick={onClose}
                  aria-label="Închide"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
