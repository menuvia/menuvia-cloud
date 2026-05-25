// ─────────────────────────────────────────────────────────────
// VatRatesEditor — Editor pentru cele 4 cote TVA per restaurant
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { D } from '../lib/constants'
import { fetchVatRates, updateVatRate } from '../lib/vat'
import type { VatRate } from '../lib/vat'

interface Props {
  restaurantId: string
}

export default function VatRatesEditor({ restaurantId }: Props) {
  const [rates, setRates] = useState<VatRate[]>([])
  const [loading, setLoading] = useState(true)
  const [savingGroup, setSavingGroup] = useState<number | null>(null)
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
        m.set(r.vat_group, {
          rate_percent: String(r.rate_percent),
          label: r.label,
          description: r.description ?? '',
        })
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
      alert('Cota TVA trebuie să fie între 0 și 100')
      return
    }
    if (ed.label.trim().length === 0) {
      alert('Eticheta nu poate fi goală')
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
      alert('Eroare la salvare: ' + (err as Error).message)
    }
    setSavingGroup(null)
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
                        setEditing((prev) => {
                          const next = new Map(prev)
                          next.set(group, {
                            rate_percent: String(orig.rate_percent),
                            label: orig.label,
                            description: orig.description ?? '',
                          })
                          return next
                        })
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
