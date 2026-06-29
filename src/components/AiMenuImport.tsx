// AiMenuImport — import meniu din poză (Faza D)
// Userul încarcă o poză cu meniul → AI (vision, prin ai-proxy cu cheia BYO)
// extrage produsele → ecran de REVIZUIRE editabil („e totul corect?") →
// inserare în bulk prin hook-ul useProducts (respectă RLS).
import { useState } from 'react'
import { D } from '../lib/constants'
import { useIsMobile } from '../hooks/useIsMobile'
import { useProducts, useCategories } from '../hooks/useData'
import { aiMenuImport, type AiPart } from '../lib/ai'

interface DraftProduct {
  name: string
  description: string
  price: number
  emoji: string
  category_id: string
  include: boolean
}

function fileToBase64(file: File): Promise<{ media_type: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve({ media_type: file.type || 'image/jpeg', data: comma >= 0 ? result.slice(comma + 1) : result })
    }
    reader.onerror = () => reject(new Error('Nu am putut citi fișierul.'))
    reader.readAsDataURL(file)
  })
}

// Validează output-ul AI (array de produse) → drafturi tipate.
function parseDrafts(text: string): DraftProduct[] {
  const clean = text.replace(/```json|```/g, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(clean)
  } catch {
    // încearcă să extragă primul array din text
    const m = clean.match(/\[[\s\S]*\]/)
    if (!m) return []
    try { parsed = JSON.parse(m[0]) } catch { return [] }
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as Record<string, unknown>).name === 'string')
    .slice(0, 200)
    .map((p) => ({
      name: String(p.name).slice(0, 200),
      description: p.description == null ? '' : String(p.description).slice(0, 1000),
      price: Number.isFinite(Number(p.price)) && Number(p.price) >= 0 ? Number(p.price) : 0,
      emoji: typeof p.emoji === 'string' ? p.emoji.slice(0, 8) : '',
      category_id: '',
      include: true,
    }))
}

export default function AiMenuImport({ restaurantId, onClose }: { restaurantId: string; onClose: () => void }) {
  const isMobile = useIsMobile()
  const products = useProducts(restaurantId)
  const categories = useCategories(restaurantId)
  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftProduct[]>([])
  const [imported, setImported] = useState(0)

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setError('Imaginea e prea mare (max 5MB).')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const img = await fileToBase64(file)
      const content: AiPart[] = [
        { type: 'image', media_type: img.media_type, data: img.data },
        {
          type: 'text',
          text: 'Extrage toate produsele din acest meniu. Returnează DOAR un JSON array, fără markdown, cu obiecte de forma {"name": string, "description": string|null, "price": number, "emoji": string}. Prețurile în lei (număr fără simbol). Pune un emoji relevant pentru fiecare produs.',
        },
      ]
      const res = await aiMenuImport({ restaurant_id: restaurantId, messages: [{ role: 'user', content }], max_tokens: 4000 })
      const parsed = parseDrafts(res.text)
      if (parsed.length === 0) {
        setError('Nu am găsit produse în imagine. Încearcă o poză mai clară.')
        setBusy(false)
        return
      }
      setDrafts(parsed)
      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la procesarea imaginii.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmImport() {
    setBusy(true)
    setError(null)
    let ok = 0
    for (const d of drafts) {
      if (!d.include || !d.name.trim()) continue
      const r = await products.create({ name: d.name.trim(), description: d.description.trim() || null, price: d.price, emoji: d.emoji, category_id: d.category_id || null })
      if (!r.error) ok++
    }
    setImported(ok)
    setBusy(false)
    setStep('done')
  }

  function patch(i: number, p: Partial<DraftProduct>) {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...p } : d)))
  }

  const field = { background: D.s3, border: `1px solid ${D.border}`, borderRadius: 7, color: D.t1, padding: '7px 9px', fontSize: '0.82rem', fontFamily: 'DM Sans,sans-serif', boxSizing: 'border-box' as const }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', zIndex: 1000, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: D.s1, border: `1px solid ${D.border}`, borderRadius: isMobile ? '18px 18px 0 0' : 18, width: '100%', maxWidth: 640, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'Fraunces,serif', fontSize: '1.1rem', color: D.t1 }}>📸 Import meniu din poză</span>
          <button onClick={onClose} aria-label="Închide" style={{ background: 'transparent', border: 'none', color: D.t2, cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          {error && <div style={{ background: D.redA, border: `1px solid ${D.red}44`, color: D.red, borderRadius: 9, padding: '10px 13px', fontSize: '0.84rem', marginBottom: 14 }}>{error}</div>}

          {step === 'upload' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <p style={{ color: D.t2, fontSize: '0.9rem', lineHeight: 1.5, marginBottom: 20 }}>
                Fotografiază sau încarcă o poză clară cu meniul. AI-ul extrage produsele, apoi le poți verifica și corecta înainte de salvare.
              </p>
              <label style={{ display: 'inline-block', background: D.gold, color: '#000', borderRadius: 10, padding: '13px 28px', fontSize: '0.9rem', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Se procesează…' : 'Alege o poză'}
                <input type="file" accept="image/*" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }} style={{ display: 'none' }} />
              </label>
            </div>
          )}

          {step === 'review' && (
            <>
              <p style={{ color: D.t1, fontSize: '0.92rem', marginBottom: 4, fontWeight: 600 }}>Am găsit {drafts.length} produse. E totul corect?</p>
              <p style={{ color: D.t2, fontSize: '0.8rem', marginBottom: 16 }}>Corectează ce e greșit, debifează ce nu vrei, apoi salvează.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {drafts.map((d, i) => (
                  <div key={i} style={{ background: d.include ? D.s2 : D.s1, border: `1px solid ${D.border}`, borderRadius: 10, padding: 12, opacity: d.include ? 1 : 0.55 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <input type="checkbox" checked={d.include} onChange={(e) => patch(i, { include: e.target.checked })} style={{ width: 18, height: 18, accentColor: '#C8963C' }} />
                      <input style={{ ...field, width: 56, textAlign: 'center' }} value={d.emoji} onChange={(e) => patch(i, { emoji: e.target.value })} placeholder="🍽️" />
                      <input style={{ ...field, flex: 1 }} value={d.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Nume produs" />
                      <input style={{ ...field, width: 80 }} type="number" value={d.price} onChange={(e) => patch(i, { price: parseFloat(e.target.value) || 0 })} />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input style={{ ...field, flex: 1 }} value={d.description} onChange={(e) => patch(i, { description: e.target.value })} placeholder="Descriere (opțional)" />
                      <select style={{ ...field, width: 150 }} value={d.category_id} onChange={(e) => patch(i, { category_id: e.target.value })}>
                        <option value="">Fără categorie</option>
                        {categories.categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <p style={{ color: D.t1, fontSize: '1rem', fontWeight: 600, marginBottom: 6 }}>{imported} produse adăugate!</p>
              <p style={{ color: D.t2, fontSize: '0.85rem' }}>Le găsești în tab-ul Produse.</p>
            </div>
          )}
        </div>

        {step === 'review' && (
          <div style={{ padding: 16, borderTop: `1px solid ${D.border}`, display: 'flex', gap: 10 }}>
            <button onClick={() => setStep('upload')} style={{ background: 'transparent', color: D.t2, border: `1px solid ${D.border}`, borderRadius: 10, padding: '12px 18px', fontSize: '0.86rem', cursor: 'pointer' }}>
              Înapoi
            </button>
            <button onClick={() => void confirmImport()} disabled={busy} className="pressable" style={{ flex: 1, background: D.gold, color: '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: '0.9rem', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Se salvează…' : `Salvează ${drafts.filter((d) => d.include).length} produse`}
            </button>
          </div>
        )}
        {step === 'done' && (
          <div style={{ padding: 16, borderTop: `1px solid ${D.border}` }}>
            <button onClick={onClose} className="pressable" style={{ width: '100%', background: D.gold, color: '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer' }}>
              Gata
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
