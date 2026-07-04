// FloorPlanViewer — randare READ-ONLY a hărții sălii pentru clientul public.
// Scop: clientul alege o masă liberă direct pe hartă (rezervare cu alegere pe
// hartă). NU depinde de tokenii dashboard-ului `D` — primește culorile prin
// props (PUB/accent) ca să se integreze în tema meniului public.
import { useState } from 'react'
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
  // Atingerea unei mese ocupate — feedback neblocant în componenta părinte.
  onOccupiedTap?: (tableLabel: string) => void
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
  onOccupiedTap,
  accent,
  PUB,
  lang,
}: Props) {
  // Masa cu focus de tastatură — pentru desenarea unui halou vizibil la Tab
  // (native `outline` pe SVG e nesigur, așa că îl desenăm noi).
  const [focusedId, setFocusedId] = useState<string | null>(null)

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
          // Ocupată = gri clar mai opac (0.35 vs 0.16) ca să nu se bazeze doar pe
          // nuanță — diferența e perceptibilă și fără culoare (daltonism).
          const fillOpacity = state === 'available' ? 0.16 : state === 'occupied' ? 0.35 : 1
          const stroke = isSelected
            ? accent
            : state === 'available'
              ? accent
              : state === 'occupied'
                ? PUB.text3
                : PUB.border
          const strokeWidth = isSelected ? 4 : 2
          // Contur întrerupt suplimentar pe masa ocupată (al doilea semnal non-hue).
          const strokeDasharray = state === 'occupied' ? '5 4' : undefined
          const isFocused = realId != null && realId === focusedId
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
            // Masă ocupată: nu e selectabilă, dar dăm feedback (nu tăcem tap-ul).
            else if (state === 'occupied') onOccupiedTap?.(t.label)
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
              onFocus={isSelectable && realId != null ? () => setFocusedId(realId) : undefined}
              onBlur={
                isSelectable ? () => setFocusedId((cur) => (cur === realId ? null : cur)) : undefined
              }
              role={isSelectable ? 'button' : 'img'}
              aria-label={label}
              aria-pressed={isSelectable ? isSelected : undefined}
              aria-disabled={!isSelectable}
              tabIndex={isSelectable ? 0 : undefined}
              style={{
                cursor: isSelectable ? 'pointer' : state === 'occupied' ? 'not-allowed' : 'default',
                // Suprimăm outline-ul nativ (nesigur pe SVG) și desenăm noi haloul.
                outline: 'none',
              }}
            >
              {/* Halou de focus vizibil la navigarea cu Tab (a11y). */}
              {isFocused &&
                (t.shape === 'round' ? (
                  <ellipse
                    cx={cx}
                    cy={cy}
                    rx={t.w / 2 + 5}
                    ry={t.h / 2 + 5}
                    fill="none"
                    stroke={accent}
                    strokeWidth={3}
                    strokeOpacity={0.9}
                  />
                ) : (
                  <rect
                    x={t.x - 5}
                    y={t.y - 5}
                    width={t.w + 10}
                    height={t.h + 10}
                    rx={(t.shape === 'square' ? 10 : 8) + 3}
                    fill="none"
                    stroke={accent}
                    strokeWidth={3}
                    strokeOpacity={0.9}
                  />
                ))}
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
                  strokeDasharray={strokeDasharray}
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
                  strokeDasharray={strokeDasharray}
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
                {/* Marcaj „✕" în colț pe masa ocupată — semnal de formă, nu doar
                    de culoare (perceptibil și în daltonism / print alb-negru). */}
                {state === 'occupied' && (
                  <text
                    x={cx + t.w / 2 - 8}
                    y={cy - t.h / 2 + 8}
                    fontSize={13}
                    fontWeight={700}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={PUB.text3}
                    aria-hidden="true"
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                  >
                    ✕
                  </text>
                )}
              </g>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
