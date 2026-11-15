import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'
import { confirm as confirmDialog } from './ui/confirm'
import { Modal } from './_dashboard/sharedUI'
import { zeroRowsAsDenied } from '../lib/userMessages'
import { Button } from './ui/Button'
import { modifierGroupMin } from '../lib/qr'
import { MENU_LANGS, activeTranslationLangs, mergeTranslations, type Translations } from '../lib/i18nMenu'
import { fetchLinkableProducts, fetchModifierGroupLinks, setModifierGroupProducts } from '../lib/modifierLinks'
import { describeModifierError } from '../lib/modifierMessages'
import { menuLangName } from '../lib/translationMessages'
import { useT } from '../i18n/useT'
import { modifiersNs } from '../i18n/ns/modifiers'
import { commonNs } from '../i18n/ns/common'
import { translationsNs } from '../i18n/ns/translations'

interface ModifierOption {
  id: string
  name: string
  price_delta: number
  is_available: boolean
  display_order: number
  translations?: Translations | null
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
  translations?: Translations | null
}

// Eroarea ecranului ținută ca DATĂ (lotul L5b): validarea e o cheie, refuzul
// serverului e eroarea brută + cheia rezervei; textul se compune la RANDARE,
// în limba curentă — o schimbare de limbă cu eroarea pe ecran o retraduce.
type ModifiersError =
  | { kind: 'nameRequired' }
  | { kind: 'server'; err: unknown; fallback?: 'err_pickSave' | 'err_optionTr'; name?: string }

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

export default function ModifiersTab({
  restaurantId,
  menuLanguages = [],
  baseLang = 'ro',
}: {
  restaurantId: string
  // Lotul O6b: limbile active ale meniului și limba originalului — grupurile
  // și opțiunile se traduc în aceleași limbi ca produsele.
  menuLanguages?: readonly string[]
  baseLang?: string
}) {
  // Sus, înaintea oricărui return: dialogurile (grup, „Alege produsele”) și
  // confirmările folosesc aceleași namespace-uri — inclusiv `translations`,
  // pentru numele limbilor meniului —, deci nu suspendă fila (L4b/L4c).
  const mt = useT(modifiersNs)
  const { t, tp } = mt
  const tc = useT(commonNs)
  const trTr = useT(translationsNs)
  const trLangs = activeTranslationLangs(menuLanguages, baseLang)
  // Traducerile din dialogul de grup: numele grupului și ale opțiunilor lui.
  const [gTr, setGTr] = useState<Record<string, string>>({})
  const [oTr, setOTr] = useState<Record<string, Record<string, string>>>({})
  const [trDirty, setTrDirty] = useState(false)
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
  const [error, setError] = useState<ModifiersError | null>(null)
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
    // Produsele și legăturile pe pagini, legăturile citite pe GRUPURI: o
    // citire trunchiată aici ar fi pornit „Alege produsele” cu bife lipsă, iar
    // salvarea ar fi dezlegat tăcut produsele nebifate (recenzia O1b).
    let pData: { id: string; name: string }[] = []
    let links: { product_id: string; modifier_group_id: string }[] = []
    let lErr: unknown = null
    try {
      ;[pData, links] = await Promise.all([fetchLinkableProducts(restaurantId), fetchModifierGroupLinks(gIds)])
    } catch (e) {
      lErr = e
    }
    if (gErr || oErr || lErr) {
      setLoadError(true)
      setLoading(false)
      return
    }
    setProducts(pData)
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
      translations: (g.translations as Translations | null | undefined) ?? null,
      modifier_options: opts
        .filter((o: Record<string, unknown>) => o.modifier_group_id === g.id)
        .map((o: Record<string, unknown>) => ({
          id: o.id as string,
          name: o.name as string,
          price_delta: o.price_delta as number,
          is_available: o.is_available as boolean,
          display_order: (o.display_order as number) ?? 0,
          translations: (o.translations as Translations | null | undefined) ?? null,
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
    const nameIn = (tr: Translations | null | undefined) =>
      Object.fromEntries(trLangs.map((l) => [l, tr?.[l]?.name ?? '']))
    setGTr(g === 'add' ? {} : nameIn(g.translations))
    setOTr(
      g === 'add'
        ? {}
        : Object.fromEntries(g.modifier_options.map((o) => [o.id, nameIn(o.translations)])),
    )
    setTrDirty(false)
    setError(null)
  }

  async function saveGroup() {
    // Fără return tăcut: click pe „Salvează" cu numele gol arăta un buton „stricat".
    if (!gName.trim()) {
      setError({ kind: 'nameRequired' })
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
        setError({ kind: 'server', err: e })
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
          // Traducerile pleacă DOAR dacă au fost atinse: pe o bază fără mig
          // 321 coloana lipsește și ar strica orice salvare a grupului.
          ...(trDirty ? { translations: mergeTranslations(editGroup.translations, gTr, trLangs, baseLang) } : {}),
        })
        .eq('id', editGroup.id)
      if (e) {
        setError({ kind: 'server', err: e })
        setSaving(false)
        return
      }
      if (trDirty) {
        for (const o of editGroup.modifier_options) {
          const { error: oe } = await supabase
            .from('modifier_options')
            .update({ translations: mergeTranslations(o.translations, oTr[o.id] ?? {}, trLangs, baseLang) })
            .eq('id', o.id)
          if (oe) {
            setError({ kind: 'server', err: oe, fallback: 'err_optionTr', name: o.name })
            setSaving(false)
            return
          }
        }
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
    // `cancelLabel` EXPLICIT: implicitul urmează <html lang> (pe rutele de
    // personal `ro`), nu limba personalului (precedentul L5a2).
    const ok = await confirmDialog({
      title: t('del_title', { name: g?.name ?? '' }),
      description: nOpts === 0 ? t('del_descNone') : tp('del_descOptions', nOpts),
      confirmLabel: tc.t('delete'),
      cancelLabel: tc.t('cancel'),
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
      setError({ kind: 'server', err: e })
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
      setError({ kind: 'server', err: e })
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
        title: t('lastOff_title', { group: g.name }),
        description: tp('lastOff_desc', users),
        confirmLabel: t('opt_markUnavailable'),
        cancelLabel: tc.t('cancel'),
        destructive: true,
      })
      if (!ok) return
    }
    const { error: e } = await supabase
      .from('modifier_options')
      .update({ is_available: !current })
      .eq('id', id)
    if (e) {
      setError({ kind: 'server', err: e })
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
      setError({ kind: 'server', err: e })
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
      setError({ kind: 'server', err: e, fallback: 'err_pickSave' })
    } finally {
      setPickSaving(false)
    }
  }

  const errorText =
    error == null
      ? null
      : error.kind === 'nameRequired'
        ? t('err_nameRequired')
        : describeModifierError(
            error.err,
            mt,
            tc,
            error.fallback ? t(error.fallback, { name: error.name ?? '' }) : undefined,
          )

  const pickVisible = products.filter((p) =>
    p.name.toLowerCase().includes(pickQuery.trim().toLowerCase()),
  )

  return (
    <div>
      {/* Banner de eroare la nivel de listă (operațiile delete/toggle/add se fac
          fără modal deschis, deci eroarea lor n-ar fi vizibilă altfel). */}
      {errorText == null || editGroup != null || pickFor != null ? null : (
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
          {errorText}
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
            {t('intro')}
          </p>
        </div>
        <button
          onClick={() => openEdit('add')}
          style={btn({ background: D.gold, color: '#000', gap: 7 })}
        >
          <Icon name="plus" size={16} />
          {t('newGroup')}
        </button>
      </div>

      {loading ? (
        <Skeleton count={2} variant="card" />
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
          <div style={{ marginBottom: 12 }}>{t('loadError')}</div>
          <button onClick={() => void load()} style={btn({ background: D.gold, color: '#000' })}>
            {tc.t('retry')}
          </button>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon="tag"
          title={t('empty_title')}
          description={t('empty_desc')}
          action={
            <button
              onClick={() => openEdit('add')}
              style={btn({ background: D.gold, color: '#000', gap: 7 })}
            >
              <Icon name="plus" size={16} />
              {t('newGroup')}
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
                  {g.selection_type === 'single' ? t('card_single') : t('card_multiple')}
                  {/* Plafonul de selecții e vizibil pe card — altfel patronul trebuia
                      să redeschidă editorul ca să verifice ce aplică serverul la comenzi. */}
                  {g.max_select == null ? null : ` · ${tp('card_max', g.max_select)}`}
                  {g.is_required ? (
                    <span style={{ color: D.gold, marginLeft: 6 }}>{t('card_required')}</span>
                  ) : null}
                </div>
                <div
                  style={{
                    fontSize: '0.72rem',
                    color: (groupProducts[g.id] ?? []).length === 0 ? D.amber : D.t2,
                    marginTop: 2,
                  }}
                >
                  {(groupProducts[g.id] ?? []).length === 0
                    ? t('card_unused')
                    : tp('card_usedBy', (groupProducts[g.id] ?? []).length)}
                </div>
                {g.modifier_options.filter((o) => o.is_available).length < modifierGroupMin(g) ? (
                  <div role="note" style={{ fontSize: '0.72rem', color: D.red, marginTop: 2 }}>
                    {t('card_tooFew')}
                  </div>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Button variant="secondary" size="sm" onClick={() => openPicker(g)}>
                  {t('card_pick')}
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
                  {tc.t('edit')}
                </button>
                <button
                  aria-label={t('card_deleteAria')}
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
                    // `0 < x` = `x > 0` scris invers (fals-pozitivul SK5 pe
                    // `a > 0 ? … : a < 0 ? …`); orice altă valoare → „Inclus”, ca înainte.
                    color: 0 < o.price_delta ? D.gold : o.price_delta < 0 ? D.green : D.t3,
                  }}
                >
                  {0 < o.price_delta
                    ? t('price_plus', { amount: o.price_delta.toLocaleString('ro-RO') })
                    : o.price_delta < 0
                      ? t('price_minus', { amount: Math.abs(o.price_delta).toLocaleString('ro-RO') })
                      : t('price_included')}
                </span>
                <button
                  onClick={() => void toggleOption(o.id, o.is_available)}
                  aria-label={o.is_available ? t('opt_markUnavailable') : t('opt_markAvailable')}
                  title={o.is_available ? t('opt_available') : t('opt_unavailable')}
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
                  aria-label={t('opt_deleteAria')}
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
                placeholder={t('opt_namePh')}
                aria-label={t('opt_nameAria', { group: g.name })}
                style={{ ...inp, flex: '1 1 120px', height: 36, fontSize: '0.82rem' }}
              />
              <input
                type="number"
                value={draftFor(g.id).price}
                onChange={(e) => setDraftFor(g.id, { price: e.target.value })}
                placeholder={t('opt_pricePh')}
                aria-label={t('opt_priceAria', { group: g.name })}
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
                {t('opt_add')}
              </button>
            </div>
          </div>
        ))
      )}

      {pickFor != null && (
        <Modal title={t('pick_title', { group: pickFor.name })} onClose={() => setPickFor(null)} width={440}>
          <div>
            <div style={{ fontSize: '0.78rem', color: D.t2, marginBottom: 10, lineHeight: 1.5 }}>
              {t('pick_desc')}
            </div>
            <input
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
              placeholder={t('pick_search')}
              aria-label={t('pick_search')}
              style={{ ...inp, marginBottom: 10 }}
            />
            <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 14 }}>
              {pickVisible.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: D.t3, padding: '8px 0' }}>
                  {products.length === 0 ? t('pick_noProducts') : t('pick_noMatch')}
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
            {errorText == null ? null : (
              <div role="alert" style={{ color: D.red, fontSize: 13, marginBottom: 14 }}>
                {errorText}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: D.t3, marginRight: 'auto' }}>
                {tp('pick_count', picked.size)}
              </span>
              <Button variant="secondary" onClick={() => setPickFor(null)}>
                {tc.t('cancel')}
              </Button>
              <Button onClick={() => void savePicker()} loading={pickSaving}>
                {tc.t('save')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {editGroup != null && (
        /* Modal partajat (sharedUI): portal la <body> + scroll-lock + maxHeight 90vh —
           overlay-ul construit manual lăsa pagina să deruleze sub modal pe mobil. */
        <Modal
          title={editGroup === 'add' ? t('newGroup') : t('edit_title')}
          onClose={() => setEditGroup(null)}
          width={400}
        >
          <div>
            <div style={{ marginBottom: 14 }}>
              <label
                style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}
              >
                {t('field_name')}
              </label>
              <input
                value={gName}
                onChange={(e) => setGName(e.target.value)}
                placeholder={t('field_namePh')}
                style={inp}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label
                style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}
              >
                {t('field_type')}
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['single', 'multiple'] as const).map((kind) => (
                  <button
                    key={kind}
                    onClick={() => setGType(kind)}
                    style={btn({
                      flex: 1,
                      background: gType === kind ? D.goldA : D.s3,
                      color: gType === kind ? D.gold : D.t2,
                      border: `1px solid ${gType === kind ? D.gold : D.border}`,
                      height: 36,
                    })}
                  >
                    {kind === 'single' ? t('type_single') : t('type_multiple')}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 5 }}>
                {gType === 'single' ? t('type_singleHint') : t('type_multipleHint')}
              </div>
            </div>
            {gType === 'multiple' && (
              <div style={{ marginBottom: 14 }}>
                <label
                  style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}
                >
                  {t('field_max')}
                </label>
                <input
                  type="number"
                  min={1}
                  value={gMaxSelect}
                  onChange={(e) => setGMaxSelect(e.target.value)}
                  placeholder={t('field_maxPh')}
                  style={inp}
                />
                <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 5 }}>
                  {t('field_maxHint')}
                </div>
              </div>
            )}
            <div style={{ marginBottom: 20 }}>
              <label
                style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}
              >
                {t('field_required')}
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
                  {t('req_yes')}
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
                  {t('req_no')}
                </button>
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 5 }}>
                {gRequired ? t('req_yesHint') : t('req_noHint')}
              </div>
            </div>
            {/* Traduceri (lotul O6b): numele grupului și al opțiunilor, în
                limbile active ale meniului — altfel un oaspete englez vedea
                „Mărime” și „Mare” în română pe un meniu tradus. */}
            {editGroup === 'add' || editGroup == null || trLangs.length === 0 ? null : (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: '0.78rem', color: D.t2, marginBottom: 8 }}>{t('tr_title')}</div>
                {[
                  { id: '__group__', label: gName || t('tr_groupFallback') },
                  ...editGroup.modifier_options.map((o) => ({ id: o.id, label: o.name })),
                ].map((row) => (
                  <div key={row.id} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: '0.75rem', color: D.t3, marginBottom: 4 }}>{row.label}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      {trLangs.map((l) => {
                        const meta = MENU_LANGS.find((x) => x.code === l)
                        // Numele limbii meniului (lotul L5b): în română EXACT
                        // `MENU_LANGS[].label` de dinainte (LX7); un cod
                        // necunoscut rămâne codul, ca înainte.
                        const langName = menuLangName(l, trTr, l)
                        const value = row.id === '__group__' ? (gTr[l] ?? '') : (oTr[row.id]?.[l] ?? '')
                        return (
                          <input
                            key={l}
                            value={value}
                            placeholder={`${meta?.flag ?? ''} ${langName}`}
                            aria-label={`${row.label} — ${langName}`}
                            onChange={(e) => {
                              const v = e.target.value
                              setTrDirty(true)
                              if (row.id === '__group__') setGTr((prev) => ({ ...prev, [l]: v }))
                              else
                                setOTr((prev) => ({ ...prev, [row.id]: { ...(prev[row.id] ?? {}), [l]: v } }))
                            }}
                            style={{ ...inp, height: 34, fontSize: '0.8rem' }}
                          />
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {errorText == null ? null : (
              <div style={{ color: D.red, fontSize: 13, marginBottom: 14 }}>{errorText}</div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setEditGroup(null)}
                style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
              >
                {tc.t('cancel')}
              </button>
              <button
                onClick={() => void saveGroup()}
                disabled={saving}
                style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.7 : 1 })}
              >
                {saving ? t('saving') : tc.t('save')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
