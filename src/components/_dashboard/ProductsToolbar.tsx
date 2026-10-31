// Antetul filei Produse (audit UX oct 2026). Înainte: PATRU butoane de
// adăugare una lângă alta („AI", „Poză", „CSV", „+ Adaugă") plus încă două în
// starea goală — pe telefon un rând de etichete criptice, fără o acțiune
// principală clară. Acum:
//   - „+ Adaugă produs" e singura acțiune principală;
//   - importurile (din poză cu AI / din fișier CSV) stau sub UN buton „Importă"
//     (disclosure: aria-expanded + aria-controls; Escape și click în afară
//     închid, focusul revine pe buton);
//   - „Generează AI" (imagini + nutriție pentru produsele EXISTENTE) rămâne,
//     dar ProductsTab nu randează antetul deloc pe un catalog gol — acolo
//     starea goală are acțiunile ei, iar generarea n-ar avea pe ce lucra.
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { D } from '../../lib/constants'
import { Icon } from '../ui/Icon'
import { btn } from './sharedUI'

export function ProductsToolbar({
  mobile,
  canAdd,
  onAdd,
  onUpgrade,
  onImportPhoto,
  onImportCsv,
  onBulkAi,
}: {
  mobile: boolean
  canAdd: boolean
  onAdd: () => void
  onUpgrade: () => void
  onImportPhoto: () => void
  onImportCsv: () => void
  onBulkAi: () => void
}) {
  const [importOpen, setImportOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  // Click în afara meniului îl închide (fără să mute focusul: utilizatorul a
  // ales deja altceva cu mouse-ul / degetul).
  useEffect(() => {
    if (!importOpen) return
    const onPointer = (e: MouseEvent) => {
      const wrap = wrapRef.current
      if (wrap && e.target instanceof Node && !wrap.contains(e.target)) setImportOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [importOpen])

  function closeImport(refocus: boolean): void {
    setImportOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  function choose(action: () => void): void {
    setImportOpen(false)
    action()
  }

  const secondary = (extra: CSSProperties = {}): CSSProperties =>
    btn({
      background: D.s2,
      color: D.t1,
      border: `1px solid ${D.border}`,
      height: 44,
      fontSize: mobile ? '0.78rem' : '0.85rem',
      padding: mobile ? '0 10px' : '0 14px',
      gap: 6,
      ...extra,
    })

  const menuItem: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    minHeight: 44,
    padding: '10px 14px',
    background: 'transparent',
    border: 'none',
    color: D.t1,
    fontSize: '0.85rem',
    fontFamily: 'DM Sans,sans-serif',
    textAlign: 'left',
    cursor: 'pointer',
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={onBulkAi}
        aria-label="Generează AI pentru tot meniul (imagini și nutriție)"
        title="Generează imagini + nutriție cu AI pentru tot meniul"
        style={secondary({ background: D.s2, color: D.gold, border: `1px solid ${D.gold}55` })}
      >
        <Icon name="sparkle" size={16} />
        {mobile ? 'AI' : 'Generează AI'}
      </button>

      <div
        ref={wrapRef}
        style={{ position: 'relative' }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && importOpen) {
            // Escape-ul închide DOAR meniul (nu și un dialog de deasupra).
            e.preventDefault()
            e.stopPropagation()
            closeImport(true)
          }
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={importOpen}
          aria-controls={menuId}
          onClick={() => setImportOpen((o) => !o)}
          style={secondary()}
        >
          <Icon name="download" size={16} />
          Importă
          <span aria-hidden="true" style={{ fontSize: '0.7rem', color: D.t2 }}>
            ▾
          </span>
        </button>
        {importOpen && (
          <div
            id={menuId}
            // Ancorat la marginea STÂNGĂ a butonului. Pe telefon antetul se
            // rupe pe două rânduri și bara ajunge lipită de marginea stângă:
            // „Importă" e al doilea buton (dreapta lui la ~180 px), deci un
            // meniu de 220 px aliniat la dreapta lui ieșea ~40 px în afara
            // containerului cu scroll (overflow: auto) și pierdea iconițele și
            // primele litere. La stânga e mereu loc: în dreapta lui „Importă"
            // stă „+ Adaugă produs", iar împreună depășesc lățimea meniului.
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              zIndex: 20,
              minWidth: 220,
              background: D.s2,
              border: `1px solid ${D.bHov}`,
              borderRadius: 12,
              boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
              padding: 6,
            }}
          >
            <button type="button" style={menuItem} onClick={() => choose(onImportPhoto)}>
              <Icon name="camera" size={16} color={D.t2} />
              Din poză (AI)
            </button>
            <button type="button" style={menuItem} onClick={() => choose(onImportCsv)}>
              <Icon name="download" size={16} color={D.t2} />
              Din fișier CSV
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={canAdd ? onAdd : onUpgrade}
        style={btn({
          background: canAdd ? D.gold : D.s3,
          color: canAdd ? '#000' : D.t2,
          border: canAdd ? 'none' : `1px solid ${D.border}`,
          height: 44,
          fontSize: mobile ? '0.82rem' : '0.9rem',
          gap: 6,
        })}
      >
        {canAdd ? (
          '+ Adaugă produs'
        ) : (
          <>
            <Icon name="lock" size={16} />
            Limită atinsă — Upgrade
          </>
        )}
      </button>
    </div>
  )
}

export default ProductsToolbar
