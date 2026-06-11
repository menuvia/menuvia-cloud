// ─────────────────────────────────────────────────────────────
// HomeTab — „Acasă": mission control-ul dashboard-ului.
// Nu e un container tehnic: status, checklist setup, scor meniu,
// cifrele zilei și acțiuni rapide. Pentru tier 1, împinge natural
// spre Meniu + Comenzi (upgrade card).
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, lazy, Suspense } from 'react'
import { D } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import type { PlanTier } from '../../lib/features'
import { InlineSpinner } from '../PageLoader'

const QuickSetupTab = lazy(() => import('../QuickSetupTab'))
const HealthScoreTab = lazy(() => import('../HealthScoreTab'))

interface Props {
  restaurantId: string
  restaurantName: string
  tier: PlanTier
  isAdmin: boolean
  productCount: number
  onNavigate: (tab: 'products' | 'mese' | 'raport') => void
  onViewMenu: () => void
  onPricing: () => void
}

const card: React.CSSProperties = {
  background: D.s2,
  border: `1px solid ${D.border}`,
  borderRadius: 14,
  padding: '18px 20px',
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={card}>
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
      <div style={{ fontFamily: 'Fraunces,serif', fontSize: '1.7rem', color: D.t1, fontWeight: 700 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 5 }}>{hint}</div>}
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

// Card expandabil — checklist-ul de setup și scorul meniului stau „în Acasă"
// fără să o aglomereze: un rând închis, conținutul complet la click.
function ExpandableCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: string
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          padding: '16px 20px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'DM Sans,sans-serif',
        }}
      >
        <span style={{ fontSize: '1.3rem' }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ color: D.t1, fontSize: '0.9rem', fontWeight: 600 }}>{title}</div>
          <div style={{ color: D.t3, fontSize: '0.75rem', marginTop: 2 }}>{subtitle}</div>
        </div>
        <span style={{ color: D.t3, fontSize: '0.8rem' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '0 20px 20px' }}>{children}</div>}
    </div>
  )
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
  // Comenzile de azi — un singur count HEAD, doar pe planurile cu comenzi.
  const [ordersToday, setOrdersToday] = useState<number | null>(null)
  useEffect(() => {
    if (tier < 2) return
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    let alive = true
    void supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .neq('status', 'cancelled')
      .gte('created_at', start.toISOString())
      .then(({ count }) => {
        if (alive) setOrdersToday(count ?? 0)
      })
    return () => {
      alive = false
    }
  }, [restaurantId, tier])

  return (
    <div style={{ maxWidth: 1000, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h1
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.5rem',
            fontWeight: 600,
            color: D.t1,
            letterSpacing: '-0.02em',
          }}
        >
          {restaurantName}
        </h1>
        <p style={{ color: D.t3, fontSize: '0.8rem', marginTop: 3 }}>
          Adaugi meniul. Generezi QR. Primești comenzi. Vezi rapoarte simple.
        </p>
      </div>

      {/* Cifrele zilei */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
          gap: 10,
        }}
      >
        <StatCard label="Produse active" value={String(productCount)} />
        {tier >= 2 && (
          <StatCard
            label="Comenzi azi"
            value={ordersToday == null ? '…' : String(ordersToday)}
            hint="fără cele anulate"
          />
        )}
        <StatCard label="Meniu QR" value="Activ" hint="scanabil de clienți" />
      </div>

      {/* Acțiuni rapide */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
          gap: 10,
        }}
      >
        <QuickAction icon="➕" label="Adaugă produs" onClick={() => onNavigate('products')} />
        <QuickAction icon="👁" label="Vezi meniul public" onClick={onViewMenu} />
        <QuickAction icon="🪑" label="Mese & QR" onClick={() => onNavigate('mese')} />
        {tier >= 2 && isAdmin && (
          <QuickAction icon="📊" label="Raportul de azi" onClick={() => onNavigate('raport')} />
        )}
      </div>

      {/* Checklist setup + Scor meniu — doar pentru admini */}
      {isAdmin && (
        <ExpandableCard
          icon="🪄"
          title="Asistent configurare"
          subtitle="Checklist pas cu pas: meniu, mese, QR — totul gata de clienți"
        >
          <Suspense fallback={<InlineSpinner label="Se încarcă asistentul..." />}>
            <QuickSetupTab restaurantId={restaurantId} restaurantName={restaurantName} />
          </Suspense>
        </ExpandableCard>
      )}
      {isAdmin &&
        (tier >= 2 ? (
          <ExpandableCard
            icon="🩺"
            title="Scor meniu"
            subtitle="Cât de bine arată și vinde meniul tău — cu recomandări concrete"
          >
            <Suspense fallback={<InlineSpinner label="Se încarcă scorul..." />}>
              <HealthScoreTab />
            </Suspense>
          </ExpandableCard>
        ) : (
          <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: '1.5rem' }}>🛎</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: D.t1, fontSize: '0.9rem', fontWeight: 600 }}>
                Vrei să primești comenzi direct de la masă?
              </div>
              <div style={{ color: D.t3, fontSize: '0.78rem', marginTop: 3, lineHeight: 1.5 }}>
                Cu Meniu + Comenzi, clienții comandă singuri prin QR, bucătăria vede totul live,
                iar tu primești rapoarte zilnice. Plata rămâne pe casa ta actuală.
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
              Activează →
            </button>
          </div>
        ))}
    </div>
  )
}
