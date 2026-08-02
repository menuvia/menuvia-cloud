// ─────────────────────────────────────────────────────────────
// HomeTab — „Acasă": mission control-ul dashboard-ului (Val 2, DESIGN_SPEC).
// Ierarhie: salut → cifrele zilei (Comenzi azi MARE) → setup ca progres
// „X/Y pași" cu bară → scor meniu ca badge + sugestii → acțiuni rapide →
// upgrade card (doar tier 1, ultimul). Gating-ul real e server-side;
// aici doar decidem ce merită văzut pe fiecare plan.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, lazy, Suspense, type ReactNode } from 'react'
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
import { Card } from '../ui/Card'
import { Icon, type IconName } from '../ui/Icon'
import { SubscriptionCard } from './SubscriptionCard'
import { romaniaDayBoundaryISO, toRomaniaYMD } from '../../lib/dates'
import { useInView, revealStyle } from '../../lib/motion'

// Paleta de scor — citește din tokens-urile existente (CSS vars).
const scorePalette = { green: D.green, gold: D.gold, orange: D.amber, red: D.red }
import { InlineSpinner } from '../PageLoader'

// Reveal local: fiecare instanță are PROPRIUL hook useInView (regula hooks —
// niciodată în .map()). Folosit pentru stagger-ul secțiunilor de pe Acasă.
function RevealItem({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div ref={ref} style={revealStyle(inView, { delay })}>
      {children}
    </div>
  )
}

// Scală de tipografie pentru cifre (serif display). Numărul dominant e mult
// mai mare/greu decât metricele secundare — ierarhie clară, nu grid identic.
const displayFont = 'var(--font-display)'

const QuickSetupTab = lazy(() => import('../QuickSetupTab'))
const HealthScoreTab = lazy(() => import('../HealthScoreTab'))

interface Props {
  restaurantId: string
  restaurantName: string
  tier: PlanTier
  isAdmin: boolean
  productCount: number
  // Mod „doar ridicare" (food truck, E3): fără pași/metrici legate de mese.
  pickupOnly: boolean
  onNavigate: (tab: 'products' | 'categories' | 'mese' | 'raport' | 'comenzi' | 'echipa') => void
  onViewMenu: () => void
  onPricing: () => void
  // Deschide magazinul Codvia (/codvia?slug=…) cu meniul restaurantului
  // pre-completat — suporturile vin cu QR-ul REAL al meniului deja tipărit.
  onOrderQrStands: () => void
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

// Metrica DOMINANTĂ — cifra cea mai importantă a zilei (comenzi azi).
// Mare, serif, accent gold, ocupă o coloană proprie lângă cele secundare.
function HeroMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card
      variant="raised"
      padding="22px 24px"
      radius={16}
      style={{
        border: `1px solid ${D.gold}44`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: 156,
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          color: D.goldL,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: displayFont,
          fontSize: '3.6rem',
          color: D.gold,
          fontWeight: 700,
          lineHeight: 0.95,
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </div>
      {hint && <div style={{ fontSize: '0.74rem', color: D.t3, marginTop: 8 }}>{hint}</div>}
    </Card>
  )
}

// Metrică SECUNDARĂ — număr mai mic, etichetă discretă. Ierarhie sub hero.
function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card variant="flat" padding="16px 18px" radius={14}>
      <div
        style={{
          fontSize: '0.66rem',
          color: D.t3,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: displayFont,
          fontSize: '1.8rem',
          color: D.t1,
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: '-0.01em',
        }}
      >
        {value}
      </div>
      {hint && <div style={{ fontSize: '0.7rem', color: D.t3, marginTop: 6 }}>{hint}</div>}
    </Card>
  )
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: IconName
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="pressable hover-lift"
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
      <Icon name={icon} size={20} color={D.gold} />
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
        aria-expanded={open}
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
  pickupOnly,
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
  const [everOrdered, setEverOrdered] = useState<boolean | null>(null)
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
        .then(({ count, error }) => {
          if (alive && !error) setTablesCount(count ?? 0)
        }),
      supabase
        .from('categories')
        .select('id', head)
        .eq('restaurant_id', restaurantId)
        .then(({ count, error }) => {
          if (alive && !error) setCategoriesCount(count ?? 0)
        }),
    ]

    if (tier >= 2) {
      // Aceeași logică de „azi" ca ReportsTab (boundary DST-aware România, lib/dates):
      // data UTC + offset hardcodat +03:00 dădea cifra greșită lângă miezul nopții
      // (ziua UTC ≠ ziua RO) și cu o oră deplasată iarna (EET e +02:00).
      const todayStart = romaniaDayBoundaryISO(toRomaniaYMD(new Date()), false)
      counts.push(
        supabase
          .from('orders')
          .select('id', head)
          .eq('restaurant_id', restaurantId)
          .neq('status', 'cancelled')
          .gte('created_at', todayStart)
          .then(({ count, error }) => {
            if (alive && !error) setOrdersToday(count ?? 0)
          }),
      )
      // Prima comandă (oricând, inclusiv test) — pasul de ACTIVARE din checklist.
      // Test de EXISTENȚĂ (limit 1), nu count exact: count-ul agrega toate
      // comenzile restaurantului la fiecare mount, pentru un boolean care
      // devine permanent true după prima comandă (OPT-1).
      counts.push(
        supabase
          .from('orders')
          .select('id')
          .eq('restaurant_id', restaurantId)
          .limit(1)
          .then(({ data, error }) => {
            if (alive && !error) setEverOrdered((data?.length ?? 0) > 0)
          }),
      )
      if (isAdmin) {
        counts.push(
          supabase
            .from('restaurant_memberships')
            .select('user_id', head)
            .eq('restaurant_id', restaurantId)
            .then(({ count, error }) => {
              if (alive && !error) setTeamCount(count ?? 0)
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
    void fetchHealthScore(restaurantId)
      .then((h) => {
        if (alive) setHealth(h)
      })
      .catch(() => {
        /* scorul e informativ — pe eroare rămâne fallback-ul, fără crash */
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
  // În modul „doar ridicare" pasul de mese dispare (nu e nimic de făcut —
  // fără bifă falsă), iar comanda de test se dă din meniul public.
  const setupItems: SetupItem[] = [
    { label: 'Adaugă produse', done: productCount > 0, target: 'products' },
    { label: 'Creează categorii', done: (categoriesCount ?? 0) > 0, target: 'categories' },
    ...(pickupOnly
      ? []
      : [
          {
            label: 'Generează QR-uri pentru mese',
            done: (tablesCount ?? 0) > 0,
            target: 'mese' as const,
          },
        ]),
    { label: 'Verifică meniul public', done: menuChecked },
    ...(tier >= 2 && isAdmin
      ? [
          { label: 'Invită echipa', done: (teamCount ?? 0) > 1, target: 'echipa' as const },
          // Pasul de ACTIVARE (PLAN_10 F4): fluxul e validat abia când o comandă
          // reală a intrat. Fostul item „Comenzile de la masă: active" era o bifă
          // permanentă — contrazicea regula „doar pași măsurabili" de mai sus.
          {
            label: pickupOnly
              ? 'Prima comandă de test — deschide meniul public și comandă'
              : 'Prima comandă de test — deschide QR-ul unei mese și comandă',
            done: everOrdered === true,
            target: 'mese' as const,
          },
        ]
      : []),
  ]
  const setupDone = setupItems.filter((s) => s.done).length
  const setupTotal = setupItems.length
  const setupComplete = setupDone === setupTotal

  const healthSuggestions = health ? getActionableSuggestions(health).slice(0, 2) : []

  // Metricele secundare — aceeași importanță între ele, sub hero.
  const secondaryMetrics = [
    { label: 'Produse active', value: String(productCount), hint: undefined as string | undefined },
    pickupOnly
      ? { label: 'QR-uri active', value: '1', hint: 'QR general (doar ridicare)' }
      : {
          label: 'QR-uri active',
          value: tablesCount == null ? '…' : String(tablesCount),
          hint: 'mese scanabile',
        },
    // Metrica „Setup" doar pentru admin: checklist-ul (sursa pașilor) e gate-uit
    // pe isAdmin mai jos — staff-ul ar vedea o cifră fără nicio listă/acțiune.
    ...(isAdmin
      ? [
          {
            label: 'Setup',
            value: `${setupDone}/${setupTotal}`,
            hint: setupComplete ? 'totul e gata ✓' : 'pași completați',
          },
        ]
      : []),
  ]

  return (
    <div style={{ maxWidth: 1000, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <RevealItem>
        <div>
          <h1
            style={{
              fontFamily: displayFont,
              fontSize: '1.7rem',
              fontWeight: 600,
              color: D.t1,
              letterSpacing: '-0.02em',
            }}
          >
            Bun venit, {restaurantName}
          </h1>
          <p style={{ color: D.t2, fontSize: '0.82rem', marginTop: 5 }}>
            Configurează restaurantul, verifică QR-urile și urmărește activitatea de azi.
          </p>
        </div>
      </RevealItem>

      {/* Cifrele zilei — „Comenzi azi" domină vizual (hero), restul secundare.
          Tier 1 (fără comenzi): grid uniform de metrici, fără hero gol. */}
      <RevealItem delay={60}>
        {tier >= 2 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <HeroMetric
                label="Comenzi azi"
                value={ordersToday == null ? '…' : String(ordersToday)}
                hint="fără cele anulate"
              />
            </div>
            <div
              style={{
                flex: '2 1 320px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))',
                gap: 12,
              }}
            >
              {secondaryMetrics.map((m) => (
                <MetricCard key={m.label} label={m.label} value={m.value} hint={m.hint} />
              ))}
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
              gap: 12,
            }}
          >
            {secondaryMetrics.map((m) => (
              <MetricCard key={m.label} label={m.label} value={m.value} hint={m.hint} />
            ))}
          </div>
        )}
      </RevealItem>

      {/* Setup restaurant — progres cu bară + pași compacți */}
      {isAdmin && !setupComplete && (
        <RevealItem delay={120}>
        <div style={card}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: D.t1,
                fontSize: '0.95rem',
                fontWeight: 700,
              }}
            >
              <Icon name="sparkle" size={18} color={D.gold} />
              Setup restaurant
            </div>
            <div style={{ color: D.gold, fontSize: '0.82rem', fontWeight: 700 }}>
              {setupDone}/{setupTotal} pași completați
            </div>
          </div>
          <div
            role="progressbar"
            aria-valuenow={setupDone}
            aria-valuemin={0}
            aria-valuemax={setupTotal}
            aria-label="Progres setup"
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {setupItems.map((it) => (
              <button
                key={it.label}
                onClick={() => {
                  if (it.done) return
                  if (it.target) onNavigate(it.target)
                  else handleViewMenu()
                }}
                className={it.done ? undefined : 'pressable'}
                aria-disabled={it.done || undefined}
                aria-label={it.done ? it.label + ' (completat)' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  padding: '12px 8px',
                  minHeight: 44,
                  margin: '0 -8px',
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
                  {it.done && <Icon name="check" size={12} color={D.green} />}
                </span>
                <span style={{ textDecoration: it.done ? 'line-through' : 'none' }}>
                  {it.label}
                </span>
                {!it.done && (
                  <span style={{ marginLeft: 'auto', display: 'flex' }}>
                    <Icon name="chevronRight" size={16} color={D.t3} />
                  </span>
                )}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <ExpandableCard
              header={(open) => (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: D.t2,
                    fontSize: '0.78rem',
                  }}
                >
                  <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} color={D.t2} />
                  {open ? 'Închide asistentul detaliat' : 'Deschide asistentul detaliat'}
                </span>
              )}
            >
              <Suspense fallback={<InlineSpinner label="Se încarcă asistentul..." />}>
                <QuickSetupTab restaurantId={restaurantId} restaurantName={restaurantName} />
              </Suspense>
            </ExpandableCard>
          </div>
        </div>
        </RevealItem>
      )}

      {/* Scor meniu — badge mare, color-codat după scor; sugestia secundară */}
      {isAdmin && tier >= 2 && (
        <RevealItem delay={180}>
        <ExpandableCard
          header={(open) => {
            // Culoarea scorului dictează accentul: verde/gold/amber/roșu.
            const sc = health ? scoreColor(health.score, scorePalette) : D.t3
            return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {/* Cifra scorului — proeminentă, în cerc color-codat */}
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: '50%',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: health ? `${sc}1A` : D.s3,
                  border: `1.5px solid ${health ? `${sc}66` : D.border}`,
                  fontFamily: displayFont,
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: sc,
                  lineHeight: 1,
                }}
              >
                {health ? health.score : '…'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: healthSuggestions.length > 0 ? 5 : 0,
                  }}
                >
                  <span style={{ color: D.t1, fontSize: '0.98rem', fontWeight: 700 }}>
                    Scor meniu
                  </span>
                  {health && (
                    <span
                      style={{
                        background: `${sc}22`,
                        color: sc,
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderRadius: 100,
                        padding: '2px 10px',
                      }}
                    >
                      {scoreLabel(health.score)}
                    </span>
                  )}
                </div>
                {/* Sugestia practică — clar secundară (text discret) */}
                {healthSuggestions.map((s) => (
                  <div key={s.component} style={{ color: D.t2, fontSize: '0.75rem', marginTop: 2 }}>
                    • {s.suggestion}
                  </div>
                ))}
              </div>
              <span style={{ display: 'flex', flexShrink: 0 }}>
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} color={D.t3} />
              </span>
            </div>
            )
          }}
        >
          <Suspense fallback={<InlineSpinner label="Se încarcă scorul..." />}>
            <HealthScoreTab />
          </Suspense>
        </ExpandableCard>
        </RevealItem>
      )}

      {/* Acțiuni rapide */}
      <RevealItem delay={240}>
      <div>
        <div style={sectionTitle}>Acțiuni rapide</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
            gap: 10,
          }}
        >
          <QuickAction icon="plus" label="Adaugă produs" onClick={() => onNavigate('products')} />
          <QuickAction icon="qr" label="Generează QR-uri" onClick={() => onNavigate('mese')} />
          <QuickAction icon="box" label="Suporturi QR fizice" onClick={onOrderQrStands} />
          <QuickAction icon="eye" label="Vezi meniul public" onClick={handleViewMenu} />
          {tier >= 2 && (
            <QuickAction icon="bell" label="Vezi comenzile" onClick={() => onNavigate('comenzi')} />
          )}
          {tier >= 2 && isAdmin && (
            <QuickAction icon="users" label="Invită ospătar" onClick={() => onNavigate('echipa')} />
          )}
        </div>
      </div>
      </RevealItem>

      {/* Abonament & facturare — ORICE plan plătit (tier ≥ 1 = starter+).
          Deschide Portalul Stripe: destinația reală a CTA-urilor din emailurile
          de facturare/dunning. Starter e plan plătit (99 lei/lună) — gate-ul pe
          tier ≥ 2 îl lăsa fără nicio cale în app de a-și schimba cardul, deci
          CTA-ul „Actualizează metoda de plată" era dead-end (audit săpt. 10). */}
      {isAdmin && tier >= 1 && (
        <RevealItem delay={300}>
          {/* id-ul e ținta CTA-urilor din emailuri (/dashboard?tab=billing →
              scroll aici, vezi efectul din DashboardPage). */}
          <div id="billing-card">
            <SubscriptionCard />
          </div>
        </RevealItem>
      )}

      {/* Upgrade — doar tier 1, mereu ultimul */}
      {isAdmin && tier < 2 && (
        <RevealItem delay={300}>
        <Card
          variant="raised"
          padding="18px 20px"
          radius={14}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
            border: `1px solid ${D.gold}33`,
          }}
        >
          <span style={{ fontSize: '1.6rem' }}>{growthPlan.emoji}</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ color: D.t1, fontSize: '0.92rem', fontWeight: 600 }}>
              Vrei să primești comenzi direct de la masă?
            </div>
            <div style={{ color: D.t2, fontSize: '0.78rem', marginTop: 4, lineHeight: 1.5 }}>
              Activează {growthPlan.name} și clienții pot comanda prin QR, iar bucătăria primește
              instant.
            </div>
          </div>
          <button
            onClick={onPricing}
            className="pressable"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 9,
              padding: '11px 18px',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
              whiteSpace: 'nowrap',
            }}
          >
            Activează {growthPlan.name}
            <Icon name="chevronRight" size={16} color="#000" />
          </button>
        </Card>
        </RevealItem>
      )}
    </div>
  )
}
