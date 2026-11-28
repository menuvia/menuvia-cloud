// Plățile comenzii din dialogul de anulare (CancelOrderDialog), pentru Ospătar
// ȘI Bucătărie — o singură implementare, ca cele două ecrane să nu se mai
// despartă.
//
// TRISTATE: `null` = necunoscut (citirea e în zbor sau a eșuat) → dialogul NU
// blochează, serverul decide (anularea peste bani încasați e respinsă în DATE,
// mig 270).
//
// O „sesiune” = o deschidere a dialogului pentru o comandă. Orice citire, și
// cea de la deschidere, și cea de RECUPERARE de după un storno eșuat
// (`reload`), își scrie rezultatul DOAR cât sesiunea ei e încă deschisă: un
// răspuns întârziat pentru o comandă închisă sau înlocuită între timp ar fi
// arătat plățile ALTEI comenzi în dialogul curent — banii vechii comenzi
// blocau anularea directă sau impuneau storno-ul pe comanda nouă.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getOrderPayments } from '../lib/orders'
import type { OrderPaymentRow } from '../lib/orders'

interface CancelSession {
  orderId: string
  open: boolean
}

export interface CancelPayments {
  /** Plățile comenzii din dialog; `null` = necunoscut. */
  payments: OrderPaymentRow[] | null
  /** Recitește plățile comenzii din dialog (după un storno eșuat); nimic pe dialog închis. */
  reload: () => void
}

/** Plățile comenzii `order` cât dialogul de anulare e deschis pe ea; `null` = dialog închis. */
export function useCancelPayments(order: { id: string } | null): CancelPayments {
  const [payments, setPayments] = useState<OrderPaymentRow[] | null>(null)
  const sessionRef = useRef<CancelSession | null>(null)

  /** Citește plățile pentru `session` și le aplică doar dacă sesiunea e încă deschisă. */
  const readInto = useCallback((session: CancelSession): void => {
    void getOrderPayments(session.orderId)
      .then((ps) => {
        if (session.open) setPayments(ps)
      })
      .catch(() => {
        if (session.open) setPayments(null)
      })
  }, [])

  useEffect(() => {
    if (order == null) {
      sessionRef.current = null
      setPayments(null)
      return
    }
    const session: CancelSession = { orderId: order.id, open: true }
    sessionRef.current = session
    setPayments(null)
    readInto(session)
    return () => {
      session.open = false
    }
  }, [order, readInto])

  const reload = useCallback((): void => {
    const session = sessionRef.current
    if (session == null || !session.open) return
    readInto(session)
  }, [readInto])

  return { payments, reload }
}
