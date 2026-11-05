import { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { useFeatures } from '../hooks/useFeatures'
import { productLimitReason, surfaceTiers } from '../lib/features'
import { planSurface, planUpsellTarget } from '../lib/planSurface'
import { browserSite } from '../lib/domain'
import {
  clearPendingRegional,
  retryPendingCountry,
  retryPendingRegional,
  storePendingRegional,
} from '../lib/pendingCountry'
import { regionalPatchFrom } from '../lib/countries'
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
const TranslationsTab = lazy(() => import('../components/TranslationsTab'))
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
const LocationsTab = lazy(() => import('../components/LocationsTab'))
const FloorPlanEditor = lazy(() => import('../components/FloorPlanEditor'))
// Re-importăm type-only pentru a evita any-cast
import type { FloorLayout } from '../components/FloorPlanEditor'
const WaiterAssignments = lazy(() => import('../components/WaiterAssignments'))
const AiSettingsTab = lazy(() => import('../components/AiSettingsTab'))
const AiChatbot = lazy(() => import('../components/AiChatbot'))
import { isPlatformAdmin } from '../lib/ai'
import { exitFounderView, clearFounderView, getFounderViewOrigin } from '../lib/founder'
import { isPartnerTab } from '../lib/partnerAccess'
import { canAddLocation, hardReloadTo, hasMultipleLocations } from '../lib/locations'
import { pickupOnlyMode } from '../lib/pickupAvailability'
import { pickupFeatureState } from '../lib/pickupCopy'
import { HelpButton } from '../components/HelpButton'
import { SignOutButton } from '../components/SignOutButton'
import { Icon, type IconName } from '../components/ui/Icon'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { PlanUnknownBanner } from '../components/_dashboard/PlanBanners'
import { confirm as confirmDialog } from '../components/ui/confirm'
import type { ConfirmOptions } from '../components/ui/confirm'
import { menuBaseLang } from '../lib/i18nMenu'
import { resolveEffectiveMenuLayout } from '../lib/themes'
import {
  LIVE_ORDERS_TAB,
  dashboardPathFor,
  settingsSectionOf,
  tabFromSearch,
  visibleNavGroups,
  type Tab,
} from '../lib/dashboardNav'
// Textele cadrului (lotul L3b): namespace `dashboard`; „Reîncearcă” din
// `common`. Etichetele navigării rămân românești în dashboardNav (date) și se
// traduc aici, la randare, prin cheia dată de `navLabels`.
import { useT } from '../i18n/useT'
import { dashboardNs } from '../i18n/ns/dashboard'
import { commonNs } from '../i18n/ns/common'
import { navGroupLabelKey, navLabelKey } from '../i18n/navLabels'

// ── Upgrade Modal ─────────────────────────────────────────────
// Shown when user hits a plan limit — stays in dashboard context
function UpgradeModal({
  reason,
  onClose,
  onGoToPricing,
}: {
  // Textul limitei atinse (productLimitReason). Singurul deschizător al
  // modalului e limita de produse — varianta „informativă" (banda planului
  // gratuit, planUsageReason) a ieșit în lotul P.
  reason: string
  onClose: () => void
  onGoToPricing: () => void
}) {
  // Comparația comercială citește limitele DIRECT din plans.ts ca să nu
  // diverge de pagina de pricing. Numele coloanelor = numele comerciale.
  useBodyScrollLock(true)
  const { t } = useT(dashboardNs)
  const starter = getCommercialPlan('starter')
  const growth = getCommercialPlan('growth')
  const COMPARE = [
    { label: t('upgrade_rowQrMenu'), free: '✓', pro: '✓' },
    {
      label: t('upgrade_rowProducts'),
      free: String(starter.limits.maxProducts),
      pro: String(growth.limits.maxProducts),
    },
    {
      label: t('upgrade_rowTables'),
      free: String(starter.limits.maxTables),
      pro: String(growth.limits.maxTables),
    },
    { label: t('upgrade_rowQrOrders'), free: '—', pro: '✓' },
    { label: t('upgrade_rowKitchen'), free: '—', pro: '✓' },
    { label: t('upgrade_rowWaiterOrders'), free: '—', pro: '✓' },
    // Tab-ul Rapoarte e minTier 2; pe growth = evidența comenzilor (fără
    // rapoarte pe email — acelea numără doar comenzi `paid`).
    { label: t('upgrade_rowReports'), free: '—', pro: t('upgrade_reportsGrowth') },
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
            {t('upgrade_title')}
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
            <span style={{ color: D.t3, fontSize: '0.8rem', marginLeft: 4 }}>
              {t('upgrade_perMonth')}
            </span>
            <div style={{ fontSize: '0.72rem', color: D.goldL, marginTop: 3 }}>
              {t('upgrade_trialNote')}
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
              {/* În română = `growth.ctaLabel` („Activează Meniu + Comenzi”) + „ →”;
                  verbul se traduce, numele comercial al planului nu (regula 4). */}
              {t('upgrade_cta', { plan: growth.name })}
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
              {/* Modalul se deschide și pe planuri PLĂTITE (limita de produse pe
                  Meniu Digital) — „Continuă cu planul gratuit" mințea acolo. */}
              {t('upgrade_notNow')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Banda planului gratuit din sidebar + banda „planul nu s-a încărcat":
// components/_dashboard/PlanBanners.tsx (testate separat, FB1–FB4).

// ── Main Dashboard ────────────────────────────────────────────
// Structura navigării (NAV_GROUPS, sub-tab-uri, `?tab=`) e în
// lib/dashboardNav.ts — lotul R2: aceleași ecrane, fiecare într-un singur loc.

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

// Comenzi → Live: intrările către ecranele live — fără embed/refactor al
// paginilor /waiter și /kitchen (deliberat low-risk; embed real = etapă viitoare).
// Lotul R2: „Comenzi live" și „Ospătar" deschideau ACELAȘI ecran (/waiter) —
// acum e o singură intrare; „Rapoarte vânzări" dubla Rapoarte → Vânzări și a ieșit.
function OrdersHub({
  onViewWaiter,
  onViewKitchen,
  fiscal,
}: {
  onViewWaiter: () => void
  onViewKitchen: () => void
  // planSurface.fiscal: „plăți la masă" doar pe planul cu bon.
  fiscal: boolean
}) {
  const { t } = useT(dashboardNs)
  const cards: { icon: IconName; title: string; desc: string; fn: () => void }[] = [
    {
      icon: 'orders',
      title: t('hub_waiterTitle'),
      desc: fiscal ? t('hub_waiterDescFiscal') : t('hub_waiterDesc'),
      fn: onViewWaiter,
    },
    { icon: 'utensils', title: t('hub_kitchenTitle'), desc: t('hub_kitchenDesc'), fn: onViewKitchen },
  ]
  return (
    <div style={{ maxWidth: 1000 }}>
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
            <div style={{ position: 'absolute', top: 18, right: 16, color: D.t3 }}>
              <Icon name="chevronRight" size={16} />
            </div>
            <div style={{ marginBottom: 10, color: D.gold }}><Icon name={c.icon} size={26} /></div>
            <div style={{ color: D.t1, fontSize: '0.95rem', fontWeight: 600, marginBottom: 4 }}>
              {c.title}
            </div>
            <div style={{ color: D.t2, fontSize: '0.78rem', lineHeight: 1.4 }}>{c.desc}</div>
            <div style={{ color: D.t3, fontSize: '0.68rem', lineHeight: 1.4, marginTop: 6 }}>
              {t('hub_opensNewScreen')}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// Textul întrebării „pierzi modificările din Setări?" — fiecare drum care
// părăsește formularul (alt tab, alt restaurant, locație nouă) își are
// formularea lui; butonul de confirmare e mereu distructiv. Textele vin din
// dicționar (lotul L3b), deci se construiesc în componentă, nu ca constantă.
type DiscardCopy = Omit<ConfirmOptions, 'destructive'>

// Tipurile listei de restaurante vin din hook (o singură sursă cu AppRouter).
type RestaurantsApi = ReturnType<typeof useRestaurants>

export default function DashboardPage({
  onViewMenu,
  onViewWaiter,
  onViewKitchen,
  onPricing,
  onSignOut,
  restaurants,
  restaurantsLoading,
  updateRestaurant,
  refetchRestaurants,
  patchRestaurantLocal,
  navigate,
  replaceUrl,
}: {
  onViewMenu: (slug: string) => void
  onViewWaiter: () => void
  onViewKitchen: () => void
  onPricing: () => void
  onSignOut: () => Promise<void>
  restaurants: RestaurantsApi['restaurants']
  restaurantsLoading: RestaurantsApi['loading']
  updateRestaurant: RestaurantsApi['update']
  // Reîncărcarea listei (aceeași instanță useRestaurants din AppRouter) —
  // după „Adaugă o locație" (lotul A), înainte ca locația nouă să devină activă.
  // Întoarce lista recitită (`null` = citirea a eșuat), ca apelantul să verifice
  // pe ea, nu pe prop-ul încă nerandat.
  refetchRestaurants: RestaurantsApi['refetch']
  // Merge LOCAL în aceeași listă după o scriere prin RPC (harta sălii,
  // `save_floor_layout`, mig 322): editorul remontat la revenirea pe tab
  // pornește de la harta tocmai salvată, nu de la copia încărcată la boot.
  patchRestaurantLocal: RestaurantsApi['patchLocal']
  // Navigarea din App (pushState + rutare): tab-ul curent stă în URL
  // (`?tab=…`), deci refresh-ul și Back-ul păstrează locul (lotul R2).
  navigate: (path: string) => void
  // Corecția URL-ului fără intrare nouă în istoric (`?tab=` nepermis → Acasă).
  replaceUrl: (path: string) => void
}) {
  const { user } = useAuth()
  const { t, tp } = useT(dashboardNs)
  const tc = useT(commonNs)
  const { activeId, activeRole, setActive, founderViewId, memberships, reloadMemberships } =
    useRestaurantCtx()
  // OPT-R2: lista de restaurante + `update` vin ca props din AppRouter (o
  // SINGURĂ instanță useRestaurants). Înainte DashboardPage rula o A DOUA
  // instanță → 4 query-uri identice la boot ȘI două copii de state care puteau
  // diverge după un update de setări. Sursă unică acum; tipurile derivate din
  // hook garantează paritate exactă cu ce trimite AppRouter.
  const rLoading = restaurantsLoading
  const update = updateRestaurant
  // Salvarea din Setări (lotul G1, recenzia CodeRabbit pe #358): valorile
  // regionale salvate de om sunt autoritatea, deci o intenție de copiere
  // rămasă de la crearea locației nu mai are voie să le suprascrie la
  // următoarea încărcare — se șterge pe orice salvare reușită care le atinge.
  const updateFromSettings = useCallback(
    async (id: string, fields: Parameters<typeof updateRestaurant>[1]) => {
      const res = await updateRestaurant(id, fields)
      if (
        !res.error &&
        ('country' in fields || 'currency' in fields || 'timezone' in fields || 'language' in fields)
      )
        clearPendingRegional(id)
      return res
    },
    [updateRestaurant],
  )
  // Mod fondator/partener: restaurantul activ e vizitat, nu al userului.
  const inFounderView = founderViewId != null && founderViewId === activeId
  // Partenerul (afiliat, mig 286) intră pe Produse: Acasă citește comenzi/rapoarte.
  // Eticheta bannerului de vizită și ținta „Ieși” vin din ORIGINEA vizitei,
  // legată de cont (lib/founder.ts), nu din rol: pe o eroare a lui my_role
  // rolul cade fail-closed pe `partner`, iar fondatorul ar fi fost etichetat
  // agent și trimis la /afiliat. Rolul rămâne doar fallback-ul pentru o
  // cheie de origine lipsă.
  const isPartner = activeRole === 'partner'
  const visitOrigin = inFounderView
    ? (getFounderViewOrigin(user?.id) ?? (isPartner ? 'afiliat' : 'founder'))
    : null
  // Ecranul de pornire: partenerul intră pe Produse (Acasă citește comenzi și
  // rapoarte, pe care politicile lui nu le acoperă).
  const defaultTab: Tab = isPartner ? 'products' : 'home'
  // Tab-ul stă în URL (`?tab=…`, lotul R2): restaurat la montare, actualizat la
  // fiecare schimbare (push → Back revine la tab-ul precedent) și recitit pe
  // `popstate`. `requestedTab` = ce a cerut omul (URL / click); tab-ul AFIȘAT
  // (`tab`, mai jos) poate fi Acasă cât timp cel cerut nu e permis. Un `?tab=`
  // necunoscut cade pe Acasă; unul nepermis se CORECTEAZĂ în URL doar pe un
  // plan CUNOSCUT (efectul de mai jos) — cât planul se încarcă sau citirea lui
  // a eșuat, doar se afișează Acasă, iar un „Reîncearcă" reușit readuce tab-ul.
  const [requestedTab, setTabState] = useState<Tab>(
    () => tabFromSearch(window.location.search) ?? defaultTab,
  )
  // Ultimele valori, pentru ascultătorul de `popstate` (montat o singură dată).
  const shownTabRef = useRef<Tab>(requestedTab)
  const navigateRef = useRef(navigate)

  // Setările sunt UN formular împărțit pe sub-tab-uri: între ele formularul
  // rămâne montat, dar ieșirea din Setări îl demontează — cu modificări
  // nesalvate întrebăm întâi, la click ȘI la Back/Forward (recenzia #335).
  const settingsDirtyRef = useRef(false)
  // O singură confirmare deschisă: clicurile repetate cât e deschisă nu
  // stivuiesc dialoguri (recenzia #335).
  const confirmPendingRef = useRef(false)
  // Stabil (useCallback): e dependența efectului din SettingsTab.
  const setSettingsDirty = useCallback((dirty: boolean) => {
    settingsDirtyRef.current = dirty
  }, [])
  const commitTab = (next: Tab) => {
    setTabState(next)
    const path = dashboardPathFor(next)
    if (window.location.pathname + window.location.search !== path) navigateRef.current(path)
  }
  // Formularul Setărilor e montat ȘI are modificări nesalvate.
  const hasUnsavedSettings = () =>
    settingsDirtyRef.current && settingsSectionOf(shownTabRef.current) != null
  const leavesDirtySettings = (next: Tab) => hasUnsavedSettings() && settingsSectionOf(next) == null
  // Doar întrebarea: `true` = omul acceptă pierderea. NU atinge
  // `settingsDirtyRef` — apelantul decide (la „Adaugă o locație" formularul
  // rămâne modificat dacă omul închide apoi dialogul fără să creeze nimic).
  // O întrebare deja deschisă face ca a doua să întoarcă `false`.
  const askDiscardSettings = (copy: DiscardCopy): Promise<boolean> => {
    if (confirmPendingRef.current) return Promise.resolve(false)
    confirmPendingRef.current = true
    return confirmDialog({ ...copy, destructive: true }).finally(() => {
      confirmPendingRef.current = false
    })
  }
  // Cere confirmarea ieșirii din Setări; `onLeave` rulează doar pe „Pleacă".
  const leaveSettingsCopy: DiscardCopy = {
    title: t('unsaved_title'),
    description: t('unsaved_leaveDesc'),
    confirmLabel: t('unsaved_leaveConfirm'),
    cancelLabel: t('unsaved_stayInSettings'),
  }
  const confirmLeaveSettings = (onLeave: () => void, copy: DiscardCopy = leaveSettingsCopy) => {
    void askDiscardSettings(copy).then((ok) => {
      if (!ok) return
      settingsDirtyRef.current = false
      onLeave()
    })
  }
  const setTab = (next: Tab) => {
    if (next === requestedTab && next === shownTabRef.current) return
    if (leavesDirtySettings(next)) {
      confirmLeaveSettings(() => commitTab(next))
      return
    }
    commitTab(next)
  }
  // Ascultătorul de `popstate` citește ultima variantă a funcțiilor de mai sus.
  const popHandlerRef = useRef<(next: Tab) => void>(() => {})
  useEffect(() => {
    navigateRef.current = navigate
    popHandlerRef.current = (next: Tab) => {
      if (leavesDirtySettings(next)) {
        // Browserul a mutat deja URL-ul: îl refacem pe tab-ul curent (Setările
        // rămân montate), apoi întrebăm — la „Pleacă" mergem unde a cerut Back-ul.
        navigateRef.current(dashboardPathFor(shownTabRef.current))
        confirmLeaveSettings(() => commitTab(next))
        return
      }
      setTabState(next)
    }
  })

  // Back/Forward: tab-ul urmează URL-ul. Doar cât suntem pe /dashboard — la
  // ieșirea din panou App demontează pagina oricum.
  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname !== '/dashboard') return
      popHandlerRef.current(tabFromSearch(window.location.search) ?? defaultTab)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [defaultTab])

  const isAdminRole = activeRole === 'owner' || activeRole === 'manager'
  // Fiecare rol vede EXACT ce poate face (serverul refuză oricum restul):
  //   - abonamentul îl gestionează doar PROPRIETARUL (managerul n-are client
  //     Stripe; fondatorul în vizită e „manager" virtual, nu proprietar);
  //   - AI-ul (ai-proxy): TOATE funcțiile doar cu membership real owner/manager;
  //     agentul cu acces acordat are DOAR importul din poză și traducerea
  //     (`AGENT_FEATURES`); fondatorul în vizită nu are nici membership, nici
  //     acces de agent, deci niciun AI;
  //   - partenerul (mig 286) nu are rețete (stocuri) și nu rotește QR-uri
  //     (`rotate_qr_token` verifică membership-ul, fără escape de partener).
  const isOwnerRole = activeRole === 'owner' && !inFounderView
  const canUseAi = isAdminRole && !inFounderView
  // Munca de MENIU cu AI (import din poză, traducere) — `AGENT_FEATURES` din
  // ai-proxy: o are și agentul cu acces acordat (has_partner_access, PR #307).
  const canUseAiMenu = canUseAi || isPartner

  // Un local pe care panoul îl va deschide trebuie să fie în AMBELE liste —
  // membership-urile din context (altfel `activeRole` e null pe el: panoul îl
  // tratează ca pe un străin până la reload) și restaurantele (altfel panoul
  // cade pe `restaurants[0]`). Ce lipsește se recitește; verificarea se face
  // pe listele ÎNTOARSE, nu pe props/state-ul încă nerandat. `force` = recitire
  // necondiționată (locația tocmai creată).
  const ensureLocationLoaded = async (restaurantId: string, force: boolean): Promise<boolean> => {
    const needMembers = force || !memberships.some((m) => m.restaurant_id === restaurantId)
    const needList = force || !restaurants.some((r) => r.id === restaurantId)
    const [rows, list] = await Promise.all([
      needMembers ? reloadMemberships() : Promise.resolve(memberships),
      needList ? refetchRestaurants() : Promise.resolve(restaurants),
    ])
    return (
      rows != null &&
      rows.some((m) => m.restaurant_id === restaurantId) &&
      list != null &&
      list.some((r) => r.id === restaurantId)
    )
  }

  // „Adaugă o locație" (lotul A): după `create_restaurant`, AMBELE liste se
  // recitesc ÎNAINTE de `setActive`. Dacă una pică sau nu conține locația
  // nouă (useData.load doar setează `error`), restaurantul activ e deja salvat
  // (setActive → localStorage), deci o reîncărcare completă îl deschide.
  const handleLocationCreated = async (restaurantId: string) => {
    // Lotul G1: locația nouă pornește cu țara, moneda, fusul și limba de bază
    // ale celei din care a fost creată (`create_restaurant` pune default-urile
    // românești). Pentru un local românesc `regionalPatchFrom` dă null, deci
    // niciun apel în plus. Patch-ul ÎNTREG se păstrează întâi ca intenție
    // (lib/pendingCountry, recenzia CodeRabbit pe #358): dacă UPDATE-ul pică,
    // efectul de mai jos îl reîncearcă la încărcarea locației, cu moneda, fusul
    // și limba sursei — nu doar cu țara și default-urile ei.
    const regional = regionalPatchFrom(restaurant)
    if (regional) {
      storePendingRegional(restaurantId, regional)
      try {
        const { error } = await update(restaurantId, regional)
        if (error) console.warn('[locații] setările regionale ale locației noi n-au fost copiate', error)
        else clearPendingRegional(restaurantId)
      } catch (e) {
        console.warn('[locații] setările regionale ale locației noi n-au fost copiate', e)
      }
    }
    const ok = await ensureLocationLoaded(restaurantId, true)
    // Pierderea modificărilor nesalvate din Setări a fost acceptată ÎNAINTE de
    // creare (`confirmBeforeOpen` pe „Adaugă o locație"), iar recitirea forțată
    // de mai sus a re-sincronizat deja formularul: o a doua întrebare (din
    // `setTab('home')`) n-ar mai avea nimic de salvat. Rezidual acceptat: o
    // imagine al cărei upload se termină cât e deschis dialogul de creare poate
    // modifica formularul după acord, iar comutarea nu mai întreabă.
    settingsDirtyRef.current = false
    setActive(restaurantId)
    if (!ok) {
      hardReloadTo('/dashboard')
      return
    }
    setTab('home')
  }

  // „Deschide" din „Toate locațiile": un id necunoscut contextului (locație
  // creată pe alt dispozitiv, acces primit între timp) se recitește ÎNTÂI; dacă
  // tot lipsește, eroarea ajunge pe ecran în locul comutării.
  const openLocation = async (restaurantId: string) => {
    const ok = await ensureLocationLoaded(restaurantId, false)
    if (!ok) {
      throw new Error(t('err_locationNotListed'))
    }
    setActive(restaurantId)
    setTab('home')
  }
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null)
  const [isPlatAdmin, setIsPlatAdmin] = useState(false)
  const isMobile = useIsMobile()

  // CTA-urile din emailurile de facturare (payment_failed/recovered, trial,
  // factură) trimit la /dashboard?tab=billing — fără efectul ăsta parametrul
  // era IGNORAT, iar userul (adesea unul cu plata picată) ateriza pe Acasă fără
  // nicio direcție. `billing` e un alias al sub-tab-ului Setări → Abonament &
  // cont (lib/dashboardNav.ts, lotul R2); aici doar scroll + centrare pe cardul
  // „Abonament & facturare" (SettingsTab e lazy → poll scurt până apare).
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

  // Platform admin (fondatorul) — deblochează butonul „Panou fondator”
  // (consumul AI global stă în /founder). Re-verificat la FIECARE schimbare de cont și
  // resetat întâi la false: cu deps `[]`, după o schimbare directă de cont
  // butonul fondatorului rămânea pe ecranul contului nou.
  const userId = user?.id ?? null
  useEffect(() => {
    let cancelled = false
    setIsPlatAdmin(false)
    if (!userId) return
    void isPlatformAdmin().then((v) => {
      // null (eroare de verificare) → tratăm ca non-admin AICI: doar ascunde
      // butonul „Panou fondator”, fără consecințe de acces (spre deosebire de
      // FounderPage).
      if (!cancelled) setIsPlatAdmin(v === true)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  // Sursă unică de adevăr pentru restaurantul selectat = `activeId` din
  // RestaurantContext (persistat în localStorage, sincron cu `activeRole`).
  // Nu mai ținem un `selectedId` local — evita desincronizarea rol/tab pe
  // staff cu roluri diferite pe restaurante diferite.
  const restaurant = restaurants.find((r) => r.id === activeId) ?? restaurants[0] ?? null

  // Selectorul de restaurant din bara laterală NU demontează formularul
  // Setărilor (aceeași cheie `settings-form`, aceleași sub-tab-uri pe orice
  // plan): SettingsTab primește doar alt `restaurant`, iar efectul lui pe
  // `[restaurant]` rescrie formularul cu datele localului nou — modificările
  // nesalvate s-ar pierde TĂCUT. Deci, cu modificări nesalvate, întrebăm
  // întâi; la „Rămân aici" select-ul controlat revine singur pe localul curent.
  const switchRestaurant = (nextId: string) => {
    if (nextId === restaurant?.id) return
    if (!hasUnsavedSettings()) {
      setActive(nextId)
      return
    }
    const nextName =
      restaurants.find((r) => r.id === nextId)?.name ?? t('unsaved_otherRestaurant')
    confirmLeaveSettings(() => setActive(nextId), {
      title: t('unsaved_title'),
      description: t('unsaved_switchDesc', { next: nextName, current: restaurant?.name ?? '' }),
      confirmLabel: t('unsaved_switchConfirm'),
      cancelLabel: t('unsaved_stayHere'),
    })
  }
  const features = useFeatures(restaurant?.id ?? null)
  const modulesState = useRestaurantModules(restaurant?.id ?? null)

  // Țara aleasă la onboarding (.com) al cărei UPDATE a picat: o reîncercăm O
  // DATĂ per restaurant și per încărcare, doar pentru OWNER-ul real (nu în
  // founder-view — trg_restaurants_country_owner_only, mig 296). Pe .ro nu
  // există niciodată o intenție păstrată → no-op (lib/pendingCountry.ts).
  const countryRetriedRef = useRef<Set<string>>(new Set())
  const restaurantId = restaurant?.id ?? null
  const restaurantCountry = restaurant?.country ?? null
  // Lotul G1: și restul setărilor regionale, pentru intenția locației noi.
  const restaurantCurrency = restaurant?.currency ?? null
  const restaurantTimezone = restaurant?.timezone ?? null
  const restaurantLanguage = restaurant?.language ?? null
  const isRealOwner =
    activeRole === 'owner' && !inFounderView && restaurant != null && restaurant.owner_id === user?.id
  useEffect(() => {
    if (!restaurantId || !isRealOwner) return
    if (countryRetriedRef.current.has(restaurantId)) return
    countryRetriedRef.current.add(restaurantId)
    void retryPendingCountry({
      restaurantId,
      currentCountry: restaurantCountry,
      isOwner: true,
      update: async (patch) => {
        const { error } = await update(restaurantId, patch)
        return { error }
      },
    }).then((res) => {
      if (res === 'failed') {
        console.warn('[dashboard] țara restaurantului încă nesalvată — reîncerc la următoarea încărcare')
      }
    })
    // Locația nouă (lotul G1): setările regionale copiate de la sursă.
    void retryPendingRegional({
      restaurantId,
      current: {
        country: restaurantCountry,
        currency: restaurantCurrency,
        timezone: restaurantTimezone,
        language: restaurantLanguage,
      },
      isOwner: true,
      update: async (patch) => {
        const { error } = await update(restaurantId, patch)
        return { error }
      },
    }).then((res) => {
      if (res === 'failed') {
        console.warn('[locații] setările regionale ale locației încă necopiate — reîncerc la următoarea încărcare')
      }
    })
  }, [
    restaurantId,
    restaurantCountry,
    restaurantCurrency,
    restaurantTimezone,
    restaurantLanguage,
    isRealOwner,
    update,
  ])

  // Planul aparține RESTAURANTULUI, nu user-ului (CLAUDE.md §3): citim
  // get_restaurant_features, corect și pentru staff (un waiter pe restaurant
  // 'free' care e owner 'pro' altundeva nu trebuie să vadă limite/tab-uri 'pro').
  // Cât timp features se încarcă → fallback 'free' (cel mai restrictiv) pentru
  // GATING. Dar fallback-ul nu e un fapt: `planKnown` (perf-staff-3) ține
  // separat „știm planul" de „planul e free" — banda „Demo gratuit", eticheta
  // planului și upsell-ul de pe Acasă apar DOAR pe un plan cunoscut, altfel un
  // plătitor vedea „Plan Gratuit 0/15" la fiecare încărcare sau blip de RPC.
  const plan = features.features?.plan ?? 'free'
  const planKnown = features.features != null

  // DOUĂ tier-uri (surfaceTiers, lib/features.ts): `tier` = planul (gating
  // general, inclusiv feature-urile NEfiscale de Plan 3: harta sălii,
  // statistici, program echipă); `money` = moneyTier, DOAR pe suprafețele de
  // bani/bon (plăți, bonuri, casă, facturi, încasări, TVA) — coborât sub 3
  // pentru un restaurant din afara României (mig 296). Pe RO sunt identice.
  const { general: tier, money } = surfaceTiers(features.features)
  // CE VEDE planul în tab-uri (lib/planSurface.ts, lotul P): planurile
  // inferioare nu văd nimic din cele superioare. `tier`/`money` de mai sus
  // rămân DOAR pentru filtrul NAV_GROUPS (minTier, lib/dashboardNav.ts).
  // `null` = planul nu e cunoscut: nici funcția, nici upsell-ul.
  const surface = planSurface(features.features)
  const fiscalSurface = surface?.fiscal === true
  // Upsell-ul unic de pe Acasă. Plata la masă și bonul există doar pentru un
  // restaurant din România, pe site-ul .ro (mig 296, lib/siteMarket.ts).
  const upsell = planUpsellTarget(surface, {
    fiscalMarket: (restaurant?.country ?? 'RO') === 'RO' && browserSite() === 'ro',
  })

  // Mod „doar ridicare" (food truck, E3): mesele/rezervările ies din nav.
  // Ambele flag-uri trebuie pornite — pickup_only fără pickup activ e inert —
  // ȘI planul nu are voie să fie CUNOSCUT fără `pickup_orders`: după un
  // downgrade setarea rămâne stocată, dar din mig 309 pagina publică nu arată
  // ridicarea și `create_order` o refuză, deci localul are nevoie exact de
  // mese/rezervări ('suspended' → nav complet). Pe planul necunoscut
  // (features în încărcare / RPC picat) rămâne comportamentul stocat, fără
  // pâlpâirea nav-ului la fiecare încărcare. Sursa unică: `pickupOnlyMode`,
  // citit și de Mese (TablesManager) pentru empty state.
  const pickupOnly =
    pickupOnlyMode(restaurant?.pickup_settings, pickupFeatureState(features.features)) === 'on'

  // Grupurile vizibile pe rol + tier + module (Gate D), cu etichetele planului
  // (lib/dashboardNav.ts). Un grup fără niciun sub-tab vizibil dispare complet.
  // „Toate locațiile" (lotul A): adminul cu ≥ 2 localuri la care e admin
  // (membership-uri REALE — vizita de fondator nu se numără, lib/locations.ts).
  const multiLocation = hasMultipleLocations(memberships, founderViewId)
  const visibleGroups = visibleNavGroups({
    isAdmin: isAdminRole,
    tier,
    money,
    pickupOnly,
    surface,
    isPartnerTab: isPartner ? isPartnerTab : null,
    multiLocation,
  })
  const groupOf = (t: Tab) => visibleGroups.find((g) => g.subTabs.some((st) => st.id === t)) ?? null
  const requestedGroup = groupOf(requestedTab)
  // Tab-ul AFIȘAT: cel cerut, sau Acasă când cel cerut nu e permis și planul nu
  // poate fi cunoscut (citirea a eșuat) — fără să rescriem URL-ul.
  const tab: Tab =
    requestedGroup == null && !planKnown && features.loadError ? defaultTab : requestedTab
  const activeGroup = groupOf(tab)
  // Titlul paginii = eticheta sub-tab-ului din NAV_GROUPS (lotul R2): o singură
  // sursă, deci bara laterală, chip-ul și titlul nu mai pot spune nume diferite.
  const activeSubTab = activeGroup?.subTabs.find((st) => st.id === tab) ?? null
  // Sub-tab-ul curent e o secțiune a formularului de Setări?
  const settingsSection = settingsSectionOf(tab)
  // Grupul care găzduiește Rezervările (punctul de atenție din nav).
  const reservationsGroupId =
    visibleGroups.find((g) => g.subTabs.some((st) => st.id === 'reservations'))?.id ?? null
  useEffect(() => {
    shownTabRef.current = tab
  }, [tab])

  // La schimbarea tab-ului, readucem conținutul în partea de sus — altfel
  // tab-ul nou moștenea poziția de scroll a celui precedent și „începea de jos".
  const contentScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    contentScrollRef.current?.scrollTo(0, 0)
  }, [tab])

  // Tab devenit inaccesibil (demovare rol, downgrade plan, modul oprit) sau
  // cerut din URL dar nepermis → înapoi Acasă, cu URL-ul corectat (replace —
  // Back nu are voie să reîntoarcă pe tab-ul refuzat). DOAR pe un plan
  // CUNOSCUT: cu planul în încărcare filtrul e pe varianta restrictivă (un
  // refresh pe „TVA" ar fi pierdut locul), iar pe o citire eșuată un URL rescris
  // definitiv ar fi împiedicat „Reîncearcă" să readucă tab-ul (recenzia #335).
  useEffect(() => {
    if (requestedGroup != null || !planKnown) return
    setTabState(defaultTab)
    replaceUrl(dashboardPathFor(defaultTab))
  }, [requestedGroup, planKnown, defaultTab, replaceUrl])
  // Spinner doar cât planul se ÎNCARCĂ (nici cunoscut, nici eșuat).
  const navReady = planKnown || features.loadError

  const { limits: planLimits, loading: planLimitsLoading } = usePlanLimits(plan)
  // „Adaugă o locație" (lotul A): DOAR cu limita CUNOSCUTĂ (planul citit ȘI
  // `plan_limits` încărcat) și peste numărul de localuri DEȚINUTE — planul e
  // al proprietarului, deci al restaurantului lui activ. Pe Planurile 1–2
  // (limita 1) cardul nu apare deloc: butonul ar eșua mereu (lotul P).
  const ownedRestaurantIds = restaurants
    .filter((r) => userId != null && r.owner_id === userId)
    .map((r) => r.id)
  const addLocationAllowed = canAddLocation(
    planKnown && !planLimitsLoading ? planLimits.max_restaurants : null,
    rLoading ? null : ownedRestaurantIds.length,
  )
  // Numărul de produse, TRISTATE: `null` = necunoscut (încă se citește sau
  // citirea a eșuat). Înainte o eroare devenea tăcut 0 — „0/15" în bandă și
  // „Adaugă produse" nebifat pe Acasă la un meniu plin (code-health-error-ignored-guards).
  const [productCount, setProductCount] = useState<number | null>(null)
  // Restaurantul pentru care e valid `productCount` — la comutare nu se scurge
  // numărul altui local.
  const productCountForRef = useRef<string | null>(null)
  React.useEffect(() => {
    if (!restaurant) {
      productCountForRef.current = null
      setProductCount(null)
      return
    }
    if (productCountForRef.current !== restaurant.id) setProductCount(null)
    // OPT-2: count-ul alimentează DOAR HomeTab (tab 'home') — navigarea între
    // celelalte tab-uri emitea un query per click fără niciun efect vizibil.
    // (Banda planului gratuit din bara laterală, al doilea consumator, a ieșit
    // în lotul P: upsell-ul e unul singur, pe Acasă.)
    if (tab !== 'home') return
    let cancelled = false
    const countedId = restaurant.id
    void supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', countedId)
      .then(({ count, error }) => {
        // Eroare → rămâne ultima valoare CUNOSCUTĂ (sau null), nu 0.
        if (cancelled || error) return
        productCountForRef.current = countedId
        setProductCount(count ?? 0)
      })
    return () => {
      cancelled = true
    }
  }, [restaurant?.id, tab]) // eslint-disable-line react-hooks/exhaustive-deps

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
        <div style={{ textAlign: 'center', color: D.t2 }}>{t('loading_generic')}</div>
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
          aria-label={t('sidebar_closeMenu')}
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
            {t('sidebar_restaurant')}
          </div>
          {/* Selector: visible only when user manages multiple restaurants */}
          {restaurants.length > 1 ? (
            <select
              value={restaurant.id}
              onChange={(e) => switchRestaurant(e.target.value)}
              aria-label={t('sidebar_chooseRestaurant')}
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
            {/* Punctul spune doar ce ȘTIM: starea abonamentului nu ajunge în
                client (nicio coloană citibilă), deci punctul urmează
                `restaurants.is_active` — meniul public e pornit sau nu. Înainte
                era „Activ" verde fix, pe orice stare (lotul R2). */}
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: restaurant.is_active ? D.green : D.t3,
              }}
            />
            <span
              style={{ fontSize: '0.68rem', color: restaurant.is_active ? D.green : D.t3 }}
              title={t(restaurant.is_active ? 'status_activeTitle' : 'status_inactiveTitle')}
            >
              {t(restaurant.is_active ? 'status_active' : 'status_inactive')}
            </span>
            {/* Numele planului doar când îl ȘTIM — nu „Demo gratuit" din fallback. */}
            {planKnown && (
              <span style={{ fontSize: '0.68rem', color: D.t3, marginLeft: 4 }}>
                · {PLAN_LABELS[plan] || plan}
              </span>
            )}
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
              {t(navGroupLabelKey(g, surface))}
              {/* Punct de atenție: rezervări pending nevăzute (grupul cu Rezervările).
                  Punctul e decorativ; textul ascuns vizual intră în numele
                  accesibil al butonului pentru screen-readers. */}
              {g.id === reservationsGroupId && pendingReservations > 0 && (
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
                    {tp('pendingReservations', pendingReservations)}
                  </span>
                </>
              )}
            </button>
          )
        })}
      </nav>
      {/* Fără bandă de upsell în bara laterală (lotul P): upsell-ul e UNUL,
          pe Acasă, lângă abonament (PlanUpsellCard). */}
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
          <Icon name="eye" size={16} /> {t('sidebar_previewMenu')}
        </button>
        {/* Ecranul de ospătar există doar pe un plan cu echipă (planSurface.staff):
            pe Planul 1 nu are ce arăta. */}
        {isAdminRole && surface?.staff === true && (
          <button
            onClick={onViewWaiter}
            title={t(fiscalSurface ? 'sidebar_waiterTitleFiscal' : 'sidebar_waiterTitle')}
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
            <Icon name="utensils" size={16} /> {t('sidebar_viewAsWaiter')}
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
            title={t('sidebar_founderTitle')}
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
            <Icon name="settings" size={16} /> {t('sidebar_founder')}
          </button>
        )}
        {/* „Ajutor” (mig 303): agentul (cu consimțământ) sau adresa de suport. */}
        <HelpButton restaurantId={restaurant?.id ?? null} enabled={isAdminRole} />
        {/* Ieșirea din cont, pentru ORICE rol (înainte doar în Setări → Cont,
            tab ascuns partenerului). */}
        <SignOutButton variant="sidebar" onSignOut={onSignOut} />
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
            {t(visitOrigin === 'afiliat' ? 'visit_agent' : 'visit_founder', {
              name:
                restaurants.find((r) => r.id === activeId)?.name ?? t('visit_restaurantFallback'),
            })}
          </span>
          <button
            onClick={() => exitFounderView(visitOrigin === 'afiliat' ? '/afiliat' : '/founder')}
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
            <Icon name="arrowLeft" size={14} /> {t('visit_exit')}
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
            aria-label={t('mobile_openMenu')}
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
            {isAdminRole && surface?.staff === true && (
              <button
                onClick={onViewWaiter}
                title={t('sidebar_viewAsWaiter')}
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
              aria-label={t('sidebar_previewMenu')}
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
              <div role="alert" style={{ textAlign: 'center', color: D.t2 }}>
                <div style={{ marginBottom: 12 }}>{t('err_restaurantLoad')}</div>
                <button
                  onClick={() => window.location.reload()}
                  className="pressable"
                  style={{
                    background: D.gold,
                    color: '#000',
                    border: 'none',
                    borderRadius: 9,
                    padding: '9px 16px',
                    minHeight: 40,
                    fontFamily: 'DM Sans,sans-serif',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {tc.t('retry')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {features.loadError && !planKnown && (
                <PlanUnknownBanner onRetry={() => void features.reload()} />
              )}
              {/* Titlul paginii = eticheta sub-tab-ului din NAV_GROUPS (lotul R2):
                  tab-urile nu-și mai scriu propriul titlu, iar rândul cu numele
                  grupului de deasupra chip-urilor a ieșit (grupul e deja marcat
                  în bara laterală). Sub titlu, sub-navigația grupului (chips). */}
              {activeGroup != null && activeSubTab != null && (
                <div style={{ marginBottom: 20 }}>
                  <PageHeader
                    as="h1"
                    title={t(navLabelKey(activeSubTab, surface))}
                    style={{ marginBottom: activeGroup.subTabs.length > 1 ? 12 : 0 }}
                  />
                  {activeGroup.subTabs.length > 1 && (
                  /* Wrapper relativ pentru fade-ul de scroll orizontal */
                  <div style={{ position: 'relative' }}>
                  <div
                    role="group"
                    aria-label={t('chips_aria', {
                      group: t(navGroupLabelKey(activeGroup, surface)),
                    })}
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
                          aria-current={active ? 'page' : undefined}
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
                          {t(navLabelKey(st, surface))}
                          {st.id === 'reservations' && pendingReservations > 0 && (
                            <span
                              aria-label={tp('pendingReservations', pendingReservations)}
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
                  )}
                </div>
              )}
              {/* Tab cerut din URL, încă nepermis cât planul se încarcă: așteptăm
                  planul în loc să aruncăm omul pe Acasă (efectul `navReady`). */}
              {activeGroup == null && !navReady && <InlineSpinner label={t('loading_generic')} />}
              {/* Guard: dacă tab-ul curent nu mai aparține niciunui grup vizibil
                  (rol/tier scăzute în aceeași randare — reset-ul de mai sus
                  rulează abia după commit), NU montăm tab-ul vechi. Altfel un
                  tab admin-only apuca să se monteze o dată și să declanșeze
                  fetch-uri înainte de reset-ul spre 'home'. */}
              {activeGroup != null && (
              // Sub-tab-urile formularului de Setări au aceeași cheie: formularul
              // rămâne montat între ele, deci modificările nesalvate nu se pierd.
              <TabFade key={settingsSection != null ? 'settings-form' : tab}>
              {tab === 'home' && (
                <Suspense fallback={<InlineSpinner label={t('loading_generic')} />}>
                  <HomeTab
                    restaurantId={restaurant.id}
                    restaurantName={restaurant.name}
                    // Ce vede planul (planSurface; `fiscal` pe tier-ul `money`).
                    // `null` = planul NU e încă cunoscut: fără upsell și fără
                    // „totul e gata" (perf-staff-3).
                    surface={surface}
                    upsell={upsell}
                    isAdmin={isAdminRole}
                    isOwner={isOwnerRole}
                    productCount={productCount}
                    pickupOnly={pickupOnly}
                    onNavigate={setTab}
                    onViewMenu={() => onViewMenu(restaurant.slug)}
                    onPricing={onPricing}
                    onOrderQrStands={() =>
                      window.open(
                        `/codvia?slug=${encodeURIComponent(restaurant.slug)}`,
                        '_blank',
                        'noopener',
                      )
                    }
                  />
                </Suspense>
              )}
              {tab === 'locatii' && (
                <Suspense fallback={<InlineSpinner label={t('loading_locations')} />}>
                  <LocationsTab
                    activeId={restaurant.id}
                    onOpen={openLocation}
                  />
                </Suspense>
              )}
              {tab === LIVE_ORDERS_TAB && (
                <OrdersHub
                  onViewWaiter={onViewWaiter}
                  onViewKitchen={onViewKitchen}
                  // „plăți la masă" = suprafață de bani (planSurface.fiscal).
                  fiscal={fiscalSurface}
                />
              )}
              {tab === 'products' && (
                <Suspense fallback={<InlineSpinner label={t('loading_products')} />}>
                  <ProductsTab
                    restaurantId={restaurant.id}
                    plan={plan}
                    onUpgrade={() => {
                      // Cu planul NECUNOSCUT limita e cea de fallback (free), deci un
                      // „Ai atins limita" ar minți un plătitor: reîncercăm planul.
                      if (!planKnown) {
                        void features.reload()
                        return
                      }
                      setUpgradeReason(productLimitReason(plan, planLimits.max_products))
                    }}
                    userId={user?.id || ''}
                    menuLanguages={restaurant.menu_languages ?? []}
                    baseLang={menuBaseLang(restaurant.language)}
                    canUseAi={canUseAi}
                    canUseAiMenu={canUseAiMenu}
                    canManageRecipes={!isPartner}
                    surface={surface}
                    // Cotele TVA stau în Setări → Comenzi & plăți; partenerul
                    // n-are fila Setări.
                    onOpenVatRates={isPartner ? undefined : () => setTab('settings-orders')}
                    onOpenTranslations={() => setTab('traduceri')}
                  />
                </Suspense>
              )}
              {tab === 'categories' && (
                <Suspense fallback={<InlineSpinner label={t('loading_categories')} />}>
                  <CategoriesTab
                    restaurantId={restaurant.id}
                    menuLanguages={restaurant.menu_languages ?? []}
                    baseLang={menuBaseLang(restaurant.language)}
                  />
                </Suspense>
              )}
              {tab === 'modificatori' && (
                <Suspense fallback={<InlineSpinner label={t('loading_modifiers')} />}>
                  <ModifiersTab
                    restaurantId={restaurant.id}
                    menuLanguages={restaurant.menu_languages ?? []}
                    baseLang={menuBaseLang(restaurant.language)}
                  />
                </Suspense>
              )}
              {tab === 'traduceri' && (
                <Suspense fallback={<InlineSpinner label={t('loading_translations')} />}>
                  <TranslationsTab
                    // Alt local = alte ciorne și altă limbă aleasă.
                    key={restaurant.id}
                    restaurantId={restaurant.id}
                    slug={restaurant.slug}
                    menuLanguages={restaurant.menu_languages ?? []}
                    baseLang={menuBaseLang(restaurant.language)}
                    // Traducerea AI = munca de MENIU din ai-proxy (o are și
                    // partenerul cu acces; fondatorul în vizită nu).
                    canTranslateAi={canUseAiMenu}
                    // Opțiunile și extra-urile există doar pe planul cu comenzi;
                    // `null` = planul necunoscut → nu se încarcă.
                    showOptions={surface == null ? null : surface.extras === true}
                    isFlipbook={resolveEffectiveMenuLayout(restaurant.theme_settings) === 'flipbook'}
                    // Limbile meniului se aleg din Setări; partenerul n-are Setările.
                    onOpenLanguageSettings={isAdminRole ? () => setTab('settings-menu') : undefined}
                  />
                </Suspense>
              )}
              {tab === 'mese' && (
                <Suspense fallback={<InlineSpinner label={t('loading_tables')} />}>
                  <TablesManager restaurant={restaurant} canRotateQr={!isPartner} />
                </Suspense>
              )}
              {tab === 'analytics' && (
                <Suspense fallback={<InlineSpinner label={t('loading_charts')} />}>
                  <AnalyticsTab
                    restaurantId={restaurant.id}
                    plan={plan}
                    fiscalEnabled={features.features?.features?.fiscal_receipt?.enabled ?? null}
                  />
                </Suspense>
              )}
              {tab === 'raport' && (
                <Suspense fallback={<InlineSpinner label={t('loading_report')} />}>
                  <ReportsTab restaurantId={restaurant.id} fiscalReports={fiscalSurface} />
                </Suspense>
              )}
              {tab === 'arhitectura' && (
                <Suspense fallback={<InlineSpinner label={t('loading_floorPlan')} />}>
                  <FloorPlanEditor
                    key={restaurant.id}
                    restaurantId={restaurant.id}
                    initialLayout={
                      (restaurant.floor_layout as unknown as FloorLayout | null) ?? null
                    }
                    onSaved={(layout) =>
                      patchRestaurantLocal(restaurant.id, {
                        floor_layout: layout as unknown as Record<string, unknown>,
                      })
                    }
                  />
                </Suspense>
              )}
              {tab === 'echipa' && (
                <Suspense fallback={<InlineSpinner label={t('loading_team')} />}>
                  <TeamManager
                    restaurant={restaurant}
                    currentUserId={user?.id || ''}
                    canInvite={!inFounderView}
                  />
                </Suspense>
              )}
              {tab === 'ture' && (
                <Suspense fallback={<InlineSpinner label={t('loading_assignments')} />}>
                  <WaiterAssignments restaurantId={restaurant.id} />
                </Suspense>
              )}
              {/* Fără prompt-uri de upgrade în tab-uri (lotul P): fila e vizibilă
                  doar pe planul care o are (NAV_GROUPS), iar upsell-ul e unul,
                  pe Acasă. Pe o nepotrivire rară (feature oprit pe plan) fila
                  rămâne goală, nu promite alt plan. */}
              {tab === 'gestiune' && surface?.stocks === true && (
                <Suspense fallback={<InlineSpinner label={t('loading_stock')} />}>
                  <StocksTab restaurantId={restaurant.id} showVat={surface.vat} />
                </Suspense>
              )}
              {tab === 'tva' && features.has('reports_vat') && (
                <Suspense fallback={<InlineSpinner label={t('loading_vatReport')} />}>
                  <VatReportTab restaurantId={restaurant.id} />
                </Suspense>
              )}
              {tab === 'casa-tura' && features.has('shifts') && (
                <Suspense fallback={<InlineSpinner label={t('loading_generic')} />}>
                  <CashRegisterTab restaurantId={restaurant.id} />
                </Suspense>
              )}
              {tab === 'happy-hour' && (
                <Suspense fallback={<InlineSpinner label={t('loading_generic')} />}>
                  <HappyHourTab restaurantId={restaurant.id} payAtTable={fiscalSurface} />
                </Suspense>
              )}
              {tab === 'invoices' && fiscalSurface && (
                <Suspense fallback={<InlineSpinner label={t('loading_invoices')} />}>
                  <InvoicesTab restaurantId={restaurant.id} restaurantName={restaurant.name} />
                </Suspense>
              )}
              {tab === 'reservations' &&
                (reservationsModuleOn ? (
                  <Suspense fallback={<InlineSpinner label={t('loading_reservations')} />}>
                    <ReservationsTab restaurantId={restaurant.id} />
                  </Suspense>
                ) : (
                  <EmptyState
                    icon="calendar"
                    title={t('resv_disabledTitle')}
                    description={t('resv_disabledDesc')}
                    action={
                      <button
                        onClick={() => setTab('settings-orders')}
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
                        {t('resv_enableInSettings')}
                      </button>
                    }
                  />
                ))}
              {/* Planul 2 = imprimanta din bucătărie (mig 227); planul cu bon
                  adaugă secțiunile fiscale. Fila e minTier 2 în NAV_GROUPS. */}
              {tab === 'casa-marcat' && (
                <Suspense fallback={<InlineSpinner label={t('loading_generic')} />}>
                  <BridgeTab restaurantId={restaurant.id} fiscalEnabled={fiscalSurface} />
                </Suspense>
              )}
              {settingsSection != null && (
                <Suspense fallback={<InlineSpinner label={t('loading_settings')} />}>
                  <SettingsTab
                    section={settingsSection}
                    isOwner={isOwnerRole}
                    onDirtyChange={setSettingsDirty}
                    planLoadError={features.loadError && !planKnown}
                    onRetryPlan={() => void features.reload()}
                    restaurant={restaurant}
                    onUpdate={updateFromSettings}
                    plan={plan}
                    onSignOut={onSignOut}
                    // „Vezi planurile" pleacă din panou (/pricing): cu formularul
                    // modificat, aceeași confirmare ca la schimbarea tab-ului
                    // (recenzia CodeRabbit pe #351 — altfel modificările se pierdeau).
                    onPricing={() =>
                      settingsDirtyRef.current ? confirmLeaveSettings(onPricing) : onPricing()
                    }
                    modulesState={modulesState}
                    founderView={inFounderView}
                    surface={surface}
                    addLocation={
                      isOwnerRole && userId && addLocationAllowed
                        ? {
                            onCreated: handleLocationCreated,
                            // ÎNAINTE de creare: recitirea de după creare dă
                            // restaurantului curent un obiect nou, care
                            // re-sincronizează formularul oricum ar răspunde
                            // omul. `askDiscardSettings` lasă formularul marcat
                            // ca modificat dacă omul închide apoi dialogul.
                            confirmBeforeOpen: () =>
                              hasUnsavedSettings()
                                ? askDiscardSettings({
                                    title: t('unsaved_title'),
                                    description: t('unsaved_addLocationDesc'),
                                    confirmLabel: t('unsaved_addLocationConfirm'),
                                    cancelLabel: t('unsaved_stayInSettings'),
                                  })
                                : Promise.resolve(true),
                            ownerId: userId,
                            knownRestaurantIds: ownedRestaurantIds,
                          }
                        : undefined
                    }
                  />
                </Suspense>
              )}
              {/* Fila AI e minTier 2 în NAV_GROUPS — vizibilă doar pe planul care o are. */}
              {tab === 'ai' && (
                <Suspense fallback={<InlineSpinner label={t('loading_ai')} />}>
                  <AiSettingsTab restaurantId={restaurant.id} readOnly={inFounderView} />
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
        {restaurant && canUseAi && (
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
                {g.id === reservationsGroupId && pendingReservations > 0 && (
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
                      {tp('pendingReservations', pendingReservations)}
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
                {t(navGroupLabelKey(g, surface))}
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
