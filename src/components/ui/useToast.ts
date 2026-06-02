import { createContext, useContext } from 'react'

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

export interface ToastApi {
  success: (msg: string, duration?: number) => void
  error: (msg: string, duration?: number) => void
  warning: (msg: string, duration?: number) => void
  info: (msg: string, duration?: number) => void
  dismiss: (id: number) => void
}

// Contextul e exportat ca să-l importe ToastProvider; consumatorii
// folosesc doar useToast().
export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast trebuie folosit într-un <ToastProvider> ascendent.')
  }
  return ctx
}
