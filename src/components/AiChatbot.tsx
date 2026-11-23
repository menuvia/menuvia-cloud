// AiChatbot — asistent flotant în dashboard (Faza C)
// Citește contextul restaurantului (categorii + produse) și poate PROPUNE
// acțiuni pe meniul QR. Orice acțiune e CONFIRMABILĂ și EDITABILĂ înainte de
// aplicare — nimic nu se schimbă fără click explicit. Aplicarea trece prin
// hook-urile existente (useProducts/useCategories), deci respectă RLS-ul.
// Limba personalului (lotul L7): interfața vine din namespace-ul `assistant`
// (+ `common`), cerut SUS în fiecare subcomponentă; PROMPT-ul pentru model și
// răspunsurile lui nu se traduc (lib/aiChatPrompt.ts). Erorile se țin ca DATE
// (cauza) și se traduc la randare.
import { useState, useRef, useEffect } from 'react'
import { D } from '../lib/constants'
import { useIsMobile } from '../hooks/useIsMobile'
import { useProducts, useCategories, type Product } from '../hooks/useData'
import { aiChat, type AiMessage } from '../lib/ai'
import { AI_CHAT_EMPTY_REPLY, buildChatSystemPrompt } from '../lib/aiChatPrompt'
import { describeAiError } from '../lib/translationMessages'
import { Icon } from './ui/Icon'
import { useT } from '../i18n/useT'
import { fillNodes } from '../i18n/fillNodes'
import { describeStaffError } from '../i18n/staffErrors'
import { assistantNs } from '../i18n/ns/assistant'
import { commonNs } from '../i18n/ns/common'
import { useUiLang } from '../i18n/UiLangContext'

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
  /** Cauza eșecului (eroarea serverului), tradusă la randare. */
  errorCause?: unknown
}

interface ChatTurn {
  role: 'user' | 'assistant'
  /** Textul modelului ca atare; gol = răspuns gol (pe ecran `no_reply`, în
   *  istoricul trimis modelului `AI_CHAT_EMPTY_REPLY`, ca înainte). */
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

const ACTION_LABEL_KEY = {
  create_product: 'action_create_product',
  update_product: 'action_update_product',
  toggle_sold_out: 'action_toggle_sold_out',
  create_category: 'action_create_category',
} as const satisfies Record<AiAction['type'], string>

export default function AiChatbot({
  restaurantId,
  restaurantName,
  menuLang = 'ro',
  currency = 'RON',
}: {
  restaurantId: string
  restaurantName: string
  /** Limba de bază a meniului: conținutul de meniu propus de model e în ea. */
  menuLang?: string
  /** Moneda meniului (cod ISO 4217). */
  currency?: string | null
}) {
  // Sus, necondiționat: `assistant` + `common` (cerute și de panou) — o singură
  // suspendare, înaintea butonului flotant.
  const ta = useT(assistantNs)
  useT(commonNs)
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  // Panoul (și fetch-ul de meniu din useProducts/useCategories) se montează DOAR
  // după prima deschidere — altfel tot meniul se descărca la fiecare montare de
  // dashboard, cu chatbotul închis. Odată montat rămâne montat: conversația
  // supraviețuiește închiderii/redeschiderii.
  const [everOpened, setEverOpened] = useState(false)
  return (
    <>
      {!open && (
        <button
          onClick={() => {
            setOpen(true)
            setEverOpened(true)
          }}
          className="pressable hover-lift"
          aria-label={ta.t('fab_open')}
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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="sparkle" size={24} color={D.onGold} />
        </button>
      )}
      {everOpened && (
        <AiChatbotPanel
          open={open}
          onClose={() => setOpen(false)}
          restaurantId={restaurantId}
          restaurantName={restaurantName}
          menuLang={menuLang}
          currency={currency}
        />
      )}
    </>
  )
}

function AiChatbotPanel({
  open,
  onClose,
  restaurantId,
  restaurantName,
  menuLang,
  currency,
}: {
  open: boolean
  onClose: () => void
  restaurantId: string
  restaurantName: string
  menuLang: string
  currency: string | null
}) {
  const ta = useT(assistantNs)
  const tc = useT(commonNs)
  const { lang: uiLang } = useUiLang()
  const isMobile = useIsMobile()
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // Eroarea ca DATĂ (cauza): o schimbare de limbă cu eroarea pe ecran o retraduce.
  const [error, setError] = useState<{ cause: unknown } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Set de chei „acțiune în curs de aplicare" — lock sincron anti dublu-submit.
  const applyingRef = useRef<Set<string>>(new Set())

  const products = useProducts(restaurantId)
  const categories = useCategories(restaurantId)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, busy])

  // Context-ul de meniu pentru model (id-uri reale ca să poată referi produse).
  function buildSystem(): string {
    // Răspunsul în limba PERSONALULUI; conținutul propus în limba MENIULUI.
    return buildChatSystemPrompt(restaurantName, categories.categories, products.products, {
      replyLang: uiLang,
      menuLang,
      currency,
    })
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
      const history: AiMessage[] = newTurns.map((t) => ({ role: t.role, content: t.text || AI_CHAT_EMPTY_REPLY }))
      const res = await aiChat({
        restaurant_id: restaurantId,
        system: buildSystem(),
        messages: history,
        max_tokens: 1500,
      })
      const { text: replyText, actions } = extractActions(res.text)
      setTurns((prev) => [...prev, { role: 'assistant', text: replyText, actions: actions.length ? actions : undefined }])
    } catch (e) {
      setError({ cause: e })
    } finally {
      setBusy(false)
    }
  }

  async function applyAction(turnIdx: number, actionId: string, edited: AiAction) {
    // Guard: nu re-executa o acțiune deja aplicată/respinsă/eronată.
    const existing = turns[turnIdx]?.actions?.find((a) => a.id === actionId)
    if (existing && existing.status !== 'pending') return
    // Lock SINCRON anti dublu-click: setStatus e async (React batch), deci două
    // click-uri în ACELAȘI tick treceau ambele de guardul pe status (citesc
    // closure-ul vechi) și inserau DE DOUĂ ORI (create_product/create_category nu
    // sunt idempotente). actionId nu e unic global (`a${idx}` per turn) → cheie
    // compusă cu turnIdx.
    const lockKey = `${turnIdx}:${actionId}`
    if (applyingRef.current.has(lockKey)) return
    applyingRef.current.add(lockKey)
    const setStatus = (status: PendingAction['status'], errorCause?: unknown) =>
      setTurns((prev) =>
        prev.map((t, i) =>
          i !== turnIdx
            ? t
            : { ...t, actions: t.actions?.map((a) => (a.id === actionId ? { ...a, action: edited, status, errorCause } : a)) },
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
      if (res.error) setStatus('error', res.error)
      else setStatus('applied')
    } catch (e) {
      setStatus('error', e)
    } finally {
      applyingRef.current.delete(lockKey)
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
  // Rămâne montat când e închis (păstrează conversația + contextul de meniu deja
  // încărcat), dar nu randează nimic — FAB-ul de redeschidere e în componenta-părinte.
  if (!open) return null

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
          <Icon name="sparkle" size={18} color={D.gold} />
          <span style={{ fontFamily: 'Fraunces,serif', fontSize: '1rem', color: D.t1 }}>{ta.t('title')}</span>
        </div>
        <button onClick={onClose} aria-label={tc.t('close')} className="pressable" style={{ background: 'transparent', border: 'none', color: D.t2, cursor: 'pointer', fontSize: 18, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
      </div>

      {/* Mesaje */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {turns.length === 0 && (
          <div style={{ color: D.t2, fontSize: '0.85rem', lineHeight: 1.6, textAlign: 'center', marginTop: 20 }}>
            {ta.t('intro')}
            <br /><br />
            {fillNodes(ta.t('intro_try'), { ex1: <em>{ta.t('intro_ex1')}</em>, ex2: <em>{ta.t('intro_ex2')}</em> })}
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
              {t.text || ta.t('no_reply')}
            </div>
            {t.actions?.map((pa) => (
              <ActionCard
                key={pa.id}
                pending={pa}
                categories={categories.categories}
                products={products.products}
                onApply={(edited) => applyAction(ti, pa.id, edited)}
                onReject={() => rejectAction(ti, pa.id)}
              />
            ))}
          </div>
        ))}
        {busy && (
          <div role="status" aria-live="polite" style={{ color: D.t2, display: 'flex', alignItems: 'center', gap: 5, padding: '2px 2px' }}>
            <span className="visually-hidden">{ta.t('typing')}</span>
            <span aria-hidden="true" className="typing-dot" />
            <span aria-hidden="true" className="typing-dot" />
            <span aria-hidden="true" className="typing-dot" />
          </div>
        )}
        {error && (
          <div style={{ background: D.redA, border: `1px solid ${D.red}44`, color: D.red, borderRadius: 9, padding: '9px 12px', fontSize: '0.82rem' }}>
            {describeAiError(error.cause, ta, tc, ta.t('err_chat'))}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: 12, borderTop: `1px solid ${D.border}`, display: 'flex', gap: 8, flexShrink: 0 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          placeholder={ta.t('input_placeholder')}
          disabled={busy}
          style={{ flex: 1, minHeight: 44, background: D.s3, border: `1px solid ${D.border}`, borderRadius: 10, color: D.t1, padding: '10px 13px', fontSize: '0.88rem', fontFamily: 'DM Sans,sans-serif' }}
        />
        <button
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          aria-label={ta.t('send_aria')}
          className="pressable"
          style={{ minWidth: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: D.gold, color: D.onGold, border: 'none', borderRadius: 10, padding: '0 16px', cursor: busy ? 'default' : 'pointer', opacity: busy || !input.trim() ? 0.5 : 1 }}
        >
          <Icon name="send" size={18} />
        </button>
      </div>
    </div>
  )
}

// ── Card de acțiune confirmabil/editabil ─────────────────────
function ActionCard({
  pending,
  categories,
  products,
  onApply,
  onReject,
}: {
  pending: PendingAction
  categories: { id: string; name: string; emoji: string }[]
  products: Product[]
  onApply: (edited: AiAction) => void
  onReject: () => void
}) {
  const ta = useT(assistantNs)
  const tc = useT(commonNs)
  const [draft, setDraft] = useState<AiAction>(pending.action)
  const a = draft

  const findCatName = (id?: string) => categories.find((c) => c.id === id)?.name ?? '—'
  // Rezolvă id-ul de produs la numele real ca userul non-tehnic să vadă
  // DESPRE CE produs e vorba, nu un id trunchiat. Fallback la id dacă produsul
  // a fost între timp șters.
  const findProdName = (id?: string) => products.find((p) => p.id === id)?.name
  // Numele produsului sau, dacă a dispărut, începutul id-ului (date, nu text).
  const prodName = (id: string) => findProdName(id) ?? `${id.slice(0, 8)}…`
  const small = { fontSize: '0.72rem', color: D.t3, marginBottom: 3, display: 'block' as const }
  const field = { width: '100%', background: D.s3, border: `1px solid ${D.border}`, borderRadius: 7, color: D.t1, padding: '7px 9px', fontSize: '0.82rem', fontFamily: 'DM Sans,sans-serif', boxSizing: 'border-box' as const }

  const done = pending.status !== 'pending'

  return (
    <div style={{ width: '100%', maxWidth: '95%', background: D.s2, border: `1px solid ${pending.status === 'applied' ? D.green + '55' : pending.status === 'error' ? D.red + '55' : D.gold + '44'}`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: D.gold, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{ta.t(ACTION_LABEL_KEY[a.type])}</span>
        {pending.status === 'applied' && <span style={{ fontSize: '0.72rem', color: D.green }}>{ta.t('status_applied')}</span>}
        {pending.status === 'rejected' && <span style={{ fontSize: '0.72rem', color: D.t3 }}>{ta.t('status_rejected')}</span>}
        {pending.status === 'error' && <span style={{ fontSize: '0.72rem', color: D.red }}>{ta.t('status_error')}</span>}
      </div>

      {!done && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(a.type === 'create_product' || a.type === 'update_product') && (
            <>
              <div>
                <label style={small}>{ta.t('field_name')}</label>
                <input style={field} value={a.name ?? ''} onChange={(e) => setDraft({ ...a, name: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={small}>{ta.t('field_price')}</label>
                  <input style={field} type="number" value={a.price ?? ''} onChange={(e) => setDraft({ ...a, price: parseFloat(e.target.value) || 0 })} />
                </div>
                <div style={{ width: 70 }}>
                  <label style={small}>{ta.t('field_emoji')}</label>
                  <input style={field} value={a.emoji ?? ''} onChange={(e) => setDraft({ ...a, emoji: e.target.value })} />
                </div>
              </div>
              {a.type === 'create_product' && (
                <div>
                  <label style={small}>{ta.t('field_category')}</label>
                  <select style={field} value={a.category_id ?? ''} onChange={(e) => setDraft({ ...a, category_id: e.target.value || undefined })}>
                    <option value="">{ta.t('no_category')}</option>
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
              {fillNodes(ta.t('soldOut_sentence'), {
                product: <strong style={{ color: D.t1 }}>{ta.t('product_quoted', { name: prodName(a.product_id) })}</strong>,
                state: <strong style={{ color: a.sold_out ? D.red : D.green }}>{ta.t(a.sold_out ? 'state_soldOut' : 'state_available')}</strong>,
              })}
            </div>
          )}
          {a.type === 'create_category' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={small}>{ta.t('field_categoryName')}</label>
                <input style={field} value={a.name} onChange={(e) => setDraft({ ...a, name: e.target.value })} />
              </div>
              <div style={{ width: 70 }}>
                <label style={small}>{ta.t('field_emoji')}</label>
                <input style={field} value={a.emoji ?? ''} onChange={(e) => setDraft({ ...a, emoji: e.target.value })} />
              </div>
            </div>
          )}
          {a.type === 'update_product' && (
            <div style={{ fontSize: '0.72rem', color: D.t3 }}>{ta.t('product_label', { name: prodName(a.product_id) })}</div>
          )}
          {a.type === 'create_product' && a.category_id && (
            <div style={{ fontSize: '0.72rem', color: D.t3 }}>→ {findCatName(a.category_id)}</div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={() => onApply(draft)} className="pressable" style={{ flex: 1, background: D.green, color: '#000', border: 'none', borderRadius: 8, padding: '8px 0', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
              {ta.t('confirm')}
            </button>
            <button onClick={onReject} className="pressable" style={{ background: 'transparent', color: D.t2, border: `1px solid ${D.border}`, borderRadius: 8, padding: '8px 14px', fontSize: '0.8rem', cursor: 'pointer' }}>
              {ta.t('reject')}
            </button>
          </div>
        </div>
      )}
      {pending.status === 'error' && (
        <div style={{ fontSize: '0.75rem', color: D.red, marginTop: 6 }}>{describeStaffError(pending.errorCause, tc)}</div>
      )}
    </div>
  )
}
