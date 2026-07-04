// FloorPlanViewer — randare READ-ONLY a hărții sălii pentru clientul public.
// Scop: clientul alege o masă liberă direct pe hartă (rezervare cu alegere pe
// hartă). NU depinde de tokenii dashboard-ului `D` — primește culorile prin
// props (PUB/accent) ca să se integreze în tema meniului public.
import type { CSSProperties, KeyboardEvent } from 'react'
import {
  CANVAS_W,
  CANVAS_H,
  resolveTableId,
  type FloorLayout,
  type FloorTable,
  type WallType,
  type DecoType,
} from '../../lib/floorPlan'

interface PubColors {
  bg: string
  surface: string
  text: string
  text2: string
  text3: string
  border: string
  borderStrong: string
}

interface Props {
  layout: FloorLayout
  // Cheie = tables.id real → is_available. Absența cheii = masă fără
  // disponibilitate cunoscută (tratată ca neselectabilă/neutră).
  availabilityByTableId: Map<string, boolean>
  // Cheie = nume masă normalizat (trim+lowercase) → tables.id (pt. fallback nume).
  tablesByName: Map<string, string>
  selectedTableId: string | null
  onSelectTable: (tableId: string) => void
  accent: string
  PUB: PubColors
  lang: string
}

// Culoarea liniilor de perete pe tip (fără a importa metadatele din editor).
const WALL_COLOR: Record<WallType, string> = {
  wall: '#64748b',
  window: '#7EB8F7',
  door: '#9B72CF',
}

// Emoji pentru decoruri — pur ilustrativ, ne-interactiv.
const DECO_EMOJI: Record<DecoType, string> = {
  plant: '🌿',
  bar_counter: '🍸',
  wc: '🚻',
  stairs: '🪜',
  kitchen_door: '👨‍🍳',
  entrance: '🚪',
}

// Starea vizuală/logică a unei mese randate.
type TableState = 'available' | 'occupied' | 'neutral'

export default function FloorPlanViewer({
  layout,
  availabilityByTableId,
  tablesByName,
  selectedTableId,
  onSelectTable,
  accent,
  PUB,
  lang,
}: Props) {
  // Multi-etaj = follow-up: randăm doar primul etaj.
  const floor = layout.floors[0]
  if (!floor) return null

  const containerStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
    borderRadius: 12,
    border: `1px solid ${PUB.border}`,
    background: PUB.surface,
    overflow: 'hidden',
  }

  // Rezolvă starea unei mese: available (liberă), occupied (ocupată) sau
  // neutral (element din layout care nu se leagă de o masă reală).
  function tableStateOf(ft: FloorTable): { state: TableState; realId: string | null } {
    const realId = resolveTableId(ft, tablesByName)
    if (realId == null) return { state: 'neutral', realId: null }
    const avail = availabilityByTableId.get(realId)
    if (avail === true) return { state: 'available', realId }
    if (avail === false) return { state: 'occupied', realId }
    // Masa reală există dar nu apare în disponibilitate → tratăm neutru.
    return { state: 'neutral', realId }
  }

  return (
    <div style={containerStyle}>
      <svg
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={lang === 'ro' ? 'Harta sălii' : 'Floor plan'}
        style={{ display: 'block' }}
      >
        {/* Zone: dreptunghiuri cu fundal subtil + etichetă */}
        {floor.zones.map((z) => (
          <g key={z.id}>
            <rect
              x={z.x}
              y={z.y}
              width={z.w}
              height={z.h}
              rx={10}
              fill={accent}
              fillOpacity={0.06}
              stroke={accent}
              strokeOpacity={0.25}
              strokeDasharray="6 5"
            />
            <text
              x={z.x + 8}
              y={z.y + 16}
              fontSize={11}
              fontWeight={600}
              letterSpacing="0.06em"
              fill={PUB.text3}
              style={{ textTransform: 'uppercase' }}
            >
              {z.label}
            </text>
          </g>
        ))}

        {/* Pereți / ferestre / uși: linii */}
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
            strokeOpacity={0.8}
          />
        ))}

        {/* Decoruri: doar marcaj ilustrativ, ne-interactiv */}
        {floor.decos.map((d) => (
          <text
            key={d.id}
            x={d.x + d.size / 2}
            y={d.y + d.size / 2}
            fontSize={d.size * 0.6}
            textAnchor="middle"
            dominantBaseline="central"
            aria-hidden="true"
            style={{ userSelect: 'none' }}
          >
            {DECO_EMOJI[d.type] ?? ''}
          </text>
        ))}

        {/* Mese */}
        {floor.tables.map((t) => {
          const { state, realId } = tableStateOf(t)
          const isSelectable = state === 'available' && realId != null
          const isSelected = realId != null && realId === selectedTableId
          const cx = t.x + t.w / 2
          const cy = t.y + t.h / 2

          // Paletă pe stare (culorile provin din props, nu din tokenii D).
          const fill =
            state === 'available'
              ? accent
              : state === 'occupied'
                ? PUB.text3
                : PUB.surface
          const fillOpacity = state === 'available' ? 0.16 : state === 'occupied' ? 0.14 : 1
          const stroke = isSelected
            ? accent
            : state === 'available'
              ? accent
              : state === 'occupied'
                ? PUB.text3
                : PUB.border
          const strokeWidth = isSelected ? 4 : 2
          const textColor =
            state === 'available' ? accent : state === 'occupied' ? PUB.text3 : PUB.text2

          const label =
            state === 'available'
              ? lang === 'ro'
                ? `Masa ${t.label} — liberă`
                : `Table ${t.label} — available`
              : state === 'occupied'
                ? lang === 'ro'
                  ? `Masa ${t.label} — ocupată`
                  : `Table ${t.label} — occupied`
                : lang === 'ro'
                  ? `Masa ${t.label}`
                  : `Table ${t.label}`

          const onActivate = () => {
            if (isSelectable && realId != null) onSelectTable(realId)
          }
          const onKey = (e: KeyboardEvent<SVGGElement>) => {
            if (!isSelectable) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onActivate()
            }
          }

          return (
            <g
              key={t.id}
              transform={t.rotation ? `rotate(${t.rotation} ${cx} ${cy})` : undefined}
              onClick={onActivate}
              onKeyDown={onKey}
              role={isSelectable ? 'button' : 'img'}
              aria-label={label}
              aria-pressed={isSelectable ? isSelected : undefined}
              aria-disabled={!isSelectable}
              tabIndex={isSelectable ? 0 : undefined}
              style={{
                cursor: isSelectable ? 'pointer' : 'default',
                outline: 'none',
              }}
            >
              {t.shape === 'round' ? (
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={t.w / 2}
                  ry={t.h / 2}
                  fill={fill}
                  fillOpacity={fillOpacity}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                />
              ) : (
                <rect
                  x={t.x}
                  y={t.y}
                  width={t.w}
                  height={t.h}
                  rx={t.shape === 'square' ? 10 : 8}
                  fill={fill}
                  fillOpacity={fillOpacity}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                />
              )}
              {/* Eticheta e contra-rotită ca să rămână orizontală și lizibilă. */}
              <g transform={t.rotation ? `rotate(${-t.rotation} ${cx} ${cy})` : undefined}>
                <text
                  x={cx}
                  y={cy - 2}
                  fontSize={15}
                  fontWeight={600}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={textColor}
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  {t.label}
                </text>
                <text
                  x={cx}
                  y={cy + 14}
                  fontSize={10}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={PUB.text3}
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  {t.seats} {lang === 'ro' ? 'loc.' : 'seats'}
                </text>
              </g>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
