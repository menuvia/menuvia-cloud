import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'

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
  // 16px minim ca să NU declanșeze zoom iOS la focus
  fontSize: '16px',
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
  const [saving, setSaving] = useState(false)
  const [optName, setOptName] = useState('')
  const [optPrice, setOptPrice] = useState('0')
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
    } else {
      setGName(g.name)
      setGType(g.selection_type)
      setGRequired(g.is_required)
    }
    setError(null)
  }

  async function saveGroup() {
    if (!gName.trim()) return
    setSaving(true)
    setError(null)
    if (editGroup === 'add') {
      const maxOrder = groups.reduce((m, g) => Math.max(m, g.modifier_options.length), -1)
      const { error: e } = await supabase.from('modifier_groups').insert({
        restaurant_id: restaurantId,
        name: gName.trim(),
        selection_type: gType,
        is_required: gRequired,
        min_select: gRequired ? 1 : 0,
        display_order: maxOrder + 1,
      })
      if (e) setError(e.message)
    } else if (editGroup && typeof editGroup !== 'string') {
      const { error: e } = await supabase
        .from('modifier_groups')
        .update({
          name: gName.trim(),
          selection_type: gType,
          is_required: gRequired,
          min_select: gRequired ? 1 : 0,
        })
        .eq('id', editGroup.id)
      if (e) setError(e.message)
    }
    setSaving(false)
    setEditGroup(null)
    await load()
  }

  async function deleteGroup(id: string) {
    await supabase.from('modifier_groups').delete().eq('id', id)
    await load()
  }

  async function addOption(groupId: string) {
    if (!optName.trim()) return
    const maxOrder = groups.find((g) => g.id === groupId)?.modifier_options.length ?? 0
    await supabase.from('modifier_options').insert({
      modifier_group_id: groupId,
      name: optName.trim(),
      price_delta: parseFloat(optPrice) || 0,
      display_order: maxOrder,
    })
    setOptName('')
    setOptPrice('0')
    await load()
  }

  async function toggleOption(id: string, current: boolean) {
    await supabase.from('modifier_options').update({ is_available: !current }).eq('id', id)
    await load()
  }

  async function deleteOption(id: string) {
    await supabase.from('modifier_options').delete().eq('id', id)
    await load()
  }

  return (
    <div>
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
            Modificatori
          </h2>
          <p style={{ color: D.t3, fontSize: '0.78rem', marginTop: 3 }}>
            Grupuri de op\u021biuni (ex: Extra sos, M\u0103rime)
          </p>
        </div>
        <button onClick={() => openEdit('add')} style={btn({ background: D.gold, color: '#000' })}>
          + Grup nou
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: D.t3 }}>
          Se \u00eencarc\u0103...
        </div>
      ) : groups.length === 0 ? (
        <div
          style={{
            padding: '40px 20px',
            textAlign: 'center',
            background: D.s2,
            border: `1px solid ${D.border}`,
            borderRadius: 14,
            color: D.t3,
          }}
        >
          Niciun grup de modificatori. Adaug\u0103 primul!
        </div>
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
                <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 2 }}>
                  {g.selection_type === 'single'
                    ? 'Selec\u021bie unic\u0103'
                    : 'Selec\u021bie multipl\u0103'}
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
                  })}
                >
                  Edit
                </button>
                <button
                  onClick={() => void deleteGroup(g.id)}
                  style={btn({ background: D.redA, color: D.red, height: 32, fontSize: '0.78rem' })}
                >
                  &#x1f5d1;
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
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 14,
                    color: o.is_available ? D.green : D.t3,
                  }}
                >
                  {o.is_available ? '&#x25cf;' : '&#x25cb;'}
                </button>
                <button
                  onClick={() => void deleteOption(o.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: D.red,
                  }}
                >
                  &#x2715;
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                value={optName}
                onChange={(e) => setOptName(e.target.value)}
                placeholder="Nume op\u021biune"
                style={{ ...inp, flex: '1 1 120px', height: 36, fontSize: '0.82rem' }}
              />
              <input
                type="number"
                value={optPrice}
                onChange={(e) => setOptPrice(e.target.value)}
                placeholder="+lei"
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
                })}
              >
                + Ad\u0103ug\u0103
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
              {editGroup === 'add' ? 'Grup nou' : 'Editeaz\u0103 grup'}
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
                    {t === 'single' ? 'O singur\u0103 op\u021biune' : 'Mai multe op\u021biuni'}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 5 }}>
                {gType === 'single'
                  ? 'Ex: "M\u0103rime" \u2014 client alege Mic\u0103 SAU Medie SAU Mare'
                  : 'Ex: "Topping-uri" \u2014 client poate alege mai multe deodat\u0103'}
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label
                style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}
              >
                Trebuie clientul s\u0103 aleag\u0103?
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
                  Nu, op\u021bional
                </button>
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 5 }}>
                {gRequired
                  ? 'Clientul nu poate ad\u0103uga produsul \u00een co\u0219 f\u0103r\u0103 s\u0103 aleag\u0103 ceva'
                  : 'Clientul poate s\u0103ri peste aceast\u0103 sec\u021biune'}
              </div>
            </div>
            {error && <div style={{ color: D.red, fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setEditGroup(null)}
                style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
              >
                Anuleaz\u0103
              </button>
              <button
                onClick={() => void saveGroup()}
                disabled={saving}
                style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.7 : 1 })}
              >
                {saving ? 'Se salveaz\u0103...' : 'Salveaz\u0103'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
