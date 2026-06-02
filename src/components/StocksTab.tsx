// ─────────────────────────────────────────────────────────────
// StocksTab — Modul gestiune stocuri (Dashboard tab nou)
//
// Subtaburi:
//   • Ingrediente — listă cu CRUD, ajustare manuală, alerte low stock
//   • Furnizori — listă cu CRUD
//   • NIR — purchase orders (intrări marfă)
//   • Profitabilitate — view product margin
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { confirm as confirmDialog } from './ui/confirm'
import { D } from '../lib/constants'
import { InlineSpinner } from './PageLoader'
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
  formatStock,
} from '../lib/stocks'
import type {
  Ingredient,
  IngredientUnit,
  Supplier,
  PurchaseOrder,
  ProductProfitability,
} from '../lib/stocks'
import Autocomplete from './Autocomplete'

interface Props {
  restaurantId: string
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
  gap: 6,
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

export default function StocksTab({ restaurantId }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('ingredients')
  const [stats, setStats] = useState<{
    ingredientsCount: number
    lowStockCount: number
    suppliersCount: number
    pendingNirs: number
    totalStockValue: number
  } | null>(null)

  // Load quick stats
  useEffect(() => {
    void (async () => {
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
      }
    })()
  }, [restaurantId, subTab]) // refresh when changing sub-tabs

  const isFirstTime = stats != null && stats.ingredientsCount === 0 && stats.suppliersCount === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div>
        <h2
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.6rem',
            color: D.t1,
            letterSpacing: '-0.02em',
            margin: 0,
            marginBottom: 4,
            fontWeight: 600,
          }}
        >
          Gestiune
        </h2>
        <div style={{ fontSize: '0.85rem', color: D.t3, lineHeight: 1.5 }}>
          Stocuri, rețete, furnizori, profitabilitate.
        </div>
      </div>

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
            label="Ingrediente"
            value={String(stats.ingredientsCount)}
            sub={stats.lowStockCount > 0 ? `${stats.lowStockCount} sub prag` : 'toate ok'}
            color={stats.lowStockCount > 0 ? '#E0A050' : D.t1}
            emoji="🥬"
          />
          <StatCard
            label="Valoare stoc"
            value={`${stats.totalStockValue.toFixed(0)} lei`}
            sub="total ingrediente"
            color={D.t1}
            emoji="💰"
          />
          <StatCard
            label="Furnizori"
            value={String(stats.suppliersCount)}
            sub={stats.suppliersCount === 0 ? 'niciunul' : 'activi'}
            color={D.t1}
            emoji="🚚"
          />
          <StatCard
            label="NIR-uri"
            value={String(stats.pendingNirs)}
            sub={stats.pendingNirs > 0 ? 'în așteptare' : 'toate ok'}
            color={stats.pendingNirs > 0 ? D.gold : D.t1}
            emoji="📋"
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
            }}
          >
            👋 Bun venit în Gestiune
          </div>
          <div style={{ fontSize: '0.85rem', color: D.t2, marginBottom: 14, lineHeight: 1.5 }}>
            Modulul de gestiune îți permite să urmărești stocul de ingrediente, să definești rețete
            și să vezi profitabilitatea fiecărui produs.
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
                <strong style={{ color: D.t1 }}>Adaugă ingredientele</strong> — făină, ulei, brânză,
                cașcaval. Pune cantitatea curentă și costul pe unitate.
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
                <strong style={{ color: D.t1 }}>Definește rețetele</strong> — la editarea unui
                produs (ex: Pizza Margherita), adaugi ingrediente cu cantitatea consumată per
                bucată.
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
                <strong style={{ color: D.t1 }}>Vezi profit + stoc automat</strong> — la fiecare
                comandă plătită, ingredientele scad automat și vezi marja per produs.
              </div>
            </div>
          </div>
          <button
            onClick={() => setSubTab('ingredients')}
            style={{
              marginTop: 16,
              padding: '10px 18px',
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
            Începe cu primul ingredient →
          </button>
        </div>
      )}

      {/* Sub-tabs */}
      <div
        style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${D.border}`, paddingBottom: 0 }}
      >
        {(
          [
            { id: 'ingredients', label: 'Ingrediente', emoji: '🥬' },
            { id: 'suppliers', label: 'Furnizori', emoji: '🚚' },
            { id: 'purchases', label: 'NIR', emoji: '📋' },
            { id: 'profitability', label: 'Profitabilitate', emoji: '💰' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              padding: '10px 16px',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${subTab === t.id ? D.gold : 'transparent'}`,
              color: subTab === t.id ? D.gold : D.t2,
              fontSize: '0.85rem',
              fontWeight: 600,
              fontFamily: 'DM Sans, sans-serif',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>{t.emoji}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div>
        {subTab === 'ingredients' && <IngredientsSection restaurantId={restaurantId} />}
        {subTab === 'suppliers' && <SuppliersSection restaurantId={restaurantId} />}
        {subTab === 'purchases' && <PurchasesSection restaurantId={restaurantId} />}
        {subTab === 'profitability' && <ProfitabilitySection restaurantId={restaurantId} />}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// INGREDIENTS section
// ═══════════════════════════════════════════════════════════════
function IngredientsSection({ restaurantId }: { restaurantId: string }) {
  const [items, setItems] = useState<Ingredient[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Ingredient | null>(null)
  const [adjustingId, setAdjustingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const data = await fetchIngredients(restaurantId)
      setItems(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [restaurantId]) // eslint-disable-line

  if (loading) return <InlineSpinner label="Se încarcă stocurile..." />

  const lowStock = items.filter(
    (i) => i.min_stock_alert != null && i.current_stock < i.min_stock_alert,
  )

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
          <span style={{ fontSize: '1.4rem' }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <div
              style={{ fontSize: '0.88rem', fontWeight: 700, color: '#E0A050', marginBottom: 2 }}
            >
              {lowStock.length}{' '}
              {lowStock.length === 1 ? 'ingredient sub prag' : 'ingrediente sub prag'}
            </div>
            <div style={{ fontSize: '0.78rem', color: D.t2 }}>
              {lowStock
                .slice(0, 3)
                .map((i) => i.name)
                .join(', ')}
              {lowStock.length > 3 && ` și încă ${lowStock.length - 3}`}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.85rem', color: D.t3 }}>
          {items.length === 0
            ? 'Niciun ingredient. Adaugă primul!'
            : `${items.length} ingrediente active`}
        </div>
        <button onClick={() => setShowAdd(true)} style={btn({ background: D.gold, color: '#000' })}>
          + Adaugă ingredient
        </button>
      </div>

      {items.length === 0 ? (
        <div
          style={{
            background: D.s2,
            border: `1px dashed ${D.border}`,
            borderRadius: 12,
            padding: 32,
            textAlign: 'center',
            color: D.t3,
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🥬</div>
          <div style={{ fontSize: '0.88rem', marginBottom: 4 }}>
            Niciun ingredient configurat încă
          </div>
          <div style={{ fontSize: '0.75rem' }}>
            Începe cu cele mai folosite (făină, ulei, lapte) și adaugă rețetele la produse
          </div>
        </div>
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
                    {formatStock(ing.current_stock, ing.unit)}
                  </span>
                  {ing.min_stock_alert != null && (
                    <span style={{ fontSize: '0.7rem', color: D.t3 }}>
                      / min {formatStock(ing.min_stock_alert, ing.unit)}
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
                    {ing.cost_per_unit.toFixed(2)} lei / {ing.unit}
                  </span>
                  <span>TVA {[9, 19, 5, 0][ing.vat_group - 1]}%</span>
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
                    Ajustează stoc
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
                    Edit
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
  ingredient,
  onClose,
  onSave,
}: {
  restaurantId: string
  ingredient: Ingredient | null
  onClose: () => void
  onSave: () => void
}) {
  const [name, setName] = useState(ingredient?.name ?? '')
  const [unit, setUnit] = useState<IngredientUnit>(ingredient?.unit ?? 'kg')
  const [stock, setStock] = useState(String(ingredient?.current_stock ?? '0'))
  const [minAlert, setMinAlert] = useState(String(ingredient?.min_stock_alert ?? ''))
  const [cost, setCost] = useState(String(ingredient?.cost_per_unit ?? '0'))
  const [vatGroup, setVatGroup] = useState(ingredient?.vat_group ?? 1)
  const [emoji, setEmoji] = useState(ingredient?.emoji ?? '')
  const [category, setCategory] = useState(ingredient?.category ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (name.trim().length === 0) {
      setError('Numele e obligatoriu')
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
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <div onClick={onClose} style={modalBg}>
      <div onClick={(e) => e.stopPropagation()} style={modalCard}>
        <div
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.3rem',
            fontWeight: 600,
            color: D.t1,
            marginBottom: 16,
          }}
        >
          {ingredient ? 'Editează ingredient' : 'Ingredient nou'}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 10 }}>
            <div>
              <label style={lbl}>Emoji</label>
              <input
                style={inp()}
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="🥬"
                maxLength={4}
              />
            </div>
            <div>
              <label style={lbl}>Nume *</label>
              <input
                style={inp()}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Făină tip 000"
              />
            </div>
          </div>

          <div>
            <label style={lbl}>Categorie (opțional)</label>
            <input
              style={inp()}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="ex: Cereale, Lactate, Băuturi"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl}>Unitate de măsură</label>
              <select
                style={inp({ height: 36 })}
                value={unit}
                onChange={(e) => setUnit(e.target.value as IngredientUnit)}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>Cota TVA</label>
              <select
                style={inp({ height: 36 })}
                value={vatGroup}
                onChange={(e) => setVatGroup(parseInt(e.target.value))}
              >
                <option value={1}>9% (mâncare)</option>
                <option value={2}>19% (alcool)</option>
                <option value={3}>5% (special)</option>
                <option value={4}>0% (scutit)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl}>Stoc curent ({unit})</label>
              <input
                style={inp()}
                type="number"
                step="0.01"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
              />
            </div>
            <div>
              <label style={lbl}>Alertă sub ({unit})</label>
              <input
                style={inp()}
                type="number"
                step="0.01"
                value={minAlert}
                onChange={(e) => setMinAlert(e.target.value)}
                placeholder="Opțional"
              />
            </div>
          </div>

          <div>
            <label style={lbl}>Cost per {unit} (lei)</label>
            <input
              style={inp()}
              type="number"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
            <div style={{ fontSize: '0.7rem', color: D.t3, marginTop: 4 }}>
              Folosit pentru calcul profit. Va fi recalculat automat la fiecare NIR.
            </div>
          </div>

          {error && (
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
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            {ingredient && (
              <button
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: `Șterge ${ingredient.name}?`,
                    confirmLabel: 'Șterge',
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
                Șterge
              </button>
            )}
            <button
              onClick={onClose}
              style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
            >
              Anulează
            </button>
            <button
              disabled={saving}
              onClick={() => void save()}
              style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.6 : 1 })}
            >
              {saving ? 'Salvez...' : 'Salvează'}
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
  const [newAmount, setNewAmount] = useState(String(ingredient.current_stock))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const n = parseFloat(newAmount)
    if (isNaN(n) || n < 0) {
      setError('Cantitate invalidă')
      return
    }
    setSaving(true)
    try {
      await adjustStockManual(ingredient.id, n, notes || 'Ajustare manuală')
      onSave()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <div onClick={onClose} style={modalBg}>
      <div onClick={(e) => e.stopPropagation()} style={modalCard}>
        <div
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.3rem',
            fontWeight: 600,
            color: D.t1,
            marginBottom: 4,
          }}
        >
          Ajustează stoc
        </div>
        <div style={{ fontSize: '0.85rem', color: D.t2, marginBottom: 16 }}>
          {ingredient.emoji} {ingredient.name}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={lbl}>
              Stoc curent: {formatStock(ingredient.current_stock, ingredient.unit)}
            </label>
            <input
              style={inp()}
              type="number"
              step="0.01"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
            />
            <div style={{ fontSize: '0.7rem', color: D.t3, marginTop: 4 }}>
              Pune cantitatea reală pe care o ai în stoc acum
            </div>
          </div>

          <div>
            <label style={lbl}>Motiv (opțional)</label>
            <input
              style={inp()}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ex: Inventar, risipă, schimb furnizor"
            />
          </div>

          {error && (
            <div
              style={{
                padding: '8px 12px',
                background: 'rgba(192,57,43,0.1)',
                borderRadius: 6,
                color: '#c0392b',
                fontSize: '0.78rem',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
            >
              Anulează
            </button>
            <button
              disabled={saving}
              onClick={() => void save()}
              style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.6 : 1 })}
            >
              {saving ? 'Salvez...' : 'Salvează'}
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
  const [items, setItems] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [vatId, setVatId] = useState('')

  async function load() {
    setLoading(true)
    try {
      const data = await fetchSuppliers(restaurantId)
      setItems(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [restaurantId]) // eslint-disable-line

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

  if (loading) return <InlineSpinner label="Se încarcă furnizorii..." />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.85rem', color: D.t3 }}>{items.length} furnizori</div>
        <button onClick={() => setShowAdd(true)} style={btn({ background: D.gold, color: '#000' })}>
          + Adaugă furnizor
        </button>
      </div>

      {items.length === 0 ? (
        <div
          style={{
            background: D.s2,
            border: `1px dashed ${D.border}`,
            borderRadius: 12,
            padding: 32,
            textAlign: 'center',
            color: D.t3,
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🚚</div>
          <div style={{ fontSize: '0.88rem' }}>Niciun furnizor încă</div>
        </div>
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
                  CUI: {s.vat_id}
                </div>
              )}
              {s.phone && <div style={{ fontSize: '0.78rem', color: D.t2 }}>📞 {s.phone}</div>}
              {s.email && <div style={{ fontSize: '0.78rem', color: D.t2 }}>📧 {s.email}</div>}
              {s.payment_terms_days > 0 && (
                <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 4 }}>
                  Termen plată: {s.payment_terms_days} zile
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={modalBg}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <div
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: '1.3rem',
                fontWeight: 600,
                color: D.t1,
                marginBottom: 16,
              }}
            >
              Furnizor nou
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={lbl}>Nume firmă *</label>
                <input
                  style={inp()}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ex: SC Lactate Brașov SRL"
                />
              </div>
              <div>
                <label style={lbl}>CUI / CIF</label>
                <input
                  style={inp()}
                  value={vatId}
                  onChange={(e) => setVatId(e.target.value)}
                  placeholder="RO12345678"
                />
              </div>
              <div>
                <label style={lbl}>Telefon</label>
                <input
                  style={inp()}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="07XX XXX XXX"
                />
              </div>
              <div>
                <label style={lbl}>Email</label>
                <input
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
                  Anulează
                </button>
                <button
                  onClick={() => void add()}
                  style={btn({ background: D.gold, color: '#000' })}
                >
                  Salvează
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
function PurchasesSection({ restaurantId }: { restaurantId: string }) {
  const [items, setItems] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [pos, sups, ings] = await Promise.all([
        fetchPurchaseOrders(restaurantId),
        fetchSuppliers(restaurantId),
        fetchIngredients(restaurantId),
      ])
      setItems(pos)
      setSuppliers(sups)
      setIngredients(ings)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [restaurantId]) // eslint-disable-line

  if (loading) return <InlineSpinner label="Se încarcă NIR-urile..." />

  const canCreate = ingredients.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div style={{ fontSize: '0.85rem', color: D.t3, flex: 1 }}>
          {items.length === 0
            ? 'Niciun NIR. Adaugă primul când primești marfă.'
            : `${items.length} NIR-uri totale`}
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
          + NIR nou
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
          }}
        >
          ℹ️ Pentru a crea un NIR, adaugă mai întâi cel puțin 1 ingredient în tab-ul Ingrediente.
        </div>
      )}

      {items.length === 0 && canCreate ? (
        <div
          style={{
            background: D.s2,
            border: `1px dashed ${D.border}`,
            borderRadius: 12,
            padding: 32,
            textAlign: 'center',
            color: D.t3,
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>📋</div>
          <div style={{ fontSize: '0.88rem', marginBottom: 4 }}>Niciun NIR încă</div>
          <div style={{ fontSize: '0.74rem' }}>
            Click „+ NIR nou" când primești marfă de la furnizor
          </div>
        </div>
      ) : items.length > 0 ? (
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
                    {po.invoice_number ?? `NIR #${po.id.slice(0, 8)}`}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: D.t3 }}>
                    {supplier?.name ?? '—'} ·{' '}
                    {po.invoice_date ?? new Date(po.created_at).toLocaleDateString('ro-RO')}
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
                  {po.total.toFixed(2)} lei
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
                    ? 'Draft'
                    : po.status === 'received'
                      ? 'Recepționat'
                      : po.status === 'paid'
                        ? 'Plătit'
                        : 'Anulat'}
                </div>
                {po.status === 'draft' && (
                  <button
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: 'Confirmă recepționarea?',
                        description: 'Stocul va crește automat.',
                        confirmLabel: 'Recepționează',
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
                    Recepționează
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ) : null}

      {showAdd && (
        <NirCreateModal
          restaurantId={restaurantId}
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
  suppliers,
  ingredients,
  onClose,
  onSave,
}: {
  restaurantId: string
  suppliers: Supplier[]
  ingredients: Ingredient[]
  onClose: () => void
  onSave: () => void
}) {
  const [supplierId, setSupplierId] = useState<string>('')
  const [supplierName, setSupplierName] = useState<string>('') // pentru autocomplete
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<NirItem[]>([
    { ingredient_id: '', quantity: '', unit_price: '', vat_rate: 19 },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receiveImmediately, setReceiveImmediately] = useState(true)

  function addRow() {
    setItems((prev) => [...prev, { ingredient_id: '', quantity: '', unit_price: '', vat_rate: 19 }])
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
      setError('Adaugă cel puțin un ingredient cu cantitate validă')
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
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <div onClick={onClose} style={modalBg}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalCard, maxWidth: 720 }}>
        <div
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.3rem',
            fontWeight: 600,
            color: D.t1,
            marginBottom: 4,
          }}
        >
          NIR nou
        </div>
        <div style={{ fontSize: '0.78rem', color: D.t3, marginBottom: 18 }}>
          Înregistrează intrarea de marfă de la furnizor. Stocurile cresc la recepționare.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Header info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl}>Furnizor (opțional)</label>
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
                placeholder="Tastează pentru a căuta sau crea nou..."
                emptyHint={`Apasă Salvează ca să creezi furnizorul "${supplierName.trim()}"`}
                style={{ height: 36 }}
              />
            </div>
            <div>
              <label style={lbl}>Data factură</label>
              <input
                style={inp()}
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label style={lbl}>Număr factură</label>
            <input
              style={inp()}
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="ex: F-2024-1234"
            />
          </div>

          {/* Items table */}
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: D.t1, marginBottom: 8 }}>
              Produse
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
                        <option value="">Alege ingredient...</option>
                        {ingredients.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.emoji ?? '🥬'} {i.name} ({i.unit})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        disabled={items.length === 1}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 7,
                          background: 'transparent',
                          border: `1px solid ${D.border}`,
                          color: '#c0392b',
                          cursor: items.length === 1 ? 'not-allowed' : 'pointer',
                          fontSize: '0.95rem',
                          opacity: items.length === 1 ? 0.3 : 1,
                          flexShrink: 0,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    {/* Row 2: Qty + Price + VAT + Total */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 90px',
                        gap: 6,
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.66rem', color: D.t3, marginBottom: 2 }}>
                          Cantitate
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
                          Preț/unitate
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
                      <div>
                        <div style={{ fontSize: '0.66rem', color: D.t3, marginBottom: 2 }}>TVA</div>
                        <select
                          style={{ ...inp({ height: 34, fontSize: '0.82rem' }) }}
                          value={it.vat_rate}
                          onChange={(e) => updateRow(idx, 'vat_rate', parseFloat(e.target.value))}
                        >
                          <option value={0}>0%</option>
                          <option value={5}>5%</option>
                          <option value={9}>9%</option>
                          <option value={19}>19%</option>
                        </select>
                      </div>
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
                      <span style={{ fontSize: '0.74rem', color: D.t3 }}>Total linie (cu TVA)</span>
                      <span
                        style={{
                          fontSize: '0.92rem',
                          fontWeight: 700,
                          color: D.t1,
                          fontFamily: 'Fraunces,serif',
                        }}
                      >
                        {lineTotal.toFixed(2)} lei
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
                background: 'transparent',
                border: `1px dashed ${D.border}`,
                color: D.t2,
                fontSize: '0.78rem',
                borderRadius: 7,
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
              }}
            >
              + Adaugă rând
            </button>
          </div>

          {/* Totals */}
          <div style={{ background: D.s3, borderRadius: 9, padding: 14 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.82rem',
                color: D.t2,
                marginBottom: 4,
              }}
            >
              <span>Subtotal (fără TVA)</span>
              <span>{subtotal.toFixed(2)} lei</span>
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
              <span>TVA</span>
              <span>{vatTotal.toFixed(2)} lei</span>
            </div>
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
              <span>TOTAL</span>
              <span>{total.toFixed(2)} lei</span>
            </div>
          </div>

          <div>
            <label style={lbl}>Note (opțional)</label>
            <input
              style={inp()}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ex: livrare cu întârziere, marfă lipsă, etc."
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
              <div style={{ fontWeight: 600 }}>Recepționează imediat</div>
              <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 2 }}>
                Stocurile vor crește automat. Bifează doar dacă marfa e fizic primită acum.
              </div>
            </div>
          </label>

          {error && (
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
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
            >
              Anulează
            </button>
            <button
              disabled={saving}
              onClick={() => void save()}
              style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.6 : 1 })}
            >
              {saving
                ? 'Salvez...'
                : receiveImmediately
                  ? 'Salvează & recepționează'
                  : 'Salvează ca draft'}
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
  const [items, setItems] = useState<ProductProfitability[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchProductProfitability(restaurantId)
      .then((data) => {
        setItems(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [restaurantId])

  if (loading) return <InlineSpinner label="Se calculează profitabilitatea..." />

  const withCost = items.filter((i) => i.cost_price > 0)
  const noCost = items.filter((i) => i.cost_price === 0)

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
        }}
      >
        💡 Pentru ca un produs să apară aici cu cost calculat, trebuie să-i adaugi rețeta (Editare
        produs → Rețetă).
      </div>

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
            Cu rețetă configurată ({withCost.length})
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
                    Cost: {p.cost_price.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: D.t3 }}>
                    Vând: {p.sell_price.toFixed(2)}
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
                    {p.margin_percent.toFixed(0)}%
                  </div>
                  <div style={{ fontSize: '0.7rem', color: D.t3 }}>marja</div>
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
            Fără rețetă ({noCost.length}) — nu se poate calcula profitul
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
            {noCost
              .slice(0, 5)
              .map((p) => p.name)
              .join(', ')}
            {noCost.length > 5 && ` și încă ${noCost.length - 5} produse`}
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
  emoji,
}: {
  label: string
  value: string
  sub?: string
  color?: string
  emoji?: string
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
        {emoji && <span style={{ fontSize: '0.95rem', opacity: 0.7 }}>{emoji}</span>}
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
