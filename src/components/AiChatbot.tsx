// AiChatbot — asistent flotant în dashboard (Faza C)
// Citește contextul restaurantului (categorii + produse) și poate PROPUNE
// acțiuni pe meniul QR. Orice acțiune e CONFIRMABILĂ și EDITABILĂ înainte de
// aplicare — nimic nu se schimbă fără click explicit. Aplicarea trece prin
// hook-urile existente (useProducts/useCategories), deci respectă RLS-ul.
import { useState, useRef, useEffect } from 'react'
import { D } from '../lib/constants'
import { useIsMobile } from '../hooks/useIsMobile'
import { useProducts, useCategories, type Product } from '../hooks/useData'
import { aiChat, type AiMessage } from '../lib/ai'

// ── Protocolul de acțiuni ────────────────────────────────────
type AiAction =
  | { type: 'create_product'; name: string; price: number; description?: string; category_id?: string; emoji?: string }
  | { type: 'update_product'; product_id: string; name?: string; price?: number; description?: string; emoji?: string }
  | { type: 'toggle_sold_out'; product_id: string; sold_out: boolean }
  | { type: 'create_category'; name: string; emoji?: string }

interface PendingAction {
  id: string
  action: AiAction
  status: 'pending' | 'applied' | 'rejected' | 'error'
  errorMsg?: string
}

interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  actions?: PendingAction[]
}

// Validează un obiect arbitrar (din output-ul AI) într-o AiAction tipată.
// Orice formă necunoscută e ignorată (fail-closed) — nu aplicăm gunoi.
function parseAction(raw: unknown, idx: number): PendingAction | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = `a${idx}`
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : undefined)
  switch (o.type) {
    case 'create_product': {
      const name = str(o.name)
      const price = num(o.price)
      if (!name || price == null) return null
      return { id, status: 'pending', action: { type: 'create_product', name, price, description: str(o.description), category_id: str(o.category_id), emoji: str(o.emoji) } }
    }
    case 'update_product': {
      const product_id = str(o.product_id)
      if (!product_id) return null
      return { id, status: 'pending', action: { type: 'update_product', product_id, name: str(o.name), price: num(o.price), description: str(o.description), emoji: str(o.emoji) } }
    }
    case 'toggle_sold_out': {
      const product_id = str(o.product_id)
      if (!product_id || typeof o.sold_out !== 'boolean') return null
      return { id, status: 'pending', action: { type: 'toggle_sold_out', product_id, sold_out: o.sold_out } }
    }
    case 'create_category': {
      const name = str(o.name)
      if (!name) return null
      return { id, status: 'pending', action: { type: 'create_category', name, emoji: str(o.emoji) } }
    }
    default:
      return null
  }
}

// Extrage textul vizibil + acțiunile dintr-un răspuns AI (bloc ```json final).
function extractActions(reply: string): { text: string; actions: PendingAction[] } {
  const fence = /```json\s*([\s\S]*?)```/i
  const m = reply.match(fence)
  if (!m) return { text: reply.trim(), actions: [] }
  let actions: PendingAction[] = []
  try {
    const parsed = JSON.parse(m[1]) as { actions?: unknown[] }
    if (Array.isArray(parsed.actions)) {
      actions = parsed.actions.map((a, i) => parseAction(a, i)).filter((a): a is PendingAction => a !== null)
    }
  } catch {
    /* bloc invalid → ignorăm, păstrăm doar textul */
  }
  const text = reply.replace(fence, '').trim()
  return { text, actions }
}

const ACTION_LABEL: Record<AiAction['type'], string> = {
  create_product: 'Adaugă produs',
  update_product: 'Modifică produs',
  toggle_sold_out: 'Disponibilitate produs',
  create_category: 'Adaugă categorie',
}

export default function AiChatbot({ restaurantId, restaurantName }: { restaurantId: string; restaurantName: string }) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const products = useProducts(restaurantId)
  const categories = useCategories(restaurantId)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, busy])

  // Context-ul de meniu pentru model (id-uri reale ca să poată referi produse).
  function buildSystem(): string {
    const cats = categories.categories.map((c) => `- ${c.id} · ${c.emoji} ${c.name}`).join('\n')
    const prods = products.products
      .slice(0, 200)
      .map((p) => `- ${p.id} · ${p.name} · ${p.price} lei${p.is_sold_out ? ' · STOC EPUIZAT' : ''}${p.category_id ? ` · cat:${p.category_id}` : ''}`)
      .join('\n')
    return [
      `Ești asistentul AI al restaurantului „${restaurantName}" din platforma Menuvia.`,
      'Ajuți la gestionarea meniului digital QR. Răspunzi mereu în română, concis și prietenos.',
      '',
      'Poți PROPUNE modificări pe meniu. Când propui modificări, adaugă la FINALUL răspunsului un bloc ```json``` cu forma:',
      '{"actions":[{"type":"create_product","name":"...","price":25,"description":"...","category_id":"<id categorie>","emoji":"🍕"}]}',
      'Tipuri de acțiuni permise:',
      '- create_product: {name, price (lei, număr), description?, category_id?, emoji?}',
      '- update_product: {product_id, name?, price?, description?, emoji?}',
      '- toggle_sold_out: {product_id, sold_out (true/false)}',
      '- create_category: {name, emoji?}',
      'Folosește DOAR id-urile reale din contextul de mai jos. Nu inventa id-uri.',
      'Nu aplica tu nimic — utilizatorul confirmă manual fiecare acțiune. Dacă userul doar pune o întrebare, NU adăuga bloc json.',
      '',
      'CATEGORII:',
      cats || '(niciuna)',
      '',
      'PRODUSE:',
      prods || '(niciunul)',
    ].join('\n')
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setError(null)
    setInput('')
    const newTurns: ChatTurn[] = [...turns, { role: 'user', text }]
    setTurns(newTurns)
    setBusy(true)
    try {
      const history: AiMessage[] = newTurns.map((t) => ({ role: t.role, content: t.text }))
      const res = await aiChat({
        restaurant_id: restaurantId,
        system: buildSystem(),
        messages: history,
        max_tokens: 1500,
      })
      const { text: replyText, actions } = extractActions(res.text)
      setTurns((prev) => [...prev, { role: 'assistant', text: replyText || '(fără răspuns)', actions: actions.length ? actions : undefined }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la asistentul AI.')
    } finally {
      setBusy(false)
    }
  }

  async function applyAction(turnIdx: number, actionId: string, edited: AiAction) {
    // Guard: nu re-executa o acțiune deja aplicată/respinsă/eronată.
    const existing = turns[turnIdx]?.actions?.find((a) => a.id === actionId)
    if (existing && existing.status !== 'pending') return
    const setStatus = (status: PendingAction['status'], errorMsg?: string) =>
      setTurns((prev) =>
        prev.map((t, i) =>
          i !== turnIdx
            ? t
            : { ...t, actions: t.actions?.map((a) => (a.id === actionId ? { ...a, action: edited, status, errorMsg } : a)) },
        ),
      )
    try {
      let res: { error: { message: string } | null } = { error: null }
      if (edited.type === 'create_product') {
        res = await products.create({ name: edited.name, price: edited.price, description: edited.description ?? null, category_id: edited.category_id ?? null, emoji: edited.emoji ?? '' })
      } else if (edited.type === 'update_product') {
        const patch: Partial<Product> = {}
        if (edited.name != null) patch.name = edited.name
        if (edited.price != null) patch.price = edited.price
        if (edited.description != null) patch.description = edited.description
        if (edited.emoji != null) patch.emoji = edited.emoji
        res = await products.update(edited.product_id, patch)
      } else if (edited.type === 'toggle_sold_out') {
        // toggleSoldOut comută starea curentă → calculăm „current" ca opusul țintei.
        res = await products.toggleSoldOut(edited.product_id, !edited.sold_out)
      } else if (edited.type === 'create_category') {
        res = await categories.create({ name: edited.name, emoji: edited.emoji ?? '🍽️' })
      }
      if (res.error) setStatus('error', res.error.message)
      else setStatus('applied')
    } catch (e) {
      setStatus('error', e instanceof Error ? e.message : 'Eroare')
    }
  }

  function rejectAction(turnIdx: number, actionId: string) {
    setTurns((prev) =>
      prev.map((t, i) =>
        i !== turnIdx ? t : { ...t, actions: t.actions?.map((a) => (a.id === actionId ? { ...a, status: 'rejected' as const } : a)) },
      ),
    )
  }

  // ── UI ─────────────────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="pressable hover-lift"
        aria-label="Deschide asistentul AI"
        style={{
          position: 'fixed',
          bottom: isMobile ? 76 : 24,
          right: 20,
          zIndex: 300,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: D.gold,
          color: '#000',
          border: 'none',
          cursor: 'pointer',
          fontSize: 24,
          boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
        }}
      >
        ✨
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        zIndex: 300,
        bottom: isMobile ? 0 : 24,
        right: isMobile ? 0 : 24,
        left: isMobile ? 0 : 'auto',
        top: isMobile ? 0 : 'auto',
        width: isMobile ? 'auto' : 400,
        height: isMobile ? 'auto' : 600,
        maxHeight: isMobile ? '100%' : '80vh',
        background: D.s1,
        border: `1px solid ${D.border}`,
        borderRadius: isMobile ? 0 : 18,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
      }}
    >
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>✨</span>
          <span style={{ fontFamily: 'Fraunces,serif', fontSize: '1rem', color: D.t1 }}>Asistent AI</span>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Închide" style={{ background: 'transparent', border: 'none', color: D.t2, cursor: 'pointer', fontSize: 18, padding: 4 }}>✕</button>
      </div>

      {/* Mesaje */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {turns.length === 0 && (
          <div style={{ color: D.t2, fontSize: '0.85rem', lineHeight: 1.6, textAlign: 'center', marginTop: 20 }}>
            Salut! Sunt asistentul tău. Pot răspunde la întrebări și pot propune modificări pe meniul QR.
            <br /><br />
            Încearcă: <em>„Adaugă o pizza Margherita la 32 lei"</em> sau <em>„Marchează Tiramisu ca epuizat"</em>.
          </div>
        )}
        {turns.map((t, ti) => (
          <div key={ti} style={{ display: 'flex', flexDirection: 'column', alignItems: t.role === 'user' ? 'flex-end' : 'flex-start', gap: 8 }}>
            <div
              style={{
                maxWidth: '85%',
                background: t.role === 'user' ? D.goldA : D.s2,
                border: `1px solid ${t.role === 'user' ? D.gold + '44' : D.border}`,
                color: D.t1,
                borderRadius: 12,
                padding: '9px 13px',
                fontSize: '0.88rem',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {t.text}
            </div>
            {t.actions?.map((pa) => (
              <ActionCard
                key={pa.id}
                pending={pa}
                categories={categories.categories}
                onApply={(edited) => applyAction(ti, pa.id, edited)}
                onReject={() => rejectAction(ti, pa.id)}
              />
            ))}
          </div>
        ))}
        {busy && <div style={{ color: D.t2, fontSize: '0.85rem' }}>Asistentul scrie…</div>}
        {error && (
          <div style={{ background: D.redA, border: `1px solid ${D.red}44`, color: D.red, borderRadius: 9, padding: '9px 12px', fontSize: '0.82rem' }}>{error}</div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: 12, borderTop: `1px solid ${D.border}`, display: 'flex', gap: 8, flexShrink: 0 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          placeholder="Scrie un mesaj…"
          disabled={busy}
          style={{ flex: 1, minHeight: 44, background: D.s3, border: `1px solid ${D.border}`, borderRadius: 10, color: D.t1, padding: '10px 13px', fontSize: '0.88rem', fontFamily: 'DM Sans,sans-serif' }}
        />
        <button
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          aria-label="Trimite mesajul"
          className="pressable"
          style={{ minWidth: 44, height: 44, background: D.gold, color: '#000', border: 'none', borderRadius: 10, padding: '0 16px', fontSize: '0.88rem', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy || !input.trim() ? 0.5 : 1 }}
        >
          ➤
        </button>
      </div>
    </div>
  )
}

// ── Card de acțiune confirmabil/editabil ─────────────────────
function ActionCard({
  pending,
  categories,
  onApply,
  onReject,
}: {
  pending: PendingAction
  categories: { id: string; name: string; emoji: string }[]
  onApply: (edited: AiAction) => void
  onReject: () => void
}) {
  const [draft, setDraft] = useState<AiAction>(pending.action)
  const a = draft

  const findCatName = (id?: string) => categories.find((c) => c.id === id)?.name ?? '—'
  const small = { fontSize: '0.72rem', color: D.t3, marginBottom: 3, display: 'block' as const }
  const field = { width: '100%', background: D.s3, border: `1px solid ${D.border}`, borderRadius: 7, color: D.t1, padding: '7px 9px', fontSize: '0.82rem', fontFamily: 'DM Sans,sans-serif', boxSizing: 'border-box' as const }

  const done = pending.status !== 'pending'

  return (
    <div style={{ width: '100%', maxWidth: '95%', background: D.s2, border: `1px solid ${pending.status === 'applied' ? D.green + '55' : pending.status === 'error' ? D.red + '55' : D.gold + '44'}`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: D.gold, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{ACTION_LABEL[a.type]}</span>
        {pending.status === 'applied' && <span style={{ fontSize: '0.72rem', color: D.green }}>· aplicat ✓</span>}
        {pending.status === 'rejected' && <span style={{ fontSize: '0.72rem', color: D.t3 }}>· respins</span>}
        {pending.status === 'error' && <span style={{ fontSize: '0.72rem', color: D.red }}>· eroare</span>}
      </div>

      {!done && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(a.type === 'create_product' || a.type === 'update_product') && (
            <>
              <div>
                <label style={small}>Nume</label>
                <input style={field} value={a.name ?? ''} onChange={(e) => setDraft({ ...a, name: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={small}>Preț (lei)</label>
                  <input style={field} type="number" value={a.price ?? ''} onChange={(e) => setDraft({ ...a, price: parseFloat(e.target.value) || 0 })} />
                </div>
                <div style={{ width: 70 }}>
                  <label style={small}>Emoji</label>
                  <input style={field} value={a.emoji ?? ''} onChange={(e) => setDraft({ ...a, emoji: e.target.value })} />
                </div>
              </div>
              {a.type === 'create_product' && (
                <div>
                  <label style={small}>Categorie</label>
                  <select style={field} value={a.category_id ?? ''} onChange={(e) => setDraft({ ...a, category_id: e.target.value || undefined })}>
                    <option value="">(fără categorie)</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
          {a.type === 'toggle_sold_out' && (
            <div style={{ fontSize: '0.82rem', color: D.t2 }}>
              Marchează produsul ca <strong style={{ color: a.sold_out ? D.red : D.green }}>{a.sold_out ? 'STOC EPUIZAT' : 'DISPONIBIL'}</strong>.
            </div>
          )}
          {a.type === 'create_category' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={small}>Nume categorie</label>
                <input style={field} value={a.name} onChange={(e) => setDraft({ ...a, name: e.target.value })} />
              </div>
              <div style={{ width: 70 }}>
                <label style={small}>Emoji</label>
                <input style={field} value={a.emoji ?? ''} onChange={(e) => setDraft({ ...a, emoji: e.target.value })} />
              </div>
            </div>
          )}
          {a.type === 'update_product' && (
            <div style={{ fontSize: '0.72rem', color: D.t3 }}>Produs: {a.product_id.slice(0, 8)}…</div>
          )}
          {a.type === 'create_product' && a.category_id && (
            <div style={{ fontSize: '0.72rem', color: D.t3 }}>→ {findCatName(a.category_id)}</div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={() => onApply(draft)} className="pressable" style={{ flex: 1, background: D.green, color: '#000', border: 'none', borderRadius: 8, padding: '8px 0', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
              Confirmă
            </button>
            <button onClick={onReject} className="pressable" style={{ background: 'transparent', color: D.t2, border: `1px solid ${D.border}`, borderRadius: 8, padding: '8px 14px', fontSize: '0.8rem', cursor: 'pointer' }}>
              Respinge
            </button>
          </div>
        </div>
      )}
      {pending.status === 'error' && pending.errorMsg && (
        <div style={{ fontSize: '0.75rem', color: D.red, marginTop: 6 }}>{pending.errorMsg}</div>
      )}
    </div>
  )
}
