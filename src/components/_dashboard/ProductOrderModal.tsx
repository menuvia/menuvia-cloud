// Ordinea produselor dintr-o categorie (lotul O5b, audit nov 2026 MENU-10).
// Niciun ecran nu scria `products.display_order` după creare, iar importul CSV
// le dădea tuturor 0 — ordinea din meniu era nedefinită și nu se putea repara.
// Fereastra arată produsele categoriei în ordinea de acum; ↑/↓ le mută local,
// „Salvează” trimite ordinea o singură dată.
import { useState } from 'react'
import { D } from '../../lib/constants'
import { Button } from '../ui/Button'
import { Modal } from './sharedUI'
import { useT } from '../../i18n/useT'
import { productsNs } from '../../i18n/ns/products'
import { commonNs } from '../../i18n/ns/common'

interface Item {
  id: string
  name: string
}

export function ProductOrderModal({
  categoryName,
  products,
  onSave,
  onClose,
}: {
  categoryName: string
  products: readonly Item[]
  /** Întoarce succesul; pe eșec fereastra rămâne deschisă. */
  onSave: (orderedIds: string[]) => Promise<boolean>
  onClose: () => void
}) {
  const { t } = useT(productsNs)
  const tc = useT(commonNs)
  const [order, setOrder] = useState<Item[]>(() => [...products])
  const [saving, setSaving] = useState(false)
  const changed = order.some((p, i) => p.id !== products[i]?.id)

  function move(i: number, delta: -1 | 1) {
    const j = i + delta
    if (j < 0 || j >= order.length) return
    setOrder((prev) => {
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  // Cât salvarea e în zbor, ordinea e înghețată și fereastra nu se închide:
  // o mutare ulterioară n-ar mai pleca, iar „Anulează” ar părea că oprește o
  // ordine care se scrie oricum (recenzia CodeRabbit pe #352).
  function closeIfIdle() {
    if (!saving) onClose()
  }

  async function save() {
    if (saving) return
    setSaving(true)
    const ok = await onSave(order.map((p) => p.id))
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal title={t('order_title', { name: categoryName })} onClose={closeIfIdle} width={440}>
      <div style={{ fontSize: '0.78rem', color: D.t2, marginBottom: 12, lineHeight: 1.5 }}>
        {t('order_hint')}
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {order.map((p, i) => (
          <li
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              background: D.s3,
              borderRadius: 8,
            }}
          >
            <span style={{ width: 22, fontSize: '0.75rem', color: D.t3 }}>{i + 1}.</span>
            <span style={{ flex: 1, fontSize: '0.85rem', color: D.t1 }}>{p.name}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('order_up', { name: p.name })}
              disabled={saving || i === 0}
              onClick={() => move(i, -1)}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('order_down', { name: p.name })}
              disabled={saving || i === order.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </Button>
          </li>
        ))}
      </ol>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="secondary" onClick={closeIfIdle} disabled={saving}>
          {tc.t('cancel')}
        </Button>
        <Button onClick={() => void save()} loading={saving} disabled={!changed}>
          {t('order_save')}
        </Button>
      </div>
    </Modal>
  )
}
