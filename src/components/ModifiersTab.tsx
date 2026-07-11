import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'

interface ModifierOption {
  id: string
  name: string
  price_delta: number
  is_available: boolean
  display_order: number
}
interface ModifierGroup {
  id: string
  name: string
  selection_type: 'single' | 'multiple'
  is_required: boolean
  min_select: number
  max_select: number | null
  display_order: number
  modifier_options: ModifierOption[]
}

const btn = (e: React.CSSProperties = {}): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 14px',
  height: 38,
  borderRadius: 9,
  fontSize: '0.85rem',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
  whiteSpace: 'nowrap',
  ...e,
})
const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '10px 13px',
  fontSize: '0.9rem',
  color: D.t1,
  outline: 'none',
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}

export default function ModifiersTab({ restaurantId }: { restaurantId: string }) {
  const [groups, setGroups] = useState<ModifierGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [editGroup, setEditGroup] = useState<ModifierGroup | 'add' | null>(null)
  const [gName, setGName] = useState('')
  const [gType, setGType] = useState<'single' | 'multiple'>('single')
  const [gRequired, setGRequired] = useState(false)
  // Plafon de selecții pentru grupurile „multiple" — string în input, gol = nelimitat.
  // Serverul (create_order, mig 145) respinge depășirea; aici owner-ul îl poate seta.
  const [gMaxSelect, setGMaxSelect] = useState('')
  const [saving, setSaving] = useState(false)
  // Draft-ul de „adaugă opțiune" e PER GRUP (map pe groupId): un singur state
  // partajat făcea ca textul tastat într-un grup să apară în toate cardurile.
  const [optDraft, setOptDraft] = useState<Record<string, { name: string; price: string }>>({})
  const draftFor = (groupId: string) => optDraft[groupId] ?? { name: '', price: '0' }
  const setDraftFor = (groupId: string, patch: Partial<{ name: string; price: string }>) =>
    setOptDraft((d) => ({ ...d, [groupId]: { ...draftFor(groupId), ...patch } }))
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: gData } = await supabase
      .from('modifier_groups')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('display_order')
    const gIds = (gData ?? []).map((g: Record<string, unknown>) => g.id as string)
    let opts: Record<string, unknown>[] = []
    if (gIds.length > 0) {
      const { data: oData } = await supabase
        .from('modifier_options')
        .select('*')
        .in('modifier_group_id', gIds)
        .order('display_order')
      opts = oData ?? []
    }
    const result: ModifierGroup[] = (gData ?? []).map((g: Record<string, unknown>) => ({
      id: g.id as string,
      name: g.name as string,
      selection_type: g.selection_type as 'single' | 'multiple',
      is_required: g.is_required as boolean,
      min_select: (g.min_select as number) ?? 0,
      max_select: g.max_select as number | null,
      display_order: (g.display_order as number) ?? 0,
      modifier_options: opts
        .filter((o: Record<string, unknown>) => o.modifier_group_id === g.id)
        .map((o: Record<string, unknown>) => ({
          id: o.id as string,
          name: o.name as string,
          price_delta: o.price_delta as number,
          is_available: o.is_available as boolean,
          display_order: (o.display_order as number) ?? 0,
        })),
    }))
    setGroups(result)
    setLoading(false)
  }, [restaurantId])

  useEffect(() => {
    void load()
  }, [load])

  function openEdit(g: ModifierGroup | 'add') {
    setEditGroup(g)
    if (g === 'add') {
      setGName('')
      setGType('single')
      setGRequired(false)
      setGMaxSelect('')
    } else {
      setGName(g.name)
      setGType(g.selection_type)
      setGRequired(g.is_required)
      setGMaxSelect(g.max_select != null ? String(g.max_select) : '')
    }
    setError(null)
  }

  async function saveGroup() {
    if (!gName.trim()) return
    setSaving(true)
    setError(null)
    // max_select se aplică DOAR la „multiple"; gol/0/negativ = nelimitat (null).
    // La „single" serverul plafonează oricum la 1 → trimitem null.
    const parsedMax = parseInt(gMaxSelect, 10)
    const maxSelect = gType === 'multiple' && parsedMax > 0 ? parsedMax : null
    if (editGroup === 'add') {
      // display_order al noului GRUP = max(display_order al grupurilor) + 1, NU max(nr. opțiuni)
      // (grupul nou ajungea aleatoriu în listă în funcție de câte opțiuni aveau alte grupuri).
      const maxOrder = groups.reduce((m, g) => Math.max(m, g.display_order), -1)
      const { error: e } = await supabase.from('modifier_groups').insert({
        restaurant_id: restaurantId,
        name: gName.trim(),
        selection_type: gType,
        is_required: gRequired,
        min_select: gRequired ? 1 : 0,
        max_select: maxSelect,
        display_order: maxOrder + 1,
      })
      // La eroare păstrăm modalul deschis (input-ul userului rămâne pentru corectare).
      if (e) {
        setError(e.message)
        setSaving(false)
        return
      }
    } else if (editGroup && typeof editGroup !== 'string') {
      const { error: e } = await supabase
        .from('modifier_groups')
        .update({
          name: gName.trim(),
          selection_type: gType,
          is_required: gRequired,
          min_select: gRequired ? 1 : 0,
          max_select: maxSelect,
        })
        .eq('id', editGroup.id)
      if (e) {
        setError(e.message)
        setSaving(false)
        return
      }
    }
    setSaving(false)
    setEditGroup(null)
    await load()
  }

  async function deleteGroup(id: string) {
    setError(null)
    const { error: e } = await supabase.from('modifier_groups').delete().eq('id', id)
    // Nu mai înghițim tăcut un refuz RLS / eroare de rețea: dacă pică, anunțăm
    // și NU re-încărcăm cu impresia că s-a șters (UI rămânea desincronizat).
    if (e) {
      setError(e.message)
      return
    }
    await load()
  }

  async function addOption(groupId: string) {
    const draft = draftFor(groupId)
    if (!draft.name.trim()) return
    setError(null)
    const maxOrder = groups.find((g) => g.id === groupId)?.modifier_options.length ?? 0
    const { error: e } = await supabase.from('modifier_options').insert({
      modifier_group_id: groupId,
      name: draft.name.trim(),
      price_delta: parseFloat(draft.price) || 0,
      display_order: maxOrder,
    })
    if (e) {
      setError(e.message)
      return
    }
    setOptDraft((d) => ({ ...d, [groupId]: { name: '', price: '0' } }))
    await load()
  }

  async function toggleOption(id: string, current: boolean) {
    setError(null)
    const { error: e } = await supabase
      .from('modifier_options')
      .update({ is_available: !current })
      .eq('id', id)
    if (e) {
      setError(e.message)
      return
    }
    await load()
  }

  async function deleteOption(id: string) {
    setError(null)
    const { error: e } = await supabase.from('modifier_options').delete().eq('id', id)
    if (e) {
      setError(e.message)
      return
    }
    await load()
  }

  return (
    <div>
      {/* Banner de eroare la nivel de listă (operațiile delete/toggle/add se fac
          fără modal deschis, deci eroarea lor n-ar fi vizibilă altfel). */}
      {error && !editGroup && (
        <div
          role="alert"
          style={{
            color: D.red,
            fontSize: 13,
            marginBottom: 14,
            padding: '10px 12px',
            background: D.red + '14',
            border: `1px solid ${D.red}55`,
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.5rem',
              color: D.t1,
              letterSpacing: '-0.02em',
            }}
          >
            Opțiuni produse
          </h2>
          <p style={{ color: D.t2, fontSize: '0.78rem', marginTop: 3 }}>
            Grupuri de opțiuni (ex: Extra sos, Mărime)
          </p>
        </div>
        <button
          onClick={() => openEdit('add')}
          style={btn({ background: D.gold, color: '#000', gap: 7 })}
        >
          <Icon name="plus" size={16} />
          Grup nou
        </button>
      </div>

      {loading ? (
        <Skeleton variant="card" count={2} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon="tag"
          title="Niciun grup de opțiuni"
          description="Adaugă primul grup ca să oferi extra-opțiuni la produse (ex: Mărime, Topping-uri)."
          action={
            <button
              onClick={() => openEdit('add')}
              style={btn({ background: D.gold, color: '#000', gap: 7 })}
            >
              <Icon name="plus" size={16} />
              Grup nou
            </button>
          }
        />
      ) : (
        groups.map((g) => (
          <div
            key={g.id}
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              padding: 18,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, color: D.t1 }}>{g.name}</div>
                <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 2 }}>
                  {g.selection_type === 'single'
                    ? 'Selecție unică'
                    : 'Selecție multiplă'}
                  {g.is_required && (
                    <span style={{ color: D.gold, marginLeft: 6 }}>Obligatoriu</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => openEdit(g)}
                  style={btn({
                    background: D.s3,
                    color: D.t2,
                    border: `1px solid ${D.border}`,
                    height: 32,
                    fontSize: '0.78rem',
                    gap: 5,
                  })}
                >
                  <Icon name="edit" size={14} />
                  Editează
                </button>
                <button
                  aria-label="Șterge grup"
                  onClick={() => void deleteGroup(g.id)}
                  style={btn({
                    background: D.redA,
                    color: D.red,
                    height: 32,
                    minWidth: 44,
                    fontSize: '0.78rem',
                  })}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
            {g.modifier_options.map((o) => (
              <div
                key={o.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  background: D.s3,
                  borderRadius: 8,
                  marginBottom: 4,
                  opacity: o.is_available ? 1 : 0.5,
                }}
              >
                <span style={{ flex: 1, fontSize: '0.85rem', color: D.t1 }}>{o.name}</span>
                <span style={{ fontSize: '0.82rem', color: o.price_delta > 0 ? D.gold : D.t3 }}>
                  {o.price_delta > 0 ? '+' + o.price_delta + ' lei' : 'Inclus'}
                </span>
                <button
                  onClick={() => void toggleOption(o.id, o.is_available)}
                  aria-label={o.is_available ? 'Marchează indisponibil' : 'Marchează disponibil'}
                  title={o.is_available ? 'Disponibil' : 'Indisponibil'}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 14,
                    color: o.is_available ? D.green : D.t3,
                  }}
                >
                  {/* Caracterele ●/○ direct — entitatea HTML NU se decodează într-o
                      expresie JSX {} de tip string, ar fi randată literal „&#x25cf;". */}
                  {o.is_available ? '●' : '○'}
                </button>
                <button
                  aria-label="Șterge opțiune"
                  onClick={() => void deleteOption(o.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    color: D.red,
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                value={draftFor(g.id).name}
                onChange={(e) => setDraftFor(g.id, { name: e.target.value })}
                placeholder="Nume opțiune"
                aria-label={'Nume opțiune nouă pentru grupul ' + g.name}
                style={{ ...inp, flex: '1 1 120px', height: 36, fontSize: '0.82rem' }}
              />
              <input
                type="number"
                value={draftFor(g.id).price}
                onChange={(e) => setDraftFor(g.id, { price: e.target.value })}
                placeholder="+lei"
                aria-label={'Preț suplimentar pentru opțiunea nouă din grupul ' + g.name}
                style={{ ...inp, width: 70, height: 36, fontSize: '0.82rem' }}
              />
              <button
                onClick={() => void addOption(g.id)}
                style={btn({
                  background: D.s4,
                  color: D.t1,
                  height: 36,
                  fontSize: '0.78rem',
                  border: `1px solid ${D.border}`,
                  gap: 5,
                })}
              >
                <Icon name="plus" size={14} />
                Adaugă
              </button>
            </div>
          </div>
        ))
      )}

      {editGroup != null && (
        <div
          onClick={() => setEditGroup(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 16,
              width: '100%',
              maxWidth: 400,
              padding: 24,
            }}
          >
            <div
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: '1.05rem',
                color: D.t1,
                marginBottom: 20,
              }}
            >
              {editGroup === 'add' ? 'Grup nou' : 'Editează grup'}
            </div>
            <div style={{ marginBottom: 14 }}>
              <label
                style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}
              >
                Nume *
              </label>
              <input
                value={gName}
                onChange={(e) => setGName(e.target.value)}
                placeholder="Extra topping"
                style={inp}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label
                style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}
              >
                Tip selecție
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['single', 'multiple'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setGType(t)}
                    style={btn({
                      flex: 1,
                      background: gType === t ? D.goldA : D.s3,
                      color: gType === t ? D.gold : D.t2,
                      border: `1px solid ${gType === t ? D.gold : D.border}`,
                      height: 36,
                    })}
                  >
                    {t === 'single' ? 'O singură opțiune' : 'Mai multe opțiuni'}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 5 }}>
                {gType === 'single'
                  ? 'Ex: "Mărime" — client alege Mică SAU Medie SAU Mare'
                  : 'Ex: "Topping-uri" — client poate alege mai multe deodată'}
              </div>
            </div>
            {gType === 'multiple' && (
              <div style={{ marginBottom: 14 }}>
                <label
                  style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}
                >
                  Număr maxim de opțiuni
                </label>
                <input
                  type="number"
                  min={1}
                  value={gMaxSelect}
                  onChange={(e) => setGMaxSelect(e.target.value)}
                  placeholder="Nelimitat"
                  style={inp}
                />
                <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 5 }}>
                  Câte opțiuni poate bifa clientul. Lasă gol pentru nelimitat.
                </div>
              </div>
            )}
            <div style={{ marginBottom: 20 }}>
              <label
                style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}
              >
                Trebuie clientul să aleagă?
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setGRequired(true)}
                  style={btn({
                    flex: 1,
                    background: gRequired ? D.goldA : D.s3,
                    color: gRequired ? D.gold : D.t2,
                    border: `1px solid ${gRequired ? D.gold : D.border}`,
                    height: 36,
                  })}
                >
                  Da, obligatoriu
                </button>
                <button
                  onClick={() => setGRequired(false)}
                  style={btn({
                    flex: 1,
                    background: !gRequired ? D.goldA : D.s3,
                    color: !gRequired ? D.gold : D.t2,
                    border: `1px solid ${!gRequired ? D.gold : D.border}`,
                    height: 36,
                  })}
                >
                  Nu, opțional
                </button>
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 5 }}>
                {gRequired
                  ? 'Clientul nu poate adăuga produsul în coș fără să aleagă ceva'
                  : 'Clientul poate sări peste această secțiune'}
              </div>
            </div>
            {error && <div style={{ color: D.red, fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setEditGroup(null)}
                style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
              >
                Anulează
              </button>
              <button
                onClick={() => void saveGroup()}
                disabled={saving}
                style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.7 : 1 })}
              >
                {saving ? 'Se salvează...' : 'Salvează'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
