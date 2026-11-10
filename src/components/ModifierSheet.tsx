// =============================================================
// Menuvia — src/components/ModifierSheet.tsx
// Bottom sheet pentru selecție modificatori + cantitate + note.
// Reutilizat de WaiterEntry + EditOrderSheet.
// =============================================================

import { useEffect, useRef, useState } from 'react'
import { FocusTrap } from './ui/FocusTrap'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { MAX_ITEM_NOTE, MAX_LINE_QTY, type CartItem, type OrdersTranslator } from '../lib/orders'
import type { ModifierGroup, Product } from '../lib/qr'
import { modifierGroupMin } from '../lib/qr'
import { D } from '../lib/constants'
import { useT } from '../i18n/useT'
import { ordersNs } from '../i18n/ns/orders'
import {
  availableOptions as groupAvailableOptions,
  buildSelectedModifiers as buildFromSelections,
  groupMax,
  initialSelections as seedSelections,
  isMultiSelection,
  missingGroups,
  selectedCount,
  selectionDelta,
  selectionsComplete,
  toggleOption,
  type OptionSelections,
} from '../lib/optionSelection'

// Regulile de selecție vin din motorul comun, ca la oaspete (lotul O4b).
type Selections = OptionSelections

// Microcopy-ul min/max al unui grup, în limba personalului — aceeași regulă ca
// `modifierGroupHint` (lib/qr, păstrat ca oracol românesc pentru GK5): doar pe
// grupurile multiple, minimul efectiv din `modifierGroupMin`.
function groupHint(
  g: Pick<ModifierGroup, 'selection_type' | 'is_required' | 'min_select' | 'max_select'>,
  t: OrdersTranslator['t'],
): string | null {
  if (g.selection_type !== 'multiple') return null
  const min = modifierGroupMin(g)
  const max = g.max_select
  if (min > 0 && max != null) {
    return min === max ? t('mod_chooseExact', { n: min }) : t('mod_chooseBetween', { min, max })
  }
  if (min > 0) return t('mod_chooseAtLeast', { n: min })
  if (max != null) return t('mod_max', { n: max })
  return null
}

export interface ModifierSheetProps {
  product: Product
  onAdd: (item: CartItem) => void
  onClose: () => void
  initialQty?: number
  initialNotes?: string
  initialSelections?: { group_id: string; option_id: string }[]
  submitLabel?: string
  // Extra-urile plătite ale produsului (lotul O2b, STAFF-OPT-8): ospătarul nu le
  // putea adăuga deloc — „burger cu bacon" ajungea doar ca notă, gătit dar
  // neîncasat. Doar unde apelantul chiar le trimite la server (comanda nouă);
  // editarea comenzii le primește odată cu lotul O3.
  allowExtras?: boolean
}

export default function ModifierSheet({
  product,
  onAdd,
  onClose,
  initialQty = 1,
  initialNotes = '',
  initialSelections = [],
  submitLabel,
  allowExtras = false,
}: ModifierSheetProps) {
  const { t } = useT(ordersNs)
  const groups = product.modifier_groups
  const availableExtras = allowExtras
    ? (product.extras ?? []).filter((e) => e.is_available !== false)
    : []
  const [extraIds, setExtraIds] = useState<ReadonlySet<string>>(() => new Set())
  const chosenExtras = availableExtras.filter((e) => extraIds.has(e.id))
  function toggleExtra(id: string): void {
    setExtraIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useBodyScrollLock(true)
  // Pornim doar cu opțiunile încă disponibile: cele devenite indisponibile nu
  // se prețuiesc, nu se trimit și nu ocupă slot din min/max (serverul le
  // respinge oricum).
  const [selections, setSelections] = useState<Selections>(() =>
    seedSelections(groups, initialSelections),
  )
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

  // Paritate cu serverul (mig 191): fiecare grup între minimul efectiv
  // (is_required SAU min_select > 0) și maxim; contează doar opțiunile care
  // există și sunt disponibile.
  const canAdd = selectionsComplete(groups, selections)
  const firstMissing = missingGroups(groups, selections)[0] ?? null

  function modDelta(): number {
    return selectionDelta(groups, selections)
  }

  function buildSelectedModifiers(): CartItem['selected_modifiers'] {
    return buildFromSelections(groups, selections)
  }

  // Single: alege; a doua atingere deselectează DOAR pe un grup opțional.
  // Multiple: bifează/debifează, fără să treacă de maxim (mig 145).
  function toggle(g: (typeof groups)[number], oid: string): void {
    setSelections((prev) => toggleOption(g, prev, oid))
  }

  const unitTotal = product.price + modDelta() + chosenExtras.reduce((s, e) => s + e.price, 0)
  const labelDefault = t('mod_addToOrder', { amount: (unitTotal * qty).toFixed(2) })

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
        <FocusTrap />
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
            {t('money', { amount: unitTotal.toFixed(2) })}
          </div>

          {groups.map((g) => {
            const sel = selections[g.id]
            // Nu randăm opțiuni indisponibile (serverul le respinge oricum).
            const availableOptions = groupAvailableOptions(g)
            // Plafon atins pe grup multiplu → dezactivăm opțiunile neselectate.
            // Numărăm doar opțiunile disponibile (cele indisponibile nu ocupă slot).
            const max = groupMax(g)
            const atMax =
              g.selection_type === 'multiple' && max != null && selectedCount(g, selections) >= max
            const hint = groupHint(g, t)
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
                        ? !isMultiSelection(sel) && sel === opt.id
                        : isMultiSelection(sel) && sel.has(opt.id)
                    // Blocăm opțiunile neselectate când grupul e la cap.
                    const isDisabled = atMax && !isSelected
                    return (
                      <button
                        key={opt.id}
                        disabled={isDisabled}
                        role={g.selection_type === 'single' ? 'radio' : undefined}
                        aria-checked={g.selection_type === 'single' ? isSelected : undefined}
                        aria-pressed={g.selection_type === 'single' ? undefined : isSelected}
                        onClick={() => toggle(g, opt.id)}
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
                        {opt.price_delta !== 0
                          ? ` ${opt.price_delta > 0 ? '+' : '−'}${Math.abs(opt.price_delta)}`
                          : ''}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {availableExtras.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: D.t2, marginBottom: 8 }}>
                {t('mod_extras')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {availableExtras.map((ex) => {
                  const on = extraIds.has(ex.id)
                  return (
                    <button
                      key={ex.id}
                      aria-pressed={on}
                      onClick={() => toggleExtra(ex.id)}
                      style={{
                        background: on ? D.goldA : D.s3,
                        border: `1px solid ${on ? D.gold : D.s3}`,
                        borderRadius: 20,
                        padding: '6px 14px',
                        color: on ? D.gold : D.t2,
                        fontFamily: 'DM Sans, sans-serif',
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      {ex.emoji ? `${ex.emoji} ` : ''}
                      {ex.name}
                      {ex.price > 0 ? ` +${ex.price}` : ''}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Quantity stepper */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ color: D.t2, fontSize: 13 }}>{t('mod_quantity')}</span>
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
                onClick={() => setQty((q) => Math.min(MAX_LINE_QTY, q + 1))}
                disabled={qty >= MAX_LINE_QTY}
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
            placeholder={t('mod_notesPlaceholder')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={MAX_ITEM_NOTE}
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

          {/* Ce mai trebuie ales, cu numele grupului (lotul O4b) — butonul blocat
              singur nu spunea de ce. */}
          {!canAdd && firstMissing && (
            <div role="status" style={{ fontSize: 12, color: D.amber, marginBottom: -8 }}>
              {t('mod_missing', { group: firstMissing.name })}
            </div>
          )}
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
                // `notes || null` = `notes.length > 0 ? notes : null` (un șir gol
                // e fals); fără `>` aici, scanerul SK5 nu mai ia codul drept text JSX.
                notes: notes || null,
                ...(chosenExtras.length === 0
                  ? {}
                  : {
                      selected_extras: chosenExtras.map((e) => ({
                        id: e.id,
                        name: e.name,
                        price: e.price,
                      })),
                    }),
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
