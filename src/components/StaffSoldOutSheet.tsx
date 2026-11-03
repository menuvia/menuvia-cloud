// ─────────────────────────────────────────────────────────────
// StaffSoldOutSheet — panoul „Epuizate” al personalului (mig 313, lotul B).
//
// Deschis din ecranul de bucătărie și de la ospătar: lista produselor active
// ale localului, cu butonul „Marchează epuizat / disponibil” pe fiecare.
// Marcarea trece EXCLUSIV prin RPC-ul `set_product_sold_out` (ospătarul și
// bucătarul n-au UPDATE pe products); refuzul serverului se afișează prin
// toUserMessage, pe rândul produsului. Epuizatele stau primele, cu sursa
// („din stoc” = un ingredient al rețetei e sub o porție; „manual” = de om).
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { D } from '../lib/constants'
import { Modal, inp } from './_dashboard/sharedUI'
import { Button } from './ui/Button'
import { toUserMessage } from '../lib/userMessages'
import {
  fetchStaffSoldOutProducts,
  setProductSoldOut,
  soldOutSourceLabel,
  type StaffSoldOutProduct,
} from '../lib/soldOut'

interface Props {
  restaurantId: string
  onClose: () => void
}

function statusText(p: StaffSoldOutProduct): string {
  const label = soldOutSourceLabel(p.is_sold_out, p.sold_out_source)
  const base = p.is_sold_out ? 'Epuizat' : 'Disponibil'
  return label ? `${base} · ${label}` : base
}

export default function StaffSoldOutSheet({ restaurantId, onClose }: Props) {
  const [products, setProducts] = useState<StaffSoldOutProduct[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<{ id: string; text: string } | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    fetchStaffSoldOutProducts(restaurantId)
      .then((rows) => {
        if (!cancelled) setProducts(rows)
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(toUserMessage(e, 'Nu am putut încărca produsele.'))
      })
    return () => {
      cancelled = true
    }
  }, [restaurantId, reloadKey])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!products) return []
    return q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products
  }, [products, search])

  const soldOutCount = products?.filter((p) => p.is_sold_out).length ?? 0

  async function toggle(p: StaffSoldOutProduct): Promise<void> {
    setPendingId(p.id)
    setActionError(null)
    try {
      const next = await setProductSoldOut(p.id, !p.is_sold_out)
      setProducts((prev) =>
        prev ? prev.map((x) => (x.id === p.id ? { ...x, ...next } : x)) : prev,
      )
    } catch (e) {
      setActionError({ id: p.id, text: toUserMessage(e, 'Nu s-a putut actualiza produsul.') })
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Modal title="Produse epuizate" onClose={onClose} width={560}>
      <div style={{ padding: '16px 22px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: D.t2, lineHeight: 1.5 }}>
          Un produs epuizat apare „Epuizat” pe meniu și nu mai poate fi comandat. Produsele cu
          rețetă se epuizează singure când un ingredient scade sub o porție și revin când stocul
          crește.
        </p>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Caută un produs"
          aria-label="Caută un produs"
          style={inp}
        />
        {loadError != null && (
          <div
            role="alert"
            style={{ fontSize: 13, color: D.red, display: 'flex', gap: 12, alignItems: 'center' }}
          >
            <span style={{ flex: 1 }}>{loadError}</span>
            <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              Reîncearcă
            </Button>
          </div>
        )}
        {products == null && loadError == null && (
          <div role="status" style={{ fontSize: 13, color: D.t3 }}>
            Se încarcă produsele…
          </div>
        )}
        {products != null && (
          <div role="status" style={{ fontSize: 12, color: D.t3 }}>
            {soldOutCount === 0
              ? 'Niciun produs epuizat.'
              : soldOutCount === 1
                ? '1 produs epuizat.'
                : `${soldOutCount} produse epuizate.`}
          </div>
        )}
        {products != null && visible.length === 0 && (
          <div style={{ fontSize: 13, color: D.t3 }}>Niciun produs găsit.</div>
        )}
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {visible.map((p) => (
            <li
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 10,
                border: `1px solid ${p.is_sold_out ? D.redBorder : D.border}`,
                background: p.is_sold_out ? D.redA : D.s1,
                flexWrap: 'wrap',
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 18, width: 24, textAlign: 'center' }}>
                {p.emoji ?? ''}
              </span>
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontSize: 14, color: D.t1, fontWeight: 500 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: p.is_sold_out ? D.red : D.t3 }}>
                  {statusText(p)}
                </div>
                {actionError?.id === p.id && (
                  <div role="alert" style={{ fontSize: 12, color: D.red, marginTop: 2 }}>
                    {actionError.text}
                  </div>
                )}
              </div>
              <Button
                variant={p.is_sold_out ? 'secondary' : 'danger'}
                size="sm"
                loading={pendingId === p.id}
                disabled={pendingId != null && pendingId !== p.id}
                onClick={() => {
                  void toggle(p)
                }}
                aria-label={
                  p.is_sold_out ? `Marchează disponibil: ${p.name}` : `Marchează epuizat: ${p.name}`
                }
              >
                {p.is_sold_out ? 'Marchează disponibil' : 'Marchează epuizat'}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
