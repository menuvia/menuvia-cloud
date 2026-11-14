// ─────────────────────────────────────────────────────────────
// StaffSoldOutSheet — panoul „Epuizate” al personalului (mig 313, lotul B).
//
// Deschis din ecranul de bucătărie și de la ospătar: lista produselor active
// ale localului, cu butonul „Marchează epuizat / disponibil” pe fiecare.
// Marcarea trece EXCLUSIV prin RPC-ul `set_product_sold_out` (ospătarul și
// bucătarul n-au UPDATE pe products); refuzul serverului se afișează prin
// describeStaffError (în română exact `toUserMessage` de dinainte), pe rândul
// produsului. Epuizatele stau primele, cu sursa („din stoc” = un ingredient al
// rețetei e sub o porție; „manual” = de om).
// Lotul L4c: textele vin din `orders` (`so_*`; „Epuizat” = `soldOut`,
// „Reîncearcă” din `common`) — ambele ecrane care deschid foaia cer `orders`
// și `common` sus, deci foaia nu suspendă la deschidere. Erorile se țin ca
// DATE și se traduc la randare. Numele produselor sunt date, netraduse.
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { D } from '../lib/constants'
import { Modal, inp } from './_dashboard/sharedUI'
import { Button } from './ui/Button'
import {
  fetchStaffSoldOutProducts,
  setProductSoldOut,
  soldOutSourceKind,
  type SoldOutSourceKind,
  type StaffSoldOutProduct,
} from '../lib/soldOut'
import { useT } from '../i18n/useT'
import { ordersNs } from '../i18n/ns/orders'
import { commonNs } from '../i18n/ns/common'
import { describeStaffError } from '../i18n/staffErrors'
import type { OrdersTranslator } from '../lib/orders'

interface Props {
  restaurantId: string
  onClose: () => void
}

const SOURCE_KEY = {
  stock: 'so_src_stock',
  manual: 'so_src_manual',
  unblocked: 'so_src_unblocked',
} as const satisfies Record<SoldOutSourceKind, string>

function statusText(p: StaffSoldOutProduct, { t }: OrdersTranslator): string {
  const kind = soldOutSourceKind(p.is_sold_out, p.sold_out_source)
  const base = p.is_sold_out ? t('soldOut') : t('so_available')
  return kind ? t('so_statusWithSource', { status: base, source: t(SOURCE_KEY[kind]) }) : base
}

export default function StaffSoldOutSheet({ restaurantId, onClose }: Props) {
  const to = useT(ordersNs)
  const { t, tp } = to
  const tc = useT(commonNs)
  const [products, setProducts] = useState<StaffSoldOutProduct[] | null>(null)
  // Erorile ca DATE (`{ err }`: o respingere poate fi și `undefined`), traduse la randare.
  const [loadError, setLoadError] = useState<{ err: unknown } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<{ id: string; err: unknown } | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    fetchStaffSoldOutProducts(restaurantId)
      .then((rows) => {
        if (!cancelled) setProducts(rows)
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError({ err: e })
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
      setActionError({ id: p.id, err: e })
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Modal title={t('so_title')} onClose={onClose} width={560}>
      <div style={{ padding: '16px 22px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: D.t2, lineHeight: 1.5 }}>{t('so_intro')}</p>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('so_search')}
          aria-label={t('so_search')}
          style={inp}
        />
        {loadError != null && (
          <div
            role="alert"
            style={{ fontSize: 13, color: D.red, display: 'flex', gap: 12, alignItems: 'center' }}
          >
            <span style={{ flex: 1 }}>
              {describeStaffError(loadError.err, tc, { fallback: t('so_loadError') })}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              {tc.t('retry')}
            </Button>
          </div>
        )}
        {products == null && loadError == null && (
          <div role="status" style={{ fontSize: 13, color: D.t3 }}>
            {t('so_loading')}
          </div>
        )}
        {products != null && (
          <div role="status" style={{ fontSize: 12, color: D.t3 }}>
            {soldOutCount === 0 ? t('so_countNone') : tp('so_count', soldOutCount)}
          </div>
        )}
        {products != null && visible.length === 0 && (
          <div style={{ fontSize: 13, color: D.t3 }}>{t('so_noMatch')}</div>
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
                  {statusText(p, to)}
                </div>
                {actionError?.id === p.id && (
                  <div role="alert" style={{ fontSize: 12, color: D.red, marginTop: 2 }}>
                    {describeStaffError(actionError.err, tc, { fallback: t('so_updateError') })}
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
                  p.is_sold_out
                    ? t('so_markAvailableAria', { name: p.name })
                    : t('so_markSoldOutAria', { name: p.name })
                }
              >
                {p.is_sold_out ? t('so_markAvailable') : t('so_markSoldOut')}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
