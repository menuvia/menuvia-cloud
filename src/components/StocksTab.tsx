// ─────────────────────────────────────────────────────────────
// StocksTab — Modul gestiune stocuri (Dashboard tab nou)
//
// Subtaburi:
//   • Ingrediente — listă cu CRUD, ajustare manuală, alerte low stock
//   • Furnizori — listă cu CRUD
//   • NIR — purchase orders (intrări marfă)
//   • Profitabilitate — view product margin
//
// Limba personalului (lotul L5b): tot textul vine din namespace-ul `stocks` (+
// „Anulează”/„Salvează”/„Șterge”/„Editează”/„Reîncearcă” din `common`). Tab-ul
// e LENEȘ în DashboardPage; componenta principală cere AMBELE namespace-uri SUS,
// înaintea oricărui return, iar secțiunile și fișele (montate condiționat) le
// citesc pe ACELEAȘI — deja încărcate, deci o fișă deschisă prima oară într-o
// limbă nouă nu suspendă fila (precondiția L4b/L4c). Erorile fișelor se țin ca
// DATE (`StockFormError`) și se traduc la randare (lib/stockMessages.ts).
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { FocusTrap } from './ui/FocusTrap'
import { useIsMobile } from '../hooks/useIsMobile'
import { confirm as confirmDialog } from './ui/confirm'
import { D } from '../lib/constants'
import { InlineSpinner } from './PageLoader'
import { Icon, type IconName } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import { fetchVatRates, getVatRate, type VatRate } from '../lib/vat'
import { toRomaniaYMD } from '../lib/dates'
import {
  fetchIngredients,
  createIngredient,
  updateIngredient,
  deleteIngredient,
  adjustStockManual,
  fetchSuppliers,
  createSupplier,
  fetchPurchaseOrders,
  receivePurchaseOrder,
  createPurchaseOrder,
  fetchProductProfitability,
  formatStockT,
  unitSymbolT,
  MANUAL_ADJUST_NOTE,
} from '../lib/stocks'
import type {
  Ingredient,
  IngredientUnit,
  Supplier,
  PurchaseOrder,
  ProductProfitability,
} from '../lib/stocks'
import Autocomplete from './Autocomplete'
import { stockFormErrorText, vatGroupLabel, type StockFormError } from '../lib/stockMessages'
import { useT } from '../i18n/useT'
import { stocksNs } from '../i18n/ns/stocks'
import { commonNs } from '../i18n/ns/common'
import { fillNodes } from '../i18n/fillNodes'
import { staffLocale } from '../i18n/format'

interface Props {
  restaurantId: string
  // Cotele TVA (ingredient, NIR) doar pe planul cu bon — planSurface.vat, lotul
  // P. Pe Planul 2 ingredientele n-au câmp de cotă, iar NIR-ul e simplificat.
  showVat: boolean
}

type SubTab = 'ingredients' | 'suppliers' | 'purchases' | 'profitability'

const UNITS: IngredientUnit[] = ['g', 'kg', 'ml', 'l', 'buc', 'pachet']

const btn = (style: React.CSSProperties = {}): React.CSSProperties => ({
  padding: '8px 14px',
  borderRadius: 8,
  fontSize: '0.82rem',
  fontWeight: 600,
  fontFamily: 'DM Sans, sans-serif',
  cursor: 'pointer',
  border: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  // Touch target ≥44px pe mobil (ospătari/patroni pe telefon) — vizual
  // butoanele rămân compacte, doar zona de atins crește.
  minHeight: 44,
  ...style,
})

const inp = (style: React.CSSProperties = {}): React.CSSProperties => ({
  padding: '8px 12px',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 7,
  color: D.t1,
  fontSize: '0.85rem',
  fontFamily: 'DM Sans, sans-serif',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  ...style,
})

// Escape închide modalul (același contract ca ui/ConfirmDialog). `active`
// permite apelul necondiționat al hook-ului din secțiuni cu modal inline.
function useEscapeClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active, onClose])
}

export default function StocksTab({ restaurantId, showVat }: Props) {
  const { t, tp } = useT(stocksNs)
  const tc = useT(commonNs)
  const [subTab, setSubTab] = useState<SubTab>('ingredients')
  const [stats, setStats] = useState<{
    ingredientsCount: number
    lowStockCount: number
    suppliersCount: number
    pendingNirs: number
    totalStockValue: number
  } | null>(null)

  // Eroarea de stats nu mai e mută: fără ea, cardurile de sus lipseau tăcut
  // (stats rămânea null) și nici ghidul de bun venit nu apărea. Bara de
  // eroare e discretă (stats-urile-s secundare), dar oferă „Reîncearcă".
  const [statsError, setStatsError] = useState(false)
  const [statsReload, setStatsReload] = useState(0)

  // Load quick stats
  useEffect(() => {
    void (async () => {
      setStatsError(false)
      try {
        const [ings, sups, pos] = await Promise.all([
          fetchIngredients(restaurantId),
          fetchSuppliers(restaurantId),
          fetchPurchaseOrders(restaurantId),
        ])
        const lowStock = ings.filter(
          (i) => i.min_stock_alert != null && i.current_stock < i.min_stock_alert,
        )
        const pending = pos.filter((p) => p.status === 'draft')
        const stockValue = ings.reduce((sum, i) => sum + i.current_stock * i.cost_per_unit, 0)
        setStats({
          ingredientsCount: ings.length,
          lowStockCount: lowStock.length,
          suppliersCount: sups.length,
          pendingNirs: pending.length,
          totalStockValue: stockValue,
        })
      } catch (err) {
        console.error('Stats load error:', err)
        setStatsError(true)
      }
    })()
  }, [restaurantId, subTab, statsReload]) // refresh when changing sub-tabs

  const isFirstTime = stats != null && stats.ingredientsCount === 0 && stats.suppliersCount === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: '0.85rem', color: D.t3, lineHeight: 1.5 }}>
          {t('intro')}
        </div>
      </div>

      {/* Eroare la sumarul de sus — discretă, cu retry (nu blochează tab-urile). */}
      {statsError && stats == null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
            background: D.s2,
            border: `1px solid ${D.border}`,
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: '0.8rem',
            color: D.t2,
          }}
        >
          {t('stats_loadError')}
          <button
            onClick={() => setStatsReload((n) => n + 1)}
            style={{
              background: 'transparent',
              color: D.gold,
              border: `1px solid ${D.gold}55`,
              borderRadius: 8,
              padding: '7px 12px',
              minHeight: 44,
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
            }}
          >
            {tc.t('retry')}
          </button>
        </div>
      )}

      {/* Quick stats — appear when there's data */}
      {stats != null && !isFirstTime && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 10,
          }}
        >
          <StatCard
            label={t('stat_ingredients')}
            value={String(stats.ingredientsCount)}
            sub={stats.lowStockCount === 0 ? t('stat_allOk') : tp('stat_belowMin', stats.lowStockCount)}
            color={stats.lowStockCount > 0 ? '#E0A050' : D.t1}
            icon="leaf"
          />
          <StatCard
            label={t('stat_stockValue')}
            // Bani: formatul de dinainte (ro-RO, fără zecimale) + „lei”, în orice limbă.
            value={t('money', {
              amount: stats.totalStockValue.toLocaleString('ro-RO', { maximumFractionDigits: 0 }),
            })}
            sub={t('stat_stockValueSub')}
            color={D.t1}
            icon="tag"
          />
          <StatCard
            label={t('stat_suppliers')}
            value={String(stats.suppliersCount)}
            sub={stats.suppliersCount === 0 ? t('stat_suppliersNone') : t('stat_suppliersActive')}
            color={D.t1}
            icon="box"
          />
          <StatCard
            label={t('stat_nirs')}
            value={String(stats.pendingNirs)}
            sub={stats.pendingNirs === 0 ? t('stat_allOk') : t('stat_nirsPending')}
            color={stats.pendingNirs > 0 ? D.gold : D.t1}
            icon="receipt"
          />
        </div>
      )}

      {/* First-time welcome */}
      {isFirstTime && (
        <div
          style={{
            background: `linear-gradient(135deg, ${D.s2} 0%, ${D.goldA} 100%)`,
            border: `1px solid ${D.gold}33`,
            borderRadius: 14,
            padding: '20px 22px',
          }}
        >
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.2rem',
              fontWeight: 600,
              color: D.t1,
              marginBottom: 6,
              letterSpacing: '-0.01em',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Icon name="sparkle" size={18} />
            {t('welcome_title')}
          </div>
          <div style={{ fontSize: '0.85rem', color: D.t2, marginBottom: 14, lineHeight: 1.5 }}>
            {t('welcome_desc')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: D.gold,
                  color: '#000',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                1
              </span>
              <div style={{ flex: 1, fontSize: '0.82rem', color: D.t2, lineHeight: 1.5 }}>
                {fillNodes(t('welcome_step1'), {
                  title: <strong style={{ color: D.t1 }}>{t('welcome_step1Title')}</strong>,
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: D.gold,
                  color: '#000',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                2
              </span>
              <div style={{ flex: 1, fontSize: '0.82rem', color: D.t2, lineHeight: 1.5 }}>
                {fillNodes(t('welcome_step2'), {
                  title: <strong style={{ color: D.t1 }}>{t('welcome_step2Title')}</strong>,
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: D.gold,
                  color: '#000',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                3
              </span>
              <div style={{ flex: 1, fontSize: '0.82rem', color: D.t2, lineHeight: 1.5 }}>
                {fillNodes(t('welcome_step3'), {
                  title: <strong style={{ color: D.t1 }}>{t('welcome_step3Title')}</strong>,
                })}
              </div>
            </div>
          </div>
          <button
            onClick={() => setSubTab('ingredients')}
            style={{
              marginTop: 16,
              padding: '10px 18px',
              minHeight: 44,
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 9,
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
            }}
          >
            {t('welcome_cta')}
          </button>
        </div>
      )}

      {/* Sub-tabs — scroll orizontal pe mobil (4 taburi nu încap pe 375px) */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: `1px solid ${D.border}`,
          paddingBottom: 0,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {(
          [
            { id: 'ingredients', label: t('tab_ingredients'), icon: 'leaf' },
            { id: 'suppliers', label: t('tab_suppliers'), icon: 'box' },
            { id: 'purchases', label: t('tab_purchases'), icon: 'receipt' },
            { id: 'profitability', label: t('tab_profitability'), icon: 'tag' },
          ] as const
        ).map((tabDef) => (
          <button
            key={tabDef.id}
            onClick={() => setSubTab(tabDef.id)}
            style={{
              padding: '10px 16px',
              minHeight: 44,
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${subTab === tabDef.id ? D.gold : 'transparent'}`,
              color: subTab === tabDef.id ? D.gold : D.t2,
              fontSize: '0.85rem',
              fontWeight: 600,
              fontFamily: 'DM Sans, sans-serif',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name={tabDef.icon} size={15} />
            <span>{tabDef.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div>
        {subTab === 'ingredients' && (
          <IngredientsSection restaurantId={restaurantId} showVat={showVat} />
        )}
        {subTab === 'suppliers' && <SuppliersSection restaurantId={restaurantId} />}
        {subTab === 'purchases' && (
          <PurchasesSection restaurantId={restaurantId} showVat={showVat} />
        )}
        {subTab === 'profitability' && <ProfitabilitySection restaurantId={restaurantId} />}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// INGREDIENTS section
// ═══════════════════════════════════════════════════════════════
function IngredientsSection({
  restaurantId,
  showVat,
}: {
  restaurantId: string
  showVat: boolean
}) {
  const st = useT(stocksNs)
  const { t, tp } = st
  const tc = useT(commonNs)
  const [items, setItems] = useState<Ingredient[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Ingredient | null>(null)
  const [adjustingId, setAdjustingId] = useState<string | null>(null)
  // Cotele TVA REALE ale restaurantului (VatRatesEditor / mig cote 21-11) —
  // hardcodarea 9/19/5/0 afișa cote pre-august 2025, contrazicând Raport TVA.
  const [vatRates, setVatRates] = useState<VatRate[]>([])

  useEffect(() => {
    // Fără cote pe plan (lotul P) nu se cer deloc.
    if (!showVat) return
    let cancelled = false
    fetchVatRates(restaurantId)
      .then((r) => {
        if (!cancelled) setVatRates(r)
      })
      .catch(() => {
        /* fallback: etichete „Grupa N" (`vat_group`) din vatGroupLabel */
      })
    return () => {
      cancelled = true
    }
  }, [restaurantId, showVat])

  const [loadError, setLoadError] = useState(false)
  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const data = await fetchIngredients(restaurantId)
      setItems(data)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [restaurantId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <InlineSpinner label={t('ing_loading')} />
  if (loadError) return <LoadErrorBox label={t('ing_loadError')} onRetry={() => void load()} />

  const lowStock = items.filter(
    (i) => i.min_stock_alert != null && i.current_stock < i.min_stock_alert,
  )
  const lowNames = lowStock
    .slice(0, 3)
    .map((i) => i.name)
    .join(', ')
  const lowLine = lowStock.length > 3 ? tp('ing_lowMore', lowStock.length - 3, { names: lowNames }) : lowNames

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {lowStock.length > 0 && (
        <div
          style={{
            background: 'rgba(224,160,80,0.12)',
            border: `1px solid #E0A050`,
            borderRadius: 10,
            padding: '12px 16px',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <span style={{ color: '#E0A050', display: 'inline-flex', flexShrink: 0 }}>
            <Icon name="alert" size={22} />
          </span>
          <div style={{ flex: 1 }}>
            <div
              style={{ fontSize: '0.88rem', fontWeight: 700, color: '#E0A050', marginBottom: 2 }}
            >
              {tp('ing_lowCount', lowStock.length)}
            </div>
            <div style={{ fontSize: '0.78rem', color: D.t2 }}>{lowLine}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.85rem', color: D.t3 }}>
          {items.length === 0 ? t('ing_none') : tp('ing_count', items.length)}
        </div>
        <button onClick={() => setShowAdd(true)} style={btn({ background: D.gold, color: '#000' })}>
          <Icon name="plus" size={15} />
          {t('ing_add')}
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="leaf"
          title={t('ing_emptyTitle')}
          description={t('ing_emptyDesc')}
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 10,
          }}
        >
          {items.map((ing) => {
            const isLow = ing.min_stock_alert != null && ing.current_stock < ing.min_stock_alert
            return (
              <div
                key={ing.id}
                style={{
                  background: D.s2,
                  border: `1px solid ${isLow ? '#E0A050' : D.border}`,
                  borderRadius: 12,
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: '1.3rem' }}>{ing.emoji ?? '🥬'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '0.92rem',
                        fontWeight: 600,
                        color: D.t1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {ing.name}
                    </div>
                    {ing.category && (
                      <div style={{ fontSize: '0.7rem', color: D.t3 }}>{ing.category}</div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontFamily: 'Fraunces,serif',
                      fontSize: '1.2rem',
                      fontWeight: 700,
                      color: isLow ? '#E0A050' : D.t1,
                    }}
                  >
                    {formatStockT(ing.current_stock, ing.unit, st)}
                  </span>
                  {ing.min_stock_alert != null && (
                    <span style={{ fontSize: '0.7rem', color: D.t3 }}>
                      {t('ing_min', { amount: formatStockT(ing.min_stock_alert, ing.unit, st) })}
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.78rem',
                    color: D.t3,
                  }}
                >
                  <span>
                    {t('ing_costPerUnit', {
                      amount: ing.cost_per_unit.toFixed(2),
                      unit: unitSymbolT(ing.unit, st),
                    })}
                  </span>
                  {showVat && <span>{t('vat_badge', { rate: vatGroupLabel(vatRates, ing.vat_group, st) })}</span>}
                </div>

                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button
                    onClick={() => setAdjustingId(ing.id)}
                    style={btn({
                      flex: 1,
                      background: D.s3,
                      color: D.t2,
                      border: `1px solid ${D.border}`,
                      fontSize: '0.74rem',
                      padding: '6px 10px',
                    })}
                  >
                    {t('ing_adjust')}
                  </button>
                  <button
                    onClick={() => setEditing(ing)}
                    style={btn({
                      background: D.s3,
                      color: D.t2,
                      border: `1px solid ${D.border}`,
                      fontSize: '0.74rem',
                      padding: '6px 10px',
                    })}
                  >
                    {tc.t('edit')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && (
        <IngredientModal
          restaurantId={restaurantId}
          vatRates={vatRates}
          showVat={showVat}
          ingredient={null}
          onClose={() => setShowAdd(false)}
          onSave={() => {
            setShowAdd(false)
            void load()
          }}
        />
      )}
      {editing && (
        <IngredientModal
          restaurantId={restaurantId}
          vatRates={vatRates}
          showVat={showVat}
          ingredient={editing}
          onClose={() => setEditing(null)}
          onSave={() => {
            setEditing(null)
            void load()
          }}
        />
      )}
      {adjustingId && (
        <AdjustStockModal
          ingredient={items.find((i) => i.id === adjustingId)!}
          onClose={() => setAdjustingId(null)}
          onSave={() => {
            setAdjustingId(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

// ── Modal: Adaugă/Edit Ingredient ─────────────────────────────
function IngredientModal({
  restaurantId,
  vatRates,
  showVat,
  ingredient,
  onClose,
  onSave,
}: {
  restaurantId: string
  vatRates: VatRate[]
  // Cota TVA a ingredientului doar pe planul cu bon (lotul P); altfel grupa
  // rămâne cea salvată (implicit 1), fără câmp.
  showVat: boolean
  ingredient: Ingredient | null
  onClose: () => void
  onSave: () => void
}) {
  const st = useT(stocksNs)
  const { t } = st
  const tc = useT(commonNs)
  const [name, setName] = useState(ingredient?.name ?? '')
  const [unit, setUnit] = useState<IngredientUnit>(ingredient?.unit ?? 'kg')
  const [stock, setStock] = useState(String(ingredient?.current_stock ?? '0'))
  const [minAlert, setMinAlert] = useState(String(ingredient?.min_stock_alert ?? ''))
  const [cost, setCost] = useState(String(ingredient?.cost_per_unit ?? '0'))
  const [vatGroup, setVatGroup] = useState(ingredient?.vat_group ?? 1)
  const [emoji, setEmoji] = useState(ingredient?.emoji ?? '')
  const [category, setCategory] = useState(ingredient?.category ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<StockFormError | null>(null)
  const isMobile = useIsMobile()

  async function save() {
    if (name.trim().length === 0) {
      setError({ kind: 'nameRequired' })
      return
    }
    setSaving(true)
    setError(null)
    try {
      const fields: Partial<Ingredient> = {
        name: name.trim(),
        unit,
        current_stock: parseFloat(stock) || 0,
        min_stock_alert: minAlert.length > 0 ? parseFloat(minAlert) : null,
        cost_per_unit: parseFloat(cost) || 0,
        vat_group: vatGroup,
        emoji: emoji.length > 0 ? emoji : null,
        category: category.length > 0 ? category : null,
      }
      if (ingredient) {
        await updateIngredient(ingredient.id, fields)
      } else {
        await createIngredient(restaurantId, fields)
      }
      onSave()
    } catch (err) {
      setError({ kind: 'server', err })
      setSaving(false)
    }
  }

  useEscapeClose(true, onClose)

  return (
    <div onClick={onClose} style={modalBg}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ing-modal-title"
        style={modalCard}
      >
        <FocusTrap />
        <div
          id="ing-modal-title"
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.3rem',
            fontWeight: 600,
            color: D.t1,
            marginBottom: 16,
          }}
        >
          {ingredient ? t('ingm_titleEdit') : t('ingm_titleNew')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 10 }}>
            <div>
              <label style={lbl} htmlFor="ing-emoji">
                {t('ingm_emoji')}
              </label>
              <input
                id="ing-emoji"
                style={inp()}
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="🥬"
                maxLength={4}
              />
            </div>
            <div>
              <label style={lbl} htmlFor="ing-name">
                {t('ingm_name')}
              </label>
              <input
                id="ing-name"
                style={inp()}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('ingm_namePh')}
              />
            </div>
          </div>

          <div>
            <label style={lbl} htmlFor="ing-category">
              {t('ingm_category')}
            </label>
            <input
              id="ing-category"
              style={inp()}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={t('ingm_categoryPh')}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl} htmlFor="ing-unit">
                {t('ingm_unit')}
              </label>
              <select
                id="ing-unit"
                style={inp({ height: 36 })}
                value={unit}
                onChange={(e) => setUnit(e.target.value as IngredientUnit)}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {unitSymbolT(u, st)}
                  </option>
                ))}
              </select>
            </div>
            {showVat && (
            <div>
              <label style={lbl} htmlFor="ing-vat">
                {t('ingm_vat')}
              </label>
              <select
                id="ing-vat"
                style={inp({ height: 36 })}
                value={vatGroup}
                onChange={(e) => setVatGroup(parseInt(e.target.value))}
              >
                {/* Cotele REALE ale restaurantului (VatRatesEditor) — hardcodarea
                    9/19/5/0 afișa cotele pre-august 2025. Fallback pe grupele
                    generice doar dacă fetch-ul a eșuat. */}
                {vatRates.length > 0 ? (
                  vatRates.map((r) => (
                    <option key={r.vat_group} value={r.vat_group}>
                      {r.rate_percent}% ({r.label})
                    </option>
                  ))
                ) : (
                  [1, 2, 3, 4].map((g) => (
                    <option key={g} value={g}>
                      {t('vat_group', { n: g })}
                    </option>
                  ))
                )}
              </select>
            </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl} htmlFor="ing-stock">
                {t('ingm_stock', { unit: unitSymbolT(unit, st) })}
              </label>
              <input
                id="ing-stock"
                style={inp()}
                type="number"
                step="0.01"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
              />
            </div>
            <div>
              <label style={lbl} htmlFor="ing-min-alert">
                {t('ingm_minAlert', { unit: unitSymbolT(unit, st) })}
              </label>
              <input
                id="ing-min-alert"
                style={inp()}
                type="number"
                step="0.01"
                value={minAlert}
                onChange={(e) => setMinAlert(e.target.value)}
                placeholder={t('ingm_optional')}
              />
            </div>
          </div>

          <div>
            <label style={lbl} htmlFor="ing-cost">
              {t('ingm_cost', { unit: unitSymbolT(unit, st) })}
            </label>
            <input
              id="ing-cost"
              style={inp()}
              type="number"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
            <div style={{ fontSize: '0.7rem', color: D.t3, marginTop: 4 }}>
              {t('ingm_costHint')}
            </div>
          </div>

          {error == null ? null : (
            <div
              style={{
                padding: '8px 12px',
                background: 'rgba(192,57,43,0.1)',
                border: '1px solid #c0392b44',
                borderRadius: 6,
                color: '#c0392b',
                fontSize: '0.78rem',
              }}
            >
              {stockFormErrorText(error, st, tc)}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            {ingredient && (
              <button
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: t('ingm_deleteTitle', { name: ingredient.name }),
                    confirmLabel: tc.t('delete'),
                    // EXPLICIT: implicitul urmează <html lang> (pe panou `ro`).
                    cancelLabel: tc.t('cancel'),
                    destructive: true,
                  })
                  if (!ok) return
                  await deleteIngredient(ingredient.id)
                  onSave()
                }}
                style={btn({
                  background: 'transparent',
                  color: '#c0392b',
                  border: `1px solid #c0392b44`,
                })}
              >
                {tc.t('delete')}
              </button>
            )}
            <button
              onClick={onClose}
              style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
            >
              {tc.t('cancel')}
            </button>
            <button
              disabled={saving}
              onClick={() => void save()}
              style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.6 : 1 })}
            >
              {saving ? t('saving') : tc.t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal: Ajustare stoc manuală ──────────────────────────────
function AdjustStockModal({
  ingredient,
  onClose,
  onSave,
}: {
  ingredient: Ingredient
  onClose: () => void
  onSave: () => void
}) {
  const st = useT(stocksNs)
  const { t } = st
  const tc = useT(commonNs)
  const [newAmount, setNewAmount] = useState(String(ingredient.current_stock))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<StockFormError | null>(null)

  async function save() {
    const n = parseFloat(newAmount)
    if (isNaN(n) || n < 0) {
      setError({ kind: 'qtyInvalid' })
      return
    }
    setSaving(true)
    try {
      // Nota implicită e DATĂ (stock_movements.notes), nu text de ecran.
      await adjustStockManual(ingredient.id, n, notes || MANUAL_ADJUST_NOTE)
      onSave()
    } catch (err) {
      setError({ kind: 'server', err })
      setSaving(false)
    }
  }

  useEscapeClose(true, onClose)

  return (
    <div onClick={onClose} style={modalBg}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="adjust-modal-title"
        style={modalCard}
      >
        <FocusTrap />
        <div
          id="adjust-modal-title"
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.3rem',
            fontWeight: 600,
            color: D.t1,
            marginBottom: 4,
          }}
        >
          {t('ing_adjust')}
        </div>
        <div style={{ fontSize: '0.85rem', color: D.t2, marginBottom: 16 }}>
          {ingredient.emoji} {ingredient.name}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={lbl} htmlFor="adjust-amount">
              {t('adj_current', { amount: formatStockT(ingredient.current_stock, ingredient.unit, st) })}
            </label>
            <input
              id="adjust-amount"
              style={inp()}
              type="number"
              step="0.01"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
            />
            <div style={{ fontSize: '0.7rem', color: D.t3, marginTop: 4 }}>
              {t('adj_hint')}
            </div>
          </div>

          <div>
            <label style={lbl} htmlFor="adjust-notes">
              {t('adj_reason')}
            </label>
            <input
              id="adjust-notes"
              style={inp()}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('adj_reasonPh')}
            />
          </div>

          {error == null ? null : (
            <div
              style={{
                padding: '8px 12px',
                background: 'rgba(192,57,43,0.1)',
                borderRadius: 6,
                color: '#c0392b',
                fontSize: '0.78rem',
              }}
            >
              {stockFormErrorText(error, st, tc)}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
            >
              {tc.t('cancel')}
            </button>
            <button
              disabled={saving}
              onClick={() => void save()}
              style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.6 : 1 })}
            >
              {saving ? t('saving') : tc.t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// SUPPLIERS section
// ═══════════════════════════════════════════════════════════════
function SuppliersSection({ restaurantId }: { restaurantId: string }) {
  const { t, tp } = useT(stocksNs)
  const tc = useT(commonNs)
  const [items, setItems] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [vatId, setVatId] = useState('')

  // Escape închide modalul inline „Furnizor nou" (a11y dialog).
  useEscapeClose(showAdd, () => setShowAdd(false))

  const [loadError, setLoadError] = useState(false)
  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const data = await fetchSuppliers(restaurantId)
      setItems(data)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [restaurantId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (name.trim().length === 0) return
    await createSupplier(restaurantId, {
      name: name.trim(),
      phone: phone.length > 0 ? phone : null,
      email: email.length > 0 ? email : null,
      vat_id: vatId.length > 0 ? vatId : null,
    })
    setName('')
    setPhone('')
    setEmail('')
    setVatId('')
    setShowAdd(false)
    await load()
  }

  if (loading) return <InlineSpinner label={t('sup_loading')} />
  if (loadError) return <LoadErrorBox label={t('sup_loadError')} onRetry={() => void load()} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.85rem', color: D.t3 }}>{tp('sup_count', items.length)}</div>
        <button onClick={() => setShowAdd(true)} style={btn({ background: D.gold, color: '#000' })}>
          <Icon name="plus" size={15} />
          {t('sup_add')}
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon="box" title={t('sup_empty')} />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 10,
          }}
        >
          {items.map((s) => (
            <div
              key={s.id}
              style={{
                background: D.s2,
                border: `1px solid ${D.border}`,
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div style={{ fontSize: '0.92rem', fontWeight: 600, color: D.t1, marginBottom: 4 }}>
                {s.name}
              </div>
              {s.vat_id && (
                <div style={{ fontSize: '0.72rem', color: D.t3, marginBottom: 2 }}>
                  {t('sup_vatId', { id: s.vat_id })}
                </div>
              )}
              {s.phone && (
                <div
                  style={{
                    fontSize: '0.78rem',
                    color: D.t2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Icon name="phone" size={13} /> {s.phone}
                </div>
              )}
              {s.email && (
                <div
                  style={{
                    fontSize: '0.78rem',
                    color: D.t2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Icon name="mail" size={13} /> {s.email}
                </div>
              )}
              {s.payment_terms_days > 0 && (
                <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 4 }}>
                  {tp('sup_terms', s.payment_terms_days)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={modalBg}>
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="supplier-modal-title"
            style={modalCard}
          >
            <FocusTrap />
            <div
              id="supplier-modal-title"
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: '1.3rem',
                fontWeight: 600,
                color: D.t1,
                marginBottom: 16,
              }}
            >
              {t('supm_title')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={lbl} htmlFor="supplier-name">
                  {t('supm_name')}
                </label>
                <input
                  id="supplier-name"
                  style={inp()}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('supm_namePh')}
                />
              </div>
              <div>
                <label style={lbl} htmlFor="supplier-vat">
                  {t('supm_vat')}
                </label>
                <input
                  id="supplier-vat"
                  style={inp()}
                  value={vatId}
                  onChange={(e) => setVatId(e.target.value)}
                  placeholder={t('supm_vatPh')}
                />
              </div>
              <div>
                <label style={lbl} htmlFor="supplier-phone">
                  {t('supm_phone')}
                </label>
                <input
                  id="supplier-phone"
                  style={inp()}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('supm_phonePh')}
                />
              </div>
              <div>
                <label style={lbl} htmlFor="supplier-email">
                  {t('supm_email')}
                </label>
                <input
                  id="supplier-email"
                  style={inp()}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button
                  onClick={() => setShowAdd(false)}
                  style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
                >
                  {tc.t('cancel')}
                </button>
                <button
                  onClick={() => void add()}
                  style={btn({ background: D.gold, color: '#000' })}
                >
                  {tc.t('save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PURCHASES section (NIR — full CRUD)
// ═══════════════════════════════════════════════════════════════
function PurchasesSection({
  restaurantId,
  showVat,
}: {
  restaurantId: string
  showVat: boolean
}) {
  const { t, tp, lang } = useT(stocksNs)
  const tc = useT(commonNs)
  const [items, setItems] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  // Cotele TVA reale ale restaurantului — opțiunile NIR nu mai sunt hardcodate.
  const [vatRates, setVatRates] = useState<VatRate[]>([])

  useEffect(() => {
    // NIR-ul simplificat (Planul 2, lotul P) nu are cote — nu se cer.
    if (!showVat) return
    let cancelled = false
    fetchVatRates(restaurantId)
      .then((r) => {
        if (!cancelled) setVatRates(r)
      })
      .catch(() => {
        /* fallback: opțiunile legacy din select */
      })
    return () => {
      cancelled = true
    }
  }, [restaurantId, showVat])

  const [loadError, setLoadError] = useState(false)
  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const [pos, sups, ings] = await Promise.all([
        fetchPurchaseOrders(restaurantId),
        fetchSuppliers(restaurantId),
        fetchIngredients(restaurantId),
      ])
      setItems(pos)
      setSuppliers(sups)
      setIngredients(ings)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [restaurantId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <InlineSpinner label={t('nir_loading')} />
  if (loadError) return <LoadErrorBox label={t('nir_loadError')} onRetry={() => void load()} />

  const canCreate = ingredients.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div style={{ fontSize: '0.85rem', color: D.t3, flex: 1 }}>
          {items.length === 0 ? t('nir_none') : tp('nir_count', items.length)}
        </div>
        <button
          disabled={!canCreate}
          onClick={() => setShowAdd(true)}
          style={btn({
            background: canCreate ? D.gold : D.s3,
            color: canCreate ? '#000' : D.t3,
            opacity: canCreate ? 1 : 0.6,
          })}
        >
          <Icon name="plus" size={15} />
          {t('nir_new')}
        </button>
      </div>

      {!canCreate && (
        <div
          style={{
            background: D.s2,
            border: `1px dashed ${D.border}`,
            borderRadius: 10,
            padding: '12px 16px',
            fontSize: '0.78rem',
            color: D.t2,
            lineHeight: 1.5,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <span style={{ color: D.gold, flexShrink: 0, display: 'inline-flex', marginTop: 1 }}>
            <Icon name="info" size={15} />
          </span>
          {t('nir_needIngredient')}
        </div>
      )}

      {items.length === 0 && canCreate ? (
        <EmptyState
          icon="receipt"
          title={t('nir_emptyTitle')}
          description={t('nir_emptyDesc')}
        />
      ) : items.length === 0 ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((po) => {
            const supplier = suppliers.find((s) => s.id === po.supplier_id)
            return (
              <div
                key={po.id}
                style={{
                  background: D.s2,
                  border: `1px solid ${D.border}`,
                  borderRadius: 10,
                  padding: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600, color: D.t1 }}>
                    {po.invoice_number ?? t('nir_fallbackName', { id: po.id.slice(0, 8) })}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: D.t3 }}>
                    {supplier?.name ?? '—'} ·{' '}
                    {/* invoice_date vine ISO (YYYY-MM-DD) — formatăm la fel ca fallback-ul,
                        altfel lista amestecă două formate de dată. Locale-ul personalului
                        (`staffLocale`: în română EXACT „ro-RO” de dinainte). */}
                    {new Date(po.invoice_date ?? po.created_at).toLocaleDateString(staffLocale(lang))}
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: 'Fraunces,serif',
                    fontSize: '1.05rem',
                    fontWeight: 700,
                    color: D.t1,
                  }}
                >
                  {t('money', { amount: po.total.toFixed(2) })}
                </div>
                <div
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: 100,
                    background:
                      po.status === 'received'
                        ? 'rgba(76,175,110,0.15)'
                        : po.status === 'paid'
                          ? 'rgba(200,150,60,0.15)'
                          : D.s3,
                    color:
                      po.status === 'received' ? D.green : po.status === 'paid' ? D.gold : D.t3,
                  }}
                >
                  {po.status === 'draft'
                    ? t('nir_status_draft')
                    : po.status === 'received'
                      ? t('nir_status_received')
                      : po.status === 'paid'
                        ? t('nir_status_paid')
                        : t('nir_status_cancelled')}
                </div>
                {po.status === 'draft' && (
                  <button
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: t('nir_receiveTitle'),
                        description: t('nir_receiveDesc'),
                        confirmLabel: t('nir_receive'),
                        // EXPLICIT: implicitul urmează <html lang> (pe panou `ro`).
                        cancelLabel: tc.t('cancel'),
                      })
                      if (!ok) return
                      await receivePurchaseOrder(po.id)
                      await load()
                    }}
                    style={btn({
                      background: D.gold,
                      color: '#000',
                      fontSize: '0.74rem',
                      padding: '6px 10px',
                    })}
                  >
                    {t('nir_receive')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAdd && (
        <NirCreateModal
          restaurantId={restaurantId}
          vatRates={vatRates}
          showVat={showVat}
          suppliers={suppliers}
          ingredients={ingredients}
          onClose={() => setShowAdd(false)}
          onSave={() => {
            setShowAdd(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

// ── Modal: Creare NIR ─────────────────────────────────────────
interface NirItem {
  ingredient_id: string
  quantity: string
  unit_price: string
  vat_rate: number
}

function NirCreateModal({
  restaurantId,
  vatRates,
  showVat,
  suppliers,
  ingredients,
  onClose,
  onSave,
}: {
  restaurantId: string
  vatRates: VatRate[]
  // NIR SIMPLIFICAT pe planul fără bon (lotul P): fără coloana de TVA și fără
  // defalcare — fiecare linie se salvează cu cota 0, deci totalul e exact ce a
  // tastat omul (cantitate × preț). Pe Planul 3 nimic nu se schimbă.
  showVat: boolean
  suppliers: Supplier[]
  ingredients: Ingredient[]
  onClose: () => void
  onSave: () => void
}) {
  const st = useT(stocksNs)
  const { t } = st
  const tc = useT(commonNs)
  // Default de rând = cota grupei 1 (mâncare) din config; 19 doar ca ultim
  // fallback. Fără TVA pe plan, cota e 0 (NIR simplificat).
  const defaultVat = showVat ? (getVatRate(vatRates, 1) ?? 19) : 0
  const [supplierId, setSupplierId] = useState<string>('')
  const [supplierName, setSupplierName] = useState<string>('') // pentru autocomplete
  const [invoiceNumber, setInvoiceNumber] = useState('')
  // Ziua României, nu UTC: după miezul nopții (00:00–02:00 iarna / 03:00 vara)
  // data UTC arată încă ziua de IERI, iar un NIR introdus după închidere se
  // salva cu data precedentă (`invoice_date` e `date`, mig 026/066).
  const [invoiceDate, setInvoiceDate] = useState<string>(() => toRomaniaYMD(new Date()))
  const [notes, setNotes] = useState('')
  const isMobile = useIsMobile()
  const [items, setItems] = useState<NirItem[]>([
    { ingredient_id: '', quantity: '', unit_price: '', vat_rate: defaultVat },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<StockFormError | null>(null)
  const [receiveImmediately, setReceiveImmediately] = useState(true)

  function addRow() {
    setItems((prev) => [...prev, { ingredient_id: '', quantity: '', unit_price: '', vat_rate: defaultVat }])
  }

  function removeRow(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateRow(idx: number, field: keyof NirItem, value: string | number) {
    setItems((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)))
  }

  // Auto-fill unit price from ingredient cost when ingredient selected
  function selectIngredient(idx: number, ingId: string) {
    const ing = ingredients.find((i) => i.id === ingId)
    setItems((prev) =>
      prev.map((r, i) =>
        i === idx
          ? {
              ...r,
              ingredient_id: ingId,
              unit_price:
                ing && ing.cost_per_unit > 0 ? ing.cost_per_unit.toFixed(2) : r.unit_price,
            }
          : r,
      ),
    )
  }

  // Calculate totals
  let subtotal = 0
  let vatTotal = 0
  for (const it of items) {
    const q = parseFloat(it.quantity) || 0
    const p = parseFloat(it.unit_price) || 0
    const lineNet = q * p
    subtotal += lineNet
    vatTotal += lineNet * (it.vat_rate / 100)
  }
  const total = subtotal + vatTotal

  async function save() {
    // Validate
    const validItems = items.filter(
      (it) => it.ingredient_id.length > 0 && parseFloat(it.quantity) > 0,
    )
    if (validItems.length === 0) {
      setError({ kind: 'noValidItems' })
      return
    }

    setSaving(true)
    setError(null)
    try {
      // Auto-create furnizor dacă a tastat nume dar nu a selectat din listă
      let finalSupplierId: string | null = supplierId.length > 0 ? supplierId : null
      const typedName = supplierName.trim()
      if (!finalSupplierId && typedName.length > 0) {
        const existing = suppliers.find((s) => s.name.toLowerCase() === typedName.toLowerCase())
        if (existing) {
          finalSupplierId = existing.id
        } else {
          const newSup = await createSupplier(restaurantId, { name: typedName })
          finalSupplierId = newSup.id
        }
      }

      const poId = await createPurchaseOrder({
        restaurant_id: restaurantId,
        supplier_id: finalSupplierId,
        invoice_number: invoiceNumber.length > 0 ? invoiceNumber : null,
        invoice_date: invoiceDate.length > 0 ? invoiceDate : null,
        notes: notes.length > 0 ? notes : null,
        items: validItems.map((it) => ({
          ingredient_id: it.ingredient_id,
          quantity: parseFloat(it.quantity),
          unit_price: parseFloat(it.unit_price) || 0,
          vat_rate: it.vat_rate,
        })),
      })

      if (receiveImmediately) {
        await receivePurchaseOrder(poId)
      }

      onSave()
    } catch (err) {
      setError({ kind: 'server', err })
      setSaving(false)
    }
  }

  return (
    <div
      // Formular greu (furnizor, factură, rânduri) — un tap pe fundal pierdea
      // tot; închiderea rămâne pe butoanele explicite (X / Anulează).
      // Din același motiv NU închide nici Escape (pierdere accidentală de date).
      style={modalBg}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nir-modal-title"
        style={{ ...modalCard, maxWidth: 720 }}
      >
        <FocusTrap />
        <div
          id="nir-modal-title"
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.3rem',
            fontWeight: 600,
            color: D.t1,
            marginBottom: 4,
          }}
        >
          {t('nir_new')}
        </div>
        <div style={{ fontSize: '0.78rem', color: D.t3, marginBottom: 18 }}>
          {t('nirm_desc')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Header info */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl}>{t('nirm_supplier')}</label>
              <Autocomplete
                value={supplierName}
                onChange={(v) => {
                  setSupplierName(v)
                  // Dacă numele nu mai matchează exact, șterge supplierId
                  const match = suppliers.find((s) => s.name === v)
                  setSupplierId(match?.id ?? '')
                }}
                onSelect={(idx) => {
                  const sup = suppliers[idx]
                  if (sup) {
                    setSupplierName(sup.name)
                    setSupplierId(sup.id)
                  }
                }}
                options={suppliers.map((s) => s.name)}
                placeholder={t('nirm_supplierPh')}
                emptyHint={t('nirm_supplierCreate', { name: supplierName.trim() })}
                style={{ height: 36 }}
              />
            </div>
            <div>
              <label style={lbl} htmlFor="nir-invoice-date">
                {t('nirm_date')}
              </label>
              <input
                id="nir-invoice-date"
                style={inp()}
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label style={lbl} htmlFor="nir-invoice-number">
              {t('nirm_number')}
            </label>
            <input
              id="nir-invoice-number"
              style={inp()}
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder={t('nirm_numberPh')}
            />
          </div>

          {/* Items table */}
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: D.t1, marginBottom: 8 }}>
              {t('nirm_items')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((it, idx) => {
                const lineNet = (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0)
                const lineTotal = lineNet * (1 + it.vat_rate / 100)
                return (
                  <div
                    key={idx}
                    style={{
                      padding: 12,
                      background: D.s2,
                      borderRadius: 8,
                      border: `1px solid ${D.border}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {/* Row 1: Ingredient + remove */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <select
                        style={{ ...inp({ height: 36, fontSize: '0.82rem' }), flex: 1 }}
                        value={it.ingredient_id}
                        onChange={(e) => selectIngredient(idx, e.target.value)}
                      >
                        <option value="">{t('nirm_pickIngredient')}</option>
                        {ingredients.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.emoji ?? '🥬'} {i.name} ({unitSymbolT(i.unit, st)})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        disabled={items.length === 1}
                        aria-label={t('nirm_removeRow')}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 7,
                          background: 'transparent',
                          border: `1px solid ${D.border}`,
                          color: '#c0392b',
                          cursor: items.length === 1 ? 'not-allowed' : 'pointer',
                          opacity: items.length === 1 ? 0.3 : 1,
                          flexShrink: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                    {/* Row 2: Qty + Price + VAT + Total */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: showVat ? '1fr 1fr 90px' : '1fr 1fr',
                        gap: 6,
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.66rem', color: D.t3, marginBottom: 2 }}>
                          {t('nirm_qty')}
                        </div>
                        <input
                          style={{ ...inp({ height: 34, fontSize: '0.82rem' }) }}
                          type="number"
                          step="0.01"
                          placeholder="0"
                          value={it.quantity}
                          onChange={(e) => updateRow(idx, 'quantity', e.target.value)}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: '0.66rem', color: D.t3, marginBottom: 2 }}>
                          {t('nirm_unitPrice')}
                        </div>
                        <input
                          style={{ ...inp({ height: 34, fontSize: '0.82rem' }) }}
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={it.unit_price}
                          onChange={(e) => updateRow(idx, 'unit_price', e.target.value)}
                        />
                      </div>
                      {showVat && (
                      <div>
                        <div style={{ fontSize: '0.66rem', color: D.t3, marginBottom: 2 }}>{t('nirm_vat')}</div>
                        <select
                          style={{ ...inp({ height: 34, fontSize: '0.82rem' }) }}
                          value={it.vat_rate}
                          onChange={(e) => updateRow(idx, 'vat_rate', parseFloat(e.target.value))}
                        >
                          {/* Cotele reale ale restaurantului; fallback legacy dacă
                              fetch-ul a eșuat. Valoarea curentă rămâne selectabilă
                              chiar dacă nu mai e în listă (rând vechi). */}
                          {(vatRates.length > 0
                            ? [...new Set(vatRates.map((r) => r.rate_percent).concat(it.vat_rate))]
                            : [0, 5, 9, 19, it.vat_rate]
                          )
                            .filter((v, i, arr) => arr.indexOf(v) === i)
                            .sort((a, b) => a - b)
                            .map((v) => (
                              <option key={v} value={v}>
                                {v}%
                              </option>
                            ))}
                        </select>
                      </div>
                      )}
                    </div>
                    {/* Line total */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '6px 10px',
                        background: D.s3,
                        borderRadius: 6,
                      }}
                    >
                      <span style={{ fontSize: '0.74rem', color: D.t3 }}>
                        {showVat ? t('nirm_lineTotalVat') : t('nirm_lineTotal')}
                      </span>
                      <span
                        style={{
                          fontSize: '0.92rem',
                          fontWeight: 700,
                          color: D.t1,
                          fontFamily: 'Fraunces,serif',
                        }}
                      >
                        {t('money', { amount: lineTotal.toFixed(2) })}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
            <button
              type="button"
              onClick={addRow}
              style={{
                marginTop: 8,
                padding: '6px 12px',
                minHeight: 44,
                background: 'transparent',
                border: `1px dashed ${D.border}`,
                color: D.t2,
                fontSize: '0.78rem',
                borderRadius: 7,
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Icon name="plus" size={14} />
              {t('nirm_addRow')}
            </button>
          </div>

          {/* Totals — defalcarea subtotal/TVA doar pe planul cu bon (lotul P). */}
          <div style={{ background: D.s3, borderRadius: 9, padding: 14 }}>
            {showVat && (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.82rem',
                    color: D.t2,
                    marginBottom: 4,
                  }}
                >
                  <span>{t('nirm_subtotal')}</span>
                  <span>{t('money', { amount: subtotal.toFixed(2) })}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.82rem',
                    color: D.t2,
                    marginBottom: 8,
                  }}
                >
                  <span>{t('nirm_vatTotal')}</span>
                  <span>{t('money', { amount: vatTotal.toFixed(2) })}</span>
                </div>
              </>
            )}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '1rem',
                fontWeight: 700,
                color: D.t1,
                fontFamily: 'Fraunces,serif',
                borderTop: `1px solid ${D.border}`,
                paddingTop: 8,
              }}
            >
              <span>{t('nirm_total')}</span>
              <span>{t('money', { amount: total.toFixed(2) })}</span>
            </div>
          </div>

          <div>
            <label style={lbl} htmlFor="nir-notes">
              {t('nirm_notes')}
            </label>
            <input
              id="nir-notes"
              style={inp()}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('nirm_notesPh')}
            />
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: 10,
              background: D.s2,
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: '0.82rem',
              color: D.t1,
            }}
          >
            <input
              type="checkbox"
              checked={receiveImmediately}
              onChange={(e) => setReceiveImmediately(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>{t('nirm_receiveNow')}</div>
              <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 2 }}>
                {t('nirm_receiveNowHint')}
              </div>
            </div>
          </label>

          {error == null ? null : (
            <div
              style={{
                padding: '8px 12px',
                background: 'rgba(192,57,43,0.1)',
                border: '1px solid #c0392b44',
                borderRadius: 6,
                color: '#c0392b',
                fontSize: '0.78rem',
              }}
            >
              {stockFormErrorText(error, st, tc)}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
            >
              {tc.t('cancel')}
            </button>
            <button
              disabled={saving}
              onClick={() => void save()}
              style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.6 : 1 })}
            >
              {saving ? t('saving') : receiveImmediately ? t('nirm_saveReceive') : t('nirm_saveDraft')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PROFITABILITY section
// ═══════════════════════════════════════════════════════════════
function ProfitabilitySection({ restaurantId }: { restaurantId: string }) {
  const { t, tp } = useT(stocksNs)
  const [items, setItems] = useState<ProductProfitability[]>([])
  const [loading, setLoading] = useState(true)
  // Eroarea de încărcare NU cade pe lista goală („niciun produs cu rețetă")
  // — un blip de rețea ar arăta un fals empty state; pattern-ul LoadErrorBox
  // din celelalte 3 secțiuni.
  const [loadError, setLoadError] = useState(false)

  function load() {
    setLoading(true)
    setLoadError(false)
    fetchProductProfitability(restaurantId)
      .then((data) => {
        setItems(data)
        setLoading(false)
      })
      .catch(() => {
        setLoadError(true)
        setLoading(false)
      })
  }

  useEffect(() => {
    load()
  }, [restaurantId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <InlineSpinner label={t('prof_loading')} />
  if (loadError) return <LoadErrorBox label={t('prof_loadError')} onRetry={load} />

  const withCost = items.filter((i) => i.cost_price > 0)
  const noCost = items.filter((i) => i.cost_price === 0)
  const noCostNames = noCost
    .slice(0, 5)
    .map((p) => p.name)
    .join(', ')
  const noCostLine =
    noCost.length > 5 ? tp('prof_more', noCost.length - 5, { names: noCostNames }) : noCostNames

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          background: D.s2,
          border: `1px solid ${D.border}`,
          borderRadius: 12,
          padding: '14px 16px',
          fontSize: '0.82rem',
          color: D.t2,
          lineHeight: 1.55,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <span style={{ color: D.gold, flexShrink: 0, display: 'inline-flex', marginTop: 1 }}>
          <Icon name="info" size={15} />
        </span>
        {t('prof_info')}
      </div>

      {items.length === 0 && (
        <EmptyState icon="tag" title={t('prof_empty')} />
      )}

      {withCost.length > 0 && (
        <div>
          <div
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              color: D.t3,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 8,
            }}
          >
            {t('prof_withRecipe', { n: withCost.length })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {withCost.map((p) => (
              <div
                key={p.product_id}
                style={{
                  background: D.s2,
                  border: `1px solid ${D.border}`,
                  borderRadius: 10,
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600, color: D.t1 }}>{p.name}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.72rem', color: D.t3 }}>
                    {t('prof_cost', { amount: p.cost_price.toFixed(2) })}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: D.t3 }}>
                    {t('prof_sell', { amount: p.sell_price.toFixed(2) })}
                  </div>
                </div>
                <div style={{ minWidth: 80, textAlign: 'right' }}>
                  <div
                    style={{
                      fontFamily: 'Fraunces,serif',
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      color:
                        p.margin_percent > 60
                          ? D.green
                          : p.margin_percent > 30
                            ? D.gold
                            : '#c0392b',
                    }}
                  >
                    {t('prof_marginPct', { pct: p.margin_percent.toFixed(0) })}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: D.t3 }}>{t('prof_margin')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {noCost.length > 0 && (
        <div>
          <div
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              color: D.t3,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 8,
            }}
          >
            {t('prof_noRecipe', { n: noCost.length })}
          </div>
          <div
            style={{
              background: D.s2,
              border: `1px dashed ${D.border}`,
              borderRadius: 10,
              padding: 14,
              fontSize: '0.78rem',
              color: D.t2,
            }}
          >
            {noCostLine}
          </div>
        </div>
      )}
    </div>
  )
}

// ── StatCard ──────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  color,
  icon,
}: {
  label: string
  value: string
  sub?: string
  color?: string
  icon?: IconName
}) {
  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
      >
        <span
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            color: D.t3,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
          }}
        >
          {label}
        </span>
        {icon && (
          <span style={{ color: D.t3, display: 'inline-flex' }}>
            <Icon name={icon} size={15} />
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: 'Fraunces,serif',
          fontSize: '1.4rem',
          fontWeight: 700,
          color: color ?? D.t1,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.7rem', color: D.t3 }}>{sub}</div>}
    </div>
  )
}

// ── Shared styles ──────────────────────────────────────────────
const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: '0.74rem',
  fontWeight: 500,
  color: D.t2,
  marginBottom: 5,
  fontFamily: 'DM Sans, sans-serif',
}

function LoadErrorBox({ label, onRetry }: { label: string; onRetry: () => void }) {
  const tc = useT(commonNs)
  return (
    <div
      style={{
        padding: 20,
        border: `1px solid ${D.border}`,
        borderRadius: 12,
        background: D.s2,
        color: D.t2,
        textAlign: 'center',
      }}
    >
      <div style={{ marginBottom: 12 }}>{label}</div>
      <button onClick={onRetry} style={btn({ background: D.gold, color: '#000' })}>
        {tc.t('retry')}
      </button>
    </div>
  )
}

const modalBg: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 200,
  padding: 20,
}

const modalCard: React.CSSProperties = {
  background: D.s1,
  borderRadius: 14,
  padding: 24,
  maxWidth: 480,
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
}
