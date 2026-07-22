// =============================================================
// Menuvia — src/components/TableStatusMap.tsx
// Al doilea mod al panoului „Stadiu mese": harta sălii desenată (floor_layout),
// cu fiecare masă colorată după statusul ei live (liberă / ocupată / de servit /
// cheamă ospătar / cere nota). Read-only + tap pe masă → o selectează (detaliul
// apare sub hartă, în TableStatusBoard). Refolosește tipurile + resolveTableId +
// canvas-ul din lib/floorPlan (aceleași coordonate ca editorul), dar cu tokenii
// D și culorile de status, nu paleta publică.
// =============================================================

import { memo } from 'react'
import type { KeyboardEvent } from 'react'
import { CANVAS_W, CANVAS_H, resolveTableId, type FloorLayout } from '../lib/floorPlan'
import { D } from '../lib/constants'

// Info de colorare per masă reală (tables.id) — calculată în TableStatusBoard.
export interface MapTableState {
  color: string // culoarea de status (STATE_META)
  label: string // eticheta de status („Ocupată" etc.), pentru aria-label
  occupied: boolean
  total: number
}

interface Props {
  layout: FloorLayout
  stateById: Map<string, MapTableState>
  tablesByName: Map<string, string>
  selectedId: string | null
  onSelectTable: (realId: string) => void
}

const WALL_COLOR = { wall: '#64748b', window: '#7EB8F7', door: '#9B72CF' } as const

function TableStatusMap({
  layout,
  stateById,
  tablesByName,
  selectedId,
  onSelectTable,
}: Props) {
  // Multi-etaj = follow-up: randăm primul etaj (ca vizualizatorul public).
  const floor = layout.floors[0]
  if (!floor) return null

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
        borderRadius: 12,
        border: `1px solid ${D.border}`,
        background: D.s1,
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="Harta sălii — stadiul meselor"
        style={{ display: 'block' }}
      >
        {/* Zone: fundal subtil + etichetă */}
        {floor.zones.map((z) => (
          <g key={z.id}>
            <rect
              x={z.x}
              y={z.y}
              width={z.w}
              height={z.h}
              rx={10}
              fill={D.gold}
              fillOpacity={0.05}
              stroke={D.border}
              strokeDasharray="6 5"
            />
            <text
              x={z.x + 8}
              y={z.y + 16}
              fontSize={11}
              fontWeight={600}
              letterSpacing="0.06em"
              fill={D.t3}
              style={{ textTransform: 'uppercase' }}
            >
              {z.label}
            </text>
          </g>
        ))}

        {/* Pereți / ferestre / uși */}
        {floor.walls.map((w) => (
          <line
            key={w.id}
            x1={w.x1}
            y1={w.y1}
            x2={w.x2}
            y2={w.y2}
            stroke={WALL_COLOR[w.type] ?? WALL_COLOR.wall}
            strokeWidth={w.type === 'window' ? 5 : w.type === 'door' ? 10 : 8}
            strokeLinecap="round"
            strokeOpacity={0.7}
          />
        ))}

        {/* Mese colorate pe status */}
        {floor.tables.map((t) => {
          const realId = resolveTableId(t, tablesByName)
          const st = realId != null ? stateById.get(realId) : undefined
          const color = st?.color ?? D.t3
          const occupied = st?.occupied ?? false
          const isSelected = realId != null && realId === selectedId
          const cx = t.x + t.w / 2
          const cy = t.y + t.h / 2
          // Selectabilă doar dacă masa e în scope-ul curent (are stare calculată).
          // Mesele din afara scope-ului ospătarului (link explicit `tableId` dar
          // ne-alocate) au `st` undefined → nu le facem clicabile (altfel tap →
          // detaliu gol).
          const selectable = st != null

          const onActivate = () => {
            if (st != null && realId != null) onSelectTable(realId)
          }
          const onKey = (e: KeyboardEvent<SVGGElement>) => {
            if (!selectable) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onActivate()
            }
          }

          const fillOpacity = occupied ? 0.22 : 0.1
          const strokeWidth = isSelected ? 4 : 2

          return (
            <g
              key={t.id}
              transform={t.rotation ? `rotate(${t.rotation} ${cx} ${cy})` : undefined}
              onClick={onActivate}
              onKeyDown={onKey}
              role={selectable ? 'button' : 'img'}
              aria-label={
                st ? `${t.label} — ${st.label}` : t.label
              }
              aria-pressed={selectable ? isSelected : undefined}
              tabIndex={selectable ? 0 : undefined}
              style={{ cursor: selectable ? 'pointer' : 'default', outline: 'none' }}
            >
              {t.shape === 'round' ? (
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={t.w / 2}
                  ry={t.h / 2}
                  fill={color}
                  fillOpacity={fillOpacity}
                  stroke={color}
                  strokeWidth={strokeWidth}
                />
              ) : (
                <rect
                  x={t.x}
                  y={t.y}
                  width={t.w}
                  height={t.h}
                  rx={t.shape === 'square' ? 10 : 8}
                  fill={color}
                  fillOpacity={fillOpacity}
                  stroke={color}
                  strokeWidth={strokeWidth}
                />
              )}
              {/* Eticheta contra-rotită ca să rămână orizontală */}
              <g transform={t.rotation ? `rotate(${-t.rotation} ${cx} ${cy})` : undefined}>
                <text
                  x={cx}
                  y={occupied ? cy - 4 : cy}
                  fontSize={15}
                  fontWeight={600}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={D.t1}
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  {t.label}
                </text>
                {occupied && st != null && (
                  <text
                    x={cx}
                    y={cy + 12}
                    fontSize={10}
                    fontWeight={600}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={color}
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                  >
                    {st.total.toFixed(0)} lei
                  </text>
                )}
                {/* Punct de status în colț — semnal redundant față de culoare */}
                {st != null && (
                  <circle
                    cx={cx + t.w / 2 - 7}
                    cy={cy - t.h / 2 + 7}
                    r={4}
                    fill={color}
                    style={{ pointerEvents: 'none' }}
                  />
                )}
              </g>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// OPT-9: memo — canvasul hărții nu se mai redesenează la fiecare render al
// board-ului (expand/selecție); props-urile vin acum stabile din derived.
export default memo(TableStatusMap)
