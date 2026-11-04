// Ordinea produselor dintr-o categorie (lotul O5b, audit nov 2026 MENU-10).
// Niciun ecran nu scria `products.display_order` după creare, iar importul CSV
// le dădea tuturor 0 — ordinea din meniu era nedefinită și nu se putea repara.
// Fereastra arată produsele categoriei în ordinea de acum; ↑/↓ le mută local,
// „Salvează” trimite ordinea o singură dată.
import { useState } from 'react'
import { D } from '../../lib/constants'
import { Button } from '../ui/Button'
import { Modal } from './sharedUI'

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

  async function save() {
    if (saving) return
    setSaving(true)
    const ok = await onSave(order.map((p) => p.id))
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal title={`Ordinea produselor din „${categoryName}”`} onClose={onClose} width={440}>
      <div style={{ fontSize: '0.78rem', color: D.t2, marginBottom: 12, lineHeight: 1.5 }}>
        Așa apar produsele în meniul clienților și la ospătar.
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
              aria-label={`Mută „${p.name}” mai sus`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Mută „${p.name}” mai jos`}
              disabled={i === order.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </Button>
          </li>
        ))}
      </ol>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>
          Anulează
        </Button>
        <Button onClick={() => void save()} loading={saving} disabled={!changed}>
          Salvează ordinea
        </Button>
      </div>
    </Modal>
  )
}
