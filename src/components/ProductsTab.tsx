// src/components/ProductsTab.tsx
// ─────────────────────────────────────────────────────────────────
// Tab "Produse" în DashboardPage — vizualizarea principală pentru
// gestionarea meniului. Extras din DashboardPage.tsx pentru a fi
// lazy-loaded ca toate celelalte tab-uri grele.
//
// Helperii vizuali (Modal/btn + useToast/Toast) sunt duplicate ca
// să păstrăm extragerea self-contained. ProductModal (folosit la
// click pe "Adaugă/Editează") e deja lazy-loaded ca chunk separat
// (extragerea anterioară), deci se cascadează corect.
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, Suspense, lazy } from 'react'
import React from 'react'
import { D } from '../lib/constants'
import { fetchVatRates } from '../lib/vat'
import type { VatRate } from '../lib/vat'
import { useCategories, useProducts } from '../hooks/useData'
import type { Product } from '../hooks/useData'
import { useIsMobile } from '../hooks/useIsMobile'
import { usePlanLimits } from '../hooks/usePlanLimits'
import { QueryError } from './PageLoader'

// ProductModal e ~1200 linii — descărcat doar la deschiderea unui produs
const ProductModal = lazy(() => import('./ProductModal'))
const ProductsCsvImport = lazy(() => import('./ProductsCsvImport'))

// ── Helperi vizuale (duplicate din DashboardPage) ─────────────────
const btn = (e: React.CSSProperties = {}): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '0 18px',
  height: 44,
  borderRadius: 10,
  fontSize: '0.9rem',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  ...e,
})

function Modal({
  title,
  onClose,
  children,
  width = 520,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  width?: number
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: D.s2,
          border: `1px solid ${D.bHov}`,
          borderRadius: 18,
          width: '100%',
          maxWidth: width,
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '18px 22px',
            borderBottom: `1px solid ${D.border}`,
          }}
        >
          <span style={{ fontFamily: 'Fraunces,serif', fontSize: '1.05rem', color: D.t1 }}>
            {title}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: D.t2,
              cursor: 'pointer',
              padding: 6,
              borderRadius: 8,
              fontSize: 18,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: 22 }}>{children}</div>
      </div>
    </div>
  )
}

function useToast() {
  const [toasts, setToasts] = useState<{ id: string; msg: string; type: string }[]>([])
  const toast = useCallback((msg: string, type = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])
  return { toasts, toast }
}

function Toast({ toasts }: { toasts: { id: string; msg: string; type: string }[] }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 80,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: D.s3,
            borderLeft: `3px solid ${t.type === 'error' ? D.red : D.green}`,
            borderRadius: 10,
            padding: '12px 16px',
            fontSize: '0.875rem',
            color: D.t1,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            minWidth: 220,
            maxWidth: 320,
          }}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}

export default function ProductsTab({
  restaurantId,
  plan,
  onUpgrade,
  userId,
}: {
  restaurantId: string
  plan: string
  onUpgrade: () => void
  userId: string
}) {
  const [vatRates, setVatRates] = useState<VatRate[]>([])
  useEffect(() => {
    void fetchVatRates(restaurantId)
      .then(setVatRates)
      .catch(() => {})
  }, [restaurantId])
  const vatLabel = (g: number): string => {
    const r = vatRates.find((r) => r.vat_group === (g || 1))
    return r ? `${r.rate_percent}%` : `${g || 1}`
  }
  const { canAddProduct } = usePlanLimits(plan)
  const {
    products,
    loading,
    error,
    create,
    update,
    remove,
    toggleActive,
    toggleSoldOut,
    toggleDailySpecial,
    refetch: refetchProducts,
  } = useProducts(restaurantId)
  const { categories, error: catError, refetch: refetchCats } = useCategories(restaurantId)
  const { toasts, toast } = useToast()
  const [modal, setModal] = useState<Product | 'add' | null>(null)
  const [delId, setDelId] = useState<string | null>(null)
  const [csvImportOpen, setCsvImportOpen] = useState(false)
  const [activeCat, setActiveCat] = useState('all')
  const [search, setSearch] = useState('')
  const canAdd = canAddProduct(products.length)
  const mob = useIsMobile()

  if (error || catError)
    return (
      <QueryError
        message={error || catError || 'Eroare necunoscută'}
        onRetry={() => {
          refetchProducts()
          refetchCats()
        }}
      />
    )

  const filtered = products
    .filter((p) => activeCat === 'all' || p.category_id === activeCat)
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))

  const handleSave = async (form: Partial<Product>) => {
    if (modal === 'add') {
      const { error: e } = await create(form)
      if (e) toast(e.message, 'error')
      else {
        toast('Produs adăugat')
        setModal(null)
      }
    } else if (modal) {
      const { error: e } = await update((modal as Product).id, form)
      if (e) toast(e.message, 'error')
      else {
        toast('Actualizat')
        setModal(null)
      }
    }
  }
  const handleDelete = async () => {
    if (!delId) return
    const { error: e } = await remove(delId)
    if (e) toast(e.message, 'error')
    else toast('Șters')
    setDelId(null)
  }

  // ── Mobile: card layout. Desktop: table grid ──────────────
  const gridCols = mob ? '1fr auto' : '2fr 1fr 80px 80px 150px'

  return (
    <div>
      <Toast toasts={toasts} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: mob ? '1.25rem' : '1.5rem',
              color: D.t1,
              letterSpacing: '-0.02em',
            }}
          >
            Produse
          </h2>
          <p style={{ color: D.t3, fontSize: '0.78rem', marginTop: 3 }}>
            {products.length} total · {products.filter((p) => p.is_active).length} active
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => setCsvImportOpen(true)}
            style={btn({
              background: D.s2,
              color: D.t1,
              border: `1px solid ${D.border}`,
              height: mob ? 38 : 44,
              fontSize: mob ? '0.78rem' : '0.85rem',
              padding: mob ? '0 10px' : '0 14px',
            })}
          >
            {mob ? '📥' : '📥 Import CSV'}
          </button>
          <button
            onClick={() => {
              if (!canAdd) {
                onUpgrade()
                return
              }
              setModal('add')
            }}
            style={btn({
              background: canAdd ? D.gold : D.s3,
              color: canAdd ? '#000' : D.t2,
              border: canAdd ? 'none' : `1px solid ${D.border}`,
              height: mob ? 38 : 44,
              fontSize: mob ? '0.82rem' : '0.9rem',
            })}
          >
            {canAdd ? '+ Adaugă produs' : '🔒 Limită atinsă — Upgrade'}
          </button>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 14,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Caută..."
          style={{
            ...inp,
            flex: '1 1 160px',
            maxWidth: mob ? '100%' : 260,
            height: 40,
            fontSize: '0.85rem',
          }}
        />
        <button
          onClick={() => setActiveCat('all')}
          style={btn({
            height: 38,
            padding: '0 11px',
            fontSize: '0.78rem',
            background: activeCat === 'all' ? D.goldA : D.s2,
            color: activeCat === 'all' ? D.goldL : D.t2,
            border: `1px solid ${activeCat === 'all' ? D.gold + '44' : D.border}`,
          })}
        >
          Toate
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            style={btn({
              height: 38,
              padding: '0 11px',
              fontSize: '0.78rem',
              background: activeCat === c.id ? D.goldA : D.s2,
              color: activeCat === c.id ? D.goldL : D.t2,
              border: `1px solid ${activeCat === c.id ? D.gold + '44' : D.border}`,
            })}
          >
            {c.emoji} {c.name}
          </button>
        ))}
      </div>
      <div
        style={{
          background: D.s2,
          border: `1px solid ${D.border}`,
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        {/* Table header — hidden on mobile */}
        {!mob && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridCols,
              padding: '10px 20px',
              background: D.s3,
              borderBottom: `1px solid ${D.border}`,
            }}
          >
            {['Produs', 'Categorie', 'Preț', 'Status', 'Acțiuni'].map((h) => (
              <div
                key={h}
                style={{
                  fontSize: '0.7rem',
                  color: D.t3,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {h}
              </div>
            ))}
          </div>
        )}
        {loading ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: D.t3 }}>
            Se încarcă...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: D.t3 }}>
            {search ? 'Niciun produs găsit' : 'Adaugă primul produs!'}
          </div>
        ) : (
          filtered.map((p, i) =>
            mob ? (
              /* ── Mobile: compact card ── */
              <div
                key={p.id}
                style={{
                  padding: '12px 14px',
                  borderBottom: i < filtered.length - 1 ? `1px solid ${D.border}` : 'none',
                  opacity: p.is_sold_out ? 0.5 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: D.s4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1rem',
                      flexShrink: 0,
                    }}
                  >
                    {p.emoji}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                    >
                      <span style={{ fontSize: '0.875rem', color: D.t1, fontWeight: 500 }}>
                        {p.name}
                      </span>
                      {p.is_daily_special && (
                        <span
                          style={{
                            fontSize: '0.6rem',
                            background: D.goldA,
                            color: D.gold,
                            padding: '1px 6px',
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          ⭐
                        </span>
                      )}
                      {p.is_sold_out && (
                        <span
                          style={{
                            fontSize: '0.6rem',
                            background: D.redA,
                            color: D.red,
                            padding: '1px 6px',
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          EPUIZAT
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: D.t3 }}>
                      {categories.find((c) => c.id === p.category_id)?.name || '—'}
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      flexShrink: 0,
                      gap: 2,
                    }}
                  >
                    <div style={{ fontSize: '0.9rem', color: D.gold, fontWeight: 600 }}>
                      {p.price} lei
                    </div>
                    <div style={{ fontSize: '0.62rem', color: D.t3, fontWeight: 500 }}>
                      TVA {vatLabel(p.vat_group ?? 1)}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    onClick={async () => {
                      const { error } = await toggleActive(p.id, p.is_active)
                      if (!error) toast(p.is_active ? 'Dezactivat' : 'Activat')
                    }}
                    style={{
                      height: 30,
                      borderRadius: 7,
                      background: 'transparent',
                      border: `1px solid ${D.border}`,
                      color: p.is_active ? D.green : D.t3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: '0.7rem',
                      padding: '0 10px',
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: p.is_active ? D.green : D.t3,
                      }}
                    />
                    {p.is_active ? 'Activ' : 'Inactiv'}
                  </button>
                  <button
                    onClick={() => setModal(p)}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 7,
                      background: D.s4,
                      border: `1px solid ${D.border}`,
                      color: D.t2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    ✏
                  </button>
                  <button
                    onClick={() => setDelId(p.id)}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 7,
                      background: D.s4,
                      border: `1px solid ${D.border}`,
                      color: D.t2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            ) : (
              /* ── Desktop: table row ── */
              <div
                key={p.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: gridCols,
                  padding: '12px 20px',
                  borderBottom: i < filtered.length - 1 ? `1px solid ${D.border}` : 'none',
                  alignItems: 'center',
                  opacity: p.is_sold_out ? 0.5 : 1,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = D.s3)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: D.s4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1rem',
                      flexShrink: 0,
                    }}
                  >
                    {p.emoji}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.875rem', color: D.t1, fontWeight: 500 }}>
                        {p.name}
                      </span>
                      {p.is_daily_special && (
                        <span
                          style={{
                            fontSize: '0.6rem',
                            background: D.goldA,
                            color: D.gold,
                            padding: '1px 6px',
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          ⭐ SPECIAL
                        </span>
                      )}
                      {p.is_sold_out && (
                        <span
                          style={{
                            fontSize: '0.6rem',
                            background: D.redA,
                            color: D.red,
                            padding: '1px 6px',
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          EPUIZAT
                        </span>
                      )}
                    </div>
                    {p.description && (
                      <div
                        style={{
                          fontSize: '0.72rem',
                          color: D.t3,
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.description}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: '0.8rem', color: D.t2 }}>
                  {categories.find((c) => c.id === p.category_id)?.name || '—'}
                </div>
                <div>
                  <div style={{ fontSize: '0.875rem', color: D.t1, fontWeight: 500 }}>
                    {p.price} lei
                  </div>
                  <div style={{ fontSize: '0.65rem', color: D.t3, fontWeight: 500, marginTop: 2 }}>
                    TVA {vatLabel(p.vat_group ?? 1)}
                  </div>
                </div>
                <button
                  onClick={async () => {
                    const { error } = await toggleActive(p.id, p.is_active)
                    if (!error) toast(p.is_active ? 'Dezactivat' : 'Activat')
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      padding: '3px 10px',
                      borderRadius: 100,
                      fontSize: '0.72rem',
                      fontWeight: 500,
                      background: p.is_active ? D.greenA : D.s3,
                      color: p.is_active ? D.green : D.t3,
                      border: `1px solid ${p.is_active ? 'rgba(76,175,110,0.2)' : D.border}`,
                    }}
                  >
                    {p.is_active ? 'Activ' : 'Inactiv'}
                  </span>
                </button>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={async () => {
                      await toggleSoldOut(p.id, p.is_sold_out)
                      toast(p.is_sold_out ? 'Disponibil' : 'Epuizat')
                    }}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 7,
                      background: p.is_sold_out ? D.redA : D.s4,
                      border: `1px solid ${p.is_sold_out ? 'rgba(224,85,85,0.3)' : D.border}`,
                      color: p.is_sold_out ? D.red : D.t3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: '0.72rem',
                    }}
                  >
                    🔴
                  </button>
                  <button
                    onClick={async () => {
                      await toggleDailySpecial(p.id, p.is_daily_special)
                      toast(p.is_daily_special ? 'Normal' : 'Special!')
                    }}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 7,
                      background: p.is_daily_special ? D.goldA : D.s4,
                      border: `1px solid ${p.is_daily_special ? D.gold + '44' : D.border}`,
                      color: p.is_daily_special ? D.gold : D.t3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: '0.72rem',
                    }}
                  >
                    ⭐
                  </button>
                  <button
                    onClick={() => setModal(p)}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 7,
                      background: D.s4,
                      border: `1px solid ${D.border}`,
                      color: D.t2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    ✏
                  </button>
                  <button
                    onClick={() => setDelId(p.id)}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 7,
                      background: D.s4,
                      border: `1px solid ${D.border}`,
                      color: D.t2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            ),
          )
        )}
      </div>
      {modal && (
        <Suspense fallback={null}>
          <ProductModal
            product={modal === 'add' ? null : (modal as Product)}
            categories={categories}
            onSave={handleSave}
            onClose={() => setModal(null)}
            restaurantId={restaurantId}
            userId={userId}
          />
        </Suspense>
      )}
      {csvImportOpen && (
        <Suspense fallback={null}>
          <ProductsCsvImport
            restaurantId={restaurantId}
            existingCategories={categories.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji }))}
            onClose={() => setCsvImportOpen(false)}
            onDone={(n) => {
              setCsvImportOpen(false)
              toast(`✓ ${n} produse importate`)
              refetchProducts()
              refetchCats()
            }}
          />
        </Suspense>
      )}
      {delId && (
        <Modal title="Șterge produs" onClose={() => setDelId(null)} width={380}>
          <p style={{ color: D.t2, marginBottom: 22 }}>
            Ești sigur că vrei să ștergi{' '}
            <strong style={{ color: D.t1 }}>{products.find((p) => p.id === delId)?.name}</strong>?
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setDelId(null)}
              style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
            >
              Anulează
            </button>
            <button onClick={handleDelete} style={btn({ background: D.red, color: '#fff' })}>
              Șterge
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
