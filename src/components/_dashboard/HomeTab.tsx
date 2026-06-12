// ─────────────────────────────────────────────────────────────
// HomeTab — „Acasă": mission control-ul dashboard-ului (Val 2, DESIGN_SPEC).
// Ierarhie: salut → cifrele zilei (Comenzi azi MARE) → setup ca progres
// „X/Y pași" cu bară → scor meniu ca badge + sugestii → acțiuni rapide →
// upgrade card (doar tier 1, ultimul). Gating-ul real e server-side;
// aici doar decidem ce merită văzut pe fiecare plan.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, lazy, Suspense } from 'react'
import { D } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import type { PlanTier } from '../../lib/features'
import { getPlanByInternalId } from '../../lib/plans'
import {
  fetchHealthScore,
  scoreLabel,
  scoreColor,
  getActionableSuggestions,
  type HealthScore,
} from '../../lib/health'

// Paleta de scor — citește din tokens-urile existente (CSS vars).
const scorePalette = { green: D.green, gold: D.gold, orange: D.amber, red: D.red }
import { InlineSpinner } from '../PageLoader'

const QuickSetupTab = lazy(() => import('../QuickSetupTab'))
const HealthScoreTab = lazy(() => import('../HealthScoreTab'))

interface Props {
  restaurantId: string
  restaurantName: string
  tier: PlanTier
  isAdmin: boolean
  productCount: number
  onNavigate: (tab: 'products' | 'categories' | 'mese' | 'raport' | 'comenzi' | 'echipa') => void
  onViewMenu: () => void
  onPricing: () => void
}

const card: React.CSSProperties = {
  background: D.s2,
  border: `1px solid ${D.border}`,
  borderRadius: 14,
  padding: '18px 20px',
}

const sectionTitle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: D.t3,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  fontWeight: 700,
  marginBottom: 10,
}

// Flag local: „a deschis meniul public măcar o dată" — singurul pas de setup
// care nu e măsurabil din DB. localStorage per restaurant, fără backend.
function menuCheckedKey(restaurantId: string): string {
  return `menuvia.menu_checked.${restaurantId}`
}
function wasMenuChecked(restaurantId: string): boolean {
  try {
    return localStorage.getItem(menuCheckedKey(restaurantId)) === '1'
  } catch {
    return false
  }
}

function MetricCard({
  label,
  value,
  hint,
  big,
  accent,
}: {
  label: string
  value: string
  hint?: string
  big?: boolean
  accent?: boolean
}) {
  return (
    <div style={{ ...card, ...(accent ? { border: `1px solid ${D.gold}44` } : null) }}>
      <div
        style={{
          fontSize: '0.7rem',
          color: D.t3,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'Fraunces,serif',
          fontSize: big ? '2.4rem' : '1.7rem',
          color: accent ? D.gold : D.t1,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {hint && <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 6 }}>{hint}</div>}
    </div>
  )
}

function QuickAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...card,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        color: D.t1,
        fontSize: '0.875rem',
        fontWeight: 500,
        fontFamily: 'DM Sans,sans-serif',
        textAlign: 'left',
      }}
    >
      <span style={{ fontSize: '1.2rem' }}>{icon}</span>
      {label}
    </button>
  )
}

// Card expandabil — detaliile complete (asistent / scor) stau „în Acasă"
// fără să o aglomereze: un rând închis, conținutul complet la click.
function ExpandableCard({
  header,
  children,
}: {
  header: (open: boolean) => React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'block',
          width: '100%',
          padding: '16px 20px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'DM Sans,sans-serif',
        }}
      >
        {header(open)}
      </button>
      {open && <div style={{ padding: '0 20px 20px' }}>{children}</div>}
    </div>
  )
}

interface SetupItem {
  label: string
  done: boolean
  target?: 'products' | 'categories' | 'mese' | 'echipa'
}

export default function HomeTab({
  restaurantId,
  restaurantName,
  tier,
  isAdmin,
  productCount,
  onNavigate,
  onViewMenu,
  onPricing,
}: Props) {
  const growthPlan = getPlanByInternalId('growth')

  // ── Cifrele zilei + datele de setup (HEAD counts, o singură rundă) ──
  const [ordersToday, setOrdersToday] = useState<number | null>(null)
  const [tablesCount, setTablesCount] = useState<number | null>(null)
  const [categoriesCount, setCategoriesCount] = useState<number | null>(null)
  const [teamCount, setTeamCount] = useState<number | null>(null)
  const [menuChecked, setMenuChecked] = useState(() => wasMenuChecked(restaurantId))
  const [health, setHealth] = useState<HealthScore | null>(null)

  useEffect(() => {
    setMenuChecked(wasMenuChecked(restaurantId))
    let alive = true
    const head = { count: 'exact' as const, head: true }

    const counts: PromiseLike<void>[] = [
      supabase
        .from('tables')
        .select('id', head)
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .then(({ count }) => {
          if (alive) setTablesCount(count ?? 0)
        }),
      supabase
        .from('categories')
        .select('id', head)
        .eq('restaurant_id', restaurantId)
        .then(({ count }) => {
          if (alive) setCategoriesCount(count ?? 0)
        }),
    ]

    if (tier >= 2) {
      // Aceeași logică de „azi" ca ReportsTab (boundary explicit România),
      // ca cifra din Acasă să bată cu raportul zilei.
      const todayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00+03:00'
      counts.push(
        supabase
          .from('orders')
          .select('id', head)
          .eq('restaurant_id', restaurantId)
          .neq('status', 'cancelled')
          .gte('created_at', todayStart)
          .then(({ count }) => {
            if (alive) setOrdersToday(count ?? 0)
          }),
      )
      if (isAdmin) {
        counts.push(
          supabase
            .from('restaurant_memberships')
            .select('user_id', head)
            .eq('restaurant_id', restaurantId)
            .then(({ count }) => {
              if (alive) setTeamCount(count ?? 0)
            }),
        )
      }
    }
    void Promise.all(counts)
    return () => {
      alive = false
    }
  }, [restaurantId, tier, isAdmin])

  // Scorul — separat (RPC), doar pentru admini pe planurile cu comenzi.
  useEffect(() => {
    if (!isAdmin || tier < 2) return
    let alive = true
    void fetchHealthScore(restaurantId).then((h) => {
      if (alive) setHealth(h)
    })
    return () => {
      alive = false
    }
  }, [restaurantId, isAdmin, tier])

  function handleViewMenu(): void {
    try {
      localStorage.setItem(menuCheckedKey(restaurantId), '1')
    } catch {
      /* ignore */
    }
    setMenuChecked(true)
    onViewMenu()
  }

  // ── Checklist de setup: doar pași MĂSURABILI (fără bife false) ──
  const setupItems: SetupItem[] = [
    { label: 'Adaugă produse', done: productCount > 0, target: 'products' },
    { label: 'Creează categorii', done: (categoriesCount ?? 0) > 0, target: 'categories' },
    { label: 'Generează QR-uri pentru mese', done: (tablesCount ?? 0) > 0, target: 'mese' },
    { label: 'Verifică meniul public', done: menuChecked },
    ...(tier >= 2 && isAdmin
      ? [
          { label: 'Invită echipa', done: (teamCount ?? 0) > 1, target: 'echipa' as const },
          { label: 'Comenzile de la masă: active', done: true },
        ]
      : []),
  ]
  const setupDone = setupItems.filter((s) => s.done).length
  const setupTotal = setupItems.length
  const setupComplete = setupDone === setupTotal

  const healthSuggestions = health ? getActionableSuggestions(health).slice(0, 2) : []

  return (
    <div style={{ maxWidth: 1000, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div>
        <h1
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.6rem',
            fontWeight: 600,
            color: D.t1,
            letterSpacing: '-0.02em',
          }}
        >
          Bun venit, {restaurantName}
        </h1>
        <p style={{ color: D.t3, fontSize: '0.82rem', marginTop: 4 }}>
          Configurează restaurantul, verifică QR-urile și urmărește activitatea de azi.
        </p>
      </div>

      {/* Cifrele zilei — Comenzi azi domină pe planurile cu comenzi */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
          gap: 10,
        }}
      >
        {tier >= 2 && (
          <MetricCard
            label="Comenzi azi"
            value={ordersToday == null ? '…' : String(ordersToday)}
            hint="fără cele anulate"
            big
            accent
          />
        )}
        <MetricCard label="Produse active" value={String(productCount)} />
        <MetricCard
          label="QR-uri active"
          value={tablesCount == null ? '…' : String(tablesCount)}
          hint="mese scanabile"
        />
        <MetricCard
          label="Setup"
          value={`${setupDone}/${setupTotal}`}
          hint={setupComplete ? 'totul e gata ✓' : 'pași completați'}
        />
      </div>

      {/* Setup restaurant — progres cu bară + pași compacți */}
      {isAdmin && !setupComplete && (
        <div style={card}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 10,
            }}
          >
            <div style={{ color: D.t1, fontSize: '0.95rem', fontWeight: 700 }}>
              🪄 Setup restaurant
            </div>
            <div style={{ color: D.gold, fontSize: '0.82rem', fontWeight: 700 }}>
              {setupDone}/{setupTotal} pași completați
            </div>
          </div>
          <div
            style={{
              height: 6,
              background: D.s3,
              borderRadius: 100,
              overflow: 'hidden',
              marginBottom: 14,
            }}
          >
            <div
              style={{
                width: `${Math.round((setupDone / setupTotal) * 100)}%`,
                height: '100%',
                background: D.gold,
                borderRadius: 100,
                transition: 'width .3s ease',
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {setupItems.map((it) => (
              <button
                key={it.label}
                onClick={() => {
                  if (it.done) return
                  if (it.target) onNavigate(it.target)
                  else handleViewMenu()
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: 'transparent',
                  border: 'none',
                  padding: '5px 0',
                  cursor: it.done ? 'default' : 'pointer',
                  fontFamily: 'DM Sans,sans-serif',
                  fontSize: '0.85rem',
                  color: it.done ? D.t3 : D.t1,
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    border: `1.5px solid ${it.done ? D.green : D.border}`,
                    background: it.done ? 'rgba(76,175,110,0.15)' : 'transparent',
                    color: D.green,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {it.done ? '✓' : ''}
                </span>
                <span style={{ textDecoration: it.done ? 'line-through' : 'none' }}>
                  {it.label}
                </span>
                {!it.done && <span style={{ color: D.t3, marginLeft: 'auto' }}>→</span>}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <ExpandableCard
              header={(open) => (
                <span style={{ color: D.t3, fontSize: '0.78rem' }}>
                  {open ? '▲ Închide asistentul detaliat' : '▼ Deschide asistentul detaliat'}
                </span>
              )}
            >
              <Suspense fallback={<InlineSpinner label="Se încarcă asistentul..." />}>
                <QuickSetupTab restaurantId={restaurantId} restaurantName={restaurantName} />
              </Suspense>
            </ExpandableCard>
          </div>
        </div>
      )}

      {/* Scor meniu — badge + sugestii practice (admin, tier 2+) */}
      {isAdmin && tier >= 2 && (
        <ExpandableCard
          header={(open) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: '1.3rem' }}>🩺</span>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: healthSuggestions.length > 0 ? 4 : 0,
                  }}
                >
                  <span style={{ color: D.t1, fontSize: '0.95rem', fontWeight: 700 }}>
                    Scor meniu
                  </span>
                  {health && (
                    <span
                      style={{
                        background: `${scoreColor(health.score, scorePalette)}22`,
                        color: scoreColor(health.score, scorePalette),
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        borderRadius: 100,
                        padding: '2px 10px',
                      }}
                    >
                      {scoreLabel(health.score)} · {health.score}
                    </span>
                  )}
                </div>
                {healthSuggestions.map((s) => (
                  <div key={s.component} style={{ color: D.t3, fontSize: '0.75rem', marginTop: 2 }}>
                    • {s.suggestion}
                  </div>
                ))}
              </div>
              <span style={{ color: D.t3, fontSize: '0.8rem', flexShrink: 0 }}>
                {open ? '▲' : '▼'}
              </span>
            </div>
          )}
        >
          <Suspense fallback={<InlineSpinner label="Se încarcă scorul..." />}>
            <HealthScoreTab />
          </Suspense>
        </ExpandableCard>
      )}

      {/* Acțiuni rapide */}
      <div>
        <div style={sectionTitle}>Acțiuni rapide</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
            gap: 10,
          }}
        >
          <QuickAction icon="➕" label="Adaugă produs" onClick={() => onNavigate('products')} />
          <QuickAction icon="🔲" label="Generează QR-uri" onClick={() => onNavigate('mese')} />
          <QuickAction icon="👁" label="Vezi meniul public" onClick={handleViewMenu} />
          {tier >= 2 && (
            <QuickAction icon="🛎" label="Vezi comenzile" onClick={() => onNavigate('comenzi')} />
          )}
          {tier >= 2 && isAdmin && (
            <QuickAction icon="👥" label="Invită ospătar" onClick={() => onNavigate('echipa')} />
          )}
        </div>
      </div>

      {/* Upgrade — doar tier 1, mereu ultimul */}
      {isAdmin && tier < 2 && (
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.5rem' }}>{growthPlan.emoji}</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ color: D.t1, fontSize: '0.9rem', fontWeight: 600 }}>
              Vrei să primești comenzi direct de la masă?
            </div>
            <div style={{ color: D.t3, fontSize: '0.78rem', marginTop: 3, lineHeight: 1.5 }}>
              {(tablesCount ?? 0) > 0
                ? `Ai deja QR-urile pe mese. Activăm comenzile pe aceleași QR-uri — nu printezi nimic din nou.`
                : `Activează ${growthPlan.name} și clienții pot comanda prin QR, iar bucătăria primește instant.`}
            </div>
          </div>
          <button
            onClick={onPricing}
            style={{
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 9,
              padding: '10px 16px',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
              whiteSpace: 'nowrap',
            }}
          >
            Activează {growthPlan.name} →
          </button>
        </div>
      )}
    </div>
  )
}
