import { useState, useEffect, Suspense, lazy } from 'react'
import UpgradePrompt from '../components/UpgradePrompt'
import { useFeatures } from '../hooks/useFeatures'
import { useAuth } from '../contexts/AuthContext'
import { useRestaurantCtx } from '../contexts/RestaurantContext'
import { useRestaurants } from '../hooks/useData'
import { useIsMobile } from '../hooks/useIsMobile'
import { D, PLAN_LABELS } from '../lib/constants'
import type { Ingredient as StocksIngredient } from '../lib/stocks'
import { usePlanLimits } from '../hooks/usePlanLimits'
import { InlineSpinner } from '../components/PageLoader'
import { supabase } from '../lib/supabase'
import type { Restaurant } from '../hooks/useData'
import React from 'react'
import { btn, Modal, Inp } from '../components/_dashboard/sharedUI'

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
const InvoicesTab = lazy(() => import('../components/InvoicesTab'))
const ReservationsTab = lazy(() => import('../components/ReservationsTab'))
const SettingsTab = lazy(() => import('../components/SettingsTab'))
const ProductsTab = lazy(() => import('../components/ProductsTab'))
const CategoriesTab = lazy(() => import('../components/CategoriesTab'))
const ReportsTab = lazy(() => import('../components/ReportsTab'))
const FloorPlanEditor = lazy(() => import('../components/FloorPlanEditor'))
// Re-importăm type-only pentru a evita any-cast
import type { FloorLayout } from '../components/FloorPlanEditor'
const WaiterAssignments = lazy(() => import('../components/WaiterAssignments'))



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


// ── RecipeAddForm: inline form for adding ingredient to recipe ───
function RecipeAddForm({
  ingredients,
  onAdd,
}: {
  ingredients: StocksIngredient[]
  onAdd: (ingredientId: string, quantity: number) => void | Promise<void>
}) {
  const [selectedId, setSelectedId] = useState('')
  const [quantity, setQuantity] = useState('')

  function submit() {
    if (selectedId.length === 0 || quantity.length === 0) return
    const q = parseFloat(quantity)
    if (isNaN(q) || q <= 0) return
    void onAdd(selectedId, q)
    setSelectedId('')
    setQuantity('')
  }

  if (ingredients.length === 0) {
    return (
      <div
        style={{
          fontSize: '0.74rem',
          color: D.t3,
          padding: '10px',
          background: D.s3,
          borderRadius: 7,
          textAlign: 'center',
        }}
      >
        Toate ingredientele sunt deja adăugate la rețetă
      </div>
    )
  }

  const sel = ingredients.find((i) => i.id === selectedId)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 100px 70px',
        gap: 6,
        alignItems: 'center',
      }}
    >
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        style={{
          padding: '8px 10px',
          background: D.s3,
          border: `1px solid ${D.border}`,
          borderRadius: 7,
          color: D.t1,
          fontSize: '0.82rem',
          fontFamily: 'DM Sans,sans-serif',
          height: 36,
        }}
      >
        <option value="">Alege ingredient...</option>
        {ingredients.map((i) => (
          <option key={i.id} value={i.id}>
            {i.emoji ?? '🥬'} {i.name}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Inp value={quantity} onChange={setQuantity} type="number" placeholder="0" />
        <span style={{ fontSize: '0.7rem', color: D.t3, whiteSpace: 'nowrap' }}>
          {sel?.unit ?? ''}
        </span>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={selectedId.length === 0 || quantity.length === 0}
        style={btn({
          background: D.gold,
          color: '#000',
          height: 36,
          fontSize: '0.74rem',
          opacity: selectedId.length === 0 || quantity.length === 0 ? 0.5 : 1,
        })}
      >
        + Add
      </button>
    </div>
  )
}

// ── ExtraForm: small inline form for adding a product extra ───────
function ExtraForm({
  onAdd,
}: {
  onAdd: (name: string, price: number, emoji: string) => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [emoji, setEmoji] = useState('')

  function submit() {
    if (name.trim().length === 0 || price.length === 0) return
    const p = parseFloat(price)
    if (isNaN(p) || p < 0) return
    void onAdd(name, p, emoji)
    setName('')
    setPrice('')
    setEmoji('')
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '40px 1fr 80px 70px',
        gap: 6,
        alignItems: 'center',
      }}
    >
      <Inp value={emoji} onChange={setEmoji} placeholder="🧀" />
      <Inp value={name} onChange={setName} placeholder="Brânză extra" />
      <Inp value={price} onChange={setPrice} type="number" placeholder="5.00" />
      <button
        type="button"
        onClick={submit}
        disabled={name.trim().length === 0 || price.length === 0}
        style={btn({
          background: D.gold,
          color: '#000',
          height: 36,
          fontSize: '0.78rem',
          opacity: name.trim().length === 0 || price.length === 0 ? 0.5 : 1,
        })}
      >
        + Adaugă
      </button>
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
  | 'reservations'
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
  { id: 'reservations', label: 'Rezervări', icon: '📅', adminOnly: true },
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
                <Suspense fallback={<InlineSpinner label="Se încarcă produsele..." />}>
                  <ProductsTab
                    restaurantId={restaurant.id}
                    plan={plan}
                    onUpgrade={() =>
                      setUpgradeReason('Ai atins limita de produse pe planul Gratuit (15 produse).')
                    }
                    userId={user?.id || ''}
                  />
                </Suspense>
              )}
              {tab === 'categories' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă categoriile..." />}>
                  <CategoriesTab restaurantId={restaurant.id} />
                </Suspense>
              )}
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
              {tab === 'reservations' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă rezervările..." />}>
                  <ReservationsTab restaurantId={restaurant.id} />
                </Suspense>
              )}
              {tab === 'casa-marcat' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă..." />}>
                  <BridgeTab restaurantId={restaurant.id} />
                </Suspense>
              )}
              {tab === 'settings' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă setările..." />}>
                  <SettingsTab
                    restaurant={restaurant}
                    onUpdate={update}
                    plan={plan}
                    onSignOut={onSignOut}
                  />
                </Suspense>
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
