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
