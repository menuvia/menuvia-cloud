import { useState } from 'react'
import { useCategories, useProducts } from '../hooks/useData'
import type { Category } from '../hooks/useData'
import { D } from '../lib/constants'
import { QueryError } from './PageLoader'
import { btn, useToast, Toast, Modal, Inp } from './_dashboard/sharedUI'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'

function CategoryModal({
  category,
  onSave,
  onClose,
}: {
  category: Category | null
  onSave: (f: Partial<Category>) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<Partial<Category>>(category || { name: '', emoji: '🍽️' })
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
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
          <button
            onClick={onClose}
            style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
          >
            Anulează
          </button>
          <button onClick={() => onSave(form)} style={btn({ background: D.gold, color: '#000' })}>
            Salvează
          </button>
        </div>
      </div>
    </Modal>
  )
}
export default function CategoriesTab({ restaurantId }: { restaurantId: string }) {
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
  const { products, error: prodError, refetch: refetchProds } = useProducts(restaurantId)
  const { toasts, toast } = useToast()
  const [modal, setModal] = useState<Category | 'add' | null>(null)
  const [delId, setDelId] = useState<string | null>(null)

  if (error || prodError)
    return (
      <QueryError
        message={error || prodError || 'Eroare necunoscută'}
        onRetry={() => {
          refetchCats()
          refetchProds()
        }}
      />
    )

  const handleSave = async (form: Partial<Category>) => {
    if (modal === 'add') {
      const { error: e } = await create(form)
      if (e) toast(e.message, 'error')
      else {
        toast('Categorie adăugată')
        setModal(null)
      }
    } else if (modal) {
      const { error: e } = await update((modal as Category).id, form)
      if (e) toast(e.message, 'error')
      else {
        toast('Actualizat')
        setModal(null)
      }
    }
  }
  const handleDelete = async () => {
    if (!delId) return
    const { error: e } = await remove(delId)
    // Mesajul hardcodat afirma o cauză FALSĂ (FK-ul e ON DELETE SET NULL —
    // produsele nu blochează ștergerea); afișăm cauza reală.
    if (e) toast('Nu s-a putut șterge categoria: ' + e.message, 'error')
    else toast('Ștearsă')
    setDelId(null)
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
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.5rem',
              color: D.t1,
              letterSpacing: '-0.02em',
            }}
          >
            Categorii
          </h2>
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
            const count = products.filter((p) => p.category_id === cat.id).length
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
                    onClick={() => {
                      const idx = categories.indexOf(cat)
                      if (idx > 0) {
                        const reordered = [...categories]
                        ;[reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]]
                        reorder(reordered)
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
                    onClick={() => {
                      const idx = categories.indexOf(cat)
                      if (idx < categories.length - 1) {
                        const reordered = [...categories]
                        ;[reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]]
                        reorder(reordered)
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
                    onClick={() => setDelId(cat.id)}
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
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
      {delId && (
        <Modal title="Șterge categorie" onClose={() => setDelId(null)} width={380}>
          <p style={{ color: D.t2, marginBottom: 22 }}>
            Produsele din această categorie rămân fără categorie.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setDelId(null)}
              style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
            >
              Anulează
            </button>
            <button onClick={handleDelete} style={btn({ background: D.red, color: '#fff' })}>
              Șterge
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
