// ─────────────────────────────────────────────────────────────
// HappyHourTab — Reguli automate de reducere pe interval orar
//
// Owner/manager creează reguli ca:
//   • "Happy Hour 17-19" — 20% pe TOT, în fiecare zi
//   • "Cocktailuri week-end" — 15% pe categoria Cocktailuri, doar Vi-Sâ 21-23
//
// Aplicarea propriu-zisă a reducerii pe comandă se face din WaiterPage
// (iter 7) sau manual via DiscountModal. Aici doar definim regulile.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react'
import { D } from '../lib/constants'
import { useIsMobile } from '../hooks/useIsMobile'
import { InlineSpinner } from './PageLoader'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import {
  fetchHappyHourRules,
  createHappyHourRule,
  updateHappyHourRule,
  deleteHappyHourRule,
  evaluateHappyHourForNow,
  DAY_LABELS,
  type HappyHourRule,
  type ActiveRule,
} from '../lib/happyHour'
import { supabase } from '../lib/supabase'

interface Props {
  restaurantId: string
}

interface Category {
  id: string
  name: string
  emoji: string | null
}
interface Product {
  id: string
  name: string
  emoji: string | null
}

// ── Style ────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: D.s1,
  border: `1px solid ${D.border}`,
  borderRadius: 14,
  padding: 22,
  marginBottom: 16,
}
const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '10px 12px',
  fontSize: '0.9rem',
  color: D.t1,
  outline: 'none',
  height: 40,
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}
const lbl: React.CSSProperties = {
  fontSize: '0.74rem',
  color: D.t2,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 5,
  fontWeight: 500,
}
const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 14px',
  height: 38,
  borderRadius: 8,
  fontSize: '0.86rem',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
  ...extra,
})

// ── Main ──────────────────────────────────────────────────────
export default function HappyHourTab({ restaurantId }: Props) {
  const [rules, setRules] = useState<HappyHourRule[]>([])
  const [active, setActive] = useState<ActiveRule[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<HappyHourRule | 'new' | null>(null)
  const [delId, setDelId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [rs, act, cats, prods] = await Promise.all([
        fetchHappyHourRules(restaurantId),
        evaluateHappyHourForNow(restaurantId).catch(() => []),
        supabase
          .from('categories')
          .select('id,name,emoji')
          .eq('restaurant_id', restaurantId)
          .order('position'),
        supabase
          .from('products')
          .select('id,name,emoji')
          .eq('restaurant_id', restaurantId)
          .eq('is_active', true)
          .order('name'),
      ])
      setRules(rs)
      setActive(act)
      setCategories((cats.data ?? []) as Category[])
      setProducts((prods.data ?? []) as Product[])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare')
    } finally {
      setLoading(false)
    }
  }, [restaurantId])

  useEffect(() => {
    void load()
  }, [load])

  // Re-evaluate active every 60s
  useEffect(() => {
    const t = setInterval(() => {
      evaluateHappyHourForNow(restaurantId)
        .then(setActive)
        .catch(() => {})
    }, 60_000)
    return () => clearInterval(t)
  }, [restaurantId])

  async function handleSave(
    rule: Omit<HappyHourRule, 'id' | 'restaurant_id' | 'created_at' | 'updated_at'>,
  ) {
    // Eroarea se propagă în RuleEditor (setErr LOCAL, vizibil în modal) — înainte
    // era scrisă pe bannerul părintelui, ACOPERIT de overlay-ul modalului rămas
    // deschis → CTA-ul principal eșua fără niciun feedback vizibil.
    if (editing === 'new') {
      await createHappyHourRule(restaurantId, rule)
    } else if (editing) {
      await updateHappyHourRule(editing.id, rule)
    }
    setEditing(null)
    void load()
  }

  async function handleDelete() {
    if (!delId) return
    try {
      await deleteHappyHourRule(delId)
      setDelId(null)
      void load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare')
    }
  }

  async function toggleActive(rule: HappyHourRule) {
    try {
      await updateHappyHourRule(rule.id, { is_active: !rule.is_active })
      void load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare')
    }
  }

  if (loading && rules.length === 0) {
    return <InlineSpinner label="Se încarcă regulile..." />
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 22,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 600,
              color: D.t1,
              margin: 0,
              fontFamily: 'Fraunces,serif',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Icon name="percent" size={22} />
            Promoții
          </h1>
          <div style={{ fontSize: '0.86rem', color: D.t2, marginTop: 4, maxWidth: 600 }}>
            Reguli automate de reducere pe interval orar și zile săptămână. Ospătarul va vedea un
            buton "Aplică Happy Hour" la plată dacă există regulă activă.
          </div>
        </div>
        <button
          onClick={() => setEditing('new')}
          style={btn({ background: D.gold, color: '#000', height: 40 })}
        >
          <Icon name="plus" size={16} />
          Regulă nouă
        </button>
      </div>

      {err && (
        <div
          style={{
            ...card,
            borderColor: D.red,
            background: D.redA,
            color: D.red,
            marginBottom: 16,
          }}
        >
          {err}
          <button
            onClick={() => setErr(null)}
            aria-label="Închide eroarea"
            style={{
              float: 'right',
              background: 'transparent',
              border: 'none',
              color: D.red,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 44,
              minHeight: 44,
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {/* Active right now banner */}
      {active.length > 0 && (
        <div
          style={{
            ...card,
            borderColor: D.gold,
            background: 'rgba(212,165,116,0.06)',
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontSize: '0.86rem',
              color: D.gold,
              fontWeight: 600,
              marginBottom: 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name="sparkle" size={15} />
            ACTIVE ACUM ({active.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {active.map((r) => (
              <span
                key={r.id}
                style={{
                  padding: '6px 12px',
                  background: D.goldA,
                  borderRadius: 6,
                  fontSize: '0.84rem',
                  color: D.t1,
                  border: `1px solid ${D.gold}`,
                }}
              >
                <strong>{r.name}</strong> · {r.discount_value}
                {r.discount_type === 'percent' ? '%' : ' lei'}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Rules list */}
      {rules.length === 0 ? (
        <EmptyState
          icon="percent"
          title="Nicio regulă încă"
          description={
            'Creează prima regulă (ex: "Happy Hour 17-19, -20% pe tot") și sistemul va sugera automat reducerea la plată în acest interval.'
          }
          action={
            <button
              onClick={() => setEditing('new')}
              style={btn({ background: D.gold, color: '#000', height: 40 })}
            >
              <Icon name="plus" size={16} />
              Prima regulă
            </button>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rules.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              categories={categories}
              products={products}
              onEdit={() => setEditing(r)}
              onDelete={() => setDelId(r.id)}
              onToggle={() => void toggleActive(r)}
            />
          ))}
        </div>
      )}

      {editing && (
        <RuleEditor
          rule={editing === 'new' ? null : editing}
          categories={categories}
          products={products}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {delId && (
        <ConfirmDelete
          name={rules.find((r) => r.id === delId)?.name ?? ''}
          onCancel={() => setDelId(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  )
}

// ── Rule card ────────────────────────────────────────────────
function RuleCard({
  rule,
  categories,
  products,
  onEdit,
  onDelete,
  onToggle,
}: {
  rule: HappyHourRule
  categories: Category[]
  products: Product[]
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}) {
  const cat = categories.find((c) => c.id === rule.category_id)
  const prod = products.find((p) => p.id === rule.product_id)
  const days =
    rule.days_of_week.length === 0
      ? 'Toate zilele'
      : rule.days_of_week.map((d) => DAY_LABELS[d - 1] ?? '?').join(' ')
  const scope =
    rule.scope === 'all' ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Icon name="tag" size={13} /> Pe tot
      </span>
    ) : rule.scope === 'category' ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Icon name="box" size={13} /> {cat?.emoji || ''} {cat?.name || '?'}
      </span>
    ) : (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Icon name="utensils" size={13} /> {prod?.emoji || ''} {prod?.name || '?'}
      </span>
    )

  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${rule.is_active ? D.gold + '44' : D.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        opacity: rule.is_active ? 1 : 0.55,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 280px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 4,
              flexWrap: 'wrap',
            }}
          >
            <strong style={{ fontSize: '0.98rem', color: D.t1, fontFamily: 'Fraunces,serif' }}>
              {rule.name}
            </strong>
            {rule.is_active ? (
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 8px',
                  background: D.greenA,
                  color: D.green,
                  borderRadius: 4,
                  fontWeight: 600,
                }}
              >
                ACTIVĂ
              </span>
            ) : (
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 8px',
                  background: D.s3,
                  color: D.t3,
                  borderRadius: 4,
                  fontWeight: 600,
                }}
              >
                OPRITĂ
              </span>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 14px',
              fontSize: '0.82rem',
              color: D.t2,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="clock" size={13} /> {rule.starts_at.slice(0, 5)}–{rule.ends_at.slice(0, 5)}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="calendar" size={13} /> {days}
            </span>
            <span>{scope}</span>
            <span style={{ color: D.gold, fontWeight: 600 }}>
              −{rule.discount_value}
              {rule.discount_type === 'percent' ? '%' : ' lei'}
              {rule.max_discount && ` (max ${rule.max_discount} lei)`}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onToggle}
            style={btn({
              background: rule.is_active ? D.s3 : D.goldA,
              color: rule.is_active ? D.t2 : D.goldL,
              border: `1px solid ${D.border}`,
              height: 32,
              padding: '0 10px',
              fontSize: '0.78rem',
            })}
          >
            {rule.is_active ? 'Oprește' : 'Pornește'}
          </button>
          <button
            onClick={onEdit}
            style={btn({
              background: D.s3,
              color: D.t1,
              border: `1px solid ${D.border}`,
              height: 32,
              padding: '0 10px',
              fontSize: '0.78rem',
            })}
          >
            Editează
          </button>
          <button
            onClick={onDelete}
            aria-label={`Șterge regula ${rule.name}`}
            style={btn({
              background: 'transparent',
              color: D.red,
              border: `1px solid ${D.red}33`,
              height: 32,
              minWidth: 44,
              padding: '0 10px',
              fontSize: '0.78rem',
            })}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Rule editor modal ────────────────────────────────────────
function RuleEditor({
  rule,
  categories,
  products,
  onClose,
  onSave,
}: {
  rule: HappyHourRule | null
  categories: Category[]
  products: Product[]
  onClose: () => void
  onSave: (r: Omit<HappyHourRule, 'id' | 'restaurant_id' | 'created_at' | 'updated_at'>) => Promise<void>
}) {
  const [name, setName] = useState(rule?.name ?? '')
  const [startsAt, setStartsAt] = useState(rule?.starts_at?.slice(0, 5) ?? '17:00')
  const [endsAt, setEndsAt] = useState(rule?.ends_at?.slice(0, 5) ?? '19:00')
  const [days, setDays] = useState<number[]>(rule?.days_of_week ?? [])
  const [scope, setScope] = useState<'all' | 'category' | 'product'>(rule?.scope ?? 'all')
  const [categoryId, setCategoryId] = useState(rule?.category_id ?? '')
  const [productId, setProductId] = useState(rule?.product_id ?? '')
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>(
    rule?.discount_type ?? 'percent',
  )
  const [discountValue, setDiscountValue] = useState(String(rule?.discount_value ?? 20))
  const [maxDiscount, setMaxDiscount] = useState(
    rule?.max_discount != null ? String(rule.max_discount) : '',
  )
  const [isActive, setIsActive] = useState(rule?.is_active ?? true)
  const [err, setErr] = useState<string | null>(null)
  const isMobile = useIsMobile()

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))
  }

  function go() {
    const dv = Number(discountValue.replace(',', '.'))
    if (!name.trim()) {
      setErr('Numele e obligatoriu')
      return
    }
    if (isNaN(dv) || dv <= 0) {
      setErr('Valoarea reducerii trebuie să fie pozitivă')
      return
    }
    if (discountType === 'percent' && dv > 100) {
      setErr('Procent max 100')
      return
    }
    if (scope === 'category' && !categoryId) {
      setErr('Selectează o categorie')
      return
    }
    if (scope === 'product' && !productId) {
      setErr('Selectează un produs')
      return
    }
    setErr(null)
    void onSave({
      name: name.trim(),
      is_active: isActive,
      starts_at: startsAt + ':00',
      ends_at: endsAt + ':00',
      days_of_week: days,
      scope,
      category_id: scope === 'category' ? categoryId : null,
      product_id: scope === 'product' ? productId : null,
      discount_type: discountType,
      discount_value: dv,
      max_discount: maxDiscount.trim().length > 0 ? Number(maxDiscount.replace(',', '.')) : null,
    }).catch((e: unknown) => {
      setErr(e instanceof Error ? e.message : 'Eroare la salvare')
    })
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: D.s1,
          border: `1px solid ${D.border}`,
          borderRadius: 14,
          padding: 22,
          maxWidth: 540,
          width: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
        }}
      >
        <h2
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.3rem',
            fontWeight: 600,
            color: D.t1,
            marginBottom: 16,
          }}
        >
          {rule ? 'Editare regulă' : 'Regulă nouă'}
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={lbl}>Nume *</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inp}
              placeholder="ex: Happy Hour 17-19"
              maxLength={80}
              autoFocus
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
            <div>
              <div style={lbl}>De la</div>
              <input
                type="time"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                style={inp}
              />
            </div>
            <div>
              <div style={lbl}>Până la</div>
              <input
                type="time"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                style={inp}
              />
            </div>
          </div>

          <div>
            <div style={lbl}>Zile săptămână (gol = toate)</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {DAY_LABELS.map((lab, i) => {
                const d = i + 1
                const on = days.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    style={btn({
                      background: on ? D.goldA : D.s3,
                      color: on ? D.goldL : D.t2,
                      border: `1px solid ${on ? D.gold : D.border}`,
                      width: 44,
                      height: 36,
                      padding: 0,
                      fontSize: '0.82rem',
                    })}
                  >
                    {lab}
                  </button>
                )
              })}
              {days.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDays([])}
                  style={btn({
                    background: 'transparent',
                    color: D.t3,
                    height: 36,
                    fontSize: '0.78rem',
                    padding: '0 10px',
                  })}
                >
                  Resetează
                </button>
              )}
            </div>
          </div>

          <div>
            <div style={lbl}>Aplicare</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['all', 'category', 'product'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  style={btn({
                    background: scope === s ? D.goldA : D.s3,
                    color: scope === s ? D.goldL : D.t2,
                    border: `1px solid ${scope === s ? D.gold : D.border}`,
                    height: 34,
                    padding: '0 12px',
                    fontSize: '0.82rem',
                  })}
                >
                  <Icon
                    name={s === 'all' ? 'tag' : s === 'category' ? 'box' : 'utensils'}
                    size={14}
                  />
                  {s === 'all' ? 'Pe tot' : s === 'category' ? 'Categorie' : 'Produs'}
                </button>
              ))}
            </div>
            {scope === 'category' && (
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                style={inp}
              >
                <option value="">— Selectează categorie —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.name}
                  </option>
                ))}
              </select>
            )}
            {scope === 'product' && (
              <select value={productId} onChange={(e) => setProductId(e.target.value)} style={inp}>
                <option value="">— Selectează produs —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.emoji} {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <div style={lbl}>Reducere</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => setDiscountType('percent')}
                style={btn({
                  background: discountType === 'percent' ? D.goldA : D.s3,
                  color: discountType === 'percent' ? D.goldL : D.t2,
                  border: `1px solid ${discountType === 'percent' ? D.gold : D.border}`,
                  height: 34,
                  fontSize: '0.82rem',
                })}
              >
                Procent (%)
              </button>
              <button
                type="button"
                onClick={() => setDiscountType('amount')}
                style={btn({
                  background: discountType === 'amount' ? D.goldA : D.s3,
                  color: discountType === 'amount' ? D.goldL : D.t2,
                  border: `1px solid ${discountType === 'amount' ? D.gold : D.border}`,
                  height: 34,
                  fontSize: '0.82rem',
                })}
              >
                Sumă fixă (lei)
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
              <div>
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  style={inp}
                  placeholder={discountType === 'percent' ? '20' : '50'}
                />
              </div>
              <div>
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  value={maxDiscount}
                  onChange={(e) => setMaxDiscount(e.target.value)}
                  style={inp}
                  placeholder="Max lei (opțional)"
                />
              </div>
            </div>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: D.t2,
              fontSize: '0.86rem',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span>Regulă activă imediat</span>
          </label>

          {err && (
            <div
              style={{
                padding: 10,
                background: D.redA,
                color: D.red,
                borderRadius: 8,
                fontSize: '0.86rem',
              }}
            >
              {err}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              style={btn({ background: D.s2, color: D.t2, border: `1px solid ${D.border}` })}
            >
              Anulează
            </button>
            <button onClick={go} style={btn({ background: D.gold, color: '#000' })}>
              {rule ? 'Salvează modificări' : 'Creează regulă'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Confirm delete ───────────────────────────────────────────
function ConfirmDelete({
  name,
  onCancel,
  onConfirm,
}: {
  name: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 250,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: D.s1,
          border: `1px solid ${D.border}`,
          borderRadius: 12,
          padding: 22,
          maxWidth: 380,
        }}
      >
        <h3
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.1rem',
            color: D.t1,
            marginBottom: 10,
          }}
        >
          Ștergi regula?
        </h3>
        <p style={{ color: D.t2, fontSize: '0.88rem', marginBottom: 18 }}>
          Vrei să ștergi <strong style={{ color: D.t1 }}>{name}</strong>? Acțiunea e ireversibilă.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
          >
            Anulează
          </button>
          <button onClick={onConfirm} style={btn({ background: D.red, color: '#fff' })}>
            Șterge
          </button>
        </div>
      </div>
    </div>
  )
}
