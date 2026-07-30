// =============================================================
// Menuvia — src/components/ModifierSheet.tsx
// Bottom sheet pentru selecție modificatori + cantitate + note.
// Reutilizat de WaiterEntry + EditOrderSheet.
// =============================================================

import { useEffect, useRef, useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import type { CartItem } from '../lib/orders'
import type { Product } from '../lib/qr'
import { modifierGroupMin, modifierGroupHint } from '../lib/qr'
import { D } from '../lib/constants'

type SingleSelection = string | null
type MultiSelection = Set<string>
type Selections = Record<string, SingleSelection | MultiSelection>

function isSingleSel(val: SingleSelection | MultiSelection): val is SingleSelection {
  return !(val instanceof Set)
}

export interface ModifierSheetProps {
  product: Product
  onAdd: (item: CartItem) => void
  onClose: () => void
  initialQty?: number
  initialNotes?: string
  initialSelections?: { group_id: string; option_id: string }[]
  submitLabel?: string
}

export default function ModifierSheet({
  product,
  onAdd,
  onClose,
  initialQty = 1,
  initialNotes = '',
  initialSelections = [],
  submitLabel,
}: ModifierSheetProps) {
  const groups = product.modifier_groups

  useBodyScrollLock(true)
  const [selections, setSelections] = useState<Selections>(() => {
    const init: Selections = {}
    for (const g of groups) {
      const optsForGroup = initialSelections
        .filter((s) => s.group_id === g.id)
        // Excludem opțiunile devenite indisponibile: nu le prețuim/trimitem
        // și nu ocupă slot din min/max (serverul le respinge oricum).
        .filter((s) => g.modifier_options.some((o) => o.id === s.option_id && o.is_available))
        .map((s) => s.option_id)
      if (g.selection_type === 'single') {
        init[g.id] = optsForGroup[0] ?? null
      } else {
        init[g.id] = new Set(optsForGroup)
      }
    }
    return init
  })
  const [qty, setQty] = useState(initialQty)
  const [notes, setNotes] = useState(initialNotes)
  const panelRef = useRef<HTMLDivElement>(null)

  // Semantică de dialog modal (paritate cu ProductSheet): focus în panou la
  // deschidere, restaurare la închidere + Escape → onClose (screen reader-ul
  // anunță dialogul; tastatura nu rămâne blocată pe fundal).
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      prev?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Numărul de opțiuni selectate ȘI încă disponibile dintr-un grup multiplu.
  // O opțiune devenită indisponibilă NU trebuie să conteze la min/max.
  function availableSelectedCount(g: (typeof groups)[number], sel: MultiSelection): number {
    return g.modifier_options.filter((o) => o.is_available && sel.has(o.id)).length
  }

  const canAdd = groups
    .filter((g) => modifierGroupMin(g) > 0)
    .every((g) => {
      // Paritate cu serverul (mig 191): grupurile cu minim efectiv > 0 —
      // is_required SAU min_select > 0 (coloane independente în schemă, mig 002)
      // — cer cel puțin `modifierGroupMin(g)` opțiuni; serverul respinge și el
      // sub minim (hint 'missing_required_group'), aici doar oglindim ca UX.
      const sel = selections[g.id]
      if (sel == null) return false
      if (sel instanceof Set) {
        return availableSelectedCount(g, sel) >= modifierGroupMin(g)
      }
      // Single: valid doar dacă opțiunea selectată e încă disponibilă.
      return g.modifier_options.some((o) => o.id === sel && o.is_available)
    })

  function modDelta(): number {
    return groups.reduce((sum, g) => {
      const sel = selections[g.id]
      if (sel == null) return sum
      if (g.selection_type === 'single' && isSingleSel(sel)) {
        // Prețuim doar dacă opțiunea e încă disponibilă.
        const opt = g.modifier_options.find((o) => o.id === sel && o.is_available)
        return sum + (opt?.price_delta ?? 0)
      }
      if (sel instanceof Set) {
        return (
          sum +
          g.modifier_options
            .filter((o) => o.is_available && sel.has(o.id))
            .reduce((s, o) => s + o.price_delta, 0)
        )
      }
      return sum
    }, 0)
  }

  function buildSelectedModifiers(): CartItem['selected_modifiers'] {
    return groups.flatMap((g) => {
      const sel = selections[g.id]
      if (sel == null) return []
      if (g.selection_type === 'single' && isSingleSel(sel)) {
        // Trimitem doar opțiuni disponibile (serverul le respinge oricum).
        const opt = g.modifier_options.find((o) => o.id === sel && o.is_available)
        if (opt == null) return []
        return [
          {
            group_id: g.id,
            group_name: g.name,
            option_id: opt.id,
            option_name: opt.name,
            price_delta: opt.price_delta,
          },
        ]
      }
      if (sel instanceof Set) {
        return g.modifier_options
          .filter((o) => o.is_available && sel.has(o.id))
          .map((o) => ({
            group_id: g.id,
            group_name: g.name,
            option_id: o.id,
            option_name: o.name,
            price_delta: o.price_delta,
          }))
      }
      return []
    })
  }

  function toggleSingle(gid: string, oid: string): void {
    setSelections((prev) => ({ ...prev, [gid]: oid }))
  }

  function toggleMultiple(gid: string, oid: string): void {
    const group = groups.find((g) => g.id === gid)
    const maxSelect = group?.max_select ?? null
    setSelections((prev) => {
      const existing = prev[gid]
      const s = existing instanceof Set ? new Set(existing) : new Set<string>()
      if (s.has(oid)) {
        // Deselectarea e mereu permisă.
        s.delete(oid)
      } else {
        // max_select client-side (paritate cu mig 145 care respinge întreaga
        // comandă la depășire). La atingerea plafonului blocăm adăugarea —
        // opțiunile la cap sunt oricum dezactivate vizual mai jos.
        if (maxSelect != null && s.size >= maxSelect) return prev
        s.add(oid)
      }
      return { ...prev, [gid]: s }
    })
  }

  const unitTotal = product.price + modDelta()
  const labelDefault = `Adaugă în comandă — ${(unitTotal * qty).toFixed(2)} lei`

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 300,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={product.name}
        tabIndex={-1}
        style={{
          background: D.s2,
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          maxHeight: '85vh',
          overflowY: 'auto',
          outline: 'none',
        }}
      >
        <div
          style={{ width: 40, height: 4, borderRadius: 2, background: D.s3, margin: '12px auto 0' }}
        />

        <div
          style={{ padding: '16px 20px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <div
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 20,
              fontWeight: 700,
              color: D.t1,
            }}
          >
            {product.name}
          </div>
          <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, color: D.gold }}>
            {unitTotal.toFixed(2)} lei
          </div>

          {groups.map((g) => {
            const sel = selections[g.id]
            // Nu randăm opțiuni indisponibile (serverul le respinge oricum).
            const availableOptions = g.modifier_options.filter((o) => o.is_available)
            // Plafon atins pe grup multiplu → dezactivăm opțiunile neselectate.
            // Numărăm doar opțiunile disponibile (cele indisponibile nu ocupă slot).
            const multiCount = sel instanceof Set ? availableSelectedCount(g, sel) : 0
            const atMax =
              g.selection_type === 'multiple' &&
              g.max_select != null &&
              multiCount >= g.max_select
            const hint = modifierGroupHint(g)
            return (
              <div key={g.id}>
                <div
                  style={{ fontSize: 13, fontWeight: 600, color: D.t2, marginBottom: hint ? 2 : 8 }}
                >
                  {g.name}
                  {modifierGroupMin(g) > 0 && <span style={{ color: D.red }}> *</span>}
                </div>
                {/* Microcopy min/max sub titlul grupului („Alege între…" etc.). */}
                {hint && (
                  <div style={{ fontSize: 12, fontWeight: 400, color: D.t3, marginBottom: 8 }}>
                    {hint}
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {availableOptions.map((opt) => {
                    const isSelected =
                      g.selection_type === 'single'
                        ? isSingleSel(sel) && sel === opt.id
                        : sel instanceof Set && sel.has(opt.id)
                    // Blocăm opțiunile neselectate când grupul e la cap.
                    const isDisabled = atMax && !isSelected
                    return (
                      <button
                        key={opt.id}
                        disabled={isDisabled}
                        role={g.selection_type === 'single' ? 'radio' : undefined}
                        aria-checked={g.selection_type === 'single' ? isSelected : undefined}
                        aria-pressed={g.selection_type === 'single' ? undefined : isSelected}
                        onClick={() =>
                          g.selection_type === 'single'
                            ? toggleSingle(g.id, opt.id)
                            : toggleMultiple(g.id, opt.id)
                        }
                        style={{
                          background: isSelected ? D.goldA : D.s3,
                          border: `1px solid ${isSelected ? D.gold : D.s3}`,
                          borderRadius: 20,
                          padding: '6px 14px',
                          color: isSelected ? D.gold : D.t2,
                          fontFamily: 'DM Sans, sans-serif',
                          fontSize: 13,
                          cursor: isDisabled ? 'not-allowed' : 'pointer',
                          opacity: isDisabled ? 0.4 : 1,
                        }}
                      >
                        {opt.name}
                        {opt.price_delta > 0 ? ` +${opt.price_delta}` : ''}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Quantity stepper */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ color: D.t2, fontSize: 13 }}>Cantitate</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: D.s3,
                  border: 'none',
                  color: D.t1,
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                −
              </button>
              <span style={{ color: D.t1, fontWeight: 600, minWidth: 20, textAlign: 'center' }}>
                {qty}
              </span>
              <button
                onClick={() => setQty((q) => q + 1)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: D.s3,
                  border: 'none',
                  color: D.t1,
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                +
              </button>
            </div>
          </div>

          <textarea
            placeholder="Mențiuni (opțional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{
              background: D.s3,
              border: `1px solid ${D.s3}`,
              borderRadius: 8,
              color: D.t1,
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              padding: '10px 12px',
              resize: 'none',
            }}
          />

          <button
            disabled={!canAdd}
            onClick={() => {
              const selectedMods = buildSelectedModifiers()
              onAdd({
                _key: crypto.randomUUID(),
                product_id: product.id,
                product_name_snapshot: product.name,
                unit_price_snapshot: product.price,
                quantity: qty,
                selected_modifiers: selectedMods,
                notes: notes.length > 0 ? notes : null,
              })
              onClose()
            }}
            style={{
              background: canAdd ? D.gold : D.s3,
              color: canAdd ? D.bg : D.t3,
              border: 'none',
              borderRadius: 8,
              padding: '12px 0',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 15,
              fontWeight: 700,
              cursor: canAdd ? 'pointer' : 'not-allowed',
            }}
          >
            {submitLabel ?? labelDefault}
          </button>
        </div>
      </div>
    </div>
  )
}
