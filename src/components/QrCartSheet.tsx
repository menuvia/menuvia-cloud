// QrCartSheet — coșul la masă (QR flow), redesign „Masa ta".
// Extras din QrMenuPage pentru code-splitting; lazy-loaded.
// Vizual aliniat la mockup: header „Masa ta", secțiune ÎN COȘ · DE TRIMIS cu
// thumbnail-uri, RECOMANDATE ALĂTURI pe orizontală, CTA cu prețul în buton.
// Folosește tokens-urile temei (PUB/accent) — fără hex hardcodat. Motion prin
// clasele din animations.css (reduced-motion respectat global).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import type { CartItem, OrderConfirmationPayload } from '../lib/orders'
import type { Category, Product } from '../lib/qr'
import { hasMandatoryModifierGroups } from '../lib/qr'
import { fmtPrice, type MenuCurrency } from '../lib/currency'
import { thumbUrlFor } from '../lib/images'

interface PUBColors {
  bg: string
  surface: string
  text: string
  text2: string
  text3: string
  border: string
  borderStrong: string
}

export interface QrCartSheetProps {
  cart: CartItem[]
  cartTotal: number
  notes: string
  submitting: boolean
  submitError: string | null
  categories: Category[]
  checkoutSuggestionSettings:
    | {
        enabled: boolean
        max_suggestions?: number
        message?: string
      }
    | null
    | undefined
  PUB: PUBColors
  accent: string
  accentGradient: string
  onClose: () => void
  onNotesChange: (v: string) => void
  onUpdateQty: (key: string, delta: number) => void
  onRemove: (key: string) => void
  onLineTotal: (item: CartItem) => number
  onSubmit: (notes: string) => void
  onOpenProduct: (product: Product) => void
  onAddToCart: (item: CartItem) => void
  /** Moneda meniului (mig 205/206) — default 'RON'. */
  currency?: MenuCurrency
  // Opțional — modul „Masa ta" complet: comenzi deja trimise (La bucătărie) +
  // plata mesei. Dacă lipsesc, sheet-ul rămâne coș simplu (backward-compatible).
  sentOrders?: OrderConfirmationPayload[]
  tableTotal?: number
  onPayTable?: () => void
  payDisabled?: boolean
  payLabel?: string
  /** Split pe itemi (mig 229): deschide selecția „plătește partea ta". */
  onPaySplit?: () => void
}

// Eyebrow mic, all-caps, cu tracking — etichetă de secțiune.
function sectionLabelStyle(color: string): CSSProperties {
  return {
    fontFamily: 'DM Sans, sans-serif',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color,
  }
}

export default function QrCartSheet({
  cart,
  cartTotal,
  notes,
  submitting,
  submitError,
  categories,
  checkoutSuggestionSettings,
  PUB,
  accent,
  accentGradient,
  onClose,
  onNotesChange,
  onUpdateQty,
  onRemove,
  onLineTotal,
  onSubmit,
  onOpenProduct,
  onAddToCart,
  currency = 'RON',
  sentOrders,
  tableTotal,
  onPayTable,
  payDisabled = false,
  payLabel = 'Plătește masa',
  onPaySplit,
}: QrCartSheetProps) {
  const hasSent = (sentOrders?.length ?? 0) > 0
  // Index produs → pentru thumbnail-uri în rândurile de coș.
  useBodyScrollLock(true)
  const productById = useMemo(() => {
    const map = new Map<string, Product>()
    for (const c of categories) {
      for (const p of c.products ?? []) map.set(p.id, p)
    }
    return map
  }, [categories])

  // Recomandate alături — întâi împerecherile CURATE de restaurant (produsele
  // legate explicit de ce e în coș, mig 164), apoi fallback pe categorii
  // neacoperite. Împerecherile sunt alegeri intenționate ale localului ("la
  // burger merge un cartof + o bere"), deci bat heuristica de categorie.
  const suggestions = useMemo<Product[]>(() => {
    if (!(checkoutSuggestionSettings?.enabled ?? false)) return []
    const maxSugg = checkoutSuggestionSettings?.max_suggestions ?? 4
    const cartProductIds = new Set(cart.map((c) => c.product_id))
    const out: Product[] = []
    const seen = new Set<string>()

    // Adaugă un produs candidat dacă e valid (nu e în coș, nu-i deja sugerat,
    // nu-i sold-out/draft) și mai e loc. Întoarce true dacă l-a adăugat.
    const tryPush = (prod: Product | undefined): boolean => {
      if (!prod || out.length >= maxSugg) return false
      if (prod.is_sold_out || prod.is_draft) return false
      if (cartProductIds.has(prod.id) || seen.has(prod.id)) return false
      seen.add(prod.id)
      out.push(prod)
      return true
    }

    // 1) Împerecheri curate: produsele pe care localul le-a legat de itemele din
    //    coș, în ordinea lor de afișare. Prioritate maximă.
    for (const item of cart) {
      if (out.length >= maxSugg) break
      const prod = productById.get(item.product_id)
      if (!prod) continue
      const paired = [...(prod.pairings ?? [])].sort((a, b) => a.display_order - b.display_order)
      for (const pr of paired) {
        if (out.length >= maxSugg) break
        tryPush(productById.get(pr.paired_product_id))
      }
    }

    // 2) Fallback: produse din categorii neacoperite de coș (heuristica veche),
    //    ca să umplem până la maxSugg dacă împerecherile nu ajung.
    if (out.length < maxSugg) {
      const cartCategoryIds = new Set(
        cart.map((item) => productById.get(item.product_id)?.category_id).filter(Boolean),
      )
      for (const cat of categories) {
        if (out.length >= maxSugg) break
        if (cartCategoryIds.has(cat.id)) continue
        for (const prod of cat.products ?? []) {
          if (out.length >= maxSugg) break
          tryPush(prod)
        }
      }
    }
    return out
  }, [categories, cart, checkoutSuggestionSettings, productById])

  const suggestionMsg =
    checkoutSuggestionSettings?.message ?? 'Ai vrea ceva în plus înainte să trimiți?'

  // OPT-2: nota pentru bucătărie e stare LOCALĂ cât timp sheet-ul e deschis —
  // fiecare tastă re-randa altfel întreaga pagină de meniu din spatele
  // sheet-ului (părintele ținea state-ul). Părintele rămâne sursa de adevăr
  // între deschideri: primește valoarea la close/submit prin onNotesChange.
  const [localNotes, setLocalNotes] = useState(notes)

  function handleClose(): void {
    onNotesChange(localNotes)
    onClose()
  }

  // Semantică de dialog modal (paritate cu ProductSheet): focus pe butonul de
  // închidere la deschidere, restaurare la închidere + Escape → handleClose
  // (persistă nota, ca și backdrop-ul). Ref pentru a evita închiderea stale.
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(handleClose)
  onCloseRef.current = handleClose
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeBtnRef.current?.focus()
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      prev?.focus()
    }
  }, [])

  function handleAddSuggestion(s: Product): void {
    // Minim efectiv > 0 (is_required SAU min_select > 0) → quick-add interzis;
    // serverul respinge sub minim (mig 191), deci deschidem ProductSheet.
    const hasRequired = hasMandatoryModifierGroups(s.modifier_groups)
    if (hasRequired) {
      handleClose()
      onOpenProduct(s)
      return
    }
    onAddToCart({
      _key: crypto.randomUUID(),
      product_id: s.id,
      product_name_snapshot: s.name,
      unit_price_snapshot: s.price,
      quantity: 1,
      selected_modifiers: [],
      notes: null,
      upsell_source: 'checkout_suggestion',
    })
  }

  const canSubmit = cart.length > 0 && !submitting

  return (
    <div
      onClick={handleClose}
      className="animate-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,18,8,0.45)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Masa ta"
        style={{
          background: PUB.bg,
          borderRadius: '22px 22px 0 0',
          width: '100%',
          maxWidth: 480,
          maxHeight: '88vh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '8px 20px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          position: 'relative',
          boxShadow: '0 -10px 40px rgba(26,18,8,0.18)',
        }}
      >
        {/* Drag handle */}
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: PUB.borderStrong,
            margin: '8px auto 0',
            flexShrink: 0,
          }}
        />

        {/* X close — afordanță explicită (cerere UX) */}
        <button
          type="button"
          ref={closeBtnRef}
          onClick={handleClose}
          aria-label="Închide"
          className="pressable"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: `1px solid ${accent}`,
            background: PUB.bg,
            color: PUB.text,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 3,
            boxShadow: '0 2px 8px rgba(26,18,8,0.18)',
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {/* Header — „Masa ta" */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
          <h2
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 28,
              fontWeight: 600,
              color: PUB.text,
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            Masa ta
          </h2>
          <div
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontStyle: 'italic',
              fontSize: 14,
              color: PUB.text2,
            }}
          >
            Adaugă oricând, plătești când vrei.
          </div>
        </div>

        {/* Secțiune: LA BUCĂTĂRIE (comenzi deja trimise în sesiune) */}
        {hasSent && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={sectionLabelStyle(PUB.text2)}>La bucătărie · {sentOrders?.length}</div>
            {sentOrders?.map((o) => (
              <div
                key={o.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  background: PUB.surface,
                  border: `1px solid ${PUB.border}`,
                  borderRadius: 12,
                  padding: '10px 14px',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span
                    style={{
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      color: PUB.text2,
                    }}
                  >
                    #{o.short_id} ·{' '}
                    {new Date(o.created_at).toLocaleTimeString('ro-RO', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span style={{ fontSize: 12, color: PUB.text3, fontStyle: 'italic' }}>
                    Trimisă la bucătărie
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: 'Fraunces, Georgia, serif',
                    fontWeight: 600,
                    color: PUB.text,
                    flexShrink: 0,
                  }}
                >
                  {fmtPrice(o.total, currency)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Secțiune: ÎN COȘ · DE TRIMIS */}
        {cart.length > 0 && <div style={sectionLabelStyle(accent)}>În coș · de trimis</div>}

        {cart.length === 0 && (
          <div style={{ fontSize: 13, color: PUB.text2, padding: '8px 0 4px', lineHeight: 1.5 }}>
            {hasSent
              ? 'Coșul e gol. Atinge un produs din meniu ca să mai comanzi.'
              : 'Coșul e gol. Atinge un produs din meniu ca să-l adaugi aici.'}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {cart.map((item) => {
            const prod = productById.get(item.product_id)
            // Personalizările item-ului (modificatori + extra), afișate discret
            // sub nume — clientul trebuie să poată verifica ce a ales („fără
            // ceapă", extra sos) înainte să trimită comanda.
            const customizations = [
              ...item.selected_modifiers.map((m) => `${m.group_name}: ${m.option_name}`),
              ...(item.selected_extras ?? []).map((e) => `+ ${e.name}`),
            ]
            return (
              <div
                key={item._key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  borderBottom: `1px solid ${PUB.border}`,
                  padding: '12px 0',
                }}
              >
                {prod?.image_url ? (
                  <img
                    src={thumbUrlFor(prod.image_url) ?? prod.image_url}
                    onError={(e) => {
                      // Imagine veche fără thumb → o singură trecere pe original.
                      if (prod.image_url && e.currentTarget.src !== prod.image_url) {
                        e.currentTarget.src = prod.image_url
                      }
                    }}
                    alt={item.product_name_snapshot}
                    loading="lazy"
                    decoding="async"
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 12,
                      objectFit: 'cover',
                      flexShrink: 0,
                      background: PUB.surface,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 12,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 24,
                      background: accentGradient,
                    }}
                  >
                    🍽️
                  </div>
                )}

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'Fraunces, Georgia, serif',
                      color: PUB.text,
                      fontSize: 16,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.product_name_snapshot}
                  </div>
                  {customizations.length > 0 && (
                    <div style={{ color: PUB.text3, fontSize: 12, lineHeight: 1.45 }}>
                      {customizations.join(' · ')}
                    </div>
                  )}
                  {item.notes && (
                    <div
                      style={{
                        color: PUB.text3,
                        fontSize: 12,
                        fontStyle: 'italic',
                        lineHeight: 1.45,
                      }}
                    >
                      „{item.notes}"
                    </div>
                  )}
                  <div style={{ color: PUB.text2, fontSize: 13, fontStyle: 'italic' }}>
                    {fmtPrice(onLineTotal(item), currency)}
                  </div>
                </div>

                {/* Stepper pill */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    background: PUB.surface,
                    border: `1px solid ${PUB.border}`,
                    borderRadius: 999,
                    // Padding vertical redus ca țintele de 44px să nu umfle pilula.
                    padding: '0 4px',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onUpdateQty(item._key, -1)}
                    aria-label="Scade cantitatea"
                    className="pressable"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: PUB.text,
                      borderRadius: '50%',
                      // Țintă de atingere 44x44 (a11y); glyph-ul rămâne mic vizual.
                      width: 44,
                      height: 44,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                      cursor: 'pointer',
                    }}
                  >
                    −
                  </button>
                  <span
                    style={{
                      color: PUB.text,
                      minWidth: 20,
                      textAlign: 'center',
                      fontWeight: 600,
                      fontSize: 14,
                    }}
                  >
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateQty(item._key, 1)}
                    aria-label="Crește cantitatea"
                    className="pressable"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: PUB.text,
                      borderRadius: '50%',
                      // Țintă de atingere 44x44 (a11y); glyph-ul rămâne mic vizual.
                      width: 44,
                      height: 44,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                      cursor: 'pointer',
                    }}
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onRemove(item._key)}
                  aria-label={`Elimină ${item.product_name_snapshot}`}
                  className="pressable"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: PUB.text3,
                    fontSize: 18,
                    cursor: 'pointer',
                    lineHeight: 1,
                    flexShrink: 0,
                    // Țintă de atingere ~40px + distanță de „+" ca să nu se atingă.
                    width: 40,
                    height: 40,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginLeft: 6,
                  }}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>

        {/* Notă pentru bucătărie */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={sectionLabelStyle(PUB.text2)}>Notă pentru bucătărie</div>
          <textarea
            placeholder="Fără ceapă, vă rog..."
            value={localNotes}
            onChange={(e) => setLocalNotes(e.target.value)}
            onBlur={() => onNotesChange(localNotes)}
            rows={2}
            style={{
              background: PUB.surface,
              border: `1px solid ${PUB.border}`,
              borderRadius: 14,
              color: PUB.text,
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              padding: '12px 14px',
              resize: 'none',
              width: '100%',
            }}
          />
        </div>

        {/* Recomandate alături — carusel orizontal */}
        {suggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Eticheta de secțiune (eyebrow) + mesajul de upsell lizibil:
                mesajul e nudge de conversie → contrast/dimensiune de body,
                nu stilul mic-tracked de etichetă. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={sectionLabelStyle(PUB.text2)}>Recomandate alături</div>
              <div
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 600,
                  color: PUB.text2,
                }}
              >
                {suggestionMsg}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 12,
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                paddingBottom: 4,
                margin: '0 -20px',
                paddingInline: 20,
              }}
            >
              {suggestions.map((s) => (
                <div
                  key={s.id}
                  style={{
                    width: 150,
                    flexShrink: 0,
                    background: PUB.surface,
                    border: `1px solid ${PUB.border}`,
                    borderRadius: 16,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {s.image_url ? (
                    <img
                      src={thumbUrlFor(s.image_url) ?? s.image_url}
                      onError={(e) => {
                        if (s.image_url && e.currentTarget.src !== s.image_url) {
                          e.currentTarget.src = s.image_url
                        }
                      }}
                      alt={s.name}
                      loading="lazy"
                      decoding="async"
                      style={{ width: '100%', height: 96, objectFit: 'cover' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: 96,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 30,
                        background: accentGradient,
                      }}
                    >
                      🍽️
                    </div>
                  )}
                  <div
                    style={{
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      flex: 1,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'Fraunces, Georgia, serif',
                        fontSize: 14,
                        fontWeight: 600,
                        color: PUB.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.name}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: 'auto',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'Fraunces, Georgia, serif',
                          fontSize: 14,
                          fontWeight: 600,
                          color: accent,
                        }}
                      >
                        {fmtPrice(s.price, currency)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleAddSuggestion(s)}
                        aria-label={`Adaugă ${s.name}`}
                        className="pressable"
                        style={{
                          // Quick-add standardizat la 44x44 (a11y), ca peste tot.
                          width: 44,
                          height: 44,
                          borderRadius: '50%',
                          background: accent,
                          color: '#fff',
                          border: 'none',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                          lineHeight: 1,
                          paddingBottom: 2,
                          flexShrink: 0,
                        }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Total */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            borderTop: `1px solid ${PUB.border}`,
            paddingTop: 14,
          }}
        >
          <span
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 18,
              fontWeight: 600,
              color: PUB.text,
            }}
          >
            Total
          </span>
          <span
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 26,
              fontWeight: 600,
              color: PUB.text,
            }}
          >
            {fmtPrice(cartTotal, currency)}
          </span>
        </div>
        <div style={{ fontSize: 11, color: PUB.text3, textAlign: 'right', marginTop: -8 }}>
          Totalul final este confirmat de restaurant.
        </div>

        {submitError != null && (
          <div
            style={{
              background: 'rgba(192,57,43,0.1)',
              border: '1px solid rgba(192,57,43,0.25)',
              borderRadius: 12,
              padding: '12px 14px',
              textAlign: 'center',
            }}
          >
            <div style={{ color: '#c0392b', fontSize: 13, lineHeight: 1.5, marginBottom: 8 }}>
              {submitError}
            </div>
            <button
              type="button"
              onClick={() => onSubmit(localNotes)}
              className="pressable"
              style={{
                background: 'rgba(192,57,43,0.15)',
                border: '1px solid rgba(192,57,43,0.3)',
                borderRadius: 8,
                color: '#c0392b',
                padding: '6px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Reîncearcă
            </button>
          </div>
        )}

        {/* CTA primar — prețul în buton (stil mockup) */}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit(localNotes)}
          className={canSubmit ? 'pressable' : ''}
          style={{
            // Coș gol / trimitere în curs → stare dezactivată clară (surface +
            // text estompat), nu accent viu la opacitate 1.
            background: canSubmit ? accent : PUB.surface,
            color: canSubmit ? '#fff' : PUB.text3,
            border: 'none',
            borderRadius: 16,
            padding: '16px 0',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 16,
            fontWeight: 700,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            opacity: submitting ? 0.7 : 1,
            boxShadow: canSubmit ? '0 6px 18px rgba(26,18,8,0.18)' : 'none',
          }}
        >
          {submitting
            ? 'Se trimite...'
            : `${hasSent ? 'Trimite și restul' : 'Trimite comanda'} · ${fmtPrice(cartTotal, currency)}`}
        </button>

        {/* CTA secundar — Plătește masa (cere nota; doar când există comenzi trimise) */}
        {onPayTable && (
          <button
            type="button"
            onClick={onPayTable}
            disabled={payDisabled}
            className={payDisabled ? '' : 'pressable'}
            style={{
              background: 'transparent',
              color: PUB.text,
              border: `1px solid ${PUB.borderStrong}`,
              borderRadius: 16,
              padding: '14px 0',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 15,
              fontWeight: 600,
              cursor: payDisabled ? 'default' : 'pointer',
              opacity: payDisabled ? 0.6 : 1,
            }}
          >
            {payLabel}
            {typeof tableTotal === 'number' ? ` · ${fmtPrice(tableTotal, currency)}` : ''}
          </button>
        )}

        {/* Split pe itemi — plătește doar partea ta (mig 229) */}
        {onPaySplit && !payDisabled && (
          <button
            type="button"
            onClick={onPaySplit}
            className="pressable"
            style={{
              background: 'transparent',
              color: PUB.text2,
              border: 'none',
              padding: '10px 0',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              minHeight: 44,
            }}
          >
            Împarte nota — plătește partea ta
          </button>
        )}
      </div>
    </div>
  )
}
