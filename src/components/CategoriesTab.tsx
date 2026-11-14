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
import { zeroRowsAsDenied } from '../lib/userMessages'
import { useT } from '../i18n/useT'
import { categoriesNs } from '../i18n/ns/categories'
import { commonNs } from '../i18n/ns/common'
import { translationsNs } from '../i18n/ns/translations'
import { describeStaffError } from '../i18n/staffErrors'
import { menuLangName } from '../lib/translationMessages'

// Un refuz ținut ca DATĂ (eroarea brută + cheia rezervei): textul se compune
// la RANDARE, în limba curentă (lotul L5b) — o schimbare de limbă cu eroarea
// pe ecran o retraduce.
type SaveFailure = { err: unknown }

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
  // Întoarce refuzul (afișat în modal) sau null la succes.
  onSave: (f: Partial<Category>) => Promise<SaveFailure | null>
  onClose: () => void
}) {
  const { t } = useT(categoriesNs)
  const tc = useT(commonNs)
  const trTr = useT(translationsNs)
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
  const [saveError, setSaveError] = useState<SaveFailure | null>(null)
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
      title={category ? t('modal_titleEdit') : t('modal_titleAdd')}
      onClose={onClose}
      width={400}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
            {t('field_name')}
          </label>
          <Inp
            label={t('field_nameAria')}
            value={form.name || ''}
            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
            placeholder={t('field_namePh')}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
            {t('field_emoji')}
          </label>
          <Inp
            label={t('field_emoji')}
            value={form.emoji || ''}
            onChange={(v) => setForm((f) => ({ ...f, emoji: v }))}
            placeholder="🍽️"
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
            {t('field_meta')}
          </label>
          <textarea
            aria-label={t('field_metaAria')}
            value={form.meta_text || ''}
            onChange={(e) => setForm((f) => ({ ...f, meta_text: e.target.value }))}
            placeholder={t('field_metaPh')}
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
            {t('field_metaHint')}
          </div>
        </div>
        {langs.length === 0 ? null : (
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
                {t('tr_title')} <span style={{ fontWeight: 400, color: D.t3 }}>{t('tr_optional')}</span>
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t3, lineHeight: 1.5, marginTop: 4 }}>
                {t('tr_desc', { lang: menuLangName(baseLang, trTr, baseLang) })}
              </div>
            </div>
            {langs.map((code) => {
              const meta = MENU_LANGS.find((l) => l.code === code)
              const label = menuLangName(code, trTr)
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
                    {t('tr_label', { flag: meta?.flag ?? '', lang: label })}
                  </span>
                  <Inp
                    label={t('tr_aria', { lang: label })}
                    value={names[code] ?? ''}
                    onChange={(v) => setNames((n) => ({ ...n, [code]: v }))}
                    placeholder={form.name || t('field_nameAria')}
                  />
                </label>
              )
            })}
          </div>
        )}
        {saveError == null ? null : (
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
            {/* În română rezerva e „Categoria nu a putut fi salvată.”, ca înainte; în
                altă limbă un text românesc al serverului cade pe `err_generic` din
                `common` — „The category couldn’t be saved: The category couldn’t
                be saved.” ar repeta prefixul. */}
            {t('saveError', {
              error: describeStaffError(saveError.err, tc, {
                fallback: tc.lang === 'ro' ? t('err_save') : undefined,
              }),
            })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
          <button
            onClick={onClose}
            style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
          >
            {tc.t('cancel')}
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
            {saving ? t('saving') : tc.t('save')}
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
  // Sus, înaintea oricărui return: modalul de categorie folosește aceleași
  // namespace-uri (inclusiv `translations`, pentru numele limbilor meniului),
  // deci prima deschidere într-o limbă nouă nu suspendă fila (L4b/L4c).
  const { t, tp } = useT(categoriesNs)
  const tc = useT(commonNs)
  useT(translationsNs)
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
  // Eroarea citirii, ca DATĂ (textul se compune la randare).
  const [prodError, setProdError] = useState<{ err: unknown } | null>(null)
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
    if (pe) setProdError({ err: pe })
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
  // Numărul din dialog se reîmprospătează la deschidere (lista e citită o dată,
  // la montare; alt dispozitiv poate fi adăugat produse între timp). Cât
  // durează citirea, dialogul nu promite „nu are produse” și „Șterge” stă
  // blocat — altfel produsele ar fi plecat în categoria implicită fără ca omul
  // s-o fi ales (recenzia CodeRabbit pe #346).
  const [countRefreshing, setCountRefreshing] = useState(false)
  // Lotul O5b (MENU-08): săgețile stau blocate cât se salvează o mutare — două
  // apăsări rapide porneau de la aceeași ordine veche și se suprapuneau.
  const [reordering, setReordering] = useState(false)
  async function moveCategories(next: typeof categories) {
    if (reordering) return
    setReordering(true)
    try {
      const res = await reorder(next)
      if (res?.error) toast(describeStaffError(res.error, tc, { fallback: t('err_order') }), 'error')
    } finally {
      setReordering(false)
    }
  }
  const openDelete = (id: string) => {
    setDelId(id)
    setMoveTo(categories.find((c) => c.id !== id)?.id ?? '')
    setCountRefreshing(true)
    void refetchProds().finally(() => setCountRefreshing(false))
  }
  const delCount = delId ? prodCounts.filter((p) => p.category_id === delId).length : 0

  if (error || prodError)
    return (
      <QueryError
        message={error || (prodError ? describeStaffError(prodError.err, tc) : '') || t('unknownError')}
        retryLabel={tc.t('retry')}
        onRetry={() => {
          refetchCats()
          void refetchProds()
        }}
      />
    )

  // Eroarea Supabase vine în `{error}` (supabase-js NU aruncă) — o întoarcem
  // modalului, care o afișează și rămâne deschis. Toast de succes DOAR pe succes.
  const handleSave = async (form: Partial<Category>): Promise<SaveFailure | null> => {
    if (!modal) return null
    try {
      const { error: e } =
        modal === 'add' ? await create(form) : await update((modal as Category).id, form)
      if (e) return { err: e }
    } catch (err) {
      // Respingere de transport (rețea căzută) — nu trebuie să rămână nevăzută.
      return { err }
    }
    toast(modal === 'add' ? t('toast_added') : t('toast_updated'))
    setModal(null)
    return null
  }
  const handleDelete = async () => {
    if (!delId || deleting) return
    setDeleting(true)
    try {
      // Întâi mutăm produsele: dacă mutarea e refuzată, categoria rămâne și
      // produsele nu ajung tăcut în „Fără categorie" (invizibile în meniu).
      // Câte sunt se citește ACUM din server, nu din numărătoarea de la montare
      // (recenzia #346): una veche de 0 sărea mutarea și lăsa produsele
      // orfane, una veche de N făcea ca „nimic de mutat” să pară refuz.
      if (moveTo) {
        const inCat = await supabase
          .from('products')
          .select('id')
          .eq('restaurant_id', restaurantId)
          .eq('category_id', delId)
        if (inCat.error) {
          toast(describeStaffError(inCat.error, tc, { fallback: t('err_move') }), 'error')
          return
        }
        if ((inCat.data ?? []).length > 0) {
          const res = await supabase
            .from('products')
            .update({ category_id: moveTo })
            .eq('restaurant_id', restaurantId)
            .eq('category_id', delId)
            .select('id')
          const denied = zeroRowsAsDenied(res)
          if (denied) {
            toast(describeStaffError(denied, tc, { fallback: t('err_move') }), 'error')
            void refetchProds()
            return
          }
        }
      }
      const { error: e } = await remove(delId)
      // Mesajul hardcodat afirma o cauză FALSĂ (FK-ul e ON DELETE SET NULL —
      // produsele nu blochează ștergerea); afișăm cauza reală.
      if (e) toast(describeStaffError(e, tc, { fallback: t('err_delete') }), 'error')
      else toast(t('toast_deleted'))
      setDelId(null)
      void refetchProds()
    } catch (err) {
      toast(describeStaffError(err, tc, { fallback: t('err_delete') }), 'error')
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
            {tp('count', categories.length)}
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
          {t('add')}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <Skeleton variant="card" count={3} />
        ) : categories.length === 0 ? (
          <EmptyState
            icon="menu"
            title={t('empty_title')}
            description={t('empty_desc')}
            action={
              <button
                onClick={() => setModal('add')}
                style={btn({ background: D.gold, color: '#000', gap: 7 })}
              >
                <Icon name="plus" size={16} />
                {t('add')}
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
                    {tp('productsCount', count)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    aria-label={t('moveUp')}
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
                    aria-label={t('moveDown')}
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
                    aria-label={t('editAria')}
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
                    aria-label={t('deleteAria')}
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
        <Modal title={t('del_title')} onClose={() => setDelId(null)} width={380}>
          {countRefreshing ? (
            <p style={{ color: D.t2, marginBottom: 22 }}>{t('del_checking')}</p>
          ) : delCount === 0 ? (
            <p style={{ color: D.t2, marginBottom: 22 }}>{t('del_empty')}</p>
          ) : (
            <div style={{ marginBottom: 22 }}>
              <label
                htmlFor="cat-delete-move"
                style={{ display: 'block', color: D.t2, fontSize: '0.85rem', marginBottom: 8 }}
              >
                {tp('del_move', delCount)}
              </label>
              <Sel id="cat-delete-move" label={t('del_moveAria')} value={moveTo} onChange={setMoveTo}>
                {categories
                  .filter((c) => c.id !== delId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.emoji} {c.name}
                    </option>
                  ))}
                <option value="">{t('del_none')}</option>
              </Sel>
              {moveTo === '' && (
                <p role="note" style={{ color: D.amber, fontSize: '0.75rem', marginTop: 6 }}>
                  {t('del_noneNote')}
                </p>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setDelId(null)}
              style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
            >
              {tc.t('cancel')}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting || countRefreshing}
              aria-busy={deleting}
              style={btn({
                background: D.red,
                color: '#fff',
                opacity: deleting || countRefreshing ? 0.6 : 1,
              })}
            >
              {deleting ? t('deleting') : tc.t('delete')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
