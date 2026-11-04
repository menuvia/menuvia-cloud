import { useState, useEffect, useCallback } from 'react'
import { useCategories } from '../hooks/useData'
import type { Category } from '../hooks/useData'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { QueryError } from './PageLoader'
import { btn, useToast, Toast, Modal, Inp, Sel } from './_dashboard/sharedUI'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'
import { MENU_LANGS, activeTranslationLangs, mergeTranslations } from '../lib/i18nMenu'
import { toUserMessage, zeroRowsAsDenied } from '../lib/userMessages'

function CategoryModal({
  category,
  menuLanguages,
  baseLang,
  onSave,
  onClose,
}: {
  category: Category | null
  menuLanguages: readonly string[]
  // Limba originalului (lotul O6a): nu i se cere traducere.
  baseLang: string
  // Întoarce mesajul de eroare (afișat în modal) sau null la succes.
  onSave: (f: Partial<Category>) => Promise<string | null>
  onClose: () => void
}) {
  const [form, setForm] = useState<Partial<Category>>(category || { name: '', emoji: '🍽️' })
  // Traduceri MANUALE ale numelui, doar pentru limbile ACTIVE din setări.
  // Limbile neactive deja scrise în `translations` (de mână sau de AI) nu se
  // afișează și nu se pierd: mergeTranslations le păstrează la salvare.
  const langs = activeTranslationLangs(menuLanguages, baseLang)
  const [names, setNames] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const code of langs) {
      const v = category?.translations?.[code]?.name
      init[code] = typeof v === 'string' ? v : ''
    }
    return init
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const nameMissing = !(form.name ?? '').trim()

  const submit = async () => {
    // Numele categoriei e obligatoriu — fără guard se crea o categorie
    // cu nume gol tăcut (invizibilă/inutilă pe meniu).
    if (nameMissing || saving) return
    setSaving(true)
    setSaveError(null)
    // Fără limbi active NU trimitem `translations` deloc: nimic de schimbat.
    const payload: Partial<Category> =
      langs.length > 0
        ? { ...form, translations: mergeTranslations(form.translations, names, langs, baseLang) }
        : form
    const err = await onSave(payload)
    // La succes părintele închide modalul; la eșec rămânem deschiși, cu
    // textul editat intact și eroarea serverului vizibilă.
    if (err) {
      setSaveError(err)
      setSaving(false)
    }
  }

  return (
    <Modal
      title={category ? 'Editează categorie' : 'Adaugă categorie'}
      onClose={onClose}
      width={400}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
            Nume *
          </label>
          <Inp
            label="Nume categorie"
            value={form.name || ''}
            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
            placeholder="Feluri principale"
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
            Emoji
          </label>
          <Inp
            label="Emoji"
            value={form.emoji || ''}
            onChange={(v) => setForm((f) => ({ ...f, emoji: v }))}
            placeholder="🍽️"
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
            Text italic sub titlu (opțional)
          </label>
          <textarea
            aria-label="Text italic sub titlu"
            value={form.meta_text || ''}
            onChange={(e) => setForm((f) => ({ ...f, meta_text: e.target.value }))}
            placeholder="ex: Servit până la ora 13:00"
            rows={2}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: D.s3,
              border: `1px solid ${D.border}`,
              borderRadius: 8,
              color: D.t1,
              fontSize: '0.85rem',
              fontFamily: 'inherit',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ fontSize: '0.7rem', color: D.t2, marginTop: 4 }}>
            Afișat pe meniul public sub numele categoriei.
          </div>
        </div>
        {langs.length > 0 && (
          <div
            style={{
              borderTop: `1px solid ${D.border}`,
              paddingTop: 13,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: D.t2 }}>
                Traduceri <span style={{ fontWeight: 400, color: D.t3 }}>(opțional)</span>
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t3, lineHeight: 1.5, marginTop: 4 }}>
                Numele categoriei în limbile active ale meniului. Câmpurile lăsate goale afișează
                automat numele în română.
              </div>
            </div>
            {langs.map((code) => {
              const meta = MENU_LANGS.find((l) => l.code === code)
              const label = meta?.label ?? code.toUpperCase()
              return (
                <label key={code} style={{ display: 'block' }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '0.78rem',
                      color: D.t2,
                      marginBottom: 5,
                    }}
                  >
                    {meta?.flag} Nume ({label})
                  </span>
                  <Inp
                    label={`Nume (${label})`}
                    value={names[code] ?? ''}
                    onChange={(v) => setNames((n) => ({ ...n, [code]: v }))}
                    placeholder={form.name || 'Nume categorie'}
                  />
                </label>
              )
            })}
          </div>
        )}
        {saveError && (
          <div
            role="alert"
            style={{
              background: D.redA,
              border: `1px solid ${D.red}`,
              color: D.red,
              borderRadius: 8,
              padding: '9px 12px',
              fontSize: '0.8rem',
              lineHeight: 1.45,
            }}
          >
            Nu s-a putut salva categoria: {saveError}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
          <button
            onClick={onClose}
            style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
          >
            Anulează
          </button>
          <button
            onClick={() => void submit()}
            disabled={nameMissing || saving}
            style={btn({
              background: D.gold,
              color: '#000',
              opacity: nameMissing || saving ? 0.5 : 1,
            })}
          >
            {saving ? 'Se salvează…' : 'Salvează'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
export default function CategoriesTab({
  restaurantId,
  menuLanguages = [],
  baseLang = 'ro',
}: {
  restaurantId: string
  // `restaurant.menu_languages` — limbile active ale meniului (mig 197).
  menuLanguages?: readonly string[]
  // `restaurants.language` — limba originalului (lotul O6a).
  baseLang?: string
}) {
  const {
    categories,
    loading,
    error,
    create,
    update,
    remove,
    reorder,
    refetch: refetchCats,
  } = useCategories(restaurantId)
  // OPT-R2: CategoriesTab folosea useProducts DOAR pentru numărul de produse
  // per categorie → descărca TOATE produsele cu select('*') (jsonb greu).
  // Fetch dedicat count-only pe 2 coloane; zero mutații (nu folosea API-ul lor).
  const [prodCounts, setProdCounts] = useState<{ id: string; category_id: string | null }[]>([])
  const [prodError, setProdError] = useState<string | null>(null)
  const refetchProds = useCallback(async () => {
    if (!restaurantId) {
      setProdCounts([])
      return
    }
    setProdError(null)
    const { data, error: pe } = await supabase
      .from('products')
      .select('id, category_id')
      .eq('restaurant_id', restaurantId)
    if (pe) setProdError(toUserMessage(pe))
    else setProdCounts((data ?? []) as { id: string; category_id: string | null }[])
  }, [restaurantId])
  useEffect(() => {
    void refetchProds()
  }, [refetchProds])
  const { toasts, toast } = useToast()
  const [modal, setModal] = useState<Category | 'add' | null>(null)
  const [delId, setDelId] = useState<string | null>(null)
  // Unde se mută produsele categoriei șterse (lotul O1a). '' = nicăieri: FK-ul
  // e ON DELETE SET NULL, iar un produs fără categorie NU apare în meniu.
  const [moveTo, setMoveTo] = useState('')
  const [deleting, setDeleting] = useState(false)
  // Lotul O5b (MENU-08): săgețile stau blocate cât se salvează o mutare — două
  // apăsări rapide porneau de la aceeași ordine veche și se suprapuneau.
  const [reordering, setReordering] = useState(false)
  async function moveCategories(next: typeof categories) {
    if (reordering) return
    setReordering(true)
    try {
      const res = await reorder(next)
      if (res?.error) toast(toUserMessage(res.error, 'Ordinea nu a putut fi salvată.'), 'error')
    } finally {
      setReordering(false)
    }
  }
  const openDelete = (id: string) => {
    setDelId(id)
    setMoveTo(categories.find((c) => c.id !== id)?.id ?? '')
  }
  const delCount = delId ? prodCounts.filter((p) => p.category_id === delId).length : 0

  if (error || prodError)
    return (
      <QueryError
        message={error || prodError || 'Eroare necunoscută'}
        onRetry={() => {
          refetchCats()
          void refetchProds()
        }}
      />
    )

  // Eroarea Supabase vine în `{error}` (supabase-js NU aruncă) — o întoarcem
  // modalului, care o afișează și rămâne deschis. Toast de succes DOAR pe succes.
  const handleSave = async (form: Partial<Category>): Promise<string | null> => {
    if (!modal) return null
    try {
      const { error: e } =
        modal === 'add' ? await create(form) : await update((modal as Category).id, form)
      if (e) return toUserMessage(e, 'Categoria nu a putut fi salvată.')
    } catch (err) {
      // Respingere de transport (rețea căzută) — nu trebuie să rămână nevăzută.
      return toUserMessage(err, 'Categoria nu a putut fi salvată.')
    }
    toast(modal === 'add' ? 'Categorie adăugată' : 'Actualizat')
    setModal(null)
    return null
  }
  const handleDelete = async () => {
    if (!delId || deleting) return
    setDeleting(true)
    try {
      // Întâi mutăm produsele: dacă mutarea e refuzată, categoria rămâne și
      // produsele nu ajung tăcut în „Fără categorie" (invizibile în meniu).
      if (moveTo && delCount > 0) {
        const res = await supabase
          .from('products')
          .update({ category_id: moveTo })
          .eq('restaurant_id', restaurantId)
          .eq('category_id', delId)
          .select('id')
        const denied = zeroRowsAsDenied(res)
        if (denied) {
          toast(toUserMessage(denied, 'Produsele nu au putut fi mutate.'), 'error')
          return
        }
      }
      const { error: e } = await remove(delId)
      // Mesajul hardcodat afirma o cauză FALSĂ (FK-ul e ON DELETE SET NULL —
      // produsele nu blochează ștergerea); afișăm cauza reală.
      if (e) toast(toUserMessage(e, 'Nu s-a putut șterge categoria.'), 'error')
      else toast('Ștearsă')
      setDelId(null)
      void refetchProds()
    } catch (err) {
      toast(toUserMessage(err, 'Nu s-a putut șterge categoria.'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <Toast toasts={toasts} />
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
          <p style={{ color: D.t3, fontSize: '0.78rem', marginTop: 3 }}>
            {categories.length} categorii
          </p>
        </div>
        <button
          onClick={() => setModal('add')}
          style={btn({
            background: D.gold,
            color: '#000',
            height: 40,
            padding: '0 16px',
            fontSize: '0.85rem',
            gap: 7,
          })}
        >
          <Icon name="plus" size={16} />
          Adaugă categorie
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <Skeleton variant="card" count={3} />
        ) : categories.length === 0 ? (
          <EmptyState
            icon="menu"
            title="Nicio categorie"
            description="Adaugă prima categorie ca să-ți organizezi meniul."
            action={
              <button
                onClick={() => setModal('add')}
                style={btn({ background: D.gold, color: '#000', gap: 7 })}
              >
                <Icon name="plus" size={16} />
                Adaugă categorie
              </button>
            }
          />
        ) : (
          categories.map((cat) => {
            const count = prodCounts.filter((p) => p.category_id === cat.id).length
            return (
              <div
                key={cat.id}
                style={{
                  background: D.s2,
                  border: `1px solid ${D.border}`,
                  borderRadius: 12,
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: D.s3,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.3rem',
                    flexShrink: 0,
                  }}
                >
                  {cat.emoji}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 500, color: D.t1 }}>{cat.name}</div>
                  <div style={{ fontSize: '0.75rem', color: D.t2, marginTop: 2 }}>
                    {count} produs{count !== 1 ? 'e' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    aria-label="Mută mai sus"
                    disabled={reordering}
                    onClick={() => {
                      const idx = categories.indexOf(cat)
                      if (idx > 0) {
                        const reordered = [...categories]
                        ;[reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]]
                        void moveCategories(reordered)
                      }
                    }}
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      borderRadius: 8,
                      background: D.s3,
                      border: `1px solid ${D.border}`,
                      color: D.t2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    ↑
                  </button>
                  <button
                    aria-label="Mută mai jos"
                    disabled={reordering}
                    onClick={() => {
                      const idx = categories.indexOf(cat)
                      if (idx < categories.length - 1) {
                        const reordered = [...categories]
                        ;[reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]]
                        void moveCategories(reordered)
                      }
                    }}
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      borderRadius: 8,
                      background: D.s3,
                      border: `1px solid ${D.border}`,
                      color: D.t2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    ↓
                  </button>
                  <button
                    aria-label="Editează categorie"
                    onClick={() => setModal(cat)}
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      borderRadius: 8,
                      background: D.s3,
                      border: `1px solid ${D.border}`,
                      color: D.t2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    aria-label="Șterge categorie"
                    onClick={() => openDelete(cat.id)}
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      borderRadius: 8,
                      background: D.redA,
                      border: `1px solid rgba(224,85,85,0.2)`,
                      color: D.red,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
      {modal && (
        <CategoryModal
          category={modal === 'add' ? null : (modal as Category)}
          menuLanguages={menuLanguages}
          baseLang={baseLang}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
      {delId && (
        <Modal title="Șterge categorie" onClose={() => setDelId(null)} width={380}>
          {delCount === 0 ? (
            <p style={{ color: D.t2, marginBottom: 22 }}>Categoria nu are produse.</p>
          ) : (
            <div style={{ marginBottom: 22 }}>
              <label
                htmlFor="cat-delete-move"
                style={{ display: 'block', color: D.t2, fontSize: '0.85rem', marginBottom: 8 }}
              >
                {delCount === 1
                  ? 'Mută produsul acestei categorii în:'
                  : `Mută cele ${delCount} produse ale acestei categorii în:`}
              </label>
              <Sel id="cat-delete-move" label="Mută produsele în" value={moveTo} onChange={setMoveTo}>
                {categories
                  .filter((c) => c.id !== delId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.emoji} {c.name}
                    </option>
                  ))}
                <option value="">Nicio categorie (nu vor apărea în meniu)</option>
              </Sel>
              {moveTo === '' && (
                <p role="note" style={{ color: D.amber, fontSize: '0.75rem', marginTop: 6 }}>
                  Fără categorie, produsele nu apar în meniul clienților până nu le alegi una.
                </p>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setDelId(null)}
              style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
            >
              Anulează
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              aria-busy={deleting}
              style={btn({ background: D.red, color: '#fff', opacity: deleting ? 0.6 : 1 })}
            >
              {deleting ? 'Se șterge…' : 'Șterge'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
