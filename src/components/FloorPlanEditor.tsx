import { useState, useRef, useCallback, useEffect } from 'react'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { useIsMobile } from '../hooks/useIsMobile'
// Tipurile + constantele canvas trăiesc acum în lib/floorPlan.ts (partajate cu
// vizualizatorul public FloorPlanViewer). Re-exportăm FloorLayout ca importurile
// existente (`import type { FloorLayout } from '../components/FloorPlanEditor'`)
// să continue să compileze.
import type {
  TableShape,
  TableStatus,
  WallType,
  DecoType,
  FloorTable,
  FloorDeco,
  Floor,
  FloorLayout,
} from '../lib/floorPlan'
import { CANVAS_W, CANVAS_H } from '../lib/floorPlan'
// Re-export local (binding-ul importat mai sus) — nu introduce dublă declarație.
export type { FloorLayout }

// ─── Types ────────────────────────────────────────────────────
type ToolType = 'select' | 'addTable' | 'addWall' | 'addZone' | 'addDeco'

// ─── Constants ────────────────────────────────────────────────
const GRID = 20

const TABLE_SHAPES: Record<TableShape, { label: string; icon: string; w: number; h: number }> = {
  round: { label: 'Rotundă', icon: '●', w: 80, h: 80 },
  square: { label: 'Pătrată', icon: '■', w: 80, h: 80 },
  rect: { label: 'Dreptunghi', icon: '▬', w: 120, h: 70 },
  bar: { label: 'Bar', icon: '━', w: 200, h: 50 },
}

const STATUS_META: Record<TableStatus, { bg: string; label: string; glow: string }> = {
  free: { bg: D.green, label: 'Liberă', glow: '0 0 12px rgba(76,175,110,.35)' },
  occupied: { bg: D.amber, label: 'Ocupată', glow: '0 0 12px rgba(232,160,32,.35)' },
  calling: { bg: D.red, label: 'Cheamă', glow: '0 0 14px rgba(224,85,85,.4)' },
  reserved: { bg: '#9B72CF', label: 'Rezervată', glow: '0 0 12px rgba(155,114,207,.35)' },
}

const WALL_META: Record<WallType, { label: string; color: string; h: number }> = {
  wall: { label: 'Perete', color: '#64748b', h: 8 },
  window: { label: 'Fereastră', color: '#7EB8F7', h: 5 },
  door: { label: 'Ușă', color: '#9B72CF', h: 10 },
}

const DECO_META: Record<DecoType, { label: string; emoji: string; size: number }> = {
  plant: { label: 'Plantă', emoji: '🌿', size: 38 },
  bar_counter: { label: 'Tejghea', emoji: '🍸', size: 46 },
  wc: { label: 'WC', emoji: '🚻', size: 42 },
  stairs: { label: 'Scări', emoji: '🪜', size: 42 },
  kitchen_door: { label: 'Bucătărie', emoji: '👨‍🍳', size: 46 },
  entrance: { label: 'Intrare', emoji: '🚪', size: 42 },
}

const uid = () => Math.random().toString(36).slice(2, 9)
const snap = (v: number) => Math.round(v / GRID) * GRID
const emptyFloor = (): Floor => ({
  id: uid(),
  name: 'Parter',
  tables: [],
  walls: [],
  decos: [],
  zones: [],
})

// ─── Shared inline style helpers (same pattern as DashboardPage) ─
const btn = (e: React.CSSProperties = {}): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 14px',
  height: 36,
  borderRadius: 9,
  fontSize: '0.82rem',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  outline: 'none',
  ...e,
})

const navBtn = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 11px',
  border: `1px solid ${active ? D.gold + '44' : D.border}`,
  borderRadius: 8,
  cursor: 'pointer',
  background: active ? D.goldA : 'transparent',
  color: active ? D.goldL : D.t2,
  fontSize: '0.82rem',
  fontFamily: 'DM Sans,sans-serif',
  fontWeight: active ? 500 : 400,
  marginBottom: 3,
  transition: 'all .15s',
  outline: 'none',
  textAlign: 'left' as const,
})

const propLabel: React.CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 500,
  color: D.t3,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  marginBottom: 5,
}

const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 8,
  padding: '7px 10px',
  fontSize: '0.82rem',
  color: D.t1,
  outline: 'none',
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}

const sectionLabel: React.CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 600,
  color: D.t3,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: 7,
}

// ─── Component ────────────────────────────────────────────────
interface FloorPlanEditorProps {
  restaurantId: string
  initialLayout?: FloorLayout | null
}

export default function FloorPlanEditor({ restaurantId, initialLayout }: FloorPlanEditorProps) {
  const [floors, setFloors] = useState<Floor[]>(initialLayout?.floors ?? [emptyFloor()])
  const [fi, setFi] = useState(0)
  const [tool, setTool] = useState<ToolType>('select')
  const [shape, setShape] = useState<TableShape>('round')
  const [wallT, setWallT] = useState<WallType>('wall')
  const [decoT, setDecoT] = useState<DecoType>('plant')
  const [seats, setSeats] = useState(4)
  const [tblNum, setTblNum] = useState(1)
  const [sel, setSel] = useState<{ type: string; id: string } | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [wallDraw, setWallDraw] = useState<{
    x1: number
    y1: number
    x2: number
    y2: number
  } | null>(null)
  const [zoneDraw, setZoneDraw] = useState<{
    x1: number
    y1: number
    x2: number
    y2: number
  } | null>(null)
  const [showGrid, setShowGrid] = useState(true)
  const [live, setLive] = useState(false)
  // Mese reale (pentru linkare în editor) + status live calculat din
  // comenzi & rezervări (cheie = FloorTable.id).
  const [realTables, setRealTables] = useState<{ id: string; name: string }[]>([])
  const [liveStatus, setLiveStatus] = useState<Record<string, TableStatus>>({})
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [hist, setHist] = useState<string[]>([])
  // Ajutorul „Cum funcționează" e pliat implicit pe mobil (deschis pe desktop).
  const [helpOpen, setHelpOpen] = useState(false)

  const canvasRef = useRef<HTMLDivElement>(null)
  const off = useRef({ x: 0, y: 0 })

  const floor = floors[fi] ?? emptyFloor()

  const upd = useCallback(
    (fn: (f: Floor) => Floor) => {
      setFloors((prev) => {
        const next = [...prev]
        next[fi] = fn({ ...next[fi] })
        return next
      })
    },
    [fi],
  )

  const pushHist = useCallback(() => {
    setHist((h) => [...h.slice(-25), JSON.stringify(floors)])
  }, [floors])

  const undo = useCallback(() => {
    if (!hist.length) return
    setFloors(JSON.parse(hist[hist.length - 1]))
    setHist((h) => h.slice(0, -1))
  }, [hist])

  // ─── Canvas helpers ───────────────────────────────────────
  // PointerLike acoperă și MouseEvent și Touch (touches[0]) — handler-ele
  // folosesc doar coordonatele, deci mouse-ul și degetul merg prin același cod.
  type PointerLike = { clientX: number; clientY: number }
  const getPos = (e: PointerLike) => {
    if (!canvasRef.current) return { x: 0, y: 0 }
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onDown = (e: PointerLike) => {
    if (live) return
    const p = getPos(e)

    if (tool === 'addTable') {
      pushHist()
      const sh = TABLE_SHAPES[shape]
      const t: FloorTable = {
        id: uid(),
        x: snap(p.x - sh.w / 2),
        y: snap(p.y - sh.h / 2),
        w: sh.w,
        h: sh.h,
        shape,
        label: String(tblNum),
        seats,
        rotation: 0,
        status: 'free',
      }
      upd((f) => ({ ...f, tables: [...f.tables, t] }))
      setTblNum((n) => n + 1)
      setSel({ type: 'table', id: t.id })
      setTool('select')
      return
    }
    if (tool === 'addWall') {
      setWallDraw({ x1: snap(p.x), y1: snap(p.y), x2: snap(p.x), y2: snap(p.y) })
      return
    }
    if (tool === 'addZone') {
      setZoneDraw({ x1: snap(p.x), y1: snap(p.y), x2: snap(p.x), y2: snap(p.y) })
      return
    }
    if (tool === 'addDeco') {
      pushHist()
      const info = DECO_META[decoT]
      const d: FloorDeco = {
        id: uid(),
        x: snap(p.x - info.size / 2),
        y: snap(p.y - info.size / 2),
        type: decoT,
        size: info.size,
      }
      upd((f) => ({ ...f, decos: [...f.decos, d] }))
      setSel({ type: 'deco', id: d.id })
      setTool('select')
      return
    }

    // Select mode
    for (let i = floor.tables.length - 1; i >= 0; i--) {
      const t = floor.tables[i]
      if (p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h) {
        setSel({ type: 'table', id: t.id })
        setDrag(t.id)
        off.current = { x: p.x - t.x, y: p.y - t.y }
        return
      }
    }
    for (const d of floor.decos) {
      if (p.x >= d.x && p.x <= d.x + d.size && p.y >= d.y && p.y <= d.y + d.size) {
        setSel({ type: 'deco', id: d.id })
        setDrag(d.id)
        off.current = { x: p.x - d.x, y: p.y - d.y }
        return
      }
    }
    setSel(null)
  }

  const onMove = (e: PointerLike) => {
    const p = getPos(e)
    if (drag) {
      const nx = snap(p.x - off.current.x)
      const ny = snap(p.y - off.current.y)
      if (sel?.type === 'table') {
        upd((f) => ({
          ...f,
          tables: f.tables.map((t) => (t.id === drag ? { ...t, x: nx, y: ny } : t)),
        }))
      } else if (sel?.type === 'deco') {
        upd((f) => ({
          ...f,
          decos: f.decos.map((d) => (d.id === drag ? { ...d, x: nx, y: ny } : d)),
        }))
      }
    }
    if (wallDraw) setWallDraw((w) => (w ? { ...w, x2: snap(p.x), y2: snap(p.y) } : null))
    if (zoneDraw) setZoneDraw((z) => (z ? { ...z, x2: snap(p.x), y2: snap(p.y) } : null))
  }

  const onUp = () => {
    if (drag) {
      pushHist()
      setDrag(null)
    }
    if (wallDraw) {
      const w = wallDraw
      const len = Math.sqrt((w.x2 - w.x1) ** 2 + (w.y2 - w.y1) ** 2)
      if (len > 20) {
        pushHist()
        upd((f) => ({ ...f, walls: [...f.walls, { id: uid(), ...w, type: wallT }] }))
      }
      setWallDraw(null)
    }
    if (zoneDraw) {
      const z = zoneDraw
      const w = Math.abs(z.x2 - z.x1),
        h = Math.abs(z.y2 - z.y1)
      if (w > 30 && h > 30) {
        pushHist()
        upd((f) => ({
          ...f,
          zones: [
            ...f.zones,
            {
              id: uid(),
              x: Math.min(z.x1, z.x2),
              y: Math.min(z.y1, z.y2),
              w,
              h,
              label: 'Zonă',
            },
          ],
        }))
      }
      setZoneDraw(null)
      setTool('select')
    }
  }

  const delSel = useCallback(() => {
    if (!sel) return
    pushHist()
    if (sel.type === 'table')
      upd((f) => ({ ...f, tables: f.tables.filter((t) => t.id !== sel.id) }))
    if (sel.type === 'deco') upd((f) => ({ ...f, decos: f.decos.filter((d) => d.id !== sel.id) }))
    if (sel.type === 'wall') upd((f) => ({ ...f, walls: f.walls.filter((w) => w.id !== sel.id) }))
    if (sel.type === 'zone') upd((f) => ({ ...f, zones: f.zones.filter((z) => z.id !== sel.id) }))
    setSel(null)
  }, [sel, pushHist, upd])

  const rotateSel = useCallback(() => {
    if (sel?.type !== 'table') return
    pushHist()
    upd((f) => ({
      ...f,
      tables: f.tables.map((t) =>
        t.id === sel.id ? { ...t, rotation: ((t.rotation || 0) + 45) % 360 } : t,
      ),
    }))
  }, [sel, pushHist, upd])

  const updTbl = (k: keyof FloorTable, v: unknown) =>
    upd((f) => ({ ...f, tables: f.tables.map((t) => (t.id === sel?.id ? { ...t, [k]: v } : t)) }))

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') delSel()
      if (e.key === 'r' && sel) rotateSel()
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [delSel, rotateSel, undo, sel])

  const handleSave = async () => {
    setSaving(true)
    const payload: FloorLayout = { floors, version: 1, savedAt: new Date().toISOString() }
    const { error } = await supabase.rpc('save_floor_layout', {
      p_restaurant_id: restaurantId,
      p_layout: payload,
    })
    setSaving(false)
    if (error) {
      // Nu mai înghițim eroarea în tăcere (audit P2): gate de plan respins, RLS denial sau
      // layout prea mare trebuie să fie vizibile, altfel userul crede că a salvat.
      console.error('[FloorPlanEditor] save failed', error)
      // Nu expunem mesajul brut de la RPC/Postgres în UI (poate divulga tabele/politici);
      // detaliile rămân doar în console.error de mai sus.
      const rawMessage = error.message ?? ''
      const hint = /feature|fiscal|plan/i.test(rawMessage)
        ? 'Harta sălii e disponibilă pe planul Fiscalizare.'
        : /too large|prea mare/i.test(rawMessage)
          ? 'Layout prea mare. Simplifică harta și reîncearcă.'
          : 'A apărut o eroare la salvare. Reîncearcă.'
      window.alert(`Salvarea hărții a eșuat: ${hint}`)
      return
    }
    setSavedOk(true)
    setTimeout(() => setSavedOk(false), 2200)
  }

  const selTable = sel?.type === 'table' ? floor.tables.find((t) => t.id === sel.id) : null

  // Mese reale (public.tables) — pentru dropdown-ul de linkare în editor.
  useEffect(() => {
    if (!restaurantId) return
    let cancelled = false
    void supabase
      .from('tables')
      .select('id, name')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (!cancelled) setRealTables((data ?? []) as { id: string; name: string }[])
      })
    return () => {
      cancelled = true
    }
  }, [restaurantId])

  // Status live: în mod Live, colorează mesele după comenzi active +
  // rezervări de azi. Rezolvă FloorTable → masă reală prin tableId
  // (explicit) sau, fallback, prin potrivire de nume (label == tables.name).
  useEffect(() => {
    if (!live || !restaurantId) {
      setLiveStatus({})
      return
    }
    let cancelled = false
    const nameToId = new Map(realTables.map((rt) => [rt.name.trim().toLowerCase(), rt.id]))
    const resolve = (t: FloorTable): string | null =>
      t.tableId ?? nameToId.get(t.label.trim().toLowerCase()) ?? null

    async function compute(): Promise<void> {
      const sod = new Date()
      sod.setHours(0, 0, 0, 0)
      const eod = new Date(sod)
      eod.setDate(eod.getDate() + 1)
      const [ordersRes, resvRes] = await Promise.all([
        supabase
          .from('orders')
          .select('table_id, status')
          .eq('restaurant_id', restaurantId)
          .not('status', 'in', '(paid,cancelled)')
          .not('table_id', 'is', null),
        supabase
          .from('reservations')
          .select('table_id, status')
          .eq('restaurant_id', restaurantId)
          .in('status', ['confirmed', 'seated'])
          .not('table_id', 'is', null)
          .gte('starts_at', sod.toISOString())
          .lte('starts_at', eod.toISOString()),
      ])
      if (cancelled) return
      const occupied = new Set(
        ((ordersRes.data ?? []) as { table_id: string }[]).map((o) => o.table_id),
      )
      const reserved = new Set(
        ((resvRes.data ?? []) as { table_id: string }[]).map((r) => r.table_id),
      )
      const map: Record<string, TableStatus> = {}
      for (const t of floor.tables) {
        const rid = resolve(t)
        if (rid && occupied.has(rid)) map[t.id] = 'occupied'
        else if (rid && reserved.has(rid)) map[t.id] = 'reserved'
        else map[t.id] = 'free'
      }
      setLiveStatus(map)
    }
    void compute()
    const iv = setInterval(() => void compute(), 15000)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [live, restaurantId, realTables, floor.tables])
  const selDeco = sel?.type === 'deco' ? floor.decos.find((d) => d.id === sel.id) : null

  const totalTables = floor.tables.length
  const totalSeats = floor.tables.reduce((s, t) => s + (t.seats || 0), 0)

  // Sub 900px editorul se stivuiește vertical: bandă de unelte orizontală
  // scrollabilă sus, canvas panabil la mijloc, proprietăți/ajutor jos. Cele
  // trei coloane fixe (200 + 860 + 210px) nu încap pe un telefon.
  const isMobile = useIsMobile(900)
  // Secțiunile de unelte: coloane fixe în banda orizontală pe mobil.
  const toolSection: React.CSSProperties = isMobile
    ? { minWidth: 150, flexShrink: 0 }
    : { marginBottom: 12 }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: isMobile ? 'auto' : '100%',
        minHeight: isMobile ? 0 : 640,
        background: D.bg,
        borderRadius: 14,
        border: `1px solid ${D.border}`,
        overflow: 'hidden',
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          borderBottom: `1px solid ${D.border}`,
          background: D.s1,
          flexShrink: 0,
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.1rem',
              color: D.t1,
              letterSpacing: '-0.02em',
              margin: 0,
            }}
          >
            Arhitectură Restaurant
          </h2>
          <p style={{ color: D.t3, fontSize: '0.72rem', marginTop: 2 }}>
            {totalTables} mese · {totalSeats} locuri
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setLive(!live)}
            style={btn({
              background: live ? D.gold : D.s3,
              color: live ? '#000' : D.t2,
              border: live ? 'none' : `1px solid ${D.border}`,
            })}
          >
            <span style={{ fontSize: 7, color: live ? D.green : D.t3 }}>●</span>
            {live ? 'Live' : 'Edit'}
          </button>
          <button
            onClick={undo}
            style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
            title="Undo (Ctrl+Z)"
          >
            ↩
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.7 : 1 })}
          >
            {savedOk ? '✓ Salvat' : saving ? 'Se salvează...' : 'Salvează'}
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          flex: 1,
          overflow: 'hidden',
        }}
      >
        {/* ── Left Sidebar — pe mobil: bandă orizontală scrollabilă de secțiuni ── */}
        {!live && (
          <div
            style={
              isMobile
                ? {
                    display: 'flex',
                    flexDirection: 'row',
                    gap: 16,
                    width: '100%',
                    background: D.s1,
                    borderBottom: `1px solid ${D.border}`,
                    overflowX: 'auto',
                    flexShrink: 0,
                    padding: '10px 12px',
                    WebkitOverflowScrolling: 'touch',
                  }
                : {
                    width: 200,
                    background: D.s1,
                    borderRight: `1px solid ${D.border}`,
                    overflowY: 'auto',
                    flexShrink: 0,
                    padding: '10px 8px',
                  }
            }
          >
            <div style={toolSection}>
              <div style={sectionLabel}>Instrumente</div>
              <button style={navBtn(tool === 'select')} onClick={() => setTool('select')}>
                ↖ Selectează
              </button>
            </div>

            <div style={toolSection}>
              <div style={sectionLabel}>Mese</div>
              {(
                Object.entries(TABLE_SHAPES) as [TableShape, (typeof TABLE_SHAPES)[TableShape]][]
              ).map(([k, v]) => (
                <button
                  key={k}
                  style={navBtn(tool === 'addTable' && shape === k)}
                  onClick={() => {
                    setTool('addTable')
                    setShape(k)
                  }}
                >
                  <span style={{ fontSize: 13, width: 16, textAlign: 'center' }}>{v.icon}</span>
                  {v.label}
                </button>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 7 }}>
                <span style={{ fontSize: '0.7rem', color: D.t3 }}>Locuri:</span>
                {[2, 4, 6, 8].map((n) => (
                  <button
                    key={n}
                    onClick={() => setSeats(n)}
                    style={btn({
                      height: 26,
                      padding: '0 8px',
                      fontSize: '0.72rem',
                      background: seats === n ? D.goldA : D.s3,
                      color: seats === n ? D.goldL : D.t2,
                      border: `1px solid ${seats === n ? D.gold + '44' : D.border}`,
                    })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div style={toolSection}>
              <div style={sectionLabel}>Structură</div>
              {(Object.entries(WALL_META) as [WallType, (typeof WALL_META)[WallType]][]).map(
                ([k, v]) => (
                  <button
                    key={k}
                    style={navBtn(tool === 'addWall' && wallT === k)}
                    onClick={() => {
                      setTool('addWall')
                      setWallT(k)
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: v.h,
                        borderRadius: 2,
                        background: v.color,
                        flexShrink: 0,
                      }}
                    />
                    {v.label}
                  </button>
                ),
              )}
              <button style={navBtn(tool === 'addZone')} onClick={() => setTool('addZone')}>
                ▢ Zonă
              </button>
            </div>

            <div style={toolSection}>
              <div style={sectionLabel}>Decoruri</div>
              {(Object.entries(DECO_META) as [DecoType, (typeof DECO_META)[DecoType]][]).map(
                ([k, v]) => (
                  <button
                    key={k}
                    style={navBtn(tool === 'addDeco' && decoT === k)}
                    onClick={() => {
                      setTool('addDeco')
                      setDecoT(k)
                    }}
                  >
                    <span style={{ fontSize: 13 }}>{v.emoji}</span> {v.label}
                  </button>
                ),
              )}
            </div>

            <div style={toolSection}>
              <div style={sectionLabel}>Etaje</div>
              {floors.map((f, i) => (
                <button key={f.id} style={navBtn(fi === i)} onClick={() => setFi(i)}>
                  {f.name}
                </button>
              ))}
              <button
                style={btn({
                  background: D.s3,
                  color: D.t2,
                  border: `1px solid ${D.border}`,
                  width: '100%',
                  marginTop: 5,
                })}
                onClick={() => {
                  setFloors((prev) => [...prev, { ...emptyFloor(), name: `Etaj ${prev.length}` }])
                  setFi(floors.length)
                }}
              >
                + Etaj
              </button>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: '0.75rem',
                color: D.t3,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={showGrid}
                onChange={() => setShowGrid(!showGrid)}
                style={{ accentColor: D.gold }}
              />
              Grid
            </label>
          </div>
        )}

        {/* ── Canvas — pe mobil: înălțime fixă, pan liber pe ambele axe ── */}
        <div
          style={{
            flex: isMobile ? undefined : 1,
            height: isMobile ? 'min(60vh, 480px)' : undefined,
            display: 'flex',
            alignItems: isMobile ? 'flex-start' : 'center',
            justifyContent: isMobile ? 'flex-start' : 'center',
            padding: isMobile ? 10 : 16,
            background: D.bg,
            overflow: 'auto',
            WebkitOverflowScrolling: 'touch',
            flexShrink: 0,
          }}
        >
          <div
            ref={canvasRef}
            style={{
              position: 'relative',
              width: CANVAS_W,
              height: CANVAS_H,
              flexShrink: 0,
              borderRadius: 12,
              border: `1px solid ${D.border}`,
              overflow: 'hidden',
              cursor: tool !== 'select' ? 'crosshair' : 'default',
              // touch-action dinamic: în modul 'select' fundalul rămâne
              // panabil (scroll nativ); uneltele de plasare/desen blochează
              // scroll-ul ca touchmove-ul să ajungă la noi. Mesele/decorurile
              // au propriul touch-action: none, deci drag-ul lor merge și în
              // modul 'select'.
              touchAction: tool !== 'select' && !live ? 'none' : undefined,
              background: showGrid
                ? `linear-gradient(${D.t1}04 1px, transparent 1px), linear-gradient(90deg, ${D.t1}04 1px, transparent 1px), ${D.bg}`
                : D.bg,
              backgroundSize: showGrid ? `${GRID}px ${GRID}px` : undefined,
            }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            // Touch: un singur deget = plasare/desenare/drag prin același cod.
            onTouchStart={(e) => {
              if (e.touches.length === 1) onDown(e.touches[0])
            }}
            onTouchMove={(e) => {
              if (e.touches.length === 1) onMove(e.touches[0])
            }}
            onTouchEnd={onUp}
            onTouchCancel={onUp}
          >
            {/* Zones */}
            {floor.zones.map((z) => (
              <div
                key={z.id}
                onClick={() => setSel({ type: 'zone', id: z.id })}
                style={{
                  position: 'absolute',
                  left: z.x,
                  top: z.y,
                  width: z.w,
                  height: z.h,
                  borderRadius: 10,
                  background: D.goldA,
                  border: `1px dashed ${D.gold}33`,
                  display: 'flex',
                  alignItems: 'flex-start',
                  padding: 6,
                }}
              >
                <span
                  style={{
                    fontSize: '0.6rem',
                    fontWeight: 600,
                    color: D.goldL,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {z.label}
                </span>
              </div>
            ))}

            {/* Walls */}
            {floor.walls.map((w) => {
              const wm = WALL_META[w.type || 'wall']
              const angle = Math.atan2(w.y2 - w.y1, w.x2 - w.x1)
              const len = Math.sqrt((w.x2 - w.x1) ** 2 + (w.y2 - w.y1) ** 2)
              return (
                <div
                  key={w.id}
                  onClick={() => setSel({ type: 'wall', id: w.id })}
                  style={{
                    position: 'absolute',
                    left: w.x1,
                    top: w.y1 - wm.h / 2,
                    width: len,
                    height: wm.h,
                    background: wm.color,
                    borderRadius: wm.h / 2,
                    transformOrigin: `0 ${wm.h / 2}px`,
                    transform: `rotate(${angle}rad)`,
                    cursor: 'pointer',
                    opacity: 0.8,
                    boxShadow:
                      sel?.type === 'wall' && sel.id === w.id ? `0 0 8px ${D.gold}` : 'none',
                  }}
                />
              )
            })}

            {/* Wall preview */}
            {wallDraw && (
              <svg
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                }}
              >
                <line
                  x1={wallDraw.x1}
                  y1={wallDraw.y1}
                  x2={wallDraw.x2}
                  y2={wallDraw.y2}
                  stroke={WALL_META[wallT].color}
                  strokeWidth={WALL_META[wallT].h}
                  strokeLinecap="round"
                  opacity={0.5}
                />
              </svg>
            )}

            {/* Zone preview */}
            {zoneDraw && (
              <div
                style={{
                  position: 'absolute',
                  left: Math.min(zoneDraw.x1, zoneDraw.x2),
                  top: Math.min(zoneDraw.y1, zoneDraw.y2),
                  width: Math.abs(zoneDraw.x2 - zoneDraw.x1),
                  height: Math.abs(zoneDraw.y2 - zoneDraw.y1),
                  border: `2px dashed ${D.gold}44`,
                  borderRadius: 10,
                  background: D.goldA,
                  pointerEvents: 'none',
                }}
              />
            )}

            {/* Decos */}
            {floor.decos.map((d) => {
              const info = DECO_META[d.type]
              const isSel = sel?.type === 'deco' && sel.id === d.id
              return (
                <div
                  key={d.id}
                  onMouseDown={(e) => {
                    if (live) return
                    e.stopPropagation()
                    setSel({ type: 'deco', id: d.id })
                    setDrag(d.id)
                    const r = canvasRef.current!.getBoundingClientRect()
                    off.current = { x: e.clientX - r.left - d.x, y: e.clientY - r.top - d.y }
                  }}
                  onTouchStart={(e) => {
                    if (live || e.touches.length !== 1) return
                    e.stopPropagation()
                    const t0 = e.touches[0]
                    setSel({ type: 'deco', id: d.id })
                    setDrag(d.id)
                    const r = canvasRef.current!.getBoundingClientRect()
                    off.current = { x: t0.clientX - r.left - d.x, y: t0.clientY - r.top - d.y }
                  }}
                  style={{
                    position: 'absolute',
                    left: d.x,
                    top: d.y,
                    width: d.size,
                    height: d.size,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: d.size * 0.55,
                    cursor: live ? 'default' : 'grab',
                    // Atingerea pe decor = drag, nu scroll (fundalul rămâne panabil).
                    touchAction: live ? undefined : 'none',
                    borderRadius: '50%',
                    border: isSel ? `2px solid ${D.gold}` : '2px solid transparent',
                    background: isSel ? D.goldA : 'transparent',
                    userSelect: 'none',
                  }}
                >
                  {info?.emoji}
                </div>
              )
            })}

            {/* Tables */}
            {floor.tables.map((t) => {
              const isSel = sel?.type === 'table' && sel.id === t.id
              // În Live, statusul vine din comenzi/rezervări; în Edit, cel salvat.
              const effectiveStatus: TableStatus = live
                ? (liveStatus[t.id] ?? 'free')
                : t.status || 'free'
              const st = STATUS_META[effectiveStatus]
              return (
                <div
                  key={t.id}
                  onMouseDown={(e) => {
                    if (live) return
                    e.stopPropagation()
                    setSel({ type: 'table', id: t.id })
                    setDrag(t.id)
                    const r = canvasRef.current!.getBoundingClientRect()
                    off.current = { x: e.clientX - r.left - t.x, y: e.clientY - r.top - t.y }
                  }}
                  onTouchStart={(e) => {
                    if (live || e.touches.length !== 1) return
                    e.stopPropagation()
                    const t0 = e.touches[0]
                    setSel({ type: 'table', id: t.id })
                    setDrag(t.id)
                    const r = canvasRef.current!.getBoundingClientRect()
                    off.current = { x: t0.clientX - r.left - t.x, y: t0.clientY - r.top - t.y }
                  }}
                  style={{
                    position: 'absolute',
                    left: t.x,
                    top: t.y,
                    width: t.w,
                    height: t.h,
                    borderRadius: t.shape === 'round' ? '50%' : t.shape === 'square' ? 10 : 8,
                    background: live ? st.bg + '18' : isSel ? D.goldA : `${D.t1}06`,
                    border: `2px solid ${live ? st.bg : isSel ? D.gold : D.border}`,
                    boxShadow: live ? st.glow : isSel ? `0 0 14px ${D.goldA}` : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: live ? 'default' : drag === t.id ? 'grabbing' : 'grab',
                    // Atingerea pe masă = drag, nu scroll (fundalul rămâne panabil).
                    touchAction: live ? undefined : 'none',
                    transform: `rotate(${t.rotation || 0}deg)`,
                    transition: drag === t.id ? 'none' : 'box-shadow .2s, border-color .2s',
                    zIndex: isSel ? 10 : 1,
                    userSelect: 'none',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'Fraunces,serif',
                      fontSize: '1rem',
                      fontWeight: 600,
                      color: live ? st.bg : isSel ? D.gold : D.t1,
                      transform: `rotate(-${t.rotation || 0}deg)`,
                    }}
                  >
                    {t.label}
                  </span>
                  <span
                    style={{
                      fontSize: '0.6rem',
                      color: D.t3,
                      fontWeight: 400,
                      transform: `rotate(-${t.rotation || 0}deg)`,
                    }}
                  >
                    {t.seats} loc.
                  </span>
                  {live && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: -8,
                        fontSize: '0.55rem',
                        fontWeight: 700,
                        color: '#fff',
                        background: st.bg,
                        padding: '1px 5px',
                        borderRadius: 4,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        transform: `rotate(-${t.rotation || 0}deg)`,
                      }}
                    >
                      {st.label}
                    </span>
                  )}
                </div>
              )
            })}

            {/* Empty state */}
            {!floor.tables.length && !floor.walls.length && !floor.decos.length && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: D.t3,
                  gap: 8,
                  pointerEvents: 'none',
                }}
              >
                <span style={{ fontSize: 40, opacity: 0.2 }}>🏗️</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                  Selectează un instrument și click pe canvas
                </span>
                <span style={{ fontSize: '0.78rem', opacity: 0.5 }}>
                  Pereți · Mese · Zone · Decoruri
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Right Sidebar (Properties) — pe mobil coboară SUB canvas ── */}
        <div
          style={
            isMobile
              ? {
                  width: '100%',
                  background: D.s1,
                  borderTop: `1px solid ${D.border}`,
                  padding: 14,
                  flexShrink: 0,
                }
              : {
                  width: 210,
                  background: D.s1,
                  borderLeft: `1px solid ${D.border}`,
                  padding: 14,
                  overflowY: 'auto',
                  flexShrink: 0,
                }
          }
        >
          {selTable && (
            <>
              <div
                style={{
                  fontFamily: 'Fraunces,serif',
                  fontSize: '0.9rem',
                  color: D.t1,
                  marginBottom: 14,
                }}
              >
                Masă #{selTable.label}
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={propLabel}>Label</div>
                <input
                  style={inp}
                  value={selTable.label}
                  onChange={(e) => updTbl('label', e.target.value)}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={propLabel}>Locuri</div>
                <input
                  style={inp}
                  type="number"
                  min={1}
                  max={20}
                  value={selTable.seats}
                  onChange={(e) => updTbl('seats', +e.target.value)}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={propLabel}>Formă</div>
                <select
                  style={{ ...inp, cursor: 'pointer' }}
                  value={selTable.shape}
                  onChange={(e) => updTbl('shape', e.target.value as TableShape)}
                >
                  {(
                    Object.entries(TABLE_SHAPES) as [
                      TableShape,
                      (typeof TABLE_SHAPES)[TableShape],
                    ][]
                  ).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={propLabel}>Dimensiuni</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    style={{ ...inp, width: '50%' }}
                    type="number"
                    value={selTable.w}
                    onChange={(e) => updTbl('w', +e.target.value)}
                    placeholder="W"
                  />
                  <input
                    style={{ ...inp, width: '50%' }}
                    type="number"
                    value={selTable.h}
                    onChange={(e) => updTbl('h', +e.target.value)}
                    placeholder="H"
                  />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={propLabel}>Rotație: {selTable.rotation || 0}°</div>
                <input
                  type="range"
                  min={0}
                  max={359}
                  step={15}
                  value={selTable.rotation || 0}
                  onChange={(e) => updTbl('rotation', +e.target.value)}
                  style={{ width: '100%', accentColor: D.gold }}
                />
              </div>
              {/* Legătură cu masa reală (POS) — folosită pentru status Live
                  (comenzi/rezervări) și interconectare. Auto-link după nume
                  dacă nu e setat explicit. */}
              <div style={{ marginBottom: 12 }}>
                <div style={propLabel}>Masă reală (POS)</div>
                <select
                  value={selTable.tableId ?? ''}
                  onChange={(e) => updTbl('tableId', e.target.value || undefined)}
                  style={{
                    width: '100%',
                    height: 32,
                    background: D.s1,
                    color: D.t1,
                    border: `1px solid ${D.border}`,
                    borderRadius: 6,
                    padding: '0 8px',
                    fontSize: '0.78rem',
                  }}
                >
                  <option value="">
                    {realTables.some(
                      (rt) => rt.name.trim().toLowerCase() === selTable.label.trim().toLowerCase(),
                    )
                      ? `Auto (după nume: ${selTable.label})`
                      : '— nelegată —'}
                  </option>
                  {realTables.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: '0.66rem', color: D.t3, marginTop: 4 }}>
                  Leagă masa de POS ca să vezi în Live comenzile și rezervările ei.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button
                  onClick={rotateSel}
                  style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
                >
                  ↻ Rotește
                </button>
                <button
                  onClick={delSel}
                  style={btn({
                    background: D.redA,
                    color: D.red,
                    border: `1px solid rgba(224,85,85,.2)`,
                  })}
                >
                  ✕
                </button>
              </div>
            </>
          )}

          {selDeco && (
            <>
              <div
                style={{
                  fontFamily: 'Fraunces,serif',
                  fontSize: '0.9rem',
                  color: D.t1,
                  marginBottom: 10,
                }}
              >
                Decor
              </div>
              <p style={{ fontSize: '0.82rem', color: D.t2 }}>
                {DECO_META[selDeco.type]?.emoji} {DECO_META[selDeco.type]?.label}
              </p>
              <button
                onClick={delSel}
                style={{
                  ...btn({ background: D.redA, color: D.red, border: 'none' }),
                  marginTop: 10,
                }}
              >
                ✕ Șterge
              </button>
            </>
          )}

          {sel?.type === 'wall' && (
            <>
              <div
                style={{
                  fontFamily: 'Fraunces,serif',
                  fontSize: '0.9rem',
                  color: D.t1,
                  marginBottom: 10,
                }}
              >
                Perete
              </div>
              <button
                onClick={delSel}
                style={btn({ background: D.redA, color: D.red, border: 'none', marginTop: 6 })}
              >
                ✕ Șterge
              </button>
            </>
          )}

          {sel?.type === 'zone' && (
            <>
              <div
                style={{
                  fontFamily: 'Fraunces,serif',
                  fontSize: '0.9rem',
                  color: D.t1,
                  marginBottom: 10,
                }}
              >
                Zonă
              </div>
              <button
                onClick={delSel}
                style={btn({ background: D.redA, color: D.red, border: 'none', marginTop: 6 })}
              >
                ✕ Șterge
              </button>
            </>
          )}

          {!sel && (
            // Pe mobil ajutorul e pliat (ocupă un rând, nu tot ecranul);
            // pe desktop rămâne mereu vizibil, ca înainte.
            <div style={{ color: D.t3, fontSize: '0.75rem', lineHeight: 1.9 }}>
              <button
                type="button"
                onClick={() => setHelpOpen((v) => !v)}
                disabled={!isMobile}
                aria-expanded={!isMobile || helpOpen}
                style={{
                  ...sectionLabel,
                  color: D.gold,
                  marginBottom: 10,
                  cursor: isMobile ? 'pointer' : 'default',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  fontFamily: 'DM Sans,sans-serif',
                  minHeight: isMobile ? 32 : undefined,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                Cum funcționează
                {isMobile && <span aria-hidden="true">{helpOpen ? '▾' : '▸'}</span>}
              </button>
              {(!isMobile || helpOpen) && (
                <>
              <p>
                <span style={{ color: D.t1, fontWeight: 500 }}>Click</span> — plasează element
              </p>
              <p>
                <span style={{ color: D.t1, fontWeight: 500 }}>Drag</span> — mută masa
              </p>
              <p>
                <span style={{ color: D.gold, fontFamily: 'monospace', fontSize: '0.7rem' }}>
                  R
                </span>{' '}
                — rotește
              </p>
              <p>
                <span style={{ color: D.gold, fontFamily: 'monospace', fontSize: '0.7rem' }}>
                  Del
                </span>{' '}
                — șterge
              </p>
              <p>
                <span style={{ color: D.gold, fontFamily: 'monospace', fontSize: '0.7rem' }}>
                  Ctrl+Z
                </span>{' '}
                — undo
              </p>
              <div style={{ borderTop: `1px solid ${D.border}`, marginTop: 10, paddingTop: 10 }}>
                <p>Pereți: click & drag</p>
                <p style={{ marginTop: 4 }}>
                  Mod <span style={{ color: D.gold }}>Live</span> arată status mese în timp real
                </p>
              </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer stats ── */}
      <div
        style={{
          display: 'flex',
          gap: 20,
          padding: '8px 18px',
          borderTop: `1px solid ${D.border}`,
          background: D.s1,
          fontSize: '0.75rem',
          color: D.t3,
          flexShrink: 0,
        }}
      >
        {[
          ['Mese', totalTables],
          ['Locuri', totalSeats],
          ['Pereți', floor.walls.length],
        ].map(([label, val]) => (
          <span key={label as string}>
            {label}:{' '}
            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: D.t1 }}>{val}</span>
          </span>
        ))}
        {live && (
          <>
            <span style={{ color: D.green }}>
              ● {floor.tables.filter((t) => (liveStatus[t.id] ?? 'free') === 'free').length} libere
            </span>
            <span style={{ color: D.amber }}>
              ● {floor.tables.filter((t) => liveStatus[t.id] === 'occupied').length} ocupate
            </span>
            <span style={{ color: '#9B72CF' }}>
              ● {floor.tables.filter((t) => liveStatus[t.id] === 'reserved').length} rezervate
            </span>
          </>
        )}
      </div>
    </div>
  )
}
