import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import '../../styles/components/toast.css'

type ToastKind = 'success' | 'error' | 'warning' | 'info'

interface ToastEntry {
  id: number
  kind: ToastKind
  message: string
  /** Durata de afișare (ms). Sub 0 = persistent (necesită dismiss manual). */
  duration: number
}

interface ToastApi {
  success: (msg: string, duration?: number) => void
  error: (msg: string, duration?: number) => void
  warning: (msg: string, duration?: number) => void
  info: (msg: string, duration?: number) => void
  dismiss: (id: number) => void
}

const DEFAULT_DURATIONS: Record<ToastKind, number> = {
  success: 3500,
  info: 3500,
  warning: 5000,
  error: 6500,
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const idRef = useRef(0)
  // Timeout-uri active per id — curățate la dismiss / unmount.
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    const t = timersRef.current.get(id)
    if (t) {
      clearTimeout(t)
      timersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (kind: ToastKind, message: string, duration?: number) => {
      const id = ++idRef.current
      const d = duration ?? DEFAULT_DURATIONS[kind]
      setToasts((prev) => [...prev, { id, kind, message, duration: d }])
      if (d > 0) {
        const timer = setTimeout(() => dismiss(id), d)
        timersRef.current.set(id, timer)
      }
    },
    [dismiss],
  )

  // Curăță toate timerele la unmount (provider de regulă persistent, dar
  // strict mode + HMR cer cleanup corect).
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, d) => push('success', m, d),
      error: (m, d) => push('error', m, d),
      warning: (m, d) => push('warning', m, d),
      info: (m, d) => push('info', m, d),
      dismiss,
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastEntry[]
  onDismiss: (id: number) => void
}) {
  // SSR-safe — randăm doar pe client (document există).
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="toast-viewport"
      role="region"
      aria-label="Notificări"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast--${t.kind}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          <span className="toast__icon" aria-hidden="true">
            {ICON[t.kind]}
          </span>
          <span className="toast__message">{t.message}</span>
          <button
            type="button"
            className="toast__close"
            onClick={() => onDismiss(t.id)}
            aria-label="Închide notificarea"
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}

const ICON: Record<ToastKind, string> = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'i',
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast trebuie folosit într-un <ToastProvider> ascendent.')
  }
  return ctx
}
