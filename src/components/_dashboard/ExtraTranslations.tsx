// Traducerile numelui unui extra, în fișa produsului (lotul O6c).
//
// Extra-urile se salvează PE LOC (adăugarea și ștergerea lor nu așteaptă
// „Salvează” al fișei), deci și traducerile lor: „Salvează traducerile” scrie
// rândul prin saveRowTranslations (re-citire, apoi scriere, 0 rânduri =
// refuz). Nu citește nimic la montare — datele vin din lista fișei. Ciorna
// nesalvată se raportează părintelui (`onDirtyChange`), ca închiderea fișei să
// ceară confirmare.
import { useEffect, useState } from 'react'
import { D } from '../../lib/constants'
import { MENU_LANGS, aiFieldsOf, applyManualEdit, type Translations } from '../../lib/i18nMenu'
import { saveRowTranslations } from '../../lib/menuTranslationsData'
import { toUserMessage } from '../../lib/userMessages'
import { Button } from '../ui/Button'
import { Inp } from './sharedUI'
import { AiReviewMark } from './ProductTranslations'

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export function ExtraTranslations({
  extra,
  langs,
  baseLang,
  onSaved,
  onDirtyChange,
  onToast,
}: {
  extra: { id: string; name: string; translations?: Translations | null }
  /** Limbile de traducere (active, fără bază). */
  langs: readonly string[]
  baseLang: string
  onSaved: (id: string, translations: Translations) => void
  /** Stabilă (useCallback în părinte): intră în dependențele efectului. */
  onDirtyChange: (id: string, dirty: boolean) => void
  onToast: (msg: string, type?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const stored = extra.translations ?? null
  const dirty = Object.entries(drafts).some(([code, v]) => v.trim() !== text(stored?.[code]?.name))

  useEffect(() => {
    onDirtyChange(extra.id, dirty)
    return () => onDirtyChange(extra.id, false)
  }, [extra.id, dirty, onDirtyChange])

  if (langs.length === 0) return null
  const done = langs.filter((code) => text(stored?.[code]?.name).length > 0).length

  async function save() {
    if (saving || !dirty) return
    setSaving(true)
    const edits = drafts
    try {
      const written = await saveRowTranslations('product_extras', extra.id, (fresh) =>
        Object.keys(edits).reduce<Translations>(
          (tr, code) => applyManualEdit(tr, code, { name: edits[code] }, baseLang),
          fresh,
        ),
      )
      onSaved(extra.id, written)
      setDrafts((d) => (d === edits ? {} : d))
      onToast('Traducerile extra-ului au fost salvate.')
    } catch (e) {
      onToast(toUserMessage(e, 'Traducerile extra-ului nu au fost salvate.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Traduceri {done}/{langs.length}
        </Button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '0.7rem', color: D.t3, lineHeight: 1.5 }}>
            Se salvează pe loc, separat de «Salvează».
          </div>
          {langs.map((code) => {
            const meta = MENU_LANGS.find((l) => l.code === code)
            const label = meta?.label ?? code.toUpperCase()
            const flagged = aiFieldsOf(stored?.[code]).includes('name') && !(code in drafts)
            return (
              <div key={code}>
                <label style={{ display: 'block', fontSize: '0.72rem', color: D.t2, marginBottom: 4 }}>
                  {meta?.flag} {label}
                </label>
                <Inp
                  label={`Nume în ${label} pentru «${extra.name}»`}
                  value={drafts[code] ?? stored?.[code]?.name ?? ''}
                  onChange={(v) => setDrafts((d) => ({ ...d, [code]: v }))}
                  placeholder={extra.name}
                />
                {flagged && <AiReviewMark />}
              </div>
            )
          })}
          <div>
            <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void save()}>
              Salvează traducerile
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
