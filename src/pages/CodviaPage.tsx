// =============================================================
// CodviaPage — magazinul de suporturi QR fizice (/codvia), brandul-frate.
//
// EXPANSION: al doilea motor de venit + canal de achiziție reciprocă:
// fiecare suport livrat vinde Menuvia (insert în colet), fiecare restaurant
// Menuvia comandă suporturi de aici (card în dashboard, slug pre-completat →
// primește standuri cu QR-ul REAL al meniului lui deja tipărit).
//
// v1 deliberat FĂRĂ plată online: comanda → email fondator (codvia-order.js),
// confirmare telefonică, plata ramburs/transfer. Copy onest — nu promitem
// termene pe care nu le controlăm încă. Pagina servește și viitorul domeniu
// codvia.ro (același bundle, ca white-label — vezi docs/CODVIA.md).
// Stil: tokens D + pattern-ul de formular din RecrutarePage.
// =============================================================
import { useEffect, useState } from 'react'
import { D } from '../lib/constants'
import { fnUrl } from '../lib/fn'
import { Icon } from '../components/ui/Icon'
import type { IconName } from '../components/ui/Icon'

interface ProductDef {
  key: string
  name: string
  price: number
  desc: string
  icon: IconName
  badge?: string
}

// Oglinda catalogului din codvia-order.js (sursa de adevăr a prețului la
// procesare e SERVERUL; aici doar afișăm aceleași valori).
const PRODUCTS: ProductDef[] = [
  {
    key: 'stand_pvc',
    name: 'Stand PVC + sticker QR',
    price: 29,
    desc: 'Suport de masă rezistent cu codul tău QR laminat. Simplu, curat, gata de pus pe masă.',
    icon: 'qr',
  },
  {
    key: 'stand_plexi',
    name: 'Stand plexiglas premium',
    price: 79,
    desc: 'Plexiglas transparent tăiat la laser, print UV. Arată bine în orice local.',
    icon: 'star',
    badge: 'Popular',
  },
  {
    key: 'placa_lemn',
    name: 'Placă lemn gravat',
    price: 129,
    desc: 'Lemn masiv gravat laser, cu logo-ul tău. Pentru localuri cu identitate.',
    icon: 'leaf',
  },
  {
    key: 'nfc_combo',
    name: 'NFC + QR combo',
    price: 179,
    desc: 'Atinge SAU scanează: cip NFC integrat sub QR. Experiența cea mai rapidă pentru client.',
    icon: 'wifi',
  },
]

const STEPS = [
  { t: 'Alegi modelul', d: 'Și ne spui ce să deschidă QR-ul: meniul tău Menuvia, pagina de recenzii Google, site-ul tău — orice link.' },
  { t: 'Confirmăm în 24h', d: 'Te sunăm, validăm designul și adresa. Plata: ramburs la livrare sau transfer — fără plată online în avans.' },
  { t: 'Primești prin curier', d: 'Suporturile vin gata de pus pe masă. Dacă ai meniu Menuvia, QR-ul e deja legat de el.' },
]

const fieldStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  padding: '12px 14px',
  fontSize: 15,
  color: D.t1,
  fontFamily: 'DM Sans, sans-serif',
  boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: D.t2,
  fontWeight: 500,
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

export default function CodviaPage({ navigate }: { navigate: (p: string) => void }) {
  // Pre-completare din query: dashboard-ul Menuvia trimite ?slug=<meniu>, iar
  // cardurile din catalog setează ?produs=. Citite O dată, la mount.
  const [product, setProduct] = useState<string>(() => {
    const p = new URLSearchParams(window.location.search).get('produs') ?? ''
    return PRODUCTS.some((x) => x.key === p) ? p : 'stand_plexi'
  })
  const [menuSlug, setMenuSlug] = useState<string>(
    () => new URLSearchParams(window.location.search).get('slug') ?? '',
  )
  const [quantity, setQuantity] = useState<string>('4')
  const [name, setName] = useState('')
  const [business, setBusiness] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [message, setMessage] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const prevTitle = document.title
    document.title = 'Codvia — suporturi QR fizice pentru localul tău'
    return () => {
      document.title = prevTitle
    }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !phone.trim() || !email.trim() || !address.trim()) {
      setErr('Toate câmpurile marcate cu * sunt obligatorii')
      return
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setErr('Email invalid')
      return
    }
    if (!consent) {
      setErr('Trebuie să accepți prelucrarea datelor pentru confirmarea comenzii')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(fnUrl('codvia-order'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product,
          quantity: parseInt(quantity, 10) || 1,
          name,
          business,
          phone,
          email,
          address,
          menu_slug: menuSlug.trim(),
          message,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(
          body?.error || 'Nu am putut trimite comanda. Încearcă din nou în câteva minute.',
        )
      }
      setDone(true)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Eroare la trimitere')
    } finally {
      setBusy(false)
    }
  }

  const selected = PRODUCTS.find((p) => p.key === product) ?? PRODUCTS[1]
  const qtyNum = Math.max(parseInt(quantity, 10) || 1, 1)

  return (
    <div
      style={{
        minHeight: '100vh',
        background: D.bg,
        color: D.t1,
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      {/* Header propriu — Codvia e brand distinct; legătura cu Menuvia e o
          punte discretă, nu chrome-ul Menuvia întreg. */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          maxWidth: 1080,
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 24,
              fontWeight: 700,
              color: D.gold,
              letterSpacing: '0.02em',
            }}
          >
            CODVIA
          </span>
          <span style={{ fontSize: 12, color: D.t3 }}>din familia Menuvia</span>
        </div>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: `1px solid ${D.border}`,
            borderRadius: 8,
            color: D.t2,
            padding: '8px 14px',
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: 'DM Sans, sans-serif',
          }}
        >
          menuvia.ro →
        </button>
      </header>

      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '0 24px' }}>
        {/* Hero */}
        <section style={{ padding: '72px 0 48px', textAlign: 'center' }}>
          <div
            style={{
              fontSize: 12,
              color: D.gold,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              fontWeight: 600,
              marginBottom: 16,
            }}
          >
            Suporturi QR fizice
          </div>
          <h1
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 'clamp(32px, 5vw, 52px)',
              fontWeight: 500,
              lineHeight: 1.12,
              letterSpacing: '-0.02em',
              margin: '0 auto 18px',
              maxWidth: 720,
            }}
          >
            Codul tău QR, ca <em style={{ color: D.gold, fontStyle: 'italic' }}>obiect</em>.
          </h1>
          <p style={{ fontSize: 17, color: D.t2, lineHeight: 1.55, maxWidth: 560, margin: '0 auto' }}>
            Standuri de masă, plăcuțe gravate și carduri NFC cu orice link vrei: meniul digital,
            recenziile Google, site-ul tău. Pentru restaurante, saloane, cabinete, pensiuni,
            evenimente.
          </p>
        </section>

        {/* Catalog */}
        <section style={{ paddingBottom: 24 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: 14,
            }}
          >
            {PRODUCTS.map((p) => {
              const active = p.key === product
              return (
                <button
                  key={p.key}
                  onClick={() => {
                    setProduct(p.key)
                    document.getElementById('comanda')?.scrollIntoView({ behavior: 'smooth' })
                  }}
                  style={{
                    textAlign: 'left',
                    background: active ? 'rgba(212,175,55,0.08)' : D.s2,
                    border: `1px solid ${active ? D.gold : D.border}`,
                    borderRadius: 14,
                    padding: '20px 18px',
                    cursor: 'pointer',
                    color: D.t1,
                    fontFamily: 'DM Sans, sans-serif',
                    position: 'relative',
                  }}
                >
                  {p.badge && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 12,
                        right: 12,
                        background: `${D.gold}22`,
                        color: D.gold,
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        borderRadius: 100,
                        padding: '3px 9px',
                      }}
                    >
                      {p.badge}
                    </span>
                  )}
                  <Icon name={p.icon} size={22} color={D.gold} />
                  <div style={{ fontWeight: 700, fontSize: 15, margin: '10px 0 4px' }}>{p.name}</div>
                  <div style={{ fontSize: 13, color: D.t2, lineHeight: 1.5, marginBottom: 12 }}>
                    {p.desc}
                  </div>
                  <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, color: D.gold }}>
                    {p.price} lei
                    <span style={{ fontSize: 12, color: D.t3, fontFamily: 'DM Sans, sans-serif' }}>
                      {' '}
                      / buc
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* Cum funcționează */}
        <section style={{ padding: '48px 0' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 14,
            }}
          >
            {STEPS.map((s, i) => (
              <div
                key={s.t}
                style={{
                  background: D.s2,
                  border: `1px solid ${D.border}`,
                  borderRadius: 14,
                  padding: '18px 20px',
                }}
              >
                <div
                  style={{
                    fontFamily: 'Fraunces, serif',
                    fontSize: 20,
                    color: D.gold,
                    marginBottom: 8,
                  }}
                >
                  {i + 1}. {s.t}
                </div>
                <div style={{ fontSize: 14, color: D.t2, lineHeight: 1.55 }}>{s.d}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Puntea spre Menuvia — cross-sell onest, în ambele direcții. */}
        <section
          style={{
            background: 'rgba(212,175,55,0.06)',
            border: `1px solid rgba(212,175,55,0.25)`,
            borderRadius: 14,
            padding: '22px 24px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 16,
            justifyContent: 'space-between',
          }}
        >
          <div style={{ maxWidth: 620 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
              Vrei ca QR-ul să deschidă un meniu digital cu comenzi?
            </div>
            <div style={{ fontSize: 14, color: D.t2, lineHeight: 1.5 }}>
              Menuvia îți face meniul digital în câteva minute (import din poză cu AI, 7 limbi,
              comenzi la masă). Comanzi suporturile aici, iar QR-ul vine gata legat de meniul tău.
            </div>
          </div>
          <button
            onClick={() => navigate('/')}
            style={{
              background: D.gold,
              color: '#0A0908',
              border: 'none',
              borderRadius: 10,
              padding: '12px 22px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
              whiteSpace: 'nowrap',
            }}
          >
            Descoperă Menuvia →
          </button>
        </section>

        {/* Formular comandă */}
        <section id="comanda" style={{ padding: '56px 0 80px', scrollMarginTop: 72 }}>
          <div style={{ maxWidth: 640, margin: '0 auto' }}>
            <h2
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: 'clamp(26px, 4vw, 38px)',
                fontWeight: 500,
                letterSpacing: '-0.02em',
                margin: '0 0 8px',
              }}
            >
              Comandă
            </h2>
            <p style={{ fontSize: 15, color: D.t2, lineHeight: 1.55, marginBottom: 28 }}>
              Fără plată online: trimiți comanda, te sunăm în 24h pentru confirmare și design,
              plătești ramburs la livrare sau prin transfer.
            </p>

            {done ? (
              <div
                style={{
                  background: 'rgba(74,222,128,0.08)',
                  border: '1px solid rgba(74,222,128,0.3)',
                  borderRadius: 14,
                  padding: '26px 24px',
                }}
              >
                <div style={{ fontSize: 17, fontWeight: 700, color: D.green, marginBottom: 6 }}>
                  Comanda a fost trimisă ✓
                </div>
                <div style={{ fontSize: 14, color: D.t2, lineHeight: 1.55 }}>
                  Te contactăm în maximum 24 de ore pentru confirmare. Dacă nu primești telefonul
                  nostru, scrie-ne la pilot@menuvia.ro.
                </div>
              </div>
            ) : (
              <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                  <div>
                    <label htmlFor="cv-product" style={labelStyle}>
                      Produs *
                    </label>
                    <select
                      id="cv-product"
                      value={product}
                      onChange={(e) => setProduct(e.target.value)}
                      style={{ ...fieldStyle, appearance: 'auto' }}
                    >
                      {PRODUCTS.map((p) => (
                        <option key={p.key} value={p.key} style={{ color: '#000' }}>
                          {p.name} — {p.price} lei/buc
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="cv-qty" style={labelStyle}>
                      Cantitate *
                    </label>
                    <input
                      id="cv-qty"
                      type="number"
                      min={1}
                      max={500}
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      style={fieldStyle}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label htmlFor="cv-name" style={labelStyle}>
                      Numele tău *
                    </label>
                    <input
                      id="cv-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ion Popescu"
                      style={fieldStyle}
                    />
                  </div>
                  <div>
                    <label htmlFor="cv-business" style={labelStyle}>
                      Local / firmă
                    </label>
                    <input
                      id="cv-business"
                      value={business}
                      onChange={(e) => setBusiness(e.target.value)}
                      placeholder="Bistro Central"
                      style={fieldStyle}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label htmlFor="cv-phone" style={labelStyle}>
                      Telefon *
                    </label>
                    <input
                      id="cv-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="07xx xxx xxx"
                      style={fieldStyle}
                    />
                  </div>
                  <div>
                    <label htmlFor="cv-email" style={labelStyle}>
                      Email *
                    </label>
                    <input
                      id="cv-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@local.ro"
                      style={fieldStyle}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="cv-address" style={labelStyle}>
                    Adresă de livrare *
                  </label>
                  <input
                    id="cv-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Str., nr., oraș, județ"
                    style={fieldStyle}
                  />
                </div>

                <div>
                  <label htmlFor="cv-slug" style={labelStyle}>
                    Meniul tău Menuvia (opțional)
                  </label>
                  <input
                    id="cv-slug"
                    value={menuSlug}
                    onChange={(e) => setMenuSlug(e.target.value)}
                    placeholder="slug-ul din menuvia.ro/m/…"
                    style={fieldStyle}
                  />
                  <div style={{ fontSize: 12, color: D.t3, marginTop: 5 }}>
                    Dacă îl completezi, QR-ul vine deja legat de meniul tău. Fără el, tipărim
                    linkul pe care ni-l dai la confirmarea telefonică.
                  </div>
                </div>

                <div>
                  <label htmlFor="cv-message" style={labelStyle}>
                    Mesaj (opțional)
                  </label>
                  <textarea
                    id="cv-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    placeholder="Logo, culori, alt link pentru QR…"
                    style={{ ...fieldStyle, resize: 'vertical' }}
                  />
                </div>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    fontSize: 13,
                    color: D.t2,
                    lineHeight: 1.5,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    Sunt de acord cu prelucrarea datelor de contact pentru confirmarea și livrarea
                    comenzii (politica de confidențialitate Menuvia).
                  </span>
                </label>

                {err && (
                  <div
                    style={{
                      background: 'rgba(248,113,113,0.08)',
                      border: '1px solid rgba(248,113,113,0.3)',
                      borderRadius: 10,
                      padding: '12px 14px',
                      fontSize: 14,
                      color: D.red,
                    }}
                  >
                    {err}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  style={{
                    background: D.gold,
                    color: '#0A0908',
                    border: 'none',
                    borderRadius: 10,
                    padding: '15px 28px',
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: busy ? 'wait' : 'pointer',
                    fontFamily: 'DM Sans, sans-serif',
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  {busy
                    ? 'Se trimite…'
                    : `Trimite comanda — ${selected.name} × ${qtyNum} (~${selected.price * qtyNum} lei)`}
                </button>
              </form>
            )}
          </div>
        </section>
      </main>

      <footer
        style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          padding: '22px 24px',
          textAlign: 'center',
          fontSize: 12,
          color: D.t3,
        }}
      >
        Codvia · un produs din familia{' '}
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: 'none',
            color: D.gold,
            cursor: 'pointer',
            fontSize: 12,
            padding: 0,
            fontFamily: 'DM Sans, sans-serif',
          }}
        >
          Menuvia
        </button>
      </footer>
    </div>
  )
}
