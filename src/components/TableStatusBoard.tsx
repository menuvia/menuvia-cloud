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
import { useT } from '../i18n/useT'
import { waiterNs } from '../i18n/ns/waiter'
import type { StringKey, Translator } from '../i18n/core'
import type waiterRo from '../i18n/ns/waiter/ro'

type WaiterT = Translator<typeof waiterRo>

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
// Eticheta e cheia din namespace-ul `waiter` (lotul L4b), tradusă la randare.
const STATE_META: Record<
  TableState,
  { labelKey: StringKey<typeof waiterRo>; color: string; icon: IconName; priority: number }
> = {
  bill: { labelKey: 'state_bill', color: D.red, icon: 'receipt', priority: 0 },
  calling: { labelKey: 'state_calling', color: D.amber, icon: 'bell', priority: 1 },
  ready: { labelKey: 'state_ready', color: D.green, icon: 'check', priority: 2 },
  occupied: { labelKey: 'state_occupied', color: D.gold, icon: 'utensils', priority: 3 },
  free: { labelKey: 'state_free', color: D.t3, icon: 'table', priority: 4 },
}

// „de 45 min" / „de 1h 20m" din cel mai vechi created_at al rundelor.
function openSince(oldestIso: string, now: number, t: WaiterT['t']): string {
  const mins = Math.max(0, Math.floor((now - new Date(oldestIso).getTime()) / 60000))
  if (mins < 60) return t('board_openMin', { n: mins })
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? t('board_openH', { h }) : t('board_openHM', { h, m })
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
  const { t, tp } = useT(waiterNs)
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
            <span style={{ fontSize: 11, color: D.t3, flexShrink: 0 }}>{tp('seats', c.seats)}</span>
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
          {t(meta.labelKey)}
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
              {t('money', { amount: c.total.toFixed(2) })}
            </span>
            <span style={{ fontSize: 12, color: D.t2 }}>
              {tp('board_rounds', c.rounds)}
              {c.oldestIso ? ` · ${openSince(c.oldestIso, now, t)}` : ''}
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
              {t('board_addToTable')}
            </button>
            <button onClick={() => onToggle(c.key)} aria-expanded={isOpen} style={ghostBtn}>
              {isOpen ? t('board_hide') : t('board_show', { n: c.rounds })}
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
          <div style={{ fontSize: 12, color: D.t3 }}>{t('board_noOrders')}</div>
          {c.id != null && (
            <button onClick={() => onAddToTable(c.id)} style={ghostBtnWide}>
              <Icon name="plus" size={15} />
              {t('board_openOrder')}
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
  const { t } = useT(waiterNs)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [mapMode, setMapMode] = useState<'grid' | 'map'>('grid')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // OPT-9: `now` e stare cu tick de 30s — înainte era Date.now() la fiecare
  // render, ceea ce invalida orice memoizare a derivărilor de mai jos.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
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

  const computed: ComputedTable[] = tables.map((tb) => {
    const tableOrders = ordersByTable.get(tb.id) ?? []
    const total = tableOrders.reduce((s, o) => s + o.total, 0)
    const oldestIso =
      tableOrders.length > 0
        ? tableOrders.reduce(
            (min, o) => (o.created_at < min ? o.created_at : min),
            tableOrders[0]!.created_at,
          )
        : null
    return {
      key: tb.id,
      id: tb.id,
      name: tb.name,
      seats: tb.seats,
      orders: tableOrders,
      state: computeState(tb.id, tableOrders),
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
      name: t('noTable'),
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
  }, [tables, orders, waiterCalls, t])
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
        title={t('board_emptyTitle')}
        description={t('board_emptyDesc')}
      />
    )
  }

  // ── Pregătire pentru modul Hartă ──
  const hasMap = (floorLayout?.floors?.[0]?.tables?.length ?? 0) > 0
  const tablesByName = new Map<string, string>()
  for (const tb of tables) tablesByName.set(tb.name.trim().toLowerCase(), tb.id)
  const stateById = new Map<string, MapTableState>()
  for (const c of computed) {
    if (c.id == null) continue
    const meta = STATE_META[c.state]
    stateById.set(c.id, {
      color: meta.color,
      label: t(meta.labelKey),
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
          <SummaryPill label={t('board_attention')} value={attentionCount} color={D.amber} />
          <SummaryPill label={t('board_occupied')} value={occupiedCount} color={D.gold} />
          <SummaryPill label={t('board_free')} value={freeCount} color={D.t3} />
        </div>
        {hasMap && (
          <div
            role="tablist"
            aria-label={t('board_modeAria')}
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
                ['grid', 'board_grid', 'menu'],
                ['map', 'board_map', 'table'],
              ] as const
            ).map(([m, labelKey, icon]) => {
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
                  {t(labelKey)}
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
                {t('board_tapHint')}
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
