import { useState } from 'react'
import type React from 'react'
import { useCategories, useProducts } from '../hooks/useData'
import type { Category } from '../hooks/useData'
import { D } from '../lib/constants'
import { QueryError } from './PageLoader'

// ── Local helpers (copy din DashboardPage; consolidare DRY = PR ulterior) ──

  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '0 18px',
  height: 44,
  borderRadius: 10,
  fontSize: '0.9rem',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  ...e,
})
const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '11px 14px',
  fontSize: '0.9rem',
  color: D.t1,
  outline: 'none',
  height: 44,
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}

function useToast() {
  const toast = useCallback((msg: string, type = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])
  return { toasts, toast }
}
function Toast({ toasts }: { toasts: { id: string; msg: string; type: string }[] }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 80,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: D.s3,
            borderLeft: `3px solid ${t.type === 'error' ? D.red : D.green}`,
            borderRadius: 10,
            padding: '12px 16px',
            fontSize: '0.875rem',
            color: D.t1,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            minWidth: 220,
            maxWidth: 320,
          }}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// ── Upgrade Modal ─────────────────────────────────────────────
function Modal({
  title,
  onClose,
  children,
  width = 520,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  width?: number
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(8px)',
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
          border: `1px solid ${D.bHov}`,
          borderRadius: 18,
          width: '100%',
          maxWidth: width,
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '18px 22px',
            borderBottom: `1px solid ${D.border}`,
          }}
        >
          <span style={{ fontFamily: 'Fraunces,serif', fontSize: '1.05rem', color: D.t1 }}>
            {title}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: D.t2,
              cursor: 'pointer',
              padding: 6,
              borderRadius: 8,
              fontSize: 18,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: 22 }}>{children}</div>
      </div>
    </div>
  )
}
function Inp({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={inp}
      onFocus={(e) => (e.target.style.borderColor = D.gold)}
      onBlur={(e) => (e.target.style.borderColor = D.border)}
    />
  )
}
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
          <div style={{ fontSize: '0.7rem', color: D.t3, marginTop: 4 }}>
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
    if (e) toast('Nu poți șterge o categorie cu produse', 'error')
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
          })}
        >
          + Adaugă categorie
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: D.t3 }}>Se încarcă...</div>
        ) : categories.length === 0 ? (
          <div
            style={{
              padding: '40px',
              textAlign: 'center',
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 14,
              color: D.t3,
            }}
          >
            Nicio categorie. Adaugă prima!
          </div>
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
                  <div style={{ fontSize: '0.75rem', color: D.t3, marginTop: 2 }}>
                    {count} produs{count !== 1 ? 'e' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => {
                      const idx = categories.indexOf(cat)
                      if (idx > 0) {
                        const reordered = [...categories]
                        ;[reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]]
                        reorder(reordered)
                      }
                    }}
                    style={{
                      width: 34,
                      height: 34,
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
                    onClick={() => {
                      const idx = categories.indexOf(cat)
                      if (idx < categories.length - 1) {
                        const reordered = [...categories]
                        ;[reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]]
                        reorder(reordered)
                      }
                    }}
                    style={{
                      width: 34,
                      height: 34,
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
                    onClick={() => setModal(cat)}
                    style={{
                      width: 34,
                      height: 34,
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
                    ✏
                  </button>
                  <button
                    onClick={() => setDelId(cat.id)}
                    style={{
                      width: 34,
                      height: 34,
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
                    🗑
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
