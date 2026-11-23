// Tipuri + constante partajate pentru harta sălii (floor plan).
// Extrase din FloorPlanEditor.tsx ca să fie reutilizabile și de vizualizatorul
// public (FloorPlanViewer) fără a duplica definițiile. Editorul le importă înapoi.

// ─── Enum-uri ─────────────────────────────────────────────────
export type TableShape = 'round' | 'square' | 'rect' | 'bar'
export type TableStatus = 'free' | 'occupied' | 'calling' | 'reserved'
export type WallType = 'wall' | 'window' | 'door'
export type DecoType = 'plant' | 'bar_counter' | 'wc' | 'stairs' | 'kitchen_door' | 'entrance'

// ─── Elemente pe canvas ───────────────────────────────────────
export interface FloorTable {
  id: string
  x: number
  y: number
  w: number
  h: number
  shape: TableShape
  label: string
  seats: number
  rotation: number
  status: TableStatus
  // Legătura cu masa reală (public.tables.id). Opțional pentru
  // backward-compat; auto-link după nume dacă lipsește.
  tableId?: string
}
export interface FloorWall {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  type: WallType
}
export interface FloorDeco {
  id: string
  x: number
  y: number
  type: DecoType
  size: number
}
export interface FloorZone {
  id: string
  x: number
  y: number
  w: number
  h: number
  label: string
}
export interface Floor {
  id: string
  name: string
  tables: FloorTable[]
  walls: FloorWall[]
  decos: FloorDeco[]
  zones: FloorZone[]
}
export interface FloorLayout {
  floors: Floor[]
  version: number
  savedAt: string
}

// ─── Numele IMPLICITE ale elementelor NOI (DATE) ──────────────
// Se scriu în `restaurants.floor_layout` la salvare și le vede și OASPETELE
// (zonele, pe harta publică a rezervării), deci NU urmează limba personalului
// (regula „valorile din DB nu se traduc”, ca `MANUAL_ADJUST_NOTE` din L5b):
// urmează limba de BAZĂ a meniului — cea în care oaspetele citește implicit
// pagina —, ca un local german să nu propună „Parter”/„Zonă” pe harta
// publică (precondiția activării limbilor). Româna e textul de dinainte; o
// limbă necunoscută cade pe română. Butoanele care le creează („+ Etaj”,
// „▢ Zonă”) se traduc în limba personalului; numele propus, nu.
export const DEFAULT_FLOOR_NAME = 'Parter'
export const defaultFloorName = (n: number): string => `Etaj ${n}`
export const DEFAULT_ZONE_LABEL = 'Zonă'

interface FloorDefaults {
  ground: string
  floor: (n: number) => string
  zone: string
}
const RO_FLOOR_DEFAULTS: FloorDefaults = { ground: DEFAULT_FLOOR_NAME, floor: defaultFloorName, zone: DEFAULT_ZONE_LABEL }
const FLOOR_DEFAULTS: Readonly<Record<string, FloorDefaults>> = {
  ro: RO_FLOOR_DEFAULTS,
  en: { ground: 'Ground floor', floor: (n) => `Floor ${n}`, zone: 'Area' },
  de: { ground: 'Erdgeschoss', floor: (n) => `Etage ${n}`, zone: 'Bereich' },
  fr: { ground: 'Rez-de-chaussée', floor: (n) => `Étage ${n}`, zone: 'Zone' },
  it: { ground: 'Piano terra', floor: (n) => `Piano ${n}`, zone: 'Zona' },
  hu: { ground: 'Földszint', floor: (n) => `${n}. emelet`, zone: 'Terület' },
  es: { ground: 'Planta baja', floor: (n) => `Planta ${n}`, zone: 'Zona' },
}

/** Numele implicite ale etajelor și zonelor noi, în limba de bază a meniului. */
export function floorDefaults(baseLang: string | null | undefined): FloorDefaults {
  return FLOOR_DEFAULTS[baseLang ?? ''] ?? RO_FLOOR_DEFAULTS
}

// ─── Constante canvas ─────────────────────────────────────────
// Sistemul de coordonate absolut pe care sunt salvate elementele. Vizualizatorul
// public scalează responsive raportându-se la aceste dimensiuni.
export const CANVAS_W = 860
export const CANVAS_H = 560

/**
 * Rezolvă un element FloorTable la id-ul mesei reale (public.tables.id).
 * Replică logica din FloorPlanEditor (linia ~483-485): `tableId` explicit are
 * prioritate, altfel fallback la potrivirea de nume case-insensitive
 * (`label` ⟷ `tables.name`). Cheile din `tablesByName` trebuie să fie deja
 * normalizate (trim + lowercase). Întoarce null dacă nu se rezolvă.
 */
export function resolveTableId(ft: FloorTable, tablesByName: Map<string, string>): string | null {
  return ft.tableId ?? tablesByName.get(ft.label.trim().toLowerCase()) ?? null
}
