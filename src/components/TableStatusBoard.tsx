// =============================================================
// Menuvia — src/components/TableStatusBoard.tsx
// Panou „Stadiu mese" (Pro/Fiscalizare) — vezi starea FIECĂREI mese dintr-o
// privire: liberă / ocupată / de servit / cheamă ospătar, cu total pe toate
// rundele, de cât timp e deschisă, câte runde, și „+ Adaugă la masă" (rundă
// nouă pe aceeași masă — clientul mai vrea un desert / o băutură fără haos).
// Două moduri: Grilă (universal) și Hartă (colorează harta sălii desenată).
// Zero cod nou de infrastructură: agregă din comenzile deschise (useOrders,
// realtime) + apelurile de ospătar. Fără migrație.
// =============================================================

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode, type CSSProperties } from 'react'
import { D } from '../lib/constants'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import type { IconName } from './ui/Icon'
import type { Order, WaiterCall } from '../lib/orders'
import type { FloorLayout } from '../lib/floorPlan'
import TableStatusMap, { type MapTableState } from './TableStatusMap'

interface BoardTable {
  id: string
  name: string
  seats: number | null
}

type TableState = 'bill' | 'calling' | 'ready' | 'occupied' | 'free'

interface TableStatusBoardProps {
  tables: BoardTable[]
  orders: Order[] // comenzile deschise (deja filtrate pe scope-ul ospătarului)
  waiterCalls: WaiterCall[] // apeluri pending
  onAddToTable: (tableId: string | null) => void
  renderOrderCard: (order: Order) => ReactNode
  floorLayout?: FloorLayout | null // harta sălii desenată (dacă există)
}

// Meta per stare: culoare, etichetă, icon. Ordinea de mai jos = și prioritatea
// de sortare (worst-first): cere nota → cheamă → de servit → ocupată → liberă.
const STATE_META: Record<
  TableState,
  { label: string; color: string; icon: IconName; priority: number }
> = {
  bill: { label: 'Cere nota', color: D.red, icon: 'receipt', priority: 0 },
  calling: { label: 'Cheamă ospătar', color: D.amber, icon: 'bell', priority: 1 },
  ready: { label: 'De servit', color: D.green, icon: 'check', priority: 2 },
  occupied: { label: 'Ocupată', color: D.gold, icon: 'utensils', priority: 3 },
  free: { label: 'Liberă', color: D.t3, icon: 'table', priority: 4 },
}

// „de 45 min" / „de 1h 20m" din cel mai vechi created_at al rundelor.
function openSince(oldestIso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(oldestIso).getTime()) / 60000))
  if (mins < 60) return `de ${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `de ${h}h` : `de ${h}h ${m}m`
}

interface ComputedTable {
  key: string
  id: string | null
  name: string
  seats: number | null
  orders: Order[]
  state: TableState
  total: number
  rounds: number
  oldestIso: string | null
}

// Un card de masă — folosit de grilă ȘI de detaliul de sub hartă.
const BoardTableCard = memo(function BoardTableCard({
  c,
  now,
  isOpen,
  onToggle,
  onAddToTable,
  renderOrderCard,
}: {
  c: ComputedTable
  now: number
  isOpen: boolean
  onToggle: (key: string) => void
  onAddToTable: (tableId: string | null) => void
  renderOrderCard: (order: Order) => ReactNode
}) {
  const meta = STATE_META[c.state]
  const occupied = c.rounds > 0
  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${occupied ? meta.color + '55' : D.border}`,
        borderRadius: 14,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        boxShadow:
          c.state === 'bill' || c.state === 'calling' ? `inset 3px 0 0 ${meta.color}` : 'none',
      }}
    >
      {/* Antet: nume masă + locuri + pastilă de status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <Icon name="table" size={16} color={occupied ? meta.color : D.t3} />
          <span
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 16,
              fontWeight: 700,
              color: D.t1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {c.name}
          </span>
          {c.seats != null && (
            <span style={{ fontSize: 11, color: D.t3, flexShrink: 0 }}>{c.seats} loc.</span>
          )}
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: meta.color + '1F',
            color: meta.color,
            borderRadius: 20,
            padding: '2px 9px',
            fontSize: 11,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <Icon name={meta.icon} size={12} color={meta.color} />
          {meta.label}
        </span>
      </div>

      {occupied ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 22,
                fontWeight: 700,
                color: D.t1,
              }}
            >
              {c.total.toFixed(2)} lei
            </span>
            <span style={{ fontSize: 12, color: D.t2 }}>
              {c.rounds === 1 ? '1 rundă' : `${c.rounds} runde`}
              {c.oldestIso ? ` · ${openSince(c.oldestIso, now)}` : ''}
            </span>
          </div>

          <div
            style={{
              fontSize: 12,
              color: D.t2,
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {c.orders
              .flatMap((o) => o.order_items)
              .map((it) => `${it.product_name_snapshot} ×${it.quantity}`)
              .join(', ')}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => onAddToTable(c.id)} style={primaryBtn}>
              <Icon name="plus" size={15} />
              Adaugă la masă
            </button>
            <button onClick={() => onToggle(c.key)} aria-expanded={isOpen} style={ghostBtn}>
              {isOpen ? 'Ascunde' : `Vezi (${c.rounds})`}
              <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14} />
            </button>
          </div>

          {isOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 2 }}>
              {c.orders.map((o) => (
                <div key={o.id}>{renderOrderCard(o)}</div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, color: D.t3 }}>Nicio comandă deschisă</div>
          {c.id != null && (
            <button onClick={() => onAddToTable(c.id)} style={ghostBtnWide}>
              <Icon name="plus" size={15} />
              Deschide comandă
            </button>
          )}
        </>
      )}
    </div>
  )
})

export default function TableStatusBoard({
  tables,
  orders,
  waiterCalls,
  onAddToTable,
  renderOrderCard,
  floorLayout,
}: TableStatusBoardProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [mapMode, setMapMode] = useState<'grid' | 'map'>('grid')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // OPT-9: `now` e stare cu tick de 30s — înainte era Date.now() la fiecare
  // render, ceea ce invalida orice memoizare a derivărilor de mai jos.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  // OPT-9: TOATE derivările (grupări, stări, sortare, countere) se
  // recalculează doar când se schimbă datele — nu la fiecare render
  // (expand/collapse, selecție pe hartă, tick de timp).
  const derived = useMemo(() => {
  // Grupăm comenzile deschise pe table_id (null = „Fără masă").
  const ordersByTable = new Map<string, Order[]>()
  for (const o of orders) {
    const key = o.table_id ?? '__none__'
    const arr = ordersByTable.get(key)
    if (arr) arr.push(o)
    else ordersByTable.set(key, [o])
  }

  // Apeluri pending pe fiecare masă (bill = cere nota, prioritate peste chemarea simplă).
  const callByTable = new Map<string, 'bill' | 'waiter'>()
  for (const c of waiterCalls) {
    if (c.status !== 'pending' || !c.table_id) continue
    const kind = c.call_type === 'bill' ? 'bill' : 'waiter'
    const existing = callByTable.get(c.table_id)
    if (existing !== 'bill') callByTable.set(c.table_id, kind)
  }

  function computeState(tableId: string | null, tableOrders: Order[]): TableState {
    if (tableId) {
      const call = callByTable.get(tableId)
      if (call === 'bill') return 'bill'
      if (call === 'waiter') return 'calling'
    }
    if (tableOrders.some((o) => o.status === 'ready')) return 'ready'
    if (tableOrders.length > 0) return 'occupied'
    return 'free'
  }

  const computed: ComputedTable[] = tables.map((t) => {
    const tableOrders = ordersByTable.get(t.id) ?? []
    const total = tableOrders.reduce((s, o) => s + o.total, 0)
    const oldestIso =
      tableOrders.length > 0
        ? tableOrders.reduce(
            (min, o) => (o.created_at < min ? o.created_at : min),
            tableOrders[0]!.created_at,
          )
        : null
    return {
      key: t.id,
      id: t.id,
      name: t.name,
      seats: t.seats,
      orders: tableOrders,
      state: computeState(t.id, tableOrders),
      total,
      rounds: tableOrders.length,
      oldestIso,
    }
  })

  // Comenzi fără masă (takeaway / manual „Fără masă") — pseudo-card separat.
  const noneOrders = ordersByTable.get('__none__') ?? []
  if (noneOrders.length > 0) {
    const total = noneOrders.reduce((s, o) => s + o.total, 0)
    const oldestIso = noneOrders.reduce(
      (min, o) => (o.created_at < min ? o.created_at : min),
      noneOrders[0]!.created_at,
    )
    computed.push({
      key: '__none__',
      id: null,
      name: 'Fără masă',
      seats: null,
      orders: noneOrders,
      state: 'occupied',
      total,
      rounds: noneOrders.length,
      oldestIso,
    })
  }

  // Sortare worst-first: prioritate de stare, apoi cele ocupate cu cea mai
  // veche comandă sus (așteaptă cel mai mult), iar cele libere alfabetic.
  computed.sort((a, b) => {
    const pa = STATE_META[a.state].priority
    const pb = STATE_META[b.state].priority
    if (pa !== pb) return pa - pb
    if (a.oldestIso && b.oldestIso) return a.oldestIso < b.oldestIso ? -1 : 1
    return a.name.localeCompare(b.name, 'ro', { numeric: true })
  })

  const occupiedCount = computed.filter((c) => c.rounds > 0).length
  const freeCount = computed.filter((c) => c.state === 'free').length
  const attentionCount = computed.filter(
    (c) => c.state === 'bill' || c.state === 'calling' || c.state === 'ready',
  ).length

  return { computed, noneOrdersCount: noneOrders.length, occupiedCount, freeCount, attentionCount }
  }, [tables, orders, waiterCalls])
  const { computed, noneOrdersCount, occupiedCount, freeCount, attentionCount } = derived

  // ATENȚIE: toate hook-urile ÎNAINTE de orice early-return (Rules of Hooks).
  // `toggle` era declarat DUPĂ early-return-ul de „nicio masă" → la tranziția
  // gol→populat React vedea mai multe hook-uri decât la randarea precedentă
  // („Rendered more hooks than during the previous render") și panoul crăpa.
  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  if (tables.length === 0 && noneOrdersCount === 0) {
    return (
      <EmptyState
        icon="table"
        title="Nicio masă configurată"
        description={'Adaugă mese în „Mese & QR” ca să vezi stadiul lor aici.'}
      />
    )
  }

  // ── Pregătire pentru modul Hartă ──
  const hasMap = (floorLayout?.floors?.[0]?.tables?.length ?? 0) > 0
  const tablesByName = new Map<string, string>()
  for (const t of tables) tablesByName.set(t.name.trim().toLowerCase(), t.id)
  const stateById = new Map<string, MapTableState>()
  for (const c of computed) {
    if (c.id == null) continue
    const meta = STATE_META[c.state]
    stateById.set(c.id, {
      color: meta.color,
      label: meta.label,
      occupied: c.rounds > 0,
      total: c.total,
    })
  }
  const selected = selectedId != null ? computed.find((c) => c.id === selectedId) ?? null : null

  return (
    <div>
      {/* Rezumat rapid + comutator Grilă/Hartă (dacă există o hartă desenată) */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 14,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <SummaryPill label="Cer atenție" value={attentionCount} color={D.amber} />
          <SummaryPill label="Ocupate" value={occupiedCount} color={D.gold} />
          <SummaryPill label="Libere" value={freeCount} color={D.t3} />
        </div>
        {hasMap && (
          <div
            role="tablist"
            aria-label="Mod afișare mese"
            style={{
              display: 'inline-flex',
              gap: 4,
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 10,
              padding: 3,
            }}
          >
            {(
              [
                ['grid', 'Grilă', 'menu'],
                ['map', 'Hartă', 'table'],
              ] as const
            ).map(([m, label, icon]) => {
              const active = mapMode === m
              return (
                <button
                  key={m}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMapMode(m)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    minHeight: 38,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'DM Sans, sans-serif',
                    fontSize: 12,
                    fontWeight: 600,
                    background: active ? D.gold : 'transparent',
                    color: active ? D.bg : D.t2,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Icon name={icon} size={14} color={active ? D.bg : D.t2} />
                  {label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {mapMode === 'map' && hasMap && floorLayout != null ? (
        <div>
          <TableStatusMap
            layout={floorLayout}
            stateById={stateById}
            tablesByName={tablesByName}
            selectedId={selectedId}
            onSelectTable={setSelectedId}
          />
          <div style={{ marginTop: 12 }}>
            {selected != null ? (
              <BoardTableCard
                c={selected}
                now={now}
                isOpen={expanded.has(selected.key)}
                onToggle={toggle}
                onAddToTable={onAddToTable}
                renderOrderCard={renderOrderCard}
              />
            ) : (
              <div
                style={{
                  textAlign: 'center',
                  color: D.t3,
                  fontSize: 13,
                  padding: '12px 8px',
                }}
              >
                Atinge o masă pe hartă ca să vezi detaliile.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
            gap: 12,
            alignItems: 'start',
          }}
        >
          {computed.map((c) => (
            <BoardTableCard
              key={c.key}
              c={c}
              now={now}
              isOpen={expanded.has(c.key)}
              onToggle={toggle}
              onAddToTable={onAddToTable}
              renderOrderCard={renderOrderCard}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 20,
        padding: '5px 12px',
        fontSize: 12,
        color: D.t2,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <strong style={{ color: D.t1, fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
      {label}
    </span>
  )
}

const primaryBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  background: D.gold,
  color: D.bg,
  border: 'none',
  borderRadius: 9,
  padding: '0 14px',
  minHeight: 44,
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  flex: '1 1 auto',
  whiteSpace: 'nowrap',
}

const ghostBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  background: D.s3,
  color: D.t1,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '0 12px',
  minHeight: 44,
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const ghostBtnWide: CSSProperties = {
  ...ghostBtn,
  width: '100%',
}
