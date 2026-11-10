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
import { Button } from '../ui/Button'
import { useT } from '../../i18n/useT'
import { productsNs } from '../../i18n/ns/products'

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
  // Fără handler = acțiunea nu e disponibilă rolului (partenerul, fondatorul în
  // vizită: AI-ul cere membership real) → butonul nu se randează deloc.
  onImportPhoto?: () => void
  onImportCsv: () => void
  onBulkAi?: () => void
}) {
  const { t } = useT(productsNs)
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

  // Pe telefon butoanele se strâng (padding mai mic), dar rămân <Button>.
  const compact: CSSProperties | undefined = mobile ? { padding: '0 10px' } : undefined

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
    fontFamily: D.fontBody,
    textAlign: 'left',
    cursor: 'pointer',
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {onBulkAi && (
      <Button
        variant="secondary"
        onClick={onBulkAi}
        aria-label={t('toolbar_bulkAiAria')}
        title={t('toolbar_bulkAiTitle')}
        icon={<Icon name="sparkle" size={16} color={D.gold} />}
        style={compact}
      >
        {mobile ? t('toolbar_bulkAiShort') : t('toolbar_bulkAi')}
      </Button>
      )}

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
        <Button
          ref={triggerRef}
          variant="secondary"
          aria-expanded={importOpen}
          aria-controls={menuId}
          onClick={() => setImportOpen((o) => !o)}
          icon={<Icon name="download" size={16} />}
          style={compact}
        >
          {t('toolbar_import')}
          <Icon name="chevronDown" size={14} color={D.t2} />
        </Button>
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
              boxShadow: D.shadowLg,
              padding: 6,
            }}
          >
            {onImportPhoto && (
              <button type="button" style={menuItem} onClick={() => choose(onImportPhoto)}>
                <Icon name="camera" size={16} color={D.t2} />
                {t('toolbar_importPhoto')}
              </button>
            )}
            <button type="button" style={menuItem} onClick={() => choose(onImportCsv)}>
              <Icon name="download" size={16} color={D.t2} />
              {t('toolbar_importCsv')}
            </button>
          </div>
        )}
      </div>

      <Button
        variant={canAdd ? 'primary' : 'secondary'}
        onClick={canAdd ? onAdd : onUpgrade}
        icon={canAdd ? undefined : <Icon name="lock" size={16} />}
        style={compact}
      >
        {canAdd ? t('toolbar_add') : t('toolbar_limit')}
      </Button>
    </div>
  )
}

export default ProductsToolbar
