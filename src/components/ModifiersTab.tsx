import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'
import { confirm as confirmDialog } from './ui/confirm'
import { Modal } from './_dashboard/sharedUI'
import { toUserMessage, zeroRowsAsDenied } from '../lib/userMessages'
import { Button } from './ui/Button'
import { modifierGroupMin } from '../lib/qr'
import { fetchModifierGroupLinks, setModifierGroupProducts } from '../lib/modifierLinks'

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
  // Eroare de ÎNCĂRCARE ≠ „niciun grup": fără ea, un refuz RLS/blip de rețea
  // (supabase-js nu aruncă) randa fals empty state-ul peste date existente.
  const [loadError, setLoadError] = useState(false)
  // Produsele restaurantului și legăturile lor cu grupurile (lotul O1b): pe
  // fiecare grup se vede câte produse îl folosesc, iar „Alege produsele” îl
  // aplică pe cele bifate. Fără legătură, grupul nu ajunge la niciun produs.
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])
  const [groupProducts, setGroupProducts] = useState<Record<string, string[]>>({})
  const [pickFor, setPickFor] = useState<ModifierGroup | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pickQuery, setPickQuery] = useState('')
  const [pickSaving, setPickSaving] = useState(false)
  // Anti dublu-click pe „Adaugă” (MENU-11): pe o conexiune lentă al doilea
  // click crea aceeași opțiune de două ori.
  const [addingFor, setAddingFor] = useState<Set<string>>(new Set())

  // `quiet`: reîncărcarea de după o acțiune păstrează lista pe ecran (înainte
  // fiecare bifă golea totul într-un schelet și pagina sărea sus).
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setLoadError(false)
    const { data: gData, error: gErr } = await supabase
      .from('modifier_groups')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('display_order')
    const gIds = (gData ?? []).map((g: Record<string, unknown>) => g.id as string)
    let opts: Record<string, unknown>[] = []
    let oErr: unknown = null
    if (gIds.length > 0) {
      const { data: oData, error: e2 } = await supabase
        .from('modifier_options')
        .select('*')
        .in('modifier_group_id', gIds)
        .order('display_order')
      opts = oData ?? []
      oErr = e2
    }
    const { data: pData, error: pErr } = await supabase
      .from('products')
      .select('id,name')
      .eq('restaurant_id', restaurantId)
      .order('name')
    let links: { product_id: string; modifier_group_id: string }[] = []
    let lErr: unknown = null
    try {
      links = await fetchModifierGroupLinks(((pData ?? []) as { id: string }[]).map((p) => p.id))
    } catch (e) {
      lErr = e
    }
    if (gErr || oErr || pErr || lErr) {
      setLoadError(true)
      setLoading(false)
      return
    }
    setProducts((pData ?? []) as { id: string; name: string }[])
    const byGroup: Record<string, string[]> = {}
    for (const l of links) (byGroup[l.modifier_group_id] ??= []).push(l.product_id)
    setGroupProducts(byGroup)
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
    // Fără return tăcut: click pe „Salvează" cu numele gol arăta un buton „stricat".
    if (!gName.trim()) {
      setError('Numele e obligatoriu')
      return
    }
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
        setError(toUserMessage(e))
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
        setError(toUserMessage(e))
        setSaving(false)
        return
      }
    }
    setSaving(false)
    setEditGroup(null)
    await load(true)
  }

  async function deleteGroup(id: string) {
    const g = groups.find((x) => x.id === id)
    const nOpts = g?.modifier_options.length ?? 0
    // Ștergere ireversibilă (FK on delete cascade pe opțiuni) — fără confirmare,
    // o atingere greșită pierdea tot grupul; inconsistent cu CategoriesTab.
    const ok = await confirmDialog({
      title: `Ștergi grupul „${g?.name ?? ''}"?`,
      description:
        nOpts > 0
          ? `Se șterg definitiv și cele ${nOpts} opțiuni ale lui.`
          : 'Acțiunea nu poate fi anulată.',
      confirmLabel: 'Șterge',
      destructive: true,
    })
    if (!ok) return
    setError(null)
    // `.select('id')`: un DELETE refuzat de RLS dă 0 rânduri FĂRĂ eroare.
    const e = zeroRowsAsDenied(
      await supabase.from('modifier_groups').delete().eq('id', id).select('id'),
    )
    // Nu mai înghițim tăcut un refuz RLS / eroare de rețea: dacă pică, anunțăm
    // și NU re-încărcăm cu impresia că s-a șters (UI rămânea desincronizat).
    if (e) {
      setError(toUserMessage(e))
      return
    }
    await load(true)
  }

  async function addOption(groupId: string) {
    const draft = draftFor(groupId)
    if (!draft.name.trim() || addingFor.has(groupId)) return
    setError(null)
    setAddingFor((s) => new Set(s).add(groupId))
    // Următoarea poziție = max + 1 (cu numărul de opțiuni, după o ștergere două
    // opțiuni ajungeau pe aceeași poziție și ordinea devenea aleatorie).
    const opts = groups.find((g) => g.id === groupId)?.modifier_options ?? []
    const nextOrder = opts.reduce((m, o) => Math.max(m, o.display_order), -1) + 1
    const { error: e } = await supabase.from('modifier_options').insert({
      modifier_group_id: groupId,
      name: draft.name.trim(),
      price_delta: parseFloat(draft.price) || 0,
      display_order: nextOrder,
    })
    setAddingFor((s) => {
      const n = new Set(s)
      n.delete(groupId)
      return n
    })
    if (e) {
      setError(toUserMessage(e))
      return
    }
    setOptDraft((d) => ({ ...d, [groupId]: { name: '', price: '0' } }))
    await load(true)
  }

  async function toggleOption(id: string, current: boolean) {
    setError(null)
    // Ultima opțiune disponibilă a unui grup OBLIGATORIU: fără ea, produsele
    // care îl folosesc nu se mai pot comanda deloc (MENU-11).
    const g = groups.find((x) => x.modifier_options.some((o) => o.id === id))
    const othersAvailable = g?.modifier_options.filter((o) => o.id !== id && o.is_available).length ?? 0
    const users = g ? (groupProducts[g.id] ?? []).length : 0
    if (current && g && g.is_required && othersAvailable === 0 && users > 0) {
      const ok = await confirmDialog({
        title: `Nicio opțiune disponibilă în „${g.name}”?`,
        description: `Grupul e obligatoriu: cele ${users} ${users === 1 ? 'produs care îl folosește nu se va' : 'produse care îl folosesc nu se vor'} mai putea comanda până marchezi din nou o opțiune disponibilă.`,
        confirmLabel: 'Marchează indisponibil',
        destructive: true,
      })
      if (!ok) return
    }
    const { error: e } = await supabase
      .from('modifier_options')
      .update({ is_available: !current })
      .eq('id', id)
    if (e) {
      setError(toUserMessage(e))
      return
    }
    await load(true)
  }

  async function deleteOption(id: string) {
    setError(null)
    const e = zeroRowsAsDenied(
      await supabase.from('modifier_options').delete().eq('id', id).select('id'),
    )
    if (e) {
      setError(toUserMessage(e))
      return
    }
    await load(true)
  }

  function openPicker(g: ModifierGroup) {
    setPickFor(g)
    setPicked(new Set(groupProducts[g.id] ?? []))
    setPickQuery('')
    setError(null)
  }

  async function savePicker() {
    if (!pickFor || pickSaving) return
    setPickSaving(true)
    setError(null)
    try {
      // Ordinea listei de produse (alfabetică) — ordinea nu contează aici:
      // poziția grupului în fișa fiecărui produs o păstrează serverul.
      await setModifierGroupProducts(
        pickFor.id,
        products.filter((p) => picked.has(p.id)).map((p) => p.id),
      )
      setPickFor(null)
      await load(true)
    } catch (e) {
      setError(toUserMessage(e, 'Nu am putut salva produsele grupului.'))
    } finally {
      setPickSaving(false)
    }
  }

  const pickVisible = products.filter((p) =>
    p.name.toLowerCase().includes(pickQuery.trim().toLowerCase()),
  )

  return (
    <div>
      {/* Banner de eroare la nivel de listă (operațiile delete/toggle/add se fac
          fără modal deschis, deci eroarea lor n-ar fi vizibilă altfel). */}
      {error && !editGroup && !pickFor && (
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
      ) : loadError ? (
        <div
          style={{
            padding: 20,
            border: `1px solid ${D.border}`,
            borderRadius: 12,
            background: D.s2,
            color: D.t2,
            textAlign: 'center',
          }}
        >
          <div style={{ marginBottom: 12 }}>Nu am putut încărca grupurile de opțiuni.</div>
          <button onClick={() => void load()} style={btn({ background: D.gold, color: '#000' })}>
            Reîncearcă
          </button>
        </div>
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
                  {/* Plafonul de selecții e vizibil pe card — altfel patronul trebuia
                      să redeschidă editorul ca să verifice ce aplică serverul la comenzi. */}
                  {g.max_select != null &&
                    ` · max ${g.max_select} ${g.max_select === 1 ? 'opțiune' : 'opțiuni'}`}
                  {g.is_required && (
                    <span style={{ color: D.gold, marginLeft: 6 }}>Obligatoriu</span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: '0.72rem',
                    color: (groupProducts[g.id] ?? []).length > 0 ? D.t2 : D.amber,
                    marginTop: 2,
                  }}
                >
                  {(groupProducts[g.id] ?? []).length === 0
                    ? 'Nu e folosit de niciun produs — clienții nu îl văd'
                    : (groupProducts[g.id] ?? []).length === 1
                      ? 'Folosit de 1 produs'
                      : `Folosit de ${(groupProducts[g.id] ?? []).length} produse`}
                </div>
                {modifierGroupMin(g) > g.modifier_options.filter((o) => o.is_available).length && (
                  <div role="note" style={{ fontSize: '0.72rem', color: D.red, marginTop: 2 }}>
                    ⚠ Prea puține opțiuni disponibile: produsele cu acest grup nu se pot comanda.
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Button variant="secondary" size="sm" onClick={() => openPicker(g)}>
                  Alege produsele
                </Button>
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
                {/* Negativul e o REDUCERE și trebuie văzut ca atare — afișat ca „Inclus"
                    ascundea o greșeală de introducere. Virgulă zecimală (ro-RO), nu punct. */}
                <span
                  style={{
                    fontSize: '0.82rem',
                    color: o.price_delta > 0 ? D.gold : o.price_delta < 0 ? D.green : D.t3,
                  }}
                >
                  {o.price_delta > 0
                    ? '+' + o.price_delta.toLocaleString('ro-RO') + ' lei'
                    : o.price_delta < 0
                      ? '−' + Math.abs(o.price_delta).toLocaleString('ro-RO') + ' lei'
                      : 'Inclus'}
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
                    minWidth: 44,
                    minHeight: 44,
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
                    justifyContent: 'center',
                    color: D.red,
                    minWidth: 44,
                    minHeight: 44,
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
                disabled={addingFor.has(g.id)}
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

      {pickFor != null && (
        <Modal title={`Produsele cu „${pickFor.name}”`} onClose={() => setPickFor(null)} width={440}>
          <div>
            <div style={{ fontSize: '0.78rem', color: D.t2, marginBottom: 10, lineHeight: 1.5 }}>
              Bifează produsele la care clientul și ospătarul aleg din acest grup.
            </div>
            <input
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
              placeholder="Caută produs"
              aria-label="Caută produs"
              style={{ ...inp, marginBottom: 10 }}
            />
            <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 14 }}>
              {pickVisible.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: D.t3, padding: '8px 0' }}>
                  {products.length === 0 ? 'Nu ai încă produse.' : 'Niciun produs găsit.'}
                </div>
              ) : (
                pickVisible.map((p) => (
                  <label
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      minHeight: 40,
                      fontSize: '0.85rem',
                      color: D.t1,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(p.id)}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev)
                          if (next.has(p.id)) next.delete(p.id)
                          else next.add(p.id)
                          return next
                        })
                      }
                      style={{ width: 18, height: 18, accentColor: D.gold }}
                    />
                    {p.name}
                  </label>
                ))
              )}
            </div>
            {error && (
              <div role="alert" style={{ color: D.red, fontSize: 13, marginBottom: 14 }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: D.t3, marginRight: 'auto' }}>
                {picked.size === 1 ? '1 produs ales' : `${picked.size} produse alese`}
              </span>
              <Button variant="secondary" onClick={() => setPickFor(null)}>
                Anulează
              </Button>
              <Button onClick={() => void savePicker()} loading={pickSaving}>
                Salvează
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {editGroup != null && (
        /* Modal partajat (sharedUI): portal la <body> + scroll-lock + maxHeight 90vh —
           overlay-ul construit manual lăsa pagina să deruleze sub modal pe mobil. */
        <Modal
          title={editGroup === 'add' ? 'Grup nou' : 'Editează grup'}
          onClose={() => setEditGroup(null)}
          width={400}
        >
          <div>
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
        </Modal>
      )}
    </div>
  )
}
