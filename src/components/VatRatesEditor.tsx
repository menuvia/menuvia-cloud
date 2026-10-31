// ─────────────────────────────────────────────────────────────
// VatRatesEditor — Editor pentru cele 4 cote TVA per restaurant
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { D } from '../lib/constants'
import { useToast } from './ui/useToast'
import { fetchVatRates, updateVatRate } from '../lib/vat'
import type { VatRate } from '../lib/vat'
import { confirm as confirmDialog } from './ui/confirm'
import { VAT_PRESETS, applyVatPreset, describeVatPresetError } from '../lib/quickSetup'

// Presetul legal (L.141/2025) — aceeași sursă ca serverul (`vat_rate_defaults_ro`,
// mig 285; QS3 leagă preview-ul de SQL). A stat în „asistentul detaliat" de pe
// Acasă, care a fost scos (dubla checklist-ul); locul lui firesc e lângă cote.
const LEGAL_PRESET = VAT_PRESETS[0]
const LEGAL_RATES_TEXT = LEGAL_PRESET.rates.map((r) => `grupa ${r.group}: ${r.rate}%`).join(', ')

interface Props {
  restaurantId: string
}

// Construiește intrarea din harta de editare pornind de la o cotă existentă.
// Folosit la încărcarea inițială și la „Anulează" (reset la valorile salvate).
const toEditForm = (r: VatRate) => ({
  rate_percent: String(r.rate_percent),
  label: r.label,
  description: r.description ?? '',
})

export default function VatRatesEditor({ restaurantId }: Props) {
  const toast = useToast()
  const [rates, setRates] = useState<VatRate[]>([])
  const [loading, setLoading] = useState(true)
  const [savingGroup, setSavingGroup] = useState<number | null>(null)
  const [applyingPreset, setApplyingPreset] = useState(false)
  const [editing, setEditing] = useState<
    Map<number, { rate_percent: string; label: string; description: string }>
  >(new Map())

  async function load() {
    setLoading(true)
    try {
      const data = await fetchVatRates(restaurantId)
      setRates(data)
      // Initialize editing map with current values
      const m = new Map<number, { rate_percent: string; label: string; description: string }>()
      for (const r of data) {
        m.set(r.vat_group, toEditForm(r))
      }
      setEditing(m)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [restaurantId]) // eslint-disable-line

  function updateField(
    group: number,
    field: 'rate_percent' | 'label' | 'description',
    value: string,
  ) {
    setEditing((prev) => {
      const next = new Map(prev)
      const existing = next.get(group) ?? { rate_percent: '', label: '', description: '' }
      next.set(group, { ...existing, [field]: value })
      return next
    })
  }

  function isDirty(group: number): boolean {
    const orig = rates.find((r) => r.vat_group === group)
    const ed = editing.get(group)
    if (!orig || !ed) return false
    return (
      String(orig.rate_percent) !== ed.rate_percent ||
      orig.label !== ed.label ||
      (orig.description ?? '') !== ed.description
    )
  }

  async function save(group: number) {
    const ed = editing.get(group)
    if (!ed) return
    const rate = parseFloat(ed.rate_percent)
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error('Cota TVA trebuie să fie între 0 și 100')
      return
    }
    if (ed.label.trim().length === 0) {
      toast.error('Eticheta nu poate fi goală')
      return
    }
    setSavingGroup(group)
    try {
      await updateVatRate(restaurantId, group, {
        rate_percent: rate,
        label: ed.label.trim(),
        description: ed.description.trim().length > 0 ? ed.description.trim() : null,
      })
      await load()
    } catch (err) {
      toast.error('Eroare la salvare: ' + (err as Error).message)
    }
    setSavingGroup(null)
  }

  /** Readuce cele 4 grupe la cotele legale (apply_vat_preset), după confirmare. */
  async function applyLegalRates() {
    const ok = await confirmDialog({
      title: 'Aplici cotele legale?',
      description:
        `Grupele primesc cotele din Legea 141/2025 (${LEGAL_RATES_TEXT}) și etichetele ` +
        'implicite. Produsele își păstrează grupa, iar maparea pe casa de marcat rămâne neatinsă.',
      confirmLabel: 'Aplică cotele legale',
    })
    if (!ok) return
    setApplyingPreset(true)
    try {
      const r = await applyVatPreset(restaurantId, LEGAL_PRESET.id)
      toast.success(`Cotele legale au fost aplicate pe ${r.rates_applied} grupe TVA.`)
    } catch (e) {
      toast.error(describeVatPresetError(e))
      return
    } finally {
      setApplyingPreset(false)
    }
    await load().catch(() => {
      toast.error('Cotele au fost aplicate, dar lista nu s-a reîncărcat. Reîncarcă pagina.')
    })
  }

  if (loading) {
    return <div style={{ fontSize: '0.82rem', color: D.t3, padding: 14 }}>Se încarcă cotele...</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          fontSize: '0.72rem',
          color: D.t3,
          lineHeight: 1.55,
          padding: '10px 12px',
          background: D.s3,
          borderRadius: 7,
        }}
      >
        💡 <strong style={{ color: D.t2 }}>Despre cote TVA:</strong> ai 4 grupe configurabile.
        Fiecare produs și ingredient se asociază cu o grupă (1, 2, 3 sau 4). Dacă statul schimbă
        cotele, modifici aici procentul fără să atingi produsele individual.
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding: '10px 12px',
          background: D.s2,
          border: `1px solid ${D.border}`,
          borderRadius: 10,
        }}
      >
        <div style={{ flex: '1 1 220px', fontSize: '0.78rem', lineHeight: 1.5 }}>
          <div style={{ color: D.t1, fontWeight: 600 }}>{LEGAL_PRESET.label}</div>
          <div style={{ color: D.t3, marginTop: 2 }}>{LEGAL_PRESET.description}</div>
        </div>
        <button
          disabled={applyingPreset}
          onClick={() => void applyLegalRates()}
          style={{
            padding: '8px 14px',
            minHeight: 40,
            background: 'transparent',
            color: D.gold,
            border: `1px solid ${D.gold}66`,
            borderRadius: 8,
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: applyingPreset ? 'wait' : 'pointer',
            opacity: applyingPreset ? 0.6 : 1,
            fontFamily: 'DM Sans, sans-serif',
          }}
        >
          {applyingPreset ? 'Se aplică…' : 'Aplică cotele legale'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[1, 2, 3, 4].map((group) => {
          const ed = editing.get(group)
          if (!ed) return null
          const dirty = isDirty(group)
          const saving = savingGroup === group
          return (
            <div
              key={group}
              style={{
                background: D.s2,
                border: `1px solid ${dirty ? D.gold + '55' : D.border}`,
                borderRadius: 10,
                padding: 14,
                transition: 'border-color 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: D.gold,
                    color: '#000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    fontFamily: 'Fraunces, serif',
                  }}
                >
                  {group}
                </span>
                <span
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: D.t2,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  Grupa {group}
                </span>
                {dirty && (
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: '0.7rem',
                      color: D.gold,
                      fontWeight: 600,
                    }}
                  >
                    Modificări nesalvate
                  </span>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '90px 1fr',
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <div>
                  <label style={lbl}>Cota %</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={ed.rate_percent}
                    onChange={(e) => updateField(group, 'rate_percent', e.target.value)}
                    style={inp}
                  />
                </div>
                <div>
                  <label style={lbl}>Etichetă scurtă</label>
                  <input
                    value={ed.label}
                    onChange={(e) => updateField(group, 'label', e.target.value)}
                    placeholder={['Mâncare', 'Alcool', 'Special', 'Scutit'][group - 1]}
                    style={inp}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={lbl}>Descriere (opțional)</label>
                <input
                  value={ed.description}
                  onChange={(e) => updateField(group, 'description', e.target.value)}
                  placeholder="Ex: Mâncare, băuturi nealcoolice, apă, sucuri, cafea"
                  style={inp}
                />
              </div>

              {dirty && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => {
                      const orig = rates.find((r) => r.vat_group === group)
                      if (orig) {
                        setEditing((prev) => new Map(prev).set(group, toEditForm(orig)))
                      }
                    }}
                    style={{
                      padding: '6px 14px',
                      background: 'transparent',
                      color: D.t3,
                      border: `1px solid ${D.border}`,
                      borderRadius: 6,
                      fontSize: '0.78rem',
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                  >
                    Anulează
                  </button>
                  <button
                    disabled={saving}
                    onClick={() => void save(group)}
                    style={{
                      padding: '6px 14px',
                      background: D.gold,
                      color: '#000',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: saving ? 'wait' : 'pointer',
                      opacity: saving ? 0.6 : 1,
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                  >
                    {saving ? 'Salvez...' : 'Salvează'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: '0.7rem',
  color: D.t3,
  marginBottom: 4,
  fontWeight: 500,
  fontFamily: 'DM Sans, sans-serif',
}

const inp: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 12px',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 6,
  color: D.t1,
  fontSize: '0.85rem',
  fontFamily: 'DM Sans, sans-serif',
  outline: 'none',
}
