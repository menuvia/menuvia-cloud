// Secțiunea „Traduceri” din fișa produsului (ProductModal, ProductsTab).
//
// Scrie DOAR în formular (`form.translations`); nimic nu pleacă în bază până la
// „Salvează” al fișei. Lotul O6c:
//   - „✨ Tradu automat” = UN apel AI pentru limbile cu goluri, apoi
//     fill-only-gaps (mergeAiTranslations) peste formularul CURENT — ce a
//     tastat omul rămâne, iar câmpurile completate primesc marcajul „de
//     verificat” (`ai_fields`);
//   - tastarea într-un câmp marcat îi scoate marcajul (setTranslationValue);
//   - „Am verificat” scoate marcajele unei limbi fără să schimbe textul.
// Importă din lib/ai DOAR aiTranslateBatch: suitele ProductsTab mock-uiesc
// modulul cu exact cinci exporturi.
import { useRef, useState } from 'react'
import { D } from '../../lib/constants'
import { aiTranslateBatch } from '../../lib/ai'
import {
  MENU_LANGS,
  aiFieldsOf,
  markTranslationReviewed,
  mergeAiTranslations,
  setTranslationValue,
  type TranslatedField,
  type Translations,
} from '../../lib/i18nMenu'
import { roCount } from '../../lib/menuTranslations'
import { toUserMessage } from '../../lib/userMessages'
import { Button } from '../ui/Button'
import { Inp, inp } from './sharedUI'

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export function AiReviewMark() {
  return (
    <span
      style={{
        display: 'inline-block',
        marginTop: 4,
        fontSize: '0.7rem',
        fontWeight: 600,
        color: D.amber,
        background: D.amberA,
        border: `1px solid ${D.amberBorder}`,
        borderRadius: 4,
        padding: '1px 6px',
      }}
    >
      ✨ tradus automat — verifică
    </span>
  )
}

export function ProductTranslations({
  restaurantId,
  name,
  description,
  translations,
  onChange,
  langs,
  baseLang,
  canTranslateAi,
  onToast,
}: {
  restaurantId: string
  /** Originalul (limba de bază), din formular. */
  name: string
  description: string
  translations: Translations | null | undefined
  /** Actualizare FUNCȚIONALĂ peste formularul curent (nu peste o copie veche). */
  onChange: (update: (prev: Translations | null | undefined) => Translations) => void
  /** Limbile de traducere (active, fără bază). */
  langs: readonly string[]
  baseLang: string
  /** AI de meniu (`canUseAiMenu`: owner/manager sau partenerul cu acces). */
  canTranslateAi: boolean
  onToast: (msg: string, type?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Formularul cel mai nou (după `await`): traducerea AI se aplică peste ce a
  // tastat omul între timp, nu peste instantaneul de la click.
  const latestRef = useRef(translations)
  latestRef.current = translations

  if (langs.length === 0) return null

  const baseLabel = MENU_LANGS.find((l) => l.code === baseLang)?.label ?? baseLang
  const descTrim = description.trim()
  const fields: Partial<Record<TranslatedField, boolean>> = { name: true, description: descTrim.length > 0 }
  const translatedCount = langs.filter(
    (code) => text(translations?.[code]?.name).length > 0 || text(translations?.[code]?.description).length > 0,
  ).length
  const reviewCount = langs.reduce((n, code) => n + aiFieldsOf(translations?.[code]).length, 0)
  const gapLangs = langs.filter(
    (code) =>
      text(translations?.[code]?.name).length === 0 ||
      (descTrim.length > 0 && text(translations?.[code]?.description).length === 0),
  )

  async function autoTranslate() {
    if (busy || gapLangs.length === 0 || !name.trim()) return
    setBusy(true)
    try {
      const map = await aiTranslateBatch({
        restaurant_id: restaurantId,
        items: [{ id: 'p', name: name.trim(), description: descTrim || null }],
        targetLangs: gapLangs,
        sourceLang: baseLang,
      })
      const ai = map.p ?? {}
      const opts = { langs: gapLangs, base: baseLang, fields }
      const { filled } = mergeAiTranslations(latestRef.current, ai, opts)
      if (filled === 0) {
        onToast('Nu am primit traduceri noi. Reîncearcă.', 'error')
        return
      }
      onChange((prev) => mergeAiTranslations(prev, ai, opts).translations)
      onToast(`Am completat ${roCount(filled, 'câmp', 'câmpuri')} — verifică-le, apoi Salvează.`)
    } catch (e) {
      onToast(toUserMessage(e, 'Traducerea automată nu a reușit. Reîncearcă.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ borderTop: `1px solid ${D.border}`, paddingTop: 14, marginTop: 8 }}>
      <Button
        variant="ghost"
        onClick={() => setOpen((s) => !s)}
        aria-expanded={open}
        style={{ width: '100%', justifyContent: 'space-between', paddingLeft: 0, paddingRight: 0 }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: D.t2, fontWeight: 600 }}>
          <span
            aria-hidden="true"
            style={{
              transform: open ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s',
              display: 'inline-block',
            }}
          >
            ▸
          </span>
          <span>Traduceri</span>
          <span style={{ fontSize: '0.7rem', color: D.t3, fontWeight: 400 }}>(opțional)</span>
        </span>
        <span style={{ fontSize: '0.7rem', color: D.t3, fontWeight: 400 }}>
          {translatedCount}/{langs.length} limbi
          {reviewCount > 0 ? ` · ${reviewCount} de verificat` : ''}
        </span>
      </Button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 14 }}>
          <div style={{ fontSize: '0.72rem', color: D.t3, lineHeight: 1.5 }}>
            Numele și descrierea în alte limbi. Originalul de sus ({baseLabel}) rămâne baza —
            câmpurile lăsate goale afișează automat originalul.
          </div>
          {canTranslateAi && name.trim().length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                disabled={gapLangs.length === 0}
                onClick={() => void autoTranslate()}
              >
                ✨ Tradu automat
              </Button>
              <span style={{ fontSize: '0.72rem', color: D.t3 }}>
                {gapLangs.length === 0
                  ? 'Toate limbile au deja nume și descriere.'
                  : 'Completează doar câmpurile goale; textul tău rămâne.'}
              </span>
            </div>
          )}
          {langs.map((code) => {
            const meta = MENU_LANGS.find((l) => l.code === code)
            const label = meta?.label ?? code.toUpperCase()
            const entry = translations?.[code] ?? {}
            const flagged = aiFieldsOf(entry)
            return (
              <div
                key={code}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: '12px 14px',
                  background: D.s3,
                  borderRadius: 9,
                  border: `1px solid ${D.border}`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: D.t1 }}>
                    {meta?.flag} {label}
                  </span>
                  {flagged.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onChange((prev) => markTranslationReviewed(prev, code))}
                    >
                      Am verificat
                    </Button>
                  )}
                </div>
                <div>
                  <label
                    style={{ display: 'block', fontSize: '0.74rem', color: D.t2, marginBottom: 5 }}
                  >
                    Nume ({label})
                  </label>
                  <Inp
                    label={`Nume (${label})`}
                    value={entry.name ?? ''}
                    onChange={(v) => onChange((prev) => setTranslationValue(prev, code, 'name', v))}
                    placeholder={name || 'Nume produs'}
                  />
                  {flagged.includes('name') && <AiReviewMark />}
                </div>
                <div>
                  <label
                    style={{ display: 'block', fontSize: '0.74rem', color: D.t2, marginBottom: 5 }}
                  >
                    Descriere ({label})
                  </label>
                  <textarea
                    aria-label={`Descriere (${label})`}
                    value={entry.description ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      onChange((prev) => setTranslationValue(prev, code, 'description', v))
                    }}
                    placeholder={description || 'Descriere produs'}
                    rows={2}
                    style={{ ...inp, height: 'auto', resize: 'vertical' }}
                  />
                  {flagged.includes('description') && <AiReviewMark />}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
