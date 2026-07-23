import { useState, useEffect, useRef, Suspense, lazy } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import UpgradePrompt from '../components/UpgradePrompt'
import { useFeatures } from '../hooks/useFeatures'
import { planTier, type PlanTier } from '../lib/features'
import { getPlan as getCommercialPlan } from '../lib/plans'
import { useRestaurantModules } from '../hooks/useRestaurantModules'
import { useAuth } from '../contexts/AuthContext'
import { useRestaurantCtx } from '../contexts/RestaurantContext'
import { useRestaurants } from '../hooks/useData'
import { useIsMobile } from '../hooks/useIsMobile'
import { D, PLAN_LABELS } from '../lib/constants'
import { usePlanLimits } from '../hooks/usePlanLimits'
import { InlineSpinner } from '../components/PageLoader'
import { supabase } from '../lib/supabase'
import { MOTION, useInView, revealStyle } from '../lib/motion'
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
const HappyHourTab = lazy(() => import('../components/HappyHourTab'))
const InvoicesTab = lazy(() => import('../components/InvoicesTab'))
const ReservationsTab = lazy(() => import('../components/ReservationsTab'))
const SettingsTab = lazy(() => import('../components/SettingsTab'))
const ProductsTab = lazy(() => import('../components/ProductsTab'))
const CategoriesTab = lazy(() => import('../components/CategoriesTab'))
const ReportsTab = lazy(() => import('../components/ReportsTab'))
const HomeTab = lazy(() => import('../components/_dashboard/HomeTab'))
const FloorPlanEditor = lazy(() => import('../components/FloorPlanEditor'))
// Re-importăm type-only pentru a evita any-cast
import type { FloorLayout } from '../components/FloorPlanEditor'
const WaiterAssignments = lazy(() => import('../components/WaiterAssignments'))
const AiSettingsTab = lazy(() => import('../components/AiSettingsTab'))
const FounderAiPanel = lazy(() => import('../components/FounderAiPanel'))
const AiChatbot = lazy(() => import('../components/AiChatbot'))
import { isPlatformAdmin } from '../lib/ai'
import { exitFounderView, clearFounderView, getFounderViewOrigin } from '../lib/founder'
import { Icon, type IconName } from '../components/ui/Icon'
import { EmptyState } from '../components/ui/EmptyState'

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
  // Comparația comercială citește limitele DIRECT din plans.ts ca să nu
  // diverge de pagina de pricing. Numele coloanelor = numele comerciale.
  useBodyScrollLock(true)
  const starter = getCommercialPlan('starter')
  const growth = getCommercialPlan('growth')
  const COMPARE = [
    { label: 'Meniu QR', free: '✓', pro: '✓' },
    {
      label: 'Produse',
      free: String(starter.limits.maxProducts),
      pro: String(growth.limits.maxProducts),
    },
    {
      label: 'Mese + QR',
      free: String(starter.limits.maxTables),
      pro: String(growth.limits.maxTables),
    },
    { label: 'Comenzi prin QR', free: '—', pro: '✓' },
    { label: 'Dashboard bucătărie', free: '—', pro: '✓' },
    { label: 'Comenzi ospătar', free: '—', pro: '✓' },
    { label: 'Rapoarte', free: 'De bază', pro: 'Zilnic + săptămânal' },
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
            Deblochează mai mult
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
              gridTemplateColumns: '1fr 90px 110px',
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
              {starter.name}
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
              {growth.name}
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
              {growth.priceMonthly}
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
              {growth.ctaLabel} →
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

// ── Main Dashboard ────────────────────────────────────────────
export type Tab =
  | 'home'
  | 'products'
  | 'categories'
  | 'modificatori'
  | 'mese'
  | 'comenzi'
  | 'analytics'
  | 'echipa'
  | 'raport'
  | 'arhitectura'
  | 'ture'
  | 'gestiune'
  | 'tva'
  | 'casa-tura'
  | 'casa-marcat'
  | 'happy-hour'
  | 'invoices'
  | 'reservations'
  | 'settings'
  | 'ai'
  | 'ai-founder'

// Navigație pe GRUPURI (max 6 în sidebar) cu sub-tab-uri interne.
// Filozofia: „Adaugi meniul. Generezi QR. Primești comenzi. Vezi rapoarte simple."
//   tier 1 — Meniu Digital:    Acasă, Meniu, Mese & QR, Setări
//   tier 2 — Meniu + Comenzi:  + Comenzi, Rapoarte
//   tier 3 — Fiscalizare:      aceleași 6 grupuri; fiscalul = sub-tab-uri, nu sidebar
// Funcțiile avansate NU se șterg — se regrupează sau se ascund pe plan.
// Gating-ul REAL e server-side (RPC/RLS, Porțile A-D); aici doar simplificăm UI-ul.
interface SubTab {
  id: Tab
  label: string
  adminOnly?: boolean
  minTier?: PlanTier
  platformAdminOnly?: boolean
  // Ascuns în modul „doar ridicare" (food truck) — mese/rezervări fără sens.
  hiddenPickupOnly?: boolean
}
interface NavGroup {
  id: string
  label: string
  icon: IconName
  adminOnly?: boolean
  minTier?: PlanTier
  subTabs: SubTab[]
}

const NAV_GROUPS: NavGroup[] = [
  { id: 'acasa', label: 'Acasă', icon: 'home', subTabs: [{ id: 'home', label: 'Acasă' }] },
  {
    id: 'meniu',
    label: 'Meniu',
    icon: 'menu',
    subTabs: [
      { id: 'products', label: 'Produse' },
      { id: 'categories', label: 'Categorii' },
      { id: 'modificatori', label: 'Opțiuni produse', minTier: 2 },
      { id: 'happy-hour', label: 'Promoții', adminOnly: true, minTier: 2 },
    ],
  },
  {
    id: 'comenzi',
    label: 'Comenzi',
    icon: 'orders',
    minTier: 2,
    subTabs: [{ id: 'comenzi', label: 'Comenzi' }],
  },
  {
    id: 'mese-qr',
    label: 'Mese & QR',
    icon: 'table',
    subTabs: [
      { id: 'mese', label: 'Mese & QR-uri' },
      // Rezervările stau aici (nu sub „Comenzi"): modulul e permis pe TOATE
      // planurile (mig 086), iar grupul „Comenzi" are minTier 2 — l-ar ascunde
      // greșit pe Plan 1. adminOnly: ospătarii au deja rezervările în WaiterPage.
      { id: 'reservations', label: 'Rezervări', adminOnly: true, hiddenPickupOnly: true },
      // Harta sălii (FloorPlanEditor) = feature `floor_plan` (pro/enterprise) — gate server mig 154.
      // Aliniem tab-ul la Plan 3 ca să nu apară editabil pe Plan 2 (mismatch de etichetă).
      { id: 'arhitectura', label: 'Hartă sală', minTier: 3, hiddenPickupOnly: true },
    ],
  },
  {
    id: 'rapoarte',
    label: 'Rapoarte',
    icon: 'chart',
    adminOnly: true,
    minTier: 2,
    subTabs: [
      { id: 'raport', label: 'Rapoarte' },
      { id: 'analytics', label: 'Statistici', minTier: 3 },
      { id: 'tva', label: 'TVA', minTier: 3 },
      { id: 'casa-tura', label: 'Încasări', minTier: 3 },
      // Tichete bucătărie = growth+ (mig 227); fiscalul rămâne tier 3 în tab.
      { id: 'casa-marcat', label: 'Casă & tichete', minTier: 2 },
      { id: 'invoices', label: 'Facturi', minTier: 3 },
      // Stocuri = feature `stocks` (growth+ în plan_features) → Plan 2, aliniat cu serverul (mig 142).
      { id: 'gestiune', label: 'Stocuri', minTier: 2 },
    ],
  },
  {
    id: 'setari',
    label: 'Setări',
    icon: 'settings',
    adminOnly: true,
    subTabs: [
      { id: 'settings', label: 'General' },
      { id: 'ai', label: 'Asistent AI', minTier: 2 },
      { id: 'echipa', label: 'Echipă', minTier: 2 },
      { id: 'ture', label: 'Program echipă', minTier: 3 },
      // Vizibil DOAR pentru platform admin (fondatorul) — vezi is_platform_admin.
      { id: 'ai-founder', label: 'Consum AI (fondator)', platformAdminOnly: true },
    ],
  },
]

function isSubTabVisible(
  st: SubTab,
  isAdmin: boolean,
  tier: PlanTier,
  isPlatAdmin: boolean,
  pickupOnly: boolean,
): boolean {
  if (st.platformAdminOnly && !isPlatAdmin) return false
  if (st.adminOnly && !isAdmin) return false
  if (st.minTier && tier < st.minTier) return false
  // Mod „doar ridicare" (food truck): mesele/rezervările nu au sens.
  if (st.hiddenPickupOnly && pickupOnly) return false
  return true
}

// Fade subtil la schimbarea tab-ului. Keyed pe `tab` (remount) → useInView
// pornește de la „ascuns" și revine instant când e în viewport. Safe pe
// reduced-motion (useInView întoarce true din start). Un singur hook, nu în map.
function TabFade({ children }: { children: React.ReactNode }) {
  const [ref, inView] = useInView<HTMLDivElement>({ amount: 0 })
  return (
    <div ref={ref} style={revealStyle(inView, { y: 8 })}>
      {children}
    </div>
  )
}

// Hub-ul „Comenzi": carduri către fluxurile live — fără embed/refactor al
// paginilor /waiter și /kitchen (deliberat low-risk; embed real = etapă viitoare).
function OrdersHub({
  onViewWaiter,
  onViewKitchen,
  onHistory,
  isAdmin,
  tier,
}: {
  onViewWaiter: () => void
  onViewKitchen: () => void
  onHistory: () => void
  isAdmin: boolean
  tier: PlanTier
}) {
  const cards: { icon: IconName; title: string; desc: string; fn: () => void; external?: boolean }[] = [
    { icon: 'orders', title: 'Comenzi live', desc: 'Comenzile deschise acum, pe mese', fn: onViewWaiter, external: true },
    { icon: 'utensils', title: 'Bucătărie', desc: 'Ecranul de preparare (KDS)', fn: onViewKitchen, external: true },
    {
      icon: 'users',
      title: 'Ospătar',
      desc: tier >= 3 ? 'Preluare manuală + plăți la masă' : 'Preluare manuală a comenzilor',
      fn: onViewWaiter,
      external: true,
    },
    // Vizibil doar pentru admin (owner/manager): tab-ul „Rapoarte" e adminOnly,
    // altfel cardul ar arunca staff-ul (ospătar/bucătărie) tăcut înapoi pe Acasă.
    ...(isAdmin
      ? [{ icon: 'history' as IconName, title: 'Rapoarte vânzări', desc: 'Ce s-a vândut, pe zile', fn: onHistory }]
      : []),
  ]
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1
        style={{
          fontFamily: 'Fraunces,serif',
          fontSize: '1.5rem',
          fontWeight: 600,
          color: D.t1,
          letterSpacing: '-0.02em',
          marginBottom: 18,
        }}
      >
        Comenzi
      </h1>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
          gap: 12,
        }}
      >
        {cards.map((c) => (
          <button
            key={c.title}
            onClick={c.fn}
            className="hover-lift pressable"
            style={{
              position: 'relative',
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: '22px 20px',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'DM Sans,sans-serif',
            }}
          >
            {c.external && (
              <div style={{ position: 'absolute', top: 18, right: 16, color: D.t3 }}>
                <Icon name="chevronRight" size={16} />
              </div>
            )}
            <div style={{ marginBottom: 10, color: D.gold }}><Icon name={c.icon} size={26} /></div>
            <div style={{ color: D.t1, fontSize: '0.95rem', fontWeight: 600, marginBottom: 4 }}>
              {c.title}
            </div>
            <div style={{ color: D.t2, fontSize: '0.78rem', lineHeight: 1.4 }}>{c.desc}</div>
            {c.external && (
              <div style={{ color: D.t3, fontSize: '0.68rem', lineHeight: 1.4, marginTop: 6 }}>
                Se deschide un ecran nou
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function DashboardPage({
  onViewMenu,
  onViewWaiter,
  onViewKitchen,
  onPricing,
  onSignOut,
  restaurants,
  restaurantsLoading,
  updateRestaurant,
}: {
  onViewMenu: (slug: string) => void
  onViewWaiter: () => void
  onViewKitchen: () => void
  onPricing: () => void
  onSignOut: () => Promise<void>
  restaurants: ReturnType<typeof useRestaurants>['restaurants']
  restaurantsLoading: ReturnType<typeof useRestaurants>['loading']
  updateRestaurant: ReturnType<typeof useRestaurants>['update']
}) {
  const { user } = useAuth()
  const { activeId, activeRole, setActive, founderViewId } = useRestaurantCtx()
  // OPT-R2: lista de restaurante + `update` vin ca props din AppRouter (o
  // SINGURĂ instanță useRestaurants). Înainte DashboardPage rula o A DOUA
  // instanță → 4 query-uri identice la boot ȘI două copii de state care puteau
  // diverge după un update de setări. Sursă unică acum; tipurile derivate din
  // hook garantează paritate exactă cu ce trimite AppRouter.
  const rLoading = restaurantsLoading
  const update = updateRestaurant
  // Mod fondator/partener: restaurantul activ e vizitat, nu al userului.
  const inFounderView = founderViewId != null && founderViewId === activeId
  // Originea vizitei e persistată la enterFounderView — sincronă, spre
  // deosebire de isPlatAdmin (RPC async care pornește false): eticheta
  // bannerului și ținta „Ieși din cont" nu depind de o cursă de rețea.
  const founderViewOrigin = getFounderViewOrigin()
  const [tab, setTab] = useState<Tab>('home')

  // La schimbarea tab-ului, readucem conținutul în partea de sus — altfel
  // tab-ul nou moștenea poziția de scroll a celui precedent și „începea de jos".
  const contentScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    contentScrollRef.current?.scrollTo(0, 0)
  }, [tab])

  const isAdminRole = activeRole === 'owner' || activeRole === 'manager'
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null)
  const [isPlatAdmin, setIsPlatAdmin] = useState(false)
  const isMobile = useIsMobile()

  // CTA-urile din emailurile de facturare (payment_failed/recovered, trial,
  // factură) trimit la /dashboard?tab=billing — fără efectul ăsta parametrul
  // era IGNORAT, iar userul (adesea unul cu plata picată) ateriza pe Acasă fără
  // nicio direcție. Scroll + centrare pe cardul „Abonament & facturare"
  // (HomeTab e lazy → poll scurt până apare elementul).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') !== 'billing') return
    let tries = 0
    const timer = setInterval(() => {
      const el = document.getElementById('billing-card')
      tries++
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        clearInterval(timer)
      } else if (tries > 20) {
        clearInterval(timer)
      }
    }, 250)
    return () => clearInterval(timer)
  }, [])

  // Platform admin (fondatorul) — deblochează tab-ul de consum AI global.
  useEffect(() => {
    let cancelled = false
    void isPlatformAdmin().then((v) => {
      // null (eroare de verificare) → tratăm ca non-admin AICI: doar ascunde tab-ul
      // AI global, fără consecințe de acces (spre deosebire de FounderPage).
      if (!cancelled) setIsPlatAdmin(v === true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Sursă unică de adevăr pentru restaurantul selectat = `activeId` din
  // RestaurantContext (persistat în localStorage, sincron cu `activeRole`).
  // Nu mai ținem un `selectedId` local — evita desincronizarea rol/tab pe
  // staff cu roluri diferite pe restaurante diferite.
  const restaurant = restaurants.find((r) => r.id === activeId) ?? restaurants[0] ?? null
  const features = useFeatures(restaurant?.id ?? null)
  const modulesState = useRestaurantModules(restaurant?.id ?? null)

  // Planul aparține RESTAURANTULUI, nu user-ului (CLAUDE.md §3): citim
  // get_restaurant_features, corect și pentru staff (un waiter pe restaurant
  // 'free' care e owner 'pro' altundeva nu trebuie să vadă limite/tab-uri 'pro').
  // Cât timp features se încarcă → fallback 'free' (cel mai restrictiv).
  const plan = features.features?.plan ?? 'free'

  // Tier comercial derivat din planul restaurantului.
  const tier: PlanTier = planTier(plan)

  // Mod „doar ridicare" (food truck, E3): mesele/rezervările ies din nav.
  // Ambele flag-uri trebuie pornite — pickup_only fără pickup activ e inert.
  const pickupOnly =
    (restaurant?.pickup_settings?.enabled ?? false) &&
    (restaurant?.pickup_settings?.pickup_only ?? false)

  // Grupurile vizibile pe rol + tier + module (Gate D). Un grup fără niciun
  // sub-tab vizibil dispare complet din sidebar.
  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    subTabs: g.subTabs.filter((st) =>
      isSubTabVisible(st, isAdminRole, tier, isPlatAdmin, pickupOnly),
    ),
  })).filter(
    (g) =>
      (!g.adminOnly || isAdminRole) &&
      (!g.minTier || tier >= g.minTier) &&
      g.subTabs.length > 0,
  )
  const activeGroup = visibleGroups.find((g) => g.subTabs.some((st) => st.id === tab)) ?? null

  // Tab devenit inaccesibil (demovare rol, downgrade plan, modul oprit) →
  // înapoi Acasă.
  useEffect(() => {
    if (activeGroup == null) setTab('home')
  }, [activeGroup])

  // FIX: UpgradeBanner afișa mereu 0/15 (hardcoded). Acum citește count-ul real.
  const { limits: planLimits } = usePlanLimits(plan)
  const [productCount, setProductCount] = useState(0)
  React.useEffect(() => {
    if (!restaurant) {
      setProductCount(0)
      return
    }
    // OPT-2: count-ul alimentează DOAR UpgradeBanner (vizibil doar pe free)
    // și HomeTab (tab 'home') — pe un plan plătit, navigarea între celelalte
    // tab-uri emitea un query per click fără niciun efect vizibil.
    if (plan !== 'free' && tab !== 'home') return
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
  }, [restaurant?.id, tab, plan]) // eslint-disable-line react-hooks/exhaustive-deps

  // Badge „Rezervări": câte rezervări PENDING viitoare așteaptă confirmare.
  // Count ieftin (head:true), reîmprospătat la schimbarea de tab/restaurant —
  // suficient ca semnal de atenție fără canal realtime permanent în nav.
  // Dep pe boolean derivat, NU pe obiectul hook-ului (identitate nouă per render).
  const reservationsModuleOn = modulesState.isEnabled('reservations')
  const [pendingReservations, setPendingReservations] = useState(0)
  React.useEffect(() => {
    if (!restaurant || !isAdminRole || !reservationsModuleOn) {
      setPendingReservations(0)
      return
    }
    let cancelled = false
    void supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurant.id)
      .eq('status', 'pending')
      .gte('starts_at', new Date().toISOString())
      .then(({ count }) => {
        if (!cancelled) setPendingReservations(count ?? 0)
      })
    return () => {
      cancelled = true
    }
  }, [restaurant?.id, tab, isAdminRole, reservationsModuleOn]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Funcție de RANDARE (nu componentă inline): definirea unei componente în corpul
  // altei componente îi schimbă identitatea la fiecare render → React demontează și
  // remontează tot sub-arborele (pierde focus/scroll, flicker). Ca funcție apelată
  // `{renderSidebar()}`, elementele se reconciliază normal (audit dashboard, MEDIUM).
  const renderSidebar = () => (
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
          aria-label="Închide meniul"
          style={{
            background: 'transparent',
            border: 'none',
            color: D.t2,
            cursor: 'pointer',
            padding: 6,
            display: 'flex',
          }}
        >
          <Icon name="close" size={18} />
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
              onChange={(e) => setActive(e.target.value)}
              style={{
                width: '100%',
                background: D.s3,
                border: `1px solid ${D.border}`,
                borderRadius: 7,
                color: D.t1,
                // Țintă tactilă ≥44px (fix a11y: fost 6px+0.85rem ≈ 30px)
                minHeight: 44,
                padding: '10px 12px',
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
        {visibleGroups.map((g) => {
          const active = activeGroup?.id === g.id
          return (
            <button
              key={g.id}
              onClick={() => {
                setTab(g.subTabs[0].id)
                setSidebarOpen(false)
              }}
              className="pressable"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                // Țintă tactilă ≥44px pe toate butoanele de navigație
                minHeight: 44,
                padding: '10px 12px',
                borderRadius: 9,
                border: 'none',
                cursor: 'pointer',
                background: active ? D.goldA : 'transparent',
                color: active ? D.goldL : D.t2,
                marginBottom: 2,
                fontSize: '0.875rem',
                fontWeight: active ? 600 : 400,
                fontFamily: 'DM Sans,sans-serif',
                textAlign: 'left',
                transition: `background ${MOTION.fast}ms ${MOTION.standard}, color ${MOTION.fast}ms ${MOTION.standard}`,
              }}
              onMouseEnter={(e) => !active && (e.currentTarget.style.background = D.s2)}
              onMouseLeave={(e) => !active && (e.currentTarget.style.background = 'transparent')}
            >
              <Icon name={g.icon} size={18} />
              {g.label}
              {/* Punct de atenție: rezervări pending nevăzute (grupul Mese & QR).
                  Punctul e decorativ; textul ascuns vizual intră în numele
                  accesibil al butonului pentru screen-readers. */}
              {g.id === 'mese-qr' && pendingReservations > 0 && (
                <>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: D.gold,
                      marginLeft: 'auto',
                      flexShrink: 0,
                    }}
                  />
                  <span className="visually-hidden">
                    {pendingReservations} rezervări în așteptare
                  </span>
                </>
              )}
            </button>
          )
        })}
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
      <div
        style={{
          padding: '10px 8px',
          borderBottom: `1px solid ${D.border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <button
          onClick={() => restaurant && onViewMenu(restaurant.slug)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            minHeight: 44,
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
          <Icon name="eye" size={16} /> Previzualizează meniu
        </button>
        {isAdminRole && (
          <button
            onClick={onViewWaiter}
            title="Deschide ecranul de ospătar — comenzi live, rezervări, plăți"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              minHeight: 44,
              padding: '10px 12px',
              borderRadius: 9,
              border: `1px solid ${D.gold}55`,
              cursor: 'pointer',
              background: `${D.gold}11`,
              color: D.gold,
              fontSize: '0.85rem',
              fontFamily: 'DM Sans,sans-serif',
              fontWeight: 600,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `${D.gold}22`
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = `${D.gold}11`
            }}
          >
            <Icon name="utensils" size={16} /> Vezi ca ospătar
          </button>
        )}
        {/* Panoul de fondator — vizibil DOAR pentru platform admin. */}
        {isPlatAdmin && (
          <button
            onClick={() => {
              // Revenirea la panou = ieșirea din vizită: fără clear, cheia
              // founder-view rămânea stale și „trăgea" fondatorul înapoi pe
              // contul străin la fiecare reload.
              clearFounderView()
              window.location.href = '/founder'
            }}
            title="Panoul de fondator — toată platforma într-un singur loc"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              minHeight: 44,
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
              e.currentTarget.style.background = D.s2
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <Icon name="settings" size={16} /> Panou fondator
          </button>
        )}
      </div>
    </>
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: D.bg,
        overflow: 'hidden',
        fontFamily: 'DM Sans,sans-serif',
      }}
    >
      {/* Banner mod fondator/partener: vizibil DOAR celui care impersonează,
          ca să știe mereu pe ce cont e. „Ieși" revine la panoul de fondator. */}
      {inFounderView && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '8px 14px',
            background: D.goldA,
            borderBottom: `1px solid ${D.gold}55`,
            color: D.goldL,
            fontSize: '0.8rem',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          <span style={{ overflowWrap: 'anywhere' }}>
            {founderViewOrigin === 'founder' ? '⚡ Mod fondator' : '🤝 Mod partener'} —{' '}
            {restaurants.find((r) => r.id === activeId)?.name ?? 'restaurant'}
          </span>
          <button
            onClick={() => exitFounderView(founderViewOrigin === 'founder' ? '/founder' : '/afiliat')}
            className="pressable"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              minHeight: 34,
              borderRadius: 100,
              border: `1px solid ${D.gold}66`,
              background: 'transparent',
              color: D.goldL,
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {/* Iese din VIZITĂ (impersonare), nu logout — text corectat */}
            <Icon name="arrowLeft" size={14} /> Ieși din vizită
          </button>
        </div>
      )}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
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
        {renderSidebar()}
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
            {renderSidebar()}
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
            aria-label="Deschide meniul"
            style={{
              background: 'transparent',
              border: 'none',
              color: D.t1,
              cursor: 'pointer',
              display: 'flex',
              padding: 6,
              borderRadius: 8,
            }}
          >
            <Icon name="menu" size={22} />
          </button>
          {/* Pe mobil afișăm numele restaurantului activ (context util),
              cu fallback la wordmark când nu există restaurant. */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: 'center',
              fontFamily: 'Fraunces,serif',
              fontSize: '1.1rem',
              color: D.t1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {restaurant?.name ?? 'Menuvia'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {isAdminRole && (
              <button
                onClick={onViewWaiter}
                title="Vezi ca ospătar"
                style={{
                  background: `${D.gold}11`,
                  border: `1px solid ${D.gold}55`,
                  color: D.gold,
                  cursor: 'pointer',
                  display: 'flex',
                  padding: 6,
                  borderRadius: 8,
                  fontSize: 16,
                }}
              >
                <Icon name="utensils" size={18} />
              </button>
            )}
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
              aria-label="Previzualizează meniu"
            >
              <Icon name="eye" size={18} />
            </button>
          </div>
        </div>

        <div
          ref={contentScrollRef}
          // paddingBottom mărit pe mobil: FAB-ul AI (56px, bottom:76) altfel
          // acoperă ultimul rând de carduri la capătul scroll-ului.
          style={{
            flex: 1,
            overflow: 'auto',
            padding: isMobile ? '16px 12px 112px' : '28px 32px',
          }}
        >
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
              {/* Sub-navigație internă a grupului activ (chips).
                  Tab-ul activ e clar evidențiat (fundal gold + bordură).
                  Numele grupului peste chips dă context ierarhic. */}
              {activeGroup != null && activeGroup.subTabs.length > 1 && (
                <div style={{ marginBottom: 20 }}>
                  <div
                    style={{
                      fontFamily: 'Fraunces,serif',
                      fontSize: '1.05rem',
                      color: D.t1,
                      letterSpacing: '-0.01em',
                      marginBottom: 10,
                    }}
                  >
                    {activeGroup.label}
                  </div>
                  {/* Wrapper relativ pentru fade-ul de scroll orizontal */}
                  <div style={{ position: 'relative' }}>
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      overflowX: 'auto',
                      paddingBottom: 2,
                    }}
                  >
                    {activeGroup.subTabs.map((st) => {
                      const active = tab === st.id
                      return (
                        <button
                          key={st.id}
                          onClick={() => setTab(st.id)}
                          className="pressable"
                          style={{
                            flexShrink: 0,
                            padding: '7px 14px',
                            fontSize: '0.8rem',
                            fontFamily: 'DM Sans,sans-serif',
                            fontWeight: active ? 600 : 400,
                            border: `1px solid ${active ? D.gold + '55' : D.border}`,
                            borderRadius: 100,
                            cursor: 'pointer',
                            background: active ? D.goldA : 'transparent',
                            color: active ? D.goldL : D.t2,
                            whiteSpace: 'nowrap',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            transition: `background ${MOTION.fast}ms ${MOTION.standard}, color ${MOTION.fast}ms ${MOTION.standard}, border-color ${MOTION.fast}ms ${MOTION.standard}`,
                          }}
                        >
                          {st.label}
                          {st.id === 'reservations' && pendingReservations > 0 && (
                            <span
                              aria-label={`${pendingReservations} rezervări în așteptare`}
                              style={{
                                minWidth: 18,
                                height: 18,
                                padding: '0 5px',
                                borderRadius: 100,
                                background: D.gold,
                                color: '#141414',
                                fontSize: '0.65rem',
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {pendingReservations > 99 ? '99+' : pendingReservations}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  {/* Semnal „mai sunt chips-uri" — fade pe marginea dreaptă */}
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      bottom: 0,
                      width: 24,
                      pointerEvents: 'none',
                      background: `linear-gradient(90deg, transparent, ${D.bg})`,
                    }}
                  />
                  </div>
                </div>
              )}
              {/* Guard: dacă tab-ul curent nu mai aparține niciunui grup vizibil
                  (rol/tier scăzute în aceeași randare — reset-ul de mai sus
                  rulează abia după commit), NU montăm tab-ul vechi. Altfel un
                  tab admin-only apuca să se monteze o dată și să declanșeze
                  fetch-uri înainte de reset-ul spre 'home'. */}
              {activeGroup != null && (
              <TabFade key={tab}>
              {tab === 'home' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă..." />}>
                  <HomeTab
                    restaurantId={restaurant.id}
                    restaurantName={restaurant.name}
                    tier={tier}
                    isAdmin={isAdminRole}
                    productCount={productCount}
                    pickupOnly={pickupOnly}
                    onNavigate={setTab}
                    onViewMenu={() => onViewMenu(restaurant.slug)}
                    onPricing={onPricing}
                  />
                </Suspense>
              )}
              {tab === 'comenzi' && (
                <OrdersHub
                  onViewWaiter={onViewWaiter}
                  onViewKitchen={onViewKitchen}
                  // TODO: înlocuiește shortcut-ul către raportul agregat cu o
                  // listă reală de istoric (ID, masă, oră, produse, status,
                  // total, ospătar, anulări) — pagină viitoare Comenzi > Istoric.
                  onHistory={() => setTab('raport')}
                  isAdmin={isAdminRole}
                  tier={tier}
                />
              )}
              {tab === 'products' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă produsele..." />}>
                  <ProductsTab
                    restaurantId={restaurant.id}
                    plan={plan}
                    onUpgrade={() =>
                      setUpgradeReason('Ai atins limita de produse pe planul Gratuit (15 produse).')
                    }
                    userId={user?.id || ''}
                    menuLanguages={restaurant.menu_languages ?? []}
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
                  <ReportsTab restaurantId={restaurant.id} fiscalReports={tier >= 3} />
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
                    description="Urmărește stocurile, definește rețete, calculează profitabilitatea per produs. Disponibil pe planul Meniu + Comenzi."
                    requiredTier={2}
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
                    description="Raport TVA grupat pe cote și zile, export CSV pentru contabil. Disponibil pe planul Fiscalizare."
                    requiredTier={3}
                    onUpgrade={onPricing}
                  />
                ))}
              {tab === 'casa-tura' &&
                (features.has('shifts') ? (
                  <Suspense fallback={<InlineSpinner label="Se încarcă..." />}>
                    <CashRegisterTab restaurantId={restaurant.id} />
                  </Suspense>
                ) : (
                  <UpgradePrompt
                    currentPlan={plan}
                    featureName="Casă & Tură"
                    emoji="💰"
                    description="Casă de bani, ture și încasări. Disponibil pe planul Fiscalizare."
                    requiredTier={3}
                    onUpgrade={onPricing}
                  />
                ))}
              {tab === 'happy-hour' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă..." />}>
                  <HappyHourTab restaurantId={restaurant.id} />
                </Suspense>
              )}
              {tab === 'invoices' &&
                (tier >= 3 ? (
                  <Suspense fallback={<InlineSpinner label="Se încarcă facturile..." />}>
                    <InvoicesTab restaurantId={restaurant.id} restaurantName={restaurant.name} />
                  </Suspense>
                ) : (
                  <UpgradePrompt
                    currentPlan={plan}
                    featureName="Facturi"
                    emoji="🧾"
                    description="Emitere facturi Oblio. Disponibil pe planul Fiscalizare."
                    requiredTier={3}
                    onUpgrade={onPricing}
                  />
                ))}
              {tab === 'reservations' &&
                (reservationsModuleOn ? (
                  <Suspense fallback={<InlineSpinner label="Se încarcă rezervările..." />}>
                    <ReservationsTab restaurantId={restaurant.id} />
                  </Suspense>
                ) : (
                  <EmptyState
                    icon="calendar"
                    title="Rezervările nu sunt activate"
                    description="Clienții tăi vor putea rezerva o masă direct din meniul public, iar tu le confirmi și le gestionezi de aici. Activezi modulul dintr-un singur click, din Setări."
                    action={
                      <button
                        onClick={() => setTab('settings')}
                        className="pressable"
                        style={{
                          padding: '10px 20px',
                          minHeight: 44,
                          borderRadius: 10,
                          border: 'none',
                          cursor: 'pointer',
                          background: D.gold,
                          color: '#141414',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          fontFamily: 'DM Sans,sans-serif',
                        }}
                      >
                        Activează din Setări
                      </button>
                    }
                  />
                ))}
              {tab === 'casa-marcat' &&
                // Tier 2 = tichete de bucătărie (mig 227); tier 3 adaugă
                // secțiunile fiscale. Sub tier 2 rămâne upgrade prompt.
                (tier >= 2 ? (
                  <Suspense fallback={<InlineSpinner label="Se încarcă..." />}>
                    <BridgeTab restaurantId={restaurant.id} fiscalEnabled={tier >= 3} />
                  </Suspense>
                ) : (
                  <UpgradePrompt
                    currentPlan={plan}
                    featureName="Casă & tichete"
                    emoji="🖨️"
                    description="Tipărește comenzile în bucătărie (din planul Meniu + Comenzi) și conectează casa de marcat fiscală (planul Fiscalizare)."
                    requiredTier={2}
                    onUpgrade={onPricing}
                  />
                ))}
              {tab === 'settings' && (
                <Suspense fallback={<InlineSpinner label="Se încarcă setările..." />}>
                  <SettingsTab
                    restaurant={restaurant}
                    onUpdate={update}
                    plan={plan}
                    onSignOut={onSignOut}
                    modulesState={modulesState}
                  />
                </Suspense>
              )}
              {tab === 'ai' &&
                (tier >= 2 ? (
                  <Suspense fallback={<InlineSpinner label="Se încarcă asistentul AI..." />}>
                    <AiSettingsTab restaurantId={restaurant.id} />
                  </Suspense>
                ) : (
                  <UpgradePrompt
                    currentPlan={plan}
                    featureName="Asistent AI"
                    emoji="🤖"
                    description="Asistent AI pentru recomandări și automatizări. Disponibil pe planul Meniu + Comenzi."
                    requiredTier={2}
                    onUpgrade={onPricing}
                  />
                ))}
              {tab === 'ai-founder' && isPlatAdmin && (
                <Suspense fallback={<InlineSpinner label="Se încarcă consumul AI..." />}>
                  <FounderAiPanel />
                </Suspense>
              )}
              </TabFade>
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

        {/* Asistent AI flotant — doar pentru admini, cu restaurant selectat.
            Lazy + fără fallback vizual (nu blochează dashboardul dacă AI nu
            e configurat — componenta gestionează singură erorile/cota). */}
        {restaurant && isAdminRole && (
          <Suspense fallback={null}>
            <AiChatbot restaurantId={restaurant.id} restaurantName={restaurant.name} />
          </Suspense>
        )}

        {/* Mobile bottom nav — hidden on desktop.
            Scroll orizontal izolat în nav (overflowX:auto + flexShrink:0 per
            buton + minWidth fix), să nu bleed-uiască peste tot conținutul
            dashboardului. Înainte: tab-urile cu label lung ("Modificatori",
            "Casă & Tură") expandau peste flex:1 → flex container overflow →
            întreaga pagină se mișca lateral la swipe. */}
        {/* Wrapper relativ: găzduiește fade-ul care semnalează că bara
            de taburi mai are conținut la dreapta (scroll fără scrollbar). */}
        <div
          style={{
            position: 'relative',
            display: isMobile ? 'block' : 'none',
            flexShrink: 0,
          }}
        >
        <div
          style={{
            borderTop: `1px solid ${D.border}`,
            background: D.s1,
            display: 'flex',
            overflowX: 'auto',
            overflowY: 'hidden',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            paddingBottom: 'env(safe-area-inset-bottom,0px)',
          }}
        >
          {visibleGroups.map((g) => {
            const navActive = activeGroup?.id === g.id
            return (
            <button
              key={g.id}
              onClick={() => setTab(g.subTabs[0].id)}
              aria-current={navActive ? 'page' : undefined}
              style={{
                flexShrink: 0,
                // minWidth redus (68→58) ca mai multe taburi să încapă în 390px
                minWidth: 58,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                padding: '10px 8px',
                border: 'none',
                // Indicator de formă redundant față de culoare (a11y):
                // bară gold subțire sus pe tabul activ, transparentă altfel
                // (rezervă spațiul → fără salt de layout la schimbare).
                borderTop: `2px solid ${navActive ? D.gold : 'transparent'}`,
                cursor: 'pointer',
                background: 'transparent',
                color: navActive ? D.gold : D.t3,
                fontFamily: 'DM Sans,sans-serif',
                transition: 'color .15s',
              }}
            >
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <Icon name={g.icon} size={20} />
                {/* Punct de atenție pe mobil: rezervări pending nevăzute. */}
                {g.id === 'mese-qr' && pendingReservations > 0 && (
                  <>
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        top: -2,
                        right: -4,
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: D.gold,
                      }}
                    />
                    <span className="visually-hidden">
                      {pendingReservations} rezervări în așteptare
                    </span>
                  </>
                )}
              </span>
              <span
                style={{
                  // 0.6rem era sub pragul lizibil; urcat la 0.66rem
                  fontSize: '0.66rem',
                  fontWeight: navActive ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}
              >
                {g.label}
              </span>
            </button>
            )
          })}
        </div>
        {/* Fade dreapta = semnal „mai sunt taburi" când bara depășește lățimea */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: 28,
            pointerEvents: 'none',
            background: `linear-gradient(90deg, transparent, ${D.s1})`,
          }}
        />
        </div>
      </div>
      </div>
    </div>
  )
}
