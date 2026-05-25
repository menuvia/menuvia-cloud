// ─────────────────────────────────────────────────────────────
// QuickSetupTab — Setup Asistent (migration 034)
//
// 4 wizards într-un singur tab, accesibile oricând:
//   1. 🍕 Tip local — preset categorii + produse (one-shot, doar dacă gol)
//   2. 🧾 TVA — preset rates (upsert oricând)
//   3. 🪑 Mese — generator în bulk pe zone
//   4. 👥 Echipă — invitație multi-email
//
// Accesibil din meniul lateral. Util după onboarding inițial când
// owner-ul vrea să populeze rapid restaurantul cu date demo realiste.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'
import {
  BUSINESS_TYPES,
  VAT_PRESETS,
  applyBusinessTypePreset,
  applyVatPreset,
  bulkCreateTables,
  sendInvite,
  type BusinessType,
  type VatPreset,
  type InviteResult,
} from '../lib/quickSetup'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  restaurantId: string
  restaurantName: string
}

// ── Style tokens ──────────────────────────────────────────────
const card: React.CSSProperties = {
  background: D.s1,
  border: `1px solid ${D.border}`,
  borderRadius: 14,
  padding: 22,
  marginBottom: 18,
}
const h2: React.CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 600,
  color: D.t1,
  margin: '0 0 4px',
  fontFamily: 'Fraunces,serif',
}
const subtle: React.CSSProperties = {
  fontSize: '0.82rem',
  color: D.t3,
  marginBottom: 14,
  lineHeight: 1.5,
}
const inp: React.CSSProperties = {
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '10px 12px',
  fontSize: '0.92rem',
  color: D.t1,
  outline: 'none',
  height: 42,
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
  width: '100%',
}
const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 16px',
  height: 40,
  borderRadius: 9,
  fontSize: '0.88rem',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
  ...extra,
})
const banner = (variant: 'ok' | 'warn' | 'err'): React.CSSProperties => ({
  padding: 12,
  borderRadius: 9,
  marginTop: 12,
  fontSize: '0.84rem',
  background: variant === 'ok' ? D.greenA : variant === 'warn' ? 'rgba(232,160,32,0.12)' : D.redA,
  border: `1px solid ${variant === 'ok' ? D.green : variant === 'warn' ? D.amber : D.red}`,
  color: variant === 'ok' ? D.green : variant === 'warn' ? D.amber : D.red,
})

// ── Main ──────────────────────────────────────────────────────
export default function QuickSetupTab({ restaurantId, restaurantName }: Props) {
  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ marginBottom: 22 }}>
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 600,
            color: D.t1,
            margin: 0,
            fontFamily: 'Fraunces,serif',
          }}
        >
          🪄 Setup Asistent
        </h1>
        <div style={{ fontSize: '0.86rem', color: D.t2, marginTop: 4, maxWidth: 600 }}>
          Populează rapid restaurantul cu date realiste. Toate setările pot fi modificate apoi din
          tab-urile dedicate (Produse, Mese, TVA, Echipă).
        </div>
      </div>

      <BusinessTypeSection restaurantId={restaurantId} />
      <VatPresetSection restaurantId={restaurantId} />
      <BulkTablesSection restaurantId={restaurantId} />
      <TeamInviteSection restaurantId={restaurantId} restaurantName={restaurantName} />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// 1. BUSINESS TYPE
// ═════════════════════════════════════════════════════════════
function BusinessTypeSection({ restaurantId }: { restaurantId: string }) {
  const [selected, setSelected] = useState<BusinessType | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ msg: string; variant: 'ok' | 'warn' | 'err' } | null>(null)
  const [existingCats, setExistingCats] = useState<number | null>(null)
  const [showForce, setShowForce] = useState(false)

  useEffect(() => {
    void (async () => {
      const { count } = await supabase
        .from('categories')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
      setExistingCats(count ?? 0)
    })()
  }, [restaurantId])

  async function go(force: boolean = false) {
    if (!selected) return
    setBusy(true)
    setResult(null)
    try {
      const r = await applyBusinessTypePreset(restaurantId, selected, force)
      if (r.status === 'success') {
        setResult({
          variant: 'ok',
          msg: `✓ Adăugate ${r.categories_added} categorii și ${r.products_added} produse. Verifică tab-ul Produse.`,
        })
        setExistingCats((existingCats ?? 0) + (r.categories_added ?? 0))
      } else if (r.status === 'skipped') {
        setShowForce(true)
        setResult({
          variant: 'warn',
          msg: `Există deja ${r.existing_categories} categorii. Vrei să adaugi presetul peste? Confirmă mai jos.`,
        })
      }
    } catch (e) {
      setResult({ variant: 'err', msg: e instanceof Error ? e.message : 'Eroare neașteptată' })
    } finally {
      setBusy(false)
    }
  }

  const sel = BUSINESS_TYPES.find((b) => b.id === selected)

  return (
    <div style={card}>
      <h2 style={h2}>1. Tip local — preset categorii și produse</h2>
      <div style={subtle}>
        Alege ce fel de local ai și sistemul îți creează automat 3-5 categorii cu produse realiste
        cu prețuri sugerate.
        {existingCats !== null && existingCats > 0 && (
          <span style={{ color: D.amber, display: 'block', marginTop: 4 }}>
            ⚠ Restaurantul are deja {existingCats} categorii. Preset-ul va fi sărit (sau forțat
            manual).
          </span>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))',
          gap: 10,
        }}
      >
        {BUSINESS_TYPES.map((bt) => (
          <button
            key={bt.id}
            onClick={() => {
              setSelected(bt.id)
              setResult(null)
              setShowForce(false)
            }}
            style={{
              ...btn({
                background: selected === bt.id ? D.goldA : D.s2,
                color: selected === bt.id ? D.goldL : D.t1,
                border: `1px solid ${selected === bt.id ? D.gold : D.border}`,
                height: 'auto',
                padding: '12px 14px',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 4,
                textAlign: 'left',
              }),
            }}
          >
            <div style={{ fontSize: '1.5rem' }}>{bt.emoji}</div>
            <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{bt.label}</div>
            <div style={{ fontSize: '0.74rem', color: D.t3, lineHeight: 1.3 }}>
              {bt.categoriesCount} categ. · {bt.productsCount} produse
            </div>
          </button>
        ))}
      </div>

      {sel && (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            background: D.s2,
            borderRadius: 10,
            border: `1px solid ${D.border}`,
          }}
        >
          <div style={{ fontSize: '0.84rem', color: D.t1, marginBottom: 8 }}>
            <strong>{sel.label}</strong> — {sel.description}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {sel.sampleCategories.map((c) => (
              <span
                key={c.name}
                style={{
                  padding: '4px 10px',
                  background: D.s3,
                  borderRadius: 6,
                  fontSize: '0.78rem',
                  color: D.t2,
                }}
              >
                {c.emoji} {c.name}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => void go(false)}
              disabled={busy}
              style={btn({ background: D.gold, color: '#000', opacity: busy ? 0.6 : 1 })}
            >
              {busy ? 'Se aplică...' : `Aplică preset ${sel.label}`}
            </button>
            {showForce && (
              <button
                onClick={() => void go(true)}
                disabled={busy}
                style={btn({ background: D.amber, color: '#000', opacity: busy ? 0.6 : 1 })}
              >
                Adaugă peste (forțat)
              </button>
            )}
          </div>
        </div>
      )}

      {result && <div style={banner(result.variant)}>{result.msg}</div>}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// 2. VAT PRESET
// ═════════════════════════════════════════════════════════════
function VatPresetSection({ restaurantId }: { restaurantId: string }) {
  const [selected, setSelected] = useState<VatPreset | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ msg: string; variant: 'ok' | 'warn' | 'err' } | null>(null)

  async function go() {
    if (!selected) return
    setBusy(true)
    setResult(null)
    try {
      const r = await applyVatPreset(restaurantId, selected)
      setResult({
        variant: 'ok',
        msg: `✓ Configurate ${r.rates_applied} cote TVA. Verifică în tab "Raport TVA".`,
      })
    } catch (e) {
      setResult({ variant: 'err', msg: e instanceof Error ? e.message : 'Eroare' })
    } finally {
      setBusy(false)
    }
  }

  const sel = VAT_PRESETS.find((v) => v.id === selected)

  return (
    <div style={card}>
      <h2 style={h2}>2. Cote TVA — preset rapid</h2>
      <div style={subtle}>
        Configurarea TVA depinde de tipul localului tău. Întreabă contabilul dacă nu ești sigur.
        Setarea se poate modifica oricând din tab-ul "Raport TVA".
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {VAT_PRESETS.map((vp) => (
          <button
            key={vp.id}
            onClick={() => {
              setSelected(vp.id)
              setResult(null)
            }}
            style={{
              ...btn({
                background: selected === vp.id ? D.goldA : D.s2,
                color: D.t1,
                border: `1px solid ${selected === vp.id ? D.gold : D.border}`,
                height: 'auto',
                padding: '14px 16px',
                alignItems: 'flex-start',
                textAlign: 'left',
                flexDirection: 'column',
                gap: 6,
              }),
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
              <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{vp.label}</div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {vp.rates.map((r) => (
                  <span
                    key={r.group}
                    style={{
                      padding: '2px 8px',
                      background: D.goldA,
                      borderRadius: 5,
                      fontSize: '0.74rem',
                      color: D.goldL,
                      fontWeight: 600,
                    }}
                  >
                    {r.rate}%
                  </span>
                ))}
              </div>
            </div>
            <div style={{ fontSize: '0.78rem', color: D.t3, lineHeight: 1.4 }}>
              {vp.description}
            </div>
          </button>
        ))}
      </div>

      {sel && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            background: D.s2,
            borderRadius: 9,
            border: `1px solid ${D.border}`,
          }}
        >
          <div style={{ fontSize: '0.8rem', color: D.t2, marginBottom: 8 }}>Va configura:</div>
          {sel.rates.map((r) => (
            <div key={r.group} style={{ fontSize: '0.84rem', color: D.t1, padding: '4px 0' }}>
              <strong>Grupul {r.group}</strong> · {r.rate}% — {r.label}
            </div>
          ))}
          <button
            onClick={() => void go()}
            disabled={busy}
            style={btn({
              background: D.gold,
              color: '#000',
              opacity: busy ? 0.6 : 1,
              marginTop: 10,
            })}
          >
            {busy ? 'Se aplică...' : `Aplică ${sel.label}`}
          </button>
        </div>
      )}

      {result && <div style={banner(result.variant)}>{result.msg}</div>}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// 3. BULK TABLES
// ═════════════════════════════════════════════════════════════
function BulkTablesSection({ restaurantId }: { restaurantId: string }) {
  const [mode, setMode] = useState<'simple' | 'zones'>('simple')
  const [perZone, setPerZone] = useState(8)
  const [zones, setZones] = useState<string>('Interior, Terasă')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ msg: string; variant: 'ok' | 'warn' | 'err' } | null>(null)

  async function go() {
    setBusy(true)
    setResult(null)
    try {
      const zonesArr =
        mode === 'zones'
          ? zones
              .split(',')
              .map((z) => z.trim())
              .filter(Boolean)
          : []
      const r = await bulkCreateTables(restaurantId, zonesArr, perZone)
      const total = r.inserted
      const msg =
        r.skipped > 0
          ? `✓ Create ${r.inserted} mese. ${r.skipped} sărite (existau deja).`
          : `✓ Create ${total} mese. Verifică în tab "Mese".`
      setResult({ variant: 'ok', msg })
    } catch (e) {
      setResult({ variant: 'err', msg: e instanceof Error ? e.message : 'Eroare' })
    } finally {
      setBusy(false)
    }
  }

  const zonesArr = zones
    .split(',')
    .map((z) => z.trim())
    .filter(Boolean)
  const totalPreview = mode === 'zones' ? zonesArr.length * perZone : perZone

  return (
    <div style={card}>
      <h2 style={h2}>3. Mese — generator în bulk</h2>
      <div style={subtle}>
        Generează mai multe mese deodată. QR-urile se imprimă apoi din tab-ul "Mese".
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button
          onClick={() => setMode('simple')}
          style={btn({
            background: mode === 'simple' ? D.goldA : D.s2,
            color: mode === 'simple' ? D.goldL : D.t2,
            border: `1px solid ${mode === 'simple' ? D.gold : D.border}`,
            height: 36,
            padding: '0 14px',
            fontSize: '0.82rem',
          })}
        >
          Fără zone
        </button>
        <button
          onClick={() => setMode('zones')}
          style={btn({
            background: mode === 'zones' ? D.goldA : D.s2,
            color: mode === 'zones' ? D.goldL : D.t2,
            border: `1px solid ${mode === 'zones' ? D.gold : D.border}`,
            height: 36,
            padding: '0 14px',
            fontSize: '0.82rem',
          })}
        >
          Cu zone (Interior, Terasă...)
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: mode === 'zones' ? '1fr 180px' : '180px',
          gap: 12,
        }}
      >
        {mode === 'zones' && (
          <div>
            <div style={{ fontSize: '0.76rem', color: D.t2, marginBottom: 6 }}>
              Zone (separate prin virgulă)
            </div>
            <input
              value={zones}
              onChange={(e) => setZones(e.target.value)}
              style={inp}
              placeholder="ex: Interior, Terasă, VIP"
            />
          </div>
        )}
        <div>
          <div style={{ fontSize: '0.76rem', color: D.t2, marginBottom: 6 }}>
            {mode === 'zones' ? 'Mese per zonă' : 'Total mese'}
          </div>
          <input
            type="number"
            min={1}
            max={200}
            value={perZone}
            onChange={(e) => setPerZone(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
            style={inp}
          />
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          padding: 10,
          background: D.s2,
          borderRadius: 8,
          fontSize: '0.84rem',
          color: D.t2,
        }}
      >
        Va crea <strong style={{ color: D.gold }}>{totalPreview} mese</strong>:{' '}
        {mode === 'zones' && zonesArr.length > 0
          ? zonesArr.map((z) => `${z} 1...${perZone}`).join(', ')
          : `Masa 1...${perZone}`}
      </div>

      <button
        onClick={() => void go()}
        disabled={busy || (mode === 'zones' && zonesArr.length === 0)}
        style={btn({ background: D.gold, color: '#000', opacity: busy ? 0.6 : 1, marginTop: 12 })}
      >
        {busy ? 'Se creează...' : `Creează ${totalPreview} mese`}
      </button>

      {result && <div style={banner(result.variant)}>{result.msg}</div>}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// 4. TEAM INVITES
// ═════════════════════════════════════════════════════════════
function TeamInviteSection({
  restaurantId,
  restaurantName,
}: {
  restaurantId: string
  restaurantName: string
}) {
  const { user } = useAuth()
  const [emails, setEmails] = useState('')
  const [role, setRole] = useState<'waiter' | 'manager' | 'kitchen'>('waiter')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<InviteResult[]>([])

  async function go() {
    const list = emails
      .split(/[,\n\s]+/)
      .map((e) => e.trim())
      .filter((e) => e.length > 0)
    const valid = list.filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    if (valid.length === 0) return

    setBusy(true)
    setResults([])
    const out: InviteResult[] = []
    const invitedByName =
      (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? 'Manager'
    for (const email of valid) {
      const r = await sendInvite(email, role, restaurantId, restaurantName, invitedByName)
      out.push({ email, ok: r.ok, error: r.error })
      setResults([...out]) // progressive update
    }
    setBusy(false)
  }

  const list = emails
    .split(/[,\n\s]+/)
    .map((e) => e.trim())
    .filter(Boolean)
  const validCount = list.filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).length

  return (
    <div style={card}>
      <h2 style={h2}>4. Echipa — invitație în bulk</h2>
      <div style={subtle}>
        Trimite invitații pe email către ospătarii și echipa de management. Vor primi un link magic
        care le creează contul automat. Skip dacă lucrezi singur deocamdată.
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: '0.76rem', color: D.t2, marginBottom: 6 }}>
          Email-uri (separate prin virgulă sau enter)
        </div>
        <textarea
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          style={{ ...inp, height: 80, padding: 10, resize: 'vertical' }}
          placeholder={'andrei@example.com\nmaria@example.com\nion@example.com'}
        />
        <div style={{ fontSize: '0.74rem', color: validCount > 0 ? D.green : D.t3, marginTop: 4 }}>
          {validCount} email{validCount === 1 ? '' : '-uri'} valid{validCount === 1 ? '' : 'e'}{' '}
          detectat{validCount === 1 ? '' : 'e'}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: '0.76rem', color: D.t2, marginBottom: 6 }}>Rol pentru toți</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['waiter', 'kitchen', 'manager'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              style={btn({
                background: role === r ? D.goldA : D.s2,
                color: role === r ? D.goldL : D.t2,
                border: `1px solid ${role === r ? D.gold : D.border}`,
                height: 36,
                padding: '0 14px',
                fontSize: '0.82rem',
              })}
            >
              {r === 'waiter' ? '👤 Ospătar' : r === 'kitchen' ? '👨‍🍳 Bucătărie' : '👔 Manager'}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => void go()}
        disabled={busy || validCount === 0}
        style={btn({
          background: D.gold,
          color: '#000',
          opacity: busy || validCount === 0 ? 0.5 : 1,
        })}
      >
        {busy
          ? `Se trimit... (${results.length}/${validCount})`
          : `Trimite ${validCount} invitați${validCount === 1 ? 'e' : 'i'}`}
      </button>

      {results.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {results.map((r) => (
            <div
              key={r.email}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 0',
                fontSize: '0.84rem',
                borderBottom: `1px solid ${D.border}`,
              }}
            >
              <span style={{ color: r.ok ? D.green : D.red, fontWeight: 600, width: 18 }}>
                {r.ok ? '✓' : '✕'}
              </span>
              <span style={{ color: D.t1, flex: 1 }}>{r.email}</span>
              {r.error && <span style={{ color: D.red, fontSize: '0.76rem' }}>{r.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
