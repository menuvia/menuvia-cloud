// Un rând din Meniu → Traduceri (lotul O6c): originalul (doar citire) și câte
// un câmp pe fiecare text cerut, în limba aleasă. Memo: primește primitive,
// obiecte STABILE (sursa, câmpurile, intrarea salvată, ciorna proprie) și
// callback-uri stabile, deci tastarea într-un rând nu re-randează lista.
import { memo } from 'react'
import { D } from '../../lib/constants'
import { aiFieldsOf, type TranslatedField, type TranslationEntry } from '../../lib/i18nMenu'
import type { TrSource } from '../../lib/menuTranslations'
import { Button } from '../ui/Button'
import { Inp, inp } from './sharedUI'
import { AiReviewMark } from './ProductTranslations'
import { FIELD_KEY } from '../../lib/translationMessages'
import { useT } from '../../i18n/useT'
import { commonNs } from '../../i18n/ns/common'
import { translationsNs } from '../../i18n/ns/translations'

type Draft = Partial<Record<TranslatedField, string>>

export const TranslationRow = memo(function TranslationRow({
  unitKey,
  lang,
  langLabel,
  kindLabel,
  context,
  source,
  fields,
  stored,
  draft,
  busy,
  error,
  saved,
  onChange,
  onSave,
  onConfirm,
}: {
  unitKey: string
  lang: string
  langLabel: string
  kindLabel: string
  /** Ex. „din grupul «Mărime»” (opțiuni). */
  context?: string
  source: TrSource
  fields: readonly TranslatedField[]
  /** Intrarea salvată pentru limba aleasă. */
  stored: TranslationEntry | undefined
  draft: Draft | undefined
  busy: boolean
  error: string | null
  saved: boolean
  onChange: (unitKey: string, lang: string, field: TranslatedField, value: string) => void
  onSave: (unitKey: string, lang: string) => void
  onConfirm: (unitKey: string, lang: string) => void
}) {
  const { t } = useT(translationsNs)
  const tc = useT(commonNs)
  const flagged = aiFieldsOf(stored)
  const review = fields.filter((f) => flagged.includes(f))
  const hasDraft = draft != null && Object.keys(draft).length > 0
  const inDraft = (f: TranslatedField) => draft != null && Object.prototype.hasOwnProperty.call(draft, f)
  const valueOf = (f: TranslatedField): string => (inDraft(f) ? (draft?.[f] ?? '') : (stored?.[f] ?? ''))
  const errorId = `${unitKey}-${lang}-err`

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (hasDraft && !busy) onSave(unitKey, lang)
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 14px',
        background: D.s2,
        border: `1px solid ${review.length > 0 ? D.amberBorder : D.border}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          alignItems: 'start',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.68rem', color: D.t3, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {kindLabel}
          </div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: D.t1, overflowWrap: 'anywhere' }}>
            {source.name}
          </div>
          {source.meta_text && (
            <div style={{ fontSize: '0.78rem', color: D.t2, marginTop: 2 }}>{source.meta_text}</div>
          )}
          {source.description && (
            <div style={{ fontSize: '0.78rem', color: D.t2, marginTop: 2, lineHeight: 1.45 }}>
              {source.description}
            </div>
          )}
          {context && <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 4 }}>{context}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          {fields.map((f) => {
            const fieldLabel = t(FIELD_KEY[f])
            const label = t('fieldAria', { field: fieldLabel, lang: langLabel, name: source.name })
            const original =
              (f === 'name' ? source.name : f === 'description' ? source.description : source.meta_text) ?? ''
            return (
              <div key={f}>
                <div style={{ fontSize: '0.7rem', color: D.t3, marginBottom: 3 }}>
                  {t('fieldIn', { field: fieldLabel, lang: langLabel })}
                </div>
                {f === 'name' ? (
                  <Inp
                    label={label}
                    value={valueOf(f)}
                    onChange={(v) => onChange(unitKey, lang, f, v)}
                    placeholder={original}
                    describedBy={error ? errorId : undefined}
                  />
                ) : (
                  <textarea
                    aria-label={label}
                    value={valueOf(f)}
                    onChange={(e) => onChange(unitKey, lang, f, e.target.value)}
                    placeholder={original}
                    rows={2}
                    style={{ ...inp, height: 'auto', resize: 'vertical' }}
                  />
                )}
                {review.includes(f) && !inDraft(f) && <AiReviewMark />}
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        {saved && !hasDraft && (
          <span style={{ fontSize: '0.78rem', color: D.greenText, fontWeight: 600 }}>{t('row_saved')}</span>
        )}
        {hasDraft && (
          <Button type="submit" size="sm" loading={busy}>
            {tc.t('save')}
          </Button>
        )}
        {!hasDraft && review.length > 0 && (
          <Button variant="secondary" size="sm" loading={busy} onClick={() => onConfirm(unitKey, lang)}>
            {t('row_confirm')}
          </Button>
        )}
      </div>
      {error && (
        <div id={errorId} role="alert" style={{ fontSize: '0.78rem', color: D.redText }}>
          {error}
        </div>
      )}
    </form>
  )
})
