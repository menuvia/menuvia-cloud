import { useState, useEffect, useCallback, Suspense, lazy } from 'react'
import UpgradePrompt from '../components/UpgradePrompt'
import VatRatesEditor from '../components/VatRatesEditor'
import { fetchVatRates } from '../lib/vat'
import type { VatRate } from '../lib/vat'
import { useFeatures } from '../hooks/useFeatures'
import { useAuth } from '../contexts/AuthContext'
import { useRestaurantCtx } from '../contexts/RestaurantContext'
import { useRestaurants, useCategories, useProducts } from '../hooks/useData'
import { useIsMobile } from '../hooks/useIsMobile'
import { D, PLAN_LABELS } from '../lib/constants'
import { THEMES } from '../lib/themes'
import { usePlanLimits } from '../hooks/usePlanLimits'
import { InlineSpinner, QueryError } from '../components/PageLoader'
import { supabase } from '../lib/supabase'
import type { Restaurant, Category, Product } from '../hooks/useData'
import React from 'react'

// ── Lazy-loaded tab components ────────────────────────────────
// TablesManager pulls in jsPDF (400KB) + qrcode + html2canvas (200KB)
// AnalyticsTab pulls in recharts (550KB)
// These only download when the user actually clicks that tab.
const TablesManager = lazy(() => import('../components/TablesManager'))
const TeamManager = lazy(() => import('../components/TeamManager'))
const AnalyticsTab = lazy(() => import('../components/AnalyticsTab'))
const ModifiersTab = lazy(() => import('../components/ModifiersTab'))
const StocksTab = lazy(() => import('../components/StocksTab'))
const VatReportTab = lazy(() => import('../components/VatReportTab'))
const BridgeTab = lazy(() => import('../components/BridgeTab'))
const CashRegisterTab = lazy(() => import('../components/CashRegisterTab'))
const QuickSetupTab = lazy(() => import('../components/QuickSetupTab'))
const HappyHourTab = lazy(() => import('../components/HappyHourTab'))
const HealthScoreTab = lazy(() => import('../components/HealthScoreTab'))
// ProductModal e ~1200 linii — descărcat doar la deschiderea unui produs.
const ProductModal = lazy(() => import('../components/ProductModal'))
const InvoicesTab = lazy(() => import('../components/InvoicesTab'))
const ProductsCsvImport = lazy(() => import('../components/ProductsCsvImport'))
const ReportsTab = lazy(() => import('../components/ReportsTab'))
const FloorPlanEditor = lazy(() => import('../components/FloorPlanEditor'))
// Re-importăm type-only pentru a evita any-cast
import type { FloorLayout } from '../components/FloorPlanEditor'
const WaiterAssignments = lazy(() => import('../components/WaiterAssignments'))

// ── Shared UI ─────────────────────────────────────────────────
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
const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '11px 14px',
  fontSize: '0.9rem',
  color: D.t1,
  outline: 'none',
  height: 44,
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
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

// ── Upgrade Modal ─────────────────────────────────────────────
// Shown when user hits a plan limit — stays in dashboard context
function UpgradeModal({
  reason,
  onClose,
  onGoToPricing,
}: {
  reason: string
  onClose: () => void
  onGoToPricing: () => void
}) {
  const COMPARE = [
    { label: 'Produse', free: '15', pro: '500' },
    { label: 'Mese + QR', free: '3', pro: '30' },
    { label: 'Comenzi live', free: '—', pro: '✓' },
    { label: 'Kitchen view', free: '—', pro: '✓' },
    { label: 'Analytics', free: '—', pro: '✓' },
    { label: 'AI import meniu', free: '—', pro: '✓' },
  ]
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
          maxWidth: 420,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            background: `linear-gradient(135deg, ${D.s1}, ${D.s2})`,
            padding: '24px 24px 20px',
            borderBottom: `1px solid ${D.border}`,
            position: 'relative',
          }}
        >
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: 14,
              right: 14,
              background: 'transparent',
              border: 'none',
              color: D.t3,
              cursor: 'pointer',
              fontSize: 18,
              padding: 4,
              borderRadius: 6,
            }}
          >
            ✕
          </button>
          <div style={{ fontSize: '1.5rem', marginBottom: 10 }}>🚀</div>
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.15rem',
              color: D.t1,
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Upgrade la Pro
          </div>
          <div
            style={{
              fontSize: '0.82rem',
              color: D.t3,
              lineHeight: 1.5,
              background: D.redA,
              border: `1px solid rgba(224,85,85,.25)`,
              borderRadius: 7,
              padding: '8px 12px',
            }}
          >
            {reason}
          </div>
        </div>

        {/* Comparison table */}
        <div style={{ padding: '16px 24px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 80px 80px',
              gap: 0,
              marginBottom: 16,
            }}
          >
            <div />
            <div
              style={{
                textAlign: 'center',
                fontSize: '0.68rem',
                fontWeight: 700,
                color: D.t3,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                paddingBottom: 8,
              }}
            >
              Gratuit
            </div>
            <div
              style={{
                textAlign: 'center',
                fontSize: '0.68rem',
                fontWeight: 700,
                color: D.gold,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                paddingBottom: 8,
              }}
            >
              Pro
            </div>
            {COMPARE.map((row, i) => (
              <React.Fragment key={row.label}>
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: D.t2,
                    padding: '7px 0',
                    borderTop: i > 0 ? `1px solid ${D.border}` : 'none',
                  }}
                >
                  {row.label}
                </div>
                <div
                  style={{
                    textAlign: 'center',
                    fontSize: '0.8rem',
                    color: D.t3,
                    padding: '7px 0',
                    borderTop: i > 0 ? `1px solid ${D.border}` : 'none',
                  }}
                >
                  {row.free}
                </div>
                <div
                  style={{
                    textAlign: 'center',
                    fontSize: '0.8rem',
                    color: row.pro === '✓' ? D.green : D.t1,
                    padding: '7px 0',
                    borderTop: i > 0 ? `1px solid ${D.border}` : 'none',
                    fontWeight: 600,
                  }}
                >
                  {row.pro}
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* Price */}
          <div
            style={{
              background: D.goldA,
              border: `1px solid ${D.gold}44`,
              borderRadius: 10,
              padding: '12px 16px',
              textAlign: 'center',
              marginBottom: 14,
            }}
          >
            <span
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: '1.4rem',
                color: D.gold,
                fontWeight: 700,
              }}
            >
              249
            </span>
            <span style={{ color: D.t3, fontSize: '0.8rem', marginLeft: 4 }}>lei/lună</span>
            <div style={{ fontSize: '0.72rem', color: D.goldL, marginTop: 3 }}>
              Primele 30 de zile gratuite · Anulezi oricând
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={onGoToPricing}
              style={{
                width: '100%',
                background: D.gold,
                color: '#000',
                border: 'none',
                borderRadius: 9,
                padding: '13px 0',
                fontFamily: 'DM Sans,sans-serif',
                fontSize: '0.9rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Upgrade la Pro →
            </button>
            <button
              onClick={onClose}
              style={{
                width: '100%',
                background: 'transparent',
                color: D.t3,
                border: `1px solid ${D.border}`,
                borderRadius: 9,
                padding: '10px 0',
                fontFamily: 'DM Sans,sans-serif',
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              Continuă cu planul gratuit
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Upgrade Banner (sidebar bottom) ───────────────────────────
function UpgradeBanner({
  plan,
  productCount,
  maxProducts,
  onUpgrade,
}: {
  plan: string
  productCount: number
  maxProducts: number
  onUpgrade: () => void
}) {
  if (plan !== 'free') return null
  const pct = Math.min(100, Math.round((productCount / Math.max(1, maxProducts)) * 100))
  const isNearLimit = pct >= 70
  const isAtLimit = pct >= 100

  return (
    <div
      style={{
        margin: '8px 8px 4px',
        background: D.s2,
        border: `1px solid ${isAtLimit ? D.red + '44' : isNearLimit ? D.gold + '44' : D.border}`,
        borderRadius: 10,
        padding: '12px 14px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 7,
        }}
      >
        <span
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            color: isAtLimit ? D.red : isNearLimit ? D.gold : D.t3,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Plan Gratuit
        </span>
        <span style={{ fontSize: '0.7rem', color: isAtLimit ? D.red : D.t3 }}>
          {productCount}/{maxProducts}
        </span>
      </div>
      {/* Progress bar */}
      <div
        style={{
          height: 3,
          background: D.s3,
          borderRadius: 2,
          overflow: 'hidden',
          marginBottom: 10,
        }}
      >
        <div
          style={{
            height: '100%',
            borderRadius: 2,
            background: isAtLimit ? D.red : isNearLimit ? D.amber : D.t3,
            width: `${pct}%`,
            transition: 'width .4s',
          }}
        />
      </div>
      <button
        onClick={onUpgrade}
        style={{
          width: '100%',
          background: D.gold,
          color: '#000',
          border: 'none',
          borderRadius: 7,
          padding: '8px 0',
          fontFamily: 'DM Sans,sans-serif',
          fontSize: '0.78rem',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Upgrade la Pro →
      </button>
    </div>
  )
}

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

function Inp({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={inp}
      onFocus={(e) => (e.target.style.borderColor = D.gold)}
      onBlur={(e) => (e.target.style.borderColor = D.border)}
    />
  )
}
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        background: value ? D.gold : D.s4,
        border: `1px solid ${value ? D.gold : D.border}`,
        position: 'relative',
        transition: 'all .2s',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 3,
          left: value ? 20 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left .2s',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
        }}
      />
    </button>
  )
}

// ── Category Modal ────────────────────────────────────────────
function CategoryModal({
  category,
  onSave,
  onClose,
}: {
  category: Category | null
  onSave: (f: Partial<Category>) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<Partial<Category>>(category || { name: '', emoji: '🍽️' })
  return (
    <Modal
      title={category ? 'Editează categorie' : 'Adaugă categorie'}
      onClose={onClose}
      width={400}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
            Nume *
          </label>
          <Inp
            value={form.name || ''}
            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
            placeholder="Feluri principale"
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
            Emoji
          </label>
          <Inp
            value={form.emoji || ''}
            onChange={(v) => setForm((f) => ({ ...f, emoji: v }))}
            placeholder="🍽️"
          />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
          <button
            onClick={onClose}
            style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
          >
            Anulează
          </button>
          <button onClick={() => onSave(form)} style={btn({ background: D.gold, color: '#000' })}>
            Salvează
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Products Tab ──────────────────────────────────────────────
function ProductsTab({
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

// ── Categories Tab ────────────────────────────────────────────
function CategoriesTab({ restaurantId }: { restaurantId: string }) {
  const {
    categories,
    loading,
    error,
    create,
    update,
    remove,
    reorder,
    refetch: refetchCats,
  } = useCategories(restaurantId)
  const { products, error: prodError, refetch: refetchProds } = useProducts(restaurantId)
  const { toasts, toast } = useToast()
  const [modal, setModal] = useState<Category | 'add' | null>(null)
  const [delId, setDelId] = useState<string | null>(null)

  if (error || prodError)
    return (
      <QueryError
        message={error || prodError || 'Eroare necunoscută'}
        onRetry={() => {
          refetchCats()
          refetchProds()
        }}
      />
    )

  const handleSave = async (form: Partial<Category>) => {
    if (modal === 'add') {
      const { error: e } = await create(form)
      if (e) toast(e.message, 'error')
      else {
        toast('Categorie adăugată')
        setModal(null)
      }
    } else if (modal) {
      const { error: e } = await update((modal as Category).id, form)
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
    if (e) toast('Nu poți șterge o categorie cu produse', 'error')
    else toast('Ștearsă')
    setDelId(null)
  }

  return (
    <div>
      <Toast toasts={toasts} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.5rem',
              color: D.t1,
              letterSpacing: '-0.02em',
            }}
          >
            Categorii
          </h2>
          <p style={{ color: D.t3, fontSize: '0.78rem', marginTop: 3 }}>
            {categories.length} categorii
          </p>
        </div>
        <button
          onClick={() => setModal('add')}
          style={btn({
            background: D.gold,
            color: '#000',
            height: 40,
            padding: '0 16px',
            fontSize: '0.85rem',
          })}
        >
          + Adaugă categorie
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: D.t3 }}>Se încarcă...</div>
        ) : categories.length === 0 ? (
          <div
            style={{
              padding: '40px',
              textAlign: 'center',
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              color: D.t3,
            }}
          >
            Nicio categorie. Adaugă prima!
          </div>
        ) : (
          categories.map((cat) => {
            const count = products.filter((p) => p.category_id === cat.id).length
            return (
              <div
                key={cat.id}
                style={{
                  background: D.s2,
                  border: `1px solid ${D.border}`,
                  borderRadius: 12,
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: D.s3,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.3rem',
                    flexShrink: 0,
                  }}
                >
                  {cat.emoji}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 500, color: D.t1 }}>{cat.name}</div>
                  <div style={{ fontSize: '0.75rem', color: D.t3, marginTop: 2 }}>
                    {count} produs{count !== 1 ? 'e' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => {
                      const idx = categories.indexOf(cat)
                      if (idx > 0) {
                        const reordered = [...categories]
                        ;[reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]]
                        reorder(reordered)
                      }
                    }}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      background: D.s3,
                      border: `1px solid ${D.border}`,
                      color: D.t2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => {
                      const idx = categories.indexOf(cat)
                      if (idx < categories.length - 1) {
                        const reordered = [...categories]
                        ;[reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]]
                        reorder(reordered)
                      }
                    }}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      background: D.s3,
                      border: `1px solid ${D.border}`,
                      color: D.t2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => setModal(cat)}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      background: D.s3,
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
                    onClick={() => setDelId(cat.id)}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      background: D.redA,
                      border: `1px solid rgba(224,85,85,0.2)`,
                      color: D.red,
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
            )
          })
        )}
      </div>
      {modal && (
        <CategoryModal
          category={modal === 'add' ? null : (modal as Category)}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
      {delId && (
        <Modal title="Șterge categorie" onClose={() => setDelId(null)} width={380}>
          <p style={{ color: D.t2, marginBottom: 22 }}>
            Produsele din această categorie rămân fără categorie.
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

// ── Settings Tab ──────────────────────────────────────────────
function SettingsTab({
  restaurant,
  onUpdate,
  plan,
  onSignOut,
}: {
  restaurant: Restaurant
  onUpdate: (id: string, f: Partial<Restaurant>) => Promise<{ error: Error | null }>
  plan: string
  onSignOut: () => void
}) {
  const [form, setForm] = useState({ ...restaurant })
  const [saving, setSaving] = useState(false)
  const { toasts, toast } = useToast()
  const upd = (k: keyof Restaurant, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  const COLORS = ['#C8963C', '#E05555', '#4CAF6E', '#5B8DEF', '#9B72CF', '#E07B45', '#3ABFBF']

  const handleSave = async () => {
    setSaving(true)
    const { error } = await onUpdate(restaurant.id, form)
    if (error) toast('Eroare: ' + error.message, 'error')
    else toast('Salvat')
    setSaving(false)
  }

  return (
    <div>
      <Toast toasts={toasts} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 22,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.5rem',
              color: D.t1,
              letterSpacing: '-0.02em',
            }}
          >
            Setări
          </h2>
          <p style={{ color: D.t3, fontSize: '0.78rem', marginTop: 3 }}>
            Informații afișate pe meniul public
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.7 : 1 })}
        >
          {saving ? 'Se salvează...' : 'Salvează'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div
          style={{
            background: D.s2,
            border: `1px solid ${D.border}`,
            borderRadius: 14,
            padding: 22,
          }}
        >
          <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 16 }}>
            Informații principale
          </div>
          {(
            [
              ['name', 'Nume restaurant *', 'La Bella Trattoria'],
              ['tagline', 'Tagline', 'Bucătărie autentică'],
              ['city', 'Oraș', 'Sibiu'],
              ['phone', 'Telefon', '07xx xxx xxx'],
              ['hours', 'Program', 'Lun–Dum: 12:00–23:00'],
              ['description', 'Descriere', 'Despre restaurant...'],
            ] as [keyof Restaurant, string, string][]
          ).map(([k, label, ph]) => (
            <div key={k} style={{ marginBottom: 13 }}>
              <label
                style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}
              >
                {label}
              </label>
              <Inp value={String(form[k] || '')} onChange={(v) => upd(k, v)} placeholder={ph} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: 22,
            }}
          >
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 14 }}>
              URL meniu
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: D.s3,
                border: `1px solid ${D.border}`,
                borderRadius: 9,
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  padding: '0 10px',
                  fontSize: '0.75rem',
                  color: D.t3,
                  borderRight: `1px solid ${D.border}`,
                  height: 44,
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                menuvia.ro/m/
              </span>
              <Inp
                value={form.slug || ''}
                onChange={(v) => upd('slug', slugify(v))}
                placeholder="slug-url"
              />
            </div>
          </div>
          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: 22,
            }}
          >
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 14 }}>
              Culoare accent
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => upd('primary_color', c)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: c,
                    border: `3px solid ${form.primary_color === c ? '#fff' : 'transparent'}`,
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          </div>
          {/* Theme picker — 8 preset themes for QR menu */}
          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: 22,
            }}
          >
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 6 }}>
              Tema meniului QR
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t3, marginBottom: 14, lineHeight: 1.5 }}>
              Alege stilul vizual pentru meniul tău. Se aplică instant pe pagina pe care o văd
              clienții.
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
                gap: 8,
              }}
            >
              {THEMES.map((t) => {
                const isSelected = (form.theme_settings?.preset_id ?? 'cafe') === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      upd('theme_settings', {
                        preset_id: t.id,
                        accent_override: form.theme_settings?.accent_override ?? null,
                      })
                    }
                    style={{
                      padding: '12px 10px',
                      border: `2px solid ${isSelected ? D.gold : D.border}`,
                      background: isSelected ? D.goldA : D.s3,
                      borderRadius: 10,
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: '1.1rem' }}>{t.emoji}</span>
                      <span
                        style={{
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          color: isSelected ? D.gold : D.t1,
                        }}
                      >
                        {t.name}
                      </span>
                    </div>
                    {/* Color preview */}
                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 3,
                          background: t.colors.bg,
                          border: `1px solid ${D.border}`,
                        }}
                        title="Background"
                      />
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 3,
                          background: t.colors.accent,
                        }}
                        title="Accent"
                      />
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 3,
                          background: t.colors.surface,
                          border: `1px solid ${D.border}`,
                        }}
                        title="Surface"
                      />
                    </div>
                    <div
                      style={{ fontSize: '0.65rem', color: D.t3, lineHeight: 1.3, marginTop: 4 }}
                    >
                      {t.description}
                    </div>
                  </button>
                )
              })}
            </div>
            <div
              style={{
                fontSize: '0.7rem',
                color: D.t3,
                marginTop: 12,
                padding: '8px 10px',
                background: D.s3,
                borderRadius: 7,
                lineHeight: 1.5,
              }}
            >
              💡 După salvare, clienții vor vedea noua temă instant la următoarea încărcare a
              meniului.
            </div>
          </div>

          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: 22,
            }}
          >
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 12 }}>
              Plan curent
            </div>
            <span
              style={{
                padding: '4px 10px',
                background: D.goldA,
                border: `1px solid ${D.gold}44`,
                borderRadius: 6,
                fontSize: '0.78rem',
                color: D.goldL,
                fontWeight: 600,
              }}
            >
              {PLAN_LABELS[plan] || plan}
            </span>
          </div>

          {/* VAT rates configuration */}
          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: 22,
            }}
          >
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 6 }}>
              🧾 Cote TVA
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t3, lineHeight: 1.5, marginBottom: 14 }}>
              Cele 4 grupe de TVA folosite în restaurantul tău. Modifică procentul când statul
              schimbă cotele — produsele își păstrează automat grupa.
            </div>
            <VatRatesEditor restaurantId={restaurant.id} />
          </div>

          {/* Google Review CTA settings */}
          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: 22,
            }}
          >
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1, marginBottom: 6 }}>
              ⭐ Google Reviews (recenzii automate)
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t3, lineHeight: 1.5, marginBottom: 12 }}>
              După ce clientul finalizează plata și dă feedback pozitiv (rating ≥ 4), îi vom afișa
              un buton "Scrie o recenzie pe Google" care îl duce direct la pagina ta de business.
              Cel mai rapid mod să crești numărul de recenzii.
            </div>

            <label style={{ display: 'block', fontSize: '0.74rem', color: D.t2, marginBottom: 5 }}>
              Google Place ID
            </label>
            <Inp
              value={form.google_place_id ?? ''}
              onChange={(v) => upd('google_place_id', v.trim() || null)}
              placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
            />
            <div style={{ fontSize: '0.7rem', color: D.t3, marginTop: 6, lineHeight: 1.5 }}>
              Găsești Place ID-ul aici:{' '}
              <a
                href="https://developers.google.com/maps/documentation/places/web-service/place-id"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: D.gold }}
              >
                Place ID Finder
              </a>
              . Caută numele localului tău, copiază ID-ul (începe cu "ChIJ...").
            </div>

            {form.google_place_id && (
              <div
                style={{
                  marginTop: 14,
                  padding: '10px 14px',
                  background: D.s3,
                  borderRadius: 8,
                  fontSize: '0.72rem',
                  color: D.t2,
                }}
              >
                <div style={{ color: '#4CAF6E', marginBottom: 4 }}>✓ Configurat</div>
                <div>
                  URL preview:{' '}
                  <a
                    href={`https://search.google.com/local/writereview?placeid=${form.google_place_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: D.gold, wordBreak: 'break-all' }}
                  >
                    search.google.com/local/writereview?placeid={form.google_place_id.slice(0, 12)}
                    ...
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Checkout suggestion settings */}
          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: 22,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1 }}>
                Sugestii la coș
              </div>
              <Toggle
                value={form.checkout_suggestion_settings?.enabled ?? false}
                onChange={(v) =>
                  upd('checkout_suggestion_settings', {
                    ...(form.checkout_suggestion_settings ?? {
                      categories: [],
                      max_suggestions: 2,
                      message: '🍰 Înainte să trimiți... ai vrea ceva în plus?',
                    }),
                    enabled: v,
                  })
                }
              />
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t3, lineHeight: 1.5, marginBottom: 8 }}>
              Sugerează automat produse din categorii lipsă din coș (ex: client a luat fel principal
              dar n-a luat desert).
            </div>
            {form.checkout_suggestion_settings?.enabled && (
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.74rem',
                    color: D.t2,
                    marginBottom: 5,
                    marginTop: 8,
                  }}
                >
                  Mesaj afișat
                </label>
                <Inp
                  value={form.checkout_suggestion_settings?.message ?? ''}
                  onChange={(v) =>
                    upd('checkout_suggestion_settings', {
                      ...(form.checkout_suggestion_settings ?? {
                        enabled: true,
                        categories: [],
                        max_suggestions: 2,
                        message: '',
                      }),
                      message: v,
                    })
                  }
                  placeholder="🍰 Înainte să trimiți... ai vrea ceva în plus?"
                />
              </div>
            )}
          </div>

          {/* Pickup ordering settings */}
          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: 22,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1 }}>
                📦 Comenzi pentru ridicare (click-and-collect)
              </div>
              <Toggle
                value={form.pickup_settings?.enabled ?? false}
                onChange={(v) =>
                  upd('pickup_settings', {
                    ...(form.pickup_settings ?? {
                      min_lead_time_minutes: 20,
                      slot_interval_minutes: 15,
                      open_hours: { start: '09:00', end: '21:00' },
                      instructions: null,
                    }),
                    enabled: v,
                  })
                }
              />
            </div>
            <div style={{ fontSize: '0.72rem', color: D.t3, lineHeight: 1.5, marginBottom: 8 }}>
              Activează pagina ta publică{' '}
              <span style={{ color: D.gold }}>menuvia.ro/r/{form.slug || 'slug'}</span>. Clienții
              pot comanda fără să scaneze QR și ridică direct de la restaurant. Plata cash la
              ridicare.
            </div>
            {form.pickup_settings?.enabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.74rem',
                        color: D.t2,
                        marginBottom: 5,
                      }}
                    >
                      Pregătire minim (min)
                    </label>
                    <Inp
                      value={String(form.pickup_settings?.min_lead_time_minutes ?? 20)}
                      onChange={(v) => {
                        const n = parseInt(v)
                        if (!isNaN(n) && n >= 5 && n <= 240)
                          upd('pickup_settings', {
                            ...(form.pickup_settings ?? {
                              enabled: true,
                              slot_interval_minutes: 15,
                              open_hours: { start: '09:00', end: '21:00' },
                              instructions: null,
                            }),
                            min_lead_time_minutes: n,
                          })
                      }}
                      type="number"
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.74rem',
                        color: D.t2,
                        marginBottom: 5,
                      }}
                    >
                      Interval slot (min)
                    </label>
                    <Inp
                      value={String(form.pickup_settings?.slot_interval_minutes ?? 15)}
                      onChange={(v) => {
                        const n = parseInt(v)
                        if (!isNaN(n) && n >= 5 && n <= 60)
                          upd('pickup_settings', {
                            ...(form.pickup_settings ?? {
                              enabled: true,
                              min_lead_time_minutes: 20,
                              open_hours: { start: '09:00', end: '21:00' },
                              instructions: null,
                            }),
                            slot_interval_minutes: n,
                          })
                      }}
                      type="number"
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.74rem',
                        color: D.t2,
                        marginBottom: 5,
                      }}
                    >
                      Deschidere
                    </label>
                    <Inp
                      value={form.pickup_settings?.open_hours?.start ?? '09:00'}
                      onChange={(v) =>
                        upd('pickup_settings', {
                          ...(form.pickup_settings ?? {
                            enabled: true,
                            min_lead_time_minutes: 20,
                            slot_interval_minutes: 15,
                            open_hours: { start: '09:00', end: '21:00' },
                            instructions: null,
                          }),
                          open_hours: {
                            start: v,
                            end: form.pickup_settings?.open_hours?.end ?? '21:00',
                          },
                        })
                      }
                      placeholder="09:00"
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.74rem',
                        color: D.t2,
                        marginBottom: 5,
                      }}
                    >
                      Închidere
                    </label>
                    <Inp
                      value={form.pickup_settings?.open_hours?.end ?? '21:00'}
                      onChange={(v) =>
                        upd('pickup_settings', {
                          ...(form.pickup_settings ?? {
                            enabled: true,
                            min_lead_time_minutes: 20,
                            slot_interval_minutes: 15,
                            open_hours: { start: '09:00', end: '21:00' },
                            instructions: null,
                          }),
                          open_hours: {
                            start: form.pickup_settings?.open_hours?.start ?? '09:00',
                            end: v,
                          },
                        })
                      }
                      placeholder="21:00"
                    />
                  </div>
                </div>
                <div>
                  <label
                    style={{ display: 'block', fontSize: '0.74rem', color: D.t2, marginBottom: 5 }}
                  >
                    Instrucțiuni client (opțional)
                  </label>
                  <Inp
                    value={form.pickup_settings?.instructions ?? ''}
                    onChange={(v) =>
                      upd('pickup_settings', {
                        ...(form.pickup_settings ?? {
                          enabled: true,
                          min_lead_time_minutes: 20,
                          slot_interval_minutes: 15,
                          open_hours: { start: '09:00', end: '21:00' },
                          instructions: null,
                        }),
                        instructions: v.length > 0 ? v : null,
                      })
                    }
                    placeholder="Ex: Sună la sosire, intrarea pe lateral"
                  />
                </div>
                <div
                  style={{
                    fontSize: '0.7rem',
                    color: D.t3,
                    padding: '8px 10px',
                    background: D.s3,
                    borderRadius: 7,
                    lineHeight: 1.5,
                  }}
                >
                  💡 Comenzile pickup apar în KitchenPage cu badge{' '}
                  <strong style={{ color: D.gold }}>📦 Pickup</strong>. Numele clientului și ora
                  ridicării sunt vizibile.
                </div>
              </div>
            )}
          </div>

          <button
            onClick={onSignOut}
            style={btn({
              background: D.s2,
              color: D.t2,
              border: `1px solid ${D.border}`,
              width: '100%',
              justifyContent: 'center',
            })}
          >
            Deconectare
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────
type Tab =
  | 'products'
  | 'categories'
  | 'modificatori'
  | 'mese'
  | 'analytics'
  | 'echipa'
  | 'raport'
  | 'arhitectura'
  | 'ture'
  | 'gestiune'
  | 'tva'
  | 'casa-tura'
  | 'casa-marcat'
  | 'setup'
  | 'happy-hour'
  | 'health'
  | 'invoices'
  | 'settings'

const NAV: { id: Tab; label: string; icon: string; adminOnly?: boolean }[] = [
  { id: 'products', label: 'Produse', icon: '☰' },
  { id: 'setup', label: 'Setup Asistent', icon: '🪄', adminOnly: true },
  { id: 'categories', label: 'Categorii', icon: '📁' },
  { id: 'modificatori', label: 'Modificatori', icon: '⚙' },
  { id: 'mese', label: 'Mese', icon: '🪑' },
  { id: 'health', label: 'Sănătate', icon: '🩺', adminOnly: true },
  { id: 'analytics', label: 'Analytics', icon: '📊', adminOnly: true },
  { id: 'raport', label: 'Rapoarte', icon: '📋', adminOnly: true },
  { id: 'arhitectura', label: 'Hartă', icon: '🗺' },
  { id: 'echipa', label: 'Echipă', icon: '👥', adminOnly: true },
  { id: 'ture', label: 'Ture', icon: '👷', adminOnly: true },
  { id: 'gestiune', label: 'Gestiune', icon: '📦', adminOnly: true },
  { id: 'tva', label: 'Raport TVA', icon: '🧾', adminOnly: true },
  { id: 'casa-tura', label: 'Casă & Tură', icon: '💰', adminOnly: true },
  { id: 'casa-marcat', label: 'Casă marcat', icon: '📟', adminOnly: true },
  { id: 'invoices', label: 'Facturi', icon: '📄', adminOnly: true },
  { id: 'happy-hour', label: 'Happy Hour', icon: '🎉', adminOnly: true },
  { id: 'settings', label: 'Setări', icon: '⚙', adminOnly: true },
]

export default function DashboardPage({
  onViewMenu,
  onPricing,
  onSignOut,
}: {
  onViewMenu: (slug: string) => void
  onPricing: () => void
  onSignOut: () => Promise<void>
}) {
  const { profile, user } = useAuth()
  const { activeRole } = useRestaurantCtx()
  const { restaurants, loading: rLoading, update } = useRestaurants()
  const [tab, setTab] = useState<Tab>('products')

  // Audit fix #2: filter tab-uri admin-only pentru waiter/kitchen
  const isAdminRole = activeRole === 'owner' || activeRole === 'manager'
  const visibleNav = NAV.filter((n) => !n.adminOnly || isAdminRole)

  // Dacă user-ul a salvat un tab admin-only și apoi a fost demovat la waiter,
  // forțăm înapoi la Produse
  useEffect(() => {
    const current = NAV.find((n) => n.id === tab)
    if (current?.adminOnly && !isAdminRole) {
      setTab('products')
    }
  }, [activeRole, tab, isAdminRole])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null)
  const plan = profile?.plan || 'free'
  const isMobile = useIsMobile()

  // Sync selectedId when restaurants load: keep selection if still valid, else pick first
  const restaurant = restaurants.find((r) => r.id === selectedId) ?? restaurants[0] ?? null
  const features = useFeatures(restaurant?.id ?? null)

  // FIX: UpgradeBanner afișa mereu 0/15 (hardcoded). Acum citește count-ul real.
  const { limits: planLimits } = usePlanLimits(plan)
  const [productCount, setProductCount] = useState(0)
  React.useEffect(() => {
    if (!restaurant) {
      setProductCount(0)
      return
    }
    let cancelled = false
    void supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurant.id)
      .then(({ count }) => {
        if (!cancelled) setProductCount(count ?? 0)
      })
    return () => {
      cancelled = true
    }
  }, [restaurant?.id, tab]) // eslint-disable-line react-hooks/exhaustive-deps

  if (rLoading)
    return (
      <div
        style={{
          minHeight: '100vh',
          background: D.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ textAlign: 'center', color: D.t2 }}>Se încarcă...</div>
      </div>
    )

  const Sidebar = () => (
    <>
      <div
        style={{
          padding: '18px 16px',
          borderBottom: `1px solid ${D.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div
            style={{
              width: 30,
              height: 30,
              background: D.gold,
              borderRadius: 7,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: 14,
            }}
          >
            ▦
          </div>
          <span
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.1rem',
              color: D.t1,
              letterSpacing: '-0.02em',
            }}
          >
            Menuvia
          </span>
        </div>
        <button
          onClick={() => setSidebarOpen(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: D.t2,
            cursor: 'pointer',
            padding: 6,
            display: 'flex',
            fontSize: 18,
          }}
        >
          ✕
        </button>
      </div>
      {restaurant && (
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${D.border}` }}>
          <div
            style={{
              fontSize: '0.68rem',
              color: D.t3,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 4,
            }}
          >
            Restaurant
          </div>
          {/* Selector: visible only when user manages multiple restaurants */}
          {restaurants.length > 1 ? (
            <select
              value={restaurant.id}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{
                width: '100%',
                background: D.s3,
                border: `1px solid ${D.border}`,
                borderRadius: 7,
                color: D.t1,
                padding: '6px 8px',
                fontSize: '0.85rem',
                fontFamily: 'DM Sans,sans-serif',
                cursor: 'pointer',
                outline: 'none',
                marginBottom: 4,
              }}
            >
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          ) : (
            <div style={{ fontSize: '0.875rem', color: D.t1, fontWeight: 500 }}>
              {restaurant.name}
            </div>
          )}
          <div style={{ fontSize: '0.72rem', color: D.t3 }}>{restaurant.city}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: D.green }} />
            <span style={{ fontSize: '0.68rem', color: D.green }}>Activ</span>
            <span style={{ fontSize: '0.68rem', color: D.t3, marginLeft: 4 }}>
              · {PLAN_LABELS[plan] || plan}
            </span>
          </div>
        </div>
      )}
      <nav style={{ padding: '10px 8px', flex: 1 }}>
        {visibleNav.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setTab(item.id)
              setSidebarOpen(false)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '11px 12px',
              borderRadius: 9,
              border: 'none',
              cursor: 'pointer',
              background: tab === item.id ? D.goldA : 'transparent',
              color: tab === item.id ? D.goldL : D.t2,
              marginBottom: 2,
              fontSize: '0.875rem',
              fontWeight: tab === item.id ? 500 : 400,
              fontFamily: 'DM Sans,sans-serif',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => tab !== item.id && (e.currentTarget.style.background = D.s2)}
            onMouseLeave={(e) =>
              tab !== item.id && (e.currentTarget.style.background = 'transparent')
            }
          >
            <span style={{ fontSize: '1rem' }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <UpgradeBanner
        plan={plan}
        productCount={productCount}
        maxProducts={planLimits.max_products}
        onUpgrade={() =>
          setUpgradeReason(
            `Ai atins limita de produse pe planul Gratuit (${planLimits.max_products} produse).`,
          )
        }
      />
      <div style={{ padding: '10px 8px', borderBottom: `1px solid ${D.border}` }}>
        <button
          onClick={() => restaurant && onViewMenu(restaurant.slug)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '10px 12px',
            borderRadius: 9,
            border: `1px solid ${D.border}`,
            cursor: 'pointer',
            background: 'transparent',
            color: D.t2,
            fontSize: '0.85rem',
            fontFamily: 'DM Sans,sans-serif',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = D.t1
            e.currentTarget.style.borderColor = D.bHov
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = D.t2
            e.currentTarget.style.borderColor = D.border
          }}
        >
          👁 Previzualizează meniu
        </button>
      </div>
    </>
  )

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        background: D.bg,
        overflow: 'hidden',
        fontFamily: 'DM Sans,sans-serif',
      }}
    >
      {/* Desktop sidebar — hidden on mobile, mobile uses overlay + hamburger */}
      <div
        style={{
          width: 220,
          background: D.s1,
          borderRight: `1px solid ${D.border}`,
          display: isMobile ? 'none' : 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        <Sidebar />
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <>
          <div
            onClick={() => setSidebarOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200 }}
          />
          <div
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              bottom: 0,
              width: 260,
              background: D.s1,
              borderRight: `1px solid ${D.border}`,
              zIndex: 201,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'auto',
            }}
          >
            <Sidebar />
          </div>
        </>
      )}

      {/* Main */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Mobile top bar — hidden on desktop */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${D.border}`,
            background: D.s1,
            display: isMobile ? 'flex' : 'none',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            style={{
              background: 'transparent',
              border: 'none',
              color: D.t1,
              cursor: 'pointer',
              display: 'flex',
              padding: 6,
              borderRadius: 8,
              fontSize: 20,
            }}
          >
            ☰
          </button>
          <div style={{ fontFamily: 'Fraunces,serif', fontSize: '1.1rem', color: D.t1 }}>
            Menuvia
          </div>
          <button
            onClick={() => restaurant && onViewMenu(restaurant.slug)}
            style={{
              background: 'transparent',
              border: 'none',
              color: D.t2,
              cursor: 'pointer',
              display: 'flex',
              padding: 6,
              borderRadius: 8,
              fontSize: 18,
            }}
          >
            👁
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '16px 12px' : '28px 32px' }}>
          {!restaurant ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
              }}
            >
              <div style={{ textAlign: 'center', color: D.t2 }}>
                Eroare la încărcarea restaurantului.
              </div>
            </div>
          ) : (
            <>
              {tab === 'products' && (
                <ProductsTab
                  restaurantId={restaurant.id}
                  plan={plan}
                  onUpgrade={() =>
                    setUpgradeReason('Ai atins limita de produse pe planul Gratuit (15 produse).')
                  }
                  userId={user?.id || ''}
                />
              )}
              {tab === 'categories' && <CategoriesTab restaurantId={restaurant.id} />}
              {tab === 'modificatori' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă modificatorii..." />}>
                  <ModifiersTab restaurantId={restaurant.id} />
                </Suspense>
              )}
              {tab === 'mese' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă mesele…" />}>
                  <TablesManager restaurant={restaurant} />
                </Suspense>
              )}
              {tab === 'analytics' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă graficele…" />}>
                  <AnalyticsTab restaurantId={restaurant.id} plan={plan} onUpgrade={onPricing} />
                </Suspense>
              )}
              {tab === 'raport' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă raportul..." />}>
                  <ReportsTab restaurantId={restaurant.id} />
                </Suspense>
              )}
              {tab === 'arhitectura' && (
                <Suspense fallback={<InlineSpinner label="Se incarca harta..." />}>
                  <FloorPlanEditor
                    key={restaurant.id}
                    restaurantId={restaurant.id}
                    initialLayout={
                      (restaurant.floor_layout as unknown as FloorLayout | null) ?? null
                    }
                  />
                </Suspense>
              )}
              {tab === 'echipa' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă echipa…" />}>
                  <TeamManager restaurant={restaurant} currentUserId={user?.id || ''} />
                </Suspense>
              )}
              {tab === 'ture' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă alocările…" />}>
                  <WaiterAssignments restaurantId={restaurant.id} />
                </Suspense>
              )}
              {tab === 'gestiune' &&
                (features.has('stocks') ? (
                  <Suspense fallback={<InlineSpinner label="Se încarcă gestiunea..." />}>
                    <StocksTab restaurantId={restaurant.id} />
                  </Suspense>
                ) : (
                  <UpgradePrompt
                    currentPlan={plan}
                    featureName="Modul Gestiune"
                    emoji="📦"
                    description="Urmărește stocurile, definește rețete, calculează profitabilitatea per produs. Disponibil din planul Growth."
                    onUpgrade={onPricing}
                  />
                ))}
              {tab === 'tva' &&
                (features.has('reports_vat') ? (
                  <Suspense fallback={<InlineSpinner label="Se încarcă raportul TVA..." />}>
                    <VatReportTab restaurantId={restaurant.id} />
                  </Suspense>
                ) : (
                  <UpgradePrompt
                    currentPlan={plan}
                    featureName="Raport TVA"
                    emoji="🧾"
                    description="Raport TVA grupat pe cote și zile, export CSV pentru contabil. Disponibil din planul Growth."
                    onUpgrade={onPricing}
                  />
                ))}
              {tab === 'casa-tura' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă..." />}>
                  <CashRegisterTab restaurantId={restaurant.id} />
                </Suspense>
              )}
              {tab === 'setup' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă..." />}>
                  <QuickSetupTab restaurantId={restaurant.id} restaurantName={restaurant.name} />
                </Suspense>
              )}
              {tab === 'happy-hour' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă..." />}>
                  <HappyHourTab restaurantId={restaurant.id} />
                </Suspense>
              )}
              {tab === 'health' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă scorul..." />}>
                  <HealthScoreTab />
                </Suspense>
              )}
              {tab === 'invoices' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă facturile..." />}>
                  <InvoicesTab restaurantId={restaurant.id} restaurantName={restaurant.name} />
                </Suspense>
              )}
              {tab === 'casa-marcat' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă..." />}>
                  <BridgeTab restaurantId={restaurant.id} />
                </Suspense>
              )}
              {tab === 'settings' && (
                <SettingsTab
                  restaurant={restaurant}
                  onUpdate={update}
                  plan={plan}
                  onSignOut={onSignOut}
                />
              )}
            </>
          )}
        </div>

        {upgradeReason && (
          <UpgradeModal
            reason={upgradeReason}
            onClose={() => setUpgradeReason(null)}
            onGoToPricing={() => {
              setUpgradeReason(null)
              onPricing()
            }}
          />
        )}

        {/* Mobile bottom nav — hidden on desktop */}
        <div
          style={{
            borderTop: `1px solid ${D.border}`,
            background: D.s1,
            display: isMobile ? 'flex' : 'none',
            flexShrink: 0,
            paddingBottom: 'env(safe-area-inset-bottom,0px)',
          }}
        >
          {visibleNav.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                padding: '10px 4px',
                border: 'none',
                cursor: 'pointer',
                background: 'transparent',
                color: tab === item.id ? D.gold : D.t3,
                fontFamily: 'DM Sans,sans-serif',
                transition: 'color .15s',
              }}
            >
              <span style={{ fontSize: '1.1rem' }}>{item.icon}</span>
              <span style={{ fontSize: '0.6rem', fontWeight: tab === item.id ? 600 : 400 }}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
