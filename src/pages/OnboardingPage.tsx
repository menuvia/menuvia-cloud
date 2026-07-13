import { useRef, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'
import { createRestaurant } from '../lib/restaurants'
import { Icon } from '../components/ui/Icon'
import type { IconName } from '../components/ui/Icon'
import { fetchRestaurantFeatures, getLimit, hasFeature } from '../lib/features'

// ─── Helpers ─────────────────────────────────────────────────
const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '12px 14px',
  fontSize: '0.9rem',
  color: D.t1,
  outline: 'none',
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}
const btnPrimary: React.CSSProperties = {
  width: '100%',
  background: D.gold,
  color: '#000',
  border: 'none',
  borderRadius: 9,
  padding: '14px 0',
  fontFamily: 'DM Sans,sans-serif',
  fontSize: '0.95rem',
  fontWeight: 700,
  cursor: 'pointer',
}
const btnSecondary: React.CSSProperties = {
  background: 'transparent',
  color: D.t3,
  border: 'none',
  fontFamily: 'DM Sans,sans-serif',
  fontSize: '0.85rem',
  cursor: 'pointer',
  padding: '8px 0',
  textDecoration: 'underline',
}
const btnDisabled: React.CSSProperties = {
  ...btnPrimary,
  background: D.s4,
  color: D.t3,
  cursor: 'not-allowed',
}
const label: React.CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  color: D.t2,
  marginBottom: 6,
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'restaurant'
  )
}

function markOnboarding(restaurantId: string, fields: Record<string, boolean | string | null>) {
  return supabase.from('onboarding_state').update(fields).eq('restaurant_id', restaurantId)
}

// ─── Progress bar ─────────────────────────────────────────────
function Progress({ step, total = 4 }: { step: number; total?: number }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '0.75rem',
            color: D.gold,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Pas {step} din {total}
        </span>
        <span style={{ fontSize: '0.75rem', color: D.t3 }}>
          {Math.round((step / total) * 100)}%
        </span>
      </div>
      <div style={{ height: 4, background: D.s3, borderRadius: 2, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            borderRadius: 2,
            background: D.gold,
            width: `${(step / total) * 100}%`,
            transition: 'width .4s ease',
          }}
        />
      </div>
      {/* Step dots */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: i + 1 < step ? D.gold : i + 1 === step ? D.goldA : D.s3,
                border: `2px solid ${i + 1 <= step ? D.gold : D.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.65rem',
                fontWeight: 700,
                color: i + 1 < step ? '#000' : i + 1 === step ? D.gold : D.t3,
                transition: 'all .3s',
              }}
            >
              {i + 1 < step ? <Icon name="check" size={12} /> : i + 1}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Error box ────────────────────────────────────────────────
function ErrorBox({ msg }: { msg: string }) {
  return (
    <div
      style={{
        background: D.redA,
        border: `1px solid rgba(224,85,85,0.3)`,
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: '0.82rem',
        color: D.red,
      }}
    >
      {msg}
    </div>
  )
}

// ─── Shell ────────────────────────────────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: D.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        fontFamily: 'DM Sans,sans-serif',
      }}
    >
      <div
        style={{
          background: D.s1,
          border: `1px solid ${D.border}`,
          borderRadius: 18,
          padding: '36px 32px',
          width: '100%',
          maxWidth: 480,
        }}
      >
        <div
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1rem',
            color: D.gold,
            marginBottom: 24,
            letterSpacing: '-0.01em',
          }}
        >
          Menuvia
        </div>
        {children}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// STEP 1 — Creează restaurantul
// ═══════════════════════════════════════════════════════════════
function Step1Restaurant({ onNext }: { onNext: (restaurantId: string, slug: string) => void }) {
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Numele restaurantului este obligatoriu.')
      return
    }
    setSaving(true)
    setError(null)
    const finalSlug = slug || slugify(name)
    try {
      const created = await createRestaurant({
        name: name.trim(),
        city: city.trim() || null,
        slug: finalSlug,
        primaryColor: '#C8963C',
      })
      onNext(created.restaurant_id, created.restaurant_slug)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Eroare necunoscută'
      setError(msg.includes('slug') ? 'Acest URL e deja folosit. Alege altul.' : msg)
      setSaving(false)
    }
  }

  return (
    <Shell>
      <Progress step={1} />
      <h1
        style={{
          fontFamily: 'Fraunces,serif',
          fontSize: '1.5rem',
          color: D.t1,
          marginBottom: 6,
          letterSpacing: '-0.02em',
        }}
      >
        Configurează restaurantul
      </h1>
      <p style={{ color: D.t2, fontSize: '0.85rem', marginBottom: 24, lineHeight: 1.6 }}>
        Informații de bază — le poți schimba oricând din Setări.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={label}>Numele restaurantului *</label>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setSlug(slugify(e.target.value))
            }}
            placeholder="La Bella Trattoria"
            style={inp}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
            autoFocus
          />
        </div>
        <div>
          <label style={label}>Oraș</label>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Focșani"
            style={inp}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
        </div>
        <div>
          <label style={label}>URL meniu public</label>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: D.s3,
              border: `1px solid ${D.border}`,
              borderRadius: 9,
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                padding: '0 10px',
                fontSize: '0.75rem',
                color: D.t3,
                borderRight: `1px solid ${D.border}`,
                height: 46,
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              menuvia.ro/m/
            </span>
            <input
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value))}
              placeholder="la-bella-trattoria"
              style={{ ...inp, borderRadius: 0, border: 'none' }}
            />
          </div>
        </div>
        {error && <ErrorBox msg={error} />}
        <button
          onClick={handleCreate}
          disabled={saving || !name.trim()}
          style={saving || !name.trim() ? btnDisabled : btnPrimary}
        >
          {saving ? 'Se creează...' : 'Continuă →'}
        </button>
      </div>
    </Shell>
  )
}

// ═══════════════════════════════════════════════════════════════
// STEP 2 — Adaugă primul produs
// ═══════════════════════════════════════════════════════════════
function Step2Menu({
  restaurantId,
  onNext,
  onSkip,
}: {
  restaurantId: string
  onNext: () => void
  onSkip: () => void
}) {
  const [catName, setCatName] = useState('Feluri principale')
  const [catEmoji, setCatEmoji] = useState('🍽️')
  const [prodName, setProdName] = useState('')
  const [prodPrice, setProdPrice] = useState('')
  const [prodEmoji, setProdEmoji] = useState('🍕')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Categoria creată se reține între încercări: pe retry după eșecul produsului,
  // NU mai inserăm o categorie nouă (duplicat), refolosim id-ul deja creat.
  const createdCatId = useRef<string | null>(null)

  const QUICK_CATS = [
    { name: 'Aperitive', emoji: '🥗' },
    { name: 'Feluri principale', emoji: '🍽️' },
    { name: 'Pizza', emoji: '🍕' },
    { name: 'Paste', emoji: '🍝' },
    { name: 'Deserturi', emoji: '🍰' },
    { name: 'Băuturi', emoji: '🥤' },
  ]

  const handleSave = async () => {
    if (!catName.trim()) {
      setError('Numele categoriei este obligatoriu.')
      return
    }
    if (!prodName.trim()) {
      setError('Numele produsului este obligatoriu.')
      return
    }
    const price = parseFloat(prodPrice)
    if (!prodPrice || isNaN(price) || price <= 0) {
      setError('Prețul trebuie să fie un număr pozitiv.')
      return
    }
    setSaving(true)
    setError(null)

    // Create category — o singură dată; pe retry refolosim id-ul reținut.
    if (!createdCatId.current) {
      const { data: cat, error: catErr } = await supabase
        .from('categories')
        .insert({
          restaurant_id: restaurantId,
          name: catName.trim(),
          emoji: catEmoji,
          display_order: 0,
        })
        .select('id')
        .single()
      if (catErr) {
        setError(catErr.message)
        setSaving(false)
        return
      }
      createdCatId.current = cat.id as string
    }

    // Create product
    const { error: prodErr } = await supabase.from('products').insert({
      restaurant_id: restaurantId,
      category_id: createdCatId.current,
      name: prodName.trim(),
      price,
      emoji: prodEmoji,
      is_active: true,
      display_order: 0,
    })
    if (prodErr) {
      setError(prodErr.message)
      setSaving(false)
      return
    }

    // Mark onboarding
    await markOnboarding(restaurantId, { menu_created: true })
    onNext()
  }

  return (
    <Shell>
      <Progress step={2} />
      <h1
        style={{
          fontFamily: 'Fraunces,serif',
          fontSize: '1.5rem',
          color: D.t1,
          marginBottom: 6,
          letterSpacing: '-0.02em',
        }}
      >
        Adaugă primul produs
      </h1>
      <p style={{ color: D.t2, fontSize: '0.85rem', marginBottom: 24, lineHeight: 1.6 }}>
        Un produs e de ajuns acum. Adaugi restul din dashboard.
      </p>

      {/* Quick cat select */}
      <div style={{ marginBottom: 14 }}>
        <label style={label}>Categorie</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {QUICK_CATS.map((c) => (
            <button
              key={c.name}
              onClick={() => {
                setCatName(c.name)
                setCatEmoji(c.emoji)
              }}
              style={{
                padding: '5px 11px',
                fontSize: '0.78rem',
                borderRadius: 7,
                fontFamily: 'DM Sans,sans-serif',
                cursor: 'pointer',
                outline: 'none',
                background: catName === c.name ? D.goldA : D.s3,
                color: catName === c.name ? D.goldL : D.t2,
                border: `1px solid ${catName === c.name ? D.gold + '55' : D.border}`,
              }}
            >
              {c.emoji} {c.name}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={catEmoji}
            onChange={(e) => setCatEmoji(e.target.value)}
            style={{
              ...inp,
              width: 60,
              textAlign: 'center',
              fontSize: '1.2rem',
              padding: '10px 8px',
            }}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
          <input
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            placeholder="Feluri principale"
            style={{ ...inp, flex: 1 }}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
        </div>
      </div>

      <div style={{ height: 1, background: D.border, margin: '18px 0' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
        <div>
          <label style={label}>Produs *</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={prodEmoji}
              onChange={(e) => setProdEmoji(e.target.value)}
              style={{
                ...inp,
                width: 60,
                textAlign: 'center',
                fontSize: '1.2rem',
                padding: '10px 8px',
              }}
              onFocus={(e) => (e.target.style.borderColor = D.gold)}
              onBlur={(e) => (e.target.style.borderColor = D.border)}
            />
            <input
              value={prodName}
              onChange={(e) => setProdName(e.target.value)}
              placeholder="Spaghete Carbonara"
              style={{ ...inp, flex: 1 }}
              autoFocus
              onFocus={(e) => (e.target.style.borderColor = D.gold)}
              onBlur={(e) => (e.target.style.borderColor = D.border)}
            />
          </div>
        </div>
        <div>
          <label style={label}>Preț (lei) *</label>
          <input
            value={prodPrice}
            onChange={(e) => setProdPrice(e.target.value)}
            placeholder="32"
            type="number"
            min="0"
            step="0.5"
            style={{ ...inp, maxWidth: 150 }}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
        </div>
      </div>

      {error && <ErrorBox msg={error} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: error ? 12 : 0 }}>
        <button onClick={handleSave} disabled={saving} style={saving ? btnDisabled : btnPrimary}>
          {saving ? 'Se salvează...' : 'Salvează și continuă →'}
        </button>
        <button onClick={onSkip} style={btnSecondary}>
          Sari peste acest pas →
        </button>
      </div>
    </Shell>
  )
}

// ═══════════════════════════════════════════════════════════════
// STEP 3 — Configurează prima masă
// ═══════════════════════════════════════════════════════════════
function Step3Table({
  restaurantId,
  onNext,
  onSkip,
}: {
  restaurantId: string
  onNext: () => void
  onSkip: () => void
}) {
  // Limita de mese a planului (free=3). Citim de la server ca să nu trimitem
  // by-default mai multe mese decât permite planul — altfel trigger-ul (mig 114)
  // făcea rollback cu eroare brută și onboarding-ul standard pica pentru free.
  const [maxTables, setMaxTables] = useState<number | null>(null)
  const [count, setCount] = useState(5)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Comenzile pentru ridicare sunt growth+ (Gate A) — pe tier 1 arătăm hintul
  // de plan sub butonul „Nu am mese" (acțiunea rămâne permisă, flag-ul e inert).
  const [hasPickup, setHasPickup] = useState(true)

  useEffect(() => {
    let cancelled = false
    void fetchRestaurantFeatures(restaurantId)
      .then((f) => {
        if (cancelled) return
        const lim = getLimit(f, 'max_tables') // null = nelimitat
        setMaxTables(lim)
        setHasPickup(hasFeature(f, 'pickup_orders'))
        // Clamp valoarea inițială (5) la limită ca să nu pornim peste plafon.
        if (lim !== null) setCount((c) => Math.min(c, Math.max(1, lim)))
      })
      .catch((e) => {
        // Eșec de transport: lăsăm UI-ul pe plafonul implicit (50) și logăm;
        // serverul (mig 114) rămâne plasa de siguranță. Fără setState post-unmount.
        if (!cancelled) console.error('[Onboarding] fetch features failed:', e)
      })
    return () => {
      cancelled = true
    }
  }, [restaurantId])

  const cap = maxTables ?? 50 // plafon efectiv pe UI (nelimitat → 50, ca înainte)
  const quickPicks = [4, 8, 12, 20, 30].filter((n) => n <= cap)

  const handleCreate = async () => {
    if (count < 1 || count > cap) {
      setError(`Numărul de mese trebuie să fie între 1 și ${cap}.`)
      return
    }
    setSaving(true)
    setError(null)

    // Create N tables named "Masa 1", "Masa 2"...
    const tables = Array.from({ length: count }, (_, i) => ({
      restaurant_id: restaurantId,
      name: `Masa ${i + 1}`,
      slug: `masa-${i + 1}`,
      seats: 4,
      is_active: true,
    }))
    const { data: createdTables, error: tErr } = await supabase
      .from('tables')
      .insert(tables)
      .select('id')
    if (tErr || !createdTables) {
      // Nu expunem textul brut Postgres; mapăm cazurile cunoscute.
      const m = tErr?.message || ''
      setError(
        /limit|maxim|plan/i.test(m)
          ? `Planul tău permite maximum ${cap} mese. Alege mai puține sau fă upgrade pentru mai multe.`
          : 'Nu am putut crea mesele. Reîncearcă.',
      )
      setSaving(false)
      return
    }

    // Create qr_tokens for each table. Verificăm eroarea: dacă eșuează, NU marcăm
    // qr_generated ca să nu raportăm o stare inconsistentă (mese fără QR).
    const tokens = createdTables.map((t) => ({ restaurant_id: restaurantId, table_id: t.id }))
    const { error: qrErr } = await supabase.from('qr_tokens').insert(tokens)

    await markOnboarding(restaurantId, { table_created: true, qr_generated: !qrErr })
    onNext()
  }

  // Ramura „fără mese": activăm pickup + pickup_only (UPDATE direct e permis —
  // pickup_settings are grant column-level 096B + e în RESTAURANT_UPDATE_FIELDS)
  // și marcăm pașii de mese/QR ca rezolvați semantic (QR-ul general = slug-ul).
  const handlePickupOnly = async () => {
    setSaving(true)
    setError(null)
    const { error: pErr } = await supabase
      .from('restaurants')
      .update({
        pickup_settings: {
          enabled: true,
          min_lead_time_minutes: 20,
          slot_interval_minutes: 15,
          open_hours: { start: '09:00', end: '21:00' },
          instructions: null,
          pickup_only: true,
        },
      })
      .eq('id', restaurantId)
    if (pErr) {
      setError('Nu am putut activa modul de ridicare. Reîncearcă.')
      setSaving(false)
      return
    }
    await markOnboarding(restaurantId, { table_created: true, qr_generated: true })
    onNext()
  }

  return (
    <Shell>
      <Progress step={3} />
      <h1
        style={{
          fontFamily: 'Fraunces,serif',
          fontSize: '1.5rem',
          color: D.t1,
          marginBottom: 6,
          letterSpacing: '-0.02em',
        }}
      >
        Câte mese are restaurantul?
      </h1>
      <p style={{ color: D.t2, fontSize: '0.85rem', marginBottom: 28, lineHeight: 1.6 }}>
        Vom crea mese numerotate automat (Masa 1, Masa 2...) cu QR-uri gata de printat. Le
        redenumești din dashboard.
      </p>

      {/* Counter */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          marginBottom: 28,
          justifyContent: 'center',
        }}
      >
        <button
          onClick={() => setCount((c) => Math.max(1, c - 1))}
          aria-label="Scade numărul de mese"
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: D.s3,
            border: `1px solid ${D.border}`,
            color: D.t1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="minus" size={20} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '3rem',
              color: D.gold,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            {count}
          </div>
          <div style={{ fontSize: '0.78rem', color: D.t3, marginTop: 4 }}>mese</div>
        </div>
        <button
          onClick={() => setCount((c) => Math.min(cap, c + 1))}
          aria-label="Crește numărul de mese"
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: D.s3,
            border: `1px solid ${D.border}`,
            color: D.t1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="plus" size={20} />
        </button>
      </div>

      {/* Hint plafon plan (free=3 mese) */}
      {maxTables !== null && (
        <div
          style={{
            textAlign: 'center',
            fontSize: '0.78rem',
            color: D.t3,
            marginBottom: 16,
            lineHeight: 1.5,
          }}
        >
          Planul tău include până la <strong style={{ color: D.t2 }}>{maxTables} mese</strong>. Poți
          adăuga mai multe oricând cu un upgrade.
        </div>
      )}

      {/* Quick picks (ascunse dacă planul permite prea puține mese ca să aibă sens) */}
      <div
        style={{
          display: quickPicks.length > 0 ? 'flex' : 'none',
          gap: 8,
          justifyContent: 'center',
          marginBottom: 24,
        }}
      >
        {quickPicks.map((n) => (
          <button
            key={n}
            onClick={() => setCount(n)}
            style={{
              padding: '5px 13px',
              fontSize: '0.82rem',
              borderRadius: 7,
              fontFamily: 'DM Sans,sans-serif',
              cursor: 'pointer',
              outline: 'none',
              background: count === n ? D.goldA : D.s3,
              color: count === n ? D.goldL : D.t2,
              border: `1px solid ${count === n ? D.gold + '55' : D.border}`,
            }}
          >
            {n}
          </button>
        ))}
      </div>

      <div
        style={{
          background: D.s2,
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: 20,
          border: `1px solid ${D.border}`,
        }}
      >
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: '0.8rem', color: D.t2 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={14} color={D.green} />
            <span>
              Se creează <strong style={{ color: D.t1 }}>{count} mese</strong> cu QR-uri unice
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={14} color={D.green} />
            <span>
              PDF gata de printat din tab-ul <strong style={{ color: D.t1 }}>Mese</strong>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={14} color={D.green} />
            <span>Le redenumești sau ștergi oricând</span>
          </div>
        </div>
      </div>

      {error && <ErrorBox msg={error} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={handleCreate} disabled={saving} style={saving ? btnDisabled : btnPrimary}>
          {saving ? `Se creează ${count} mese...` : `Creează ${count} mese →`}
        </button>
        <button onClick={onSkip} style={btnSecondary}>
          Sari peste acest pas →
        </button>
        {/* Food truck / tejghea (E3): activează pickup + modul „doar ridicare"
            — fără mese; QR-ul general /m/:slug devine QR-ul principal. */}
        <button onClick={handlePickupOnly} disabled={saving} style={btnSecondary}>
          Nu am mese — doar ridicare (food truck) →
        </button>
        {!hasPickup && (
          <div
            style={{
              fontSize: '0.74rem',
              color: D.t3,
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            Comenzile pentru ridicare necesită planul 🛎 Meniu + Comenzi — meniul QR general
            funcționează și pe planul curent.
          </div>
        )}
      </div>
    </Shell>
  )
}

// ═══════════════════════════════════════════════════════════════
// STEP 4 — Gata!
// ═══════════════════════════════════════════════════════════════
function Step4Done({
  restaurantId,
  slug,
  onComplete,
}: {
  restaurantId: string
  slug: string
  onComplete: () => void
}) {
  const menuUrl = `${window.location.origin}/m/${slug}`
  // Feedback la copiere — fără el, click-ul părea că nu face nimic (iar în
  // browsere fără clipboard API eșua complet tăcut).
  const [copied, setCopied] = useState(false)
  const copyMenuUrl = async () => {
    try {
      await navigator.clipboard.writeText(menuUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard indisponibil (permisiuni/HTTP) — selectăm măcar linkul nu
      // putem; lăsăm userul să-l copieze manual din <a> de alături.
    }
  }

  const handleDone = async () => {
    await supabase
      .from('onboarding_state')
      .update({ completed_at: new Date().toISOString() })
      .eq('restaurant_id', restaurantId)
    onComplete()
  }

  const achievements: { icon: IconName; title: string; done: boolean }[] = [
    { icon: 'home', title: 'Restaurant creat', done: true },
    { icon: 'menu', title: 'Meniu configurat', done: true },
    { icon: 'table', title: 'Mese și QR-uri', done: true },
    { icon: 'qr', title: 'Gata de comenzi', done: true },
  ]

  return (
    <Shell>
      <Progress step={4} />
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: D.goldA,
            border: `1px solid ${D.gold}44`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
          }}
        >
          <Icon name="sparkle" size={30} color={D.gold} />
        </div>
        <h1
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.6rem',
            color: D.t1,
            letterSpacing: '-0.02em',
            marginBottom: 8,
          }}
        >
          Ești gata!
        </h1>
        <p style={{ color: D.t2, fontSize: '0.85rem', lineHeight: 1.6 }}>
          Restaurantul tău e configurat și live.
        </p>
      </div>

      {/* Achievements */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
        {achievements.map((a) => (
          <div
            key={a.title}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: D.s2,
              borderRadius: 10,
              padding: '10px 14px',
              border: `1px solid ${D.border}`,
            }}
          >
            <Icon name={a.icon} size={18} color={D.gold} />
            <span style={{ fontSize: '0.875rem', color: D.t1, flex: 1 }}>{a.title}</span>
            <Icon name="check" size={16} color={D.green} label="finalizat" />
          </div>
        ))}
      </div>

      {/* Menu URL */}
      <div
        style={{
          background: D.s2,
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 22,
          border: `1px solid ${D.gold}33`,
        }}
      >
        <div
          style={{
            fontSize: '0.7rem',
            color: D.t3,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            marginBottom: 6,
          }}
        >
          Link meniu public
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <a
            href={menuUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '0.82rem',
              color: D.gold,
              textDecoration: 'none',
              flex: 1,
              wordBreak: 'break-all',
            }}
          >
            {menuUrl}
          </a>
          <button
            onClick={() => void copyMenuUrl()}
            aria-label="Copiază link-ul meniului"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 11px',
              minHeight: 32,
              fontSize: '0.72rem',
              background: copied ? 'rgba(74,222,128,0.14)' : D.goldA,
              color: copied ? D.green : D.goldL,
              border: `1px solid ${copied ? `${D.green}55` : `${D.gold}44`}`,
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
              flexShrink: 0,
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            {copied ? 'Copiat!' : 'Copiază'}
          </button>
        </div>
      </div>

      {/* Next steps hint */}
      <div
        style={{
          background: D.s2,
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 24,
          border: `1px solid ${D.border}`,
        }}
      >
        <div style={{ fontSize: '0.78rem', color: D.t2 }}>
          <strong style={{ color: D.t1, display: 'block', marginBottom: 8 }}>
            Următori pași în dashboard:
          </strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="orders" size={15} color={D.t3} />
              <span>Adaugă restul produselor din meniu</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="printer" size={15} color={D.t3} />
              <span>Printează QR-urile din tab-ul Mese</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="users" size={15} color={D.t3} />
              <span>Invită ospătarul și bucătarul din tab-ul Echipă</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="chart" size={15} color={D.t3} />
              <span>Urmărește comenzile live din Kitchen</span>
            </div>
          </div>
        </div>
      </div>

      <button onClick={handleDone} style={btnPrimary}>
        Deschide dashboard-ul →
      </button>
    </Shell>
  )
}

// ═══════════════════════════════════════════════════════════════
// MAIN — Orchestrator
// ═══════════════════════════════════════════════════════════════
interface OnboardingState {
  step: 1 | 2 | 3 | 4
  restaurantId: string | null
  slug: string | null
}

export default function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const [state, setState] = useState<OnboardingState>({
    step: 1,
    restaurantId: null,
    slug: null,
  })

  const goTo = (step: 1 | 2 | 3 | 4) => setState((s) => ({ ...s, step }))

  if (state.step === 1) {
    return (
      <Step1Restaurant onNext={(restaurantId, slug) => setState({ step: 2, restaurantId, slug })} />
    )
  }

  if (state.step === 2) {
    return (
      <Step2Menu restaurantId={state.restaurantId!} onNext={() => goTo(3)} onSkip={() => goTo(3)} />
    )
  }

  if (state.step === 3) {
    return (
      <Step3Table
        restaurantId={state.restaurantId!}
        onNext={() => goTo(4)}
        onSkip={() => goTo(4)}
      />
    )
  }

  return <Step4Done restaurantId={state.restaurantId!} slug={state.slug!} onComplete={onComplete} />
}
