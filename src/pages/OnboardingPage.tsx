import { useRef, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'
import { createRestaurant } from '../lib/restaurants'
import { Icon } from '../components/ui/Icon'
import type { IconName } from '../components/ui/Icon'
import { fetchRestaurantFeatures, getLimit, hasFeature } from '../lib/features'

// ─── Limbă UI ────────────────────────────────────────────────
// Citită o singură dată, la încărcarea modulului — nu e state, nu se
// schimbă mid-flow. Convenția: cheia localStorage 'menuvia_ui_lang'
// ('ro' | 'en'), setată de /auth prin ?lang=en. Default absolut: 'ro'.
const lang: 'ro' | 'en' = localStorage.getItem('menuvia_ui_lang') === 'en' ? 'en' : 'ro'

const S = {
  ro: {
    common: {
      progressLabel: (step: number, total: number) => `Pas ${step} din ${total}`,
    },
    step1: {
      title: 'Configurează restaurantul',
      subtitle: 'Informații de bază — le poți schimba oricând din Setări.',
      nameLabel: 'Numele restaurantului *',
      namePlaceholder: 'La Bella Trattoria',
      cityLabel: 'Oraș',
      cityPlaceholder: 'Focșani',
      slugLabel: 'URL meniu public',
      slugPrefix: 'menuvia.ro/m/',
      slugPlaceholder: 'la-bella-trattoria',
      nameRequiredError: 'Numele restaurantului este obligatoriu.',
      unknownError: 'Eroare necunoscută',
      slugTakenError: 'Acest URL e deja folosit. Alege altul.',
      savingBtn: 'Se creează...',
      continueBtn: 'Continuă →',
    },
    step2: {
      title: 'Adaugă primul produs',
      subtitle: 'Un produs e de ajuns acum. Adaugi restul din dashboard.',
      categoryLabel: 'Categorie',
      quickCats: [
        { name: 'Aperitive', emoji: '🥗' },
        { name: 'Feluri principale', emoji: '🍽️' },
        { name: 'Pizza', emoji: '🍕' },
        { name: 'Paste', emoji: '🍝' },
        { name: 'Deserturi', emoji: '🍰' },
        { name: 'Băuturi', emoji: '🥤' },
      ],
      defaultCatName: 'Feluri principale',
      defaultCatEmoji: '🍽️',
      catEmojiAriaLabel: 'Emoji categorie',
      catNamePlaceholder: 'Feluri principale',
      productLabel: 'Produs *',
      prodEmojiAriaLabel: 'Emoji produs',
      prodNamePlaceholder: 'Spaghete Carbonara',
      priceLabel: 'Preț (lei) *',
      pricePlaceholder: '32',
      categoryNameRequiredError: 'Numele categoriei este obligatoriu.',
      productNameRequiredError: 'Numele produsului este obligatoriu.',
      priceError: 'Prețul trebuie să fie un număr pozitiv.',
      savingBtn: 'Se salvează...',
      saveContinueBtn: 'Salvează și continuă →',
      skipBtn: 'Sari peste acest pas →',
    },
    step3: {
      title: 'Câte mese are restaurantul?',
      subtitle:
        'Vom crea mese numerotate automat (Masa 1, Masa 2...) cu QR-uri gata de printat. Le redenumești din dashboard.',
      // Numele/slug-ul meselor create urmează limba fluxului — subtitlul de
      // mai sus promite exact schema asta de numire.
      tableName: (n: number) => `Masa ${n}`,
      tableSlug: (n: number) => `masa-${n}`,
      decreaseAria: 'Scade numărul de mese',
      increaseAria: 'Crește numărul de mese',
      tablesUnit: 'mese',
      planHintPrefix: 'Planul tău include până la ',
      planHintTables: (n: number) => `${n} mese`,
      planHintSuffix: '. Poți adăuga mai multe oricând cu un upgrade.',
      createsTablesPrefix: 'Se creează ',
      createsTablesBold: (n: number) => `${n} mese`,
      createsTablesSuffix: ' cu QR-uri unice',
      pdfPrefix: 'PDF gata de printat din tab-ul ',
      pdfTabName: 'Mese & QR',
      renameAnytime: 'Le redenumești sau ștergi oricând',
      tableCountRangeError: (cap: number) => `Numărul de mese trebuie să fie între 1 și ${cap}.`,
      planLimitKnownError: (maxTables: number) =>
        `Planul tău permite maximum ${maxTables} mese. Alege mai puține sau fă upgrade pentru mai multe.`,
      planLimitUnknownError:
        'Planul tău nu permite atâtea mese. Alege mai puține sau fă upgrade pentru mai multe.',
      createTablesGenericError: 'Nu am putut crea mesele. Reîncearcă.',
      pickupActivateError: 'Nu am putut activa modul de ridicare. Reîncearcă.',
      creatingTablesBtn: (count: number) => `Se creează ${count} mese...`,
      createTablesBtn: (count: number) => `Creează ${count} mese →`,
      skipBtn: 'Sari peste acest pas →',
      pickupOnlyBtn: 'Nu am mese — doar ridicare (food truck) →',
      pickupHint:
        'Comenzile pentru ridicare necesită planul 🛎 Meniu + Comenzi — meniul QR general funcționează și pe planul curent.',
    },
    step4: {
      title: 'Ești gata!',
      subtitle: 'Restaurantul tău e configurat și live.',
      achievements: [
        { icon: 'home' as IconName, title: 'Restaurant creat' },
        { icon: 'menu' as IconName, title: 'Meniu configurat' },
        { icon: 'table' as IconName, title: 'Mese și QR-uri' },
        { icon: 'qr' as IconName, title: 'Gata de comenzi' },
      ],
      achievementDoneLabel: 'finalizat',
      menuLinkLabel: 'Link meniu public',
      copyBtnAriaLabel: 'Copiază link-ul meniului',
      copiedLabel: 'Copiat!',
      copyLabel: 'Copiază',
      nextStepsTitle: 'Următorii pași în dashboard:',
      nextStepAddProducts: 'Adaugă restul produselor din meniu',
      nextStepPrintQr: 'Printează QR-urile din tab-ul Mese & QR',
      nextStepInviteTeam: 'Invită echipa din Setări → Echipă (de la planul Meniu + Comenzi)',
      nextStepTrackOrders: 'Urmărește comenzile live din Bucătărie',
      finishingBtn: 'Se deschide...',
      doneBtn: 'Deschide dashboard-ul →',
    },
  },
  en: {
    common: {
      progressLabel: (step: number, total: number) => `Step ${step} of ${total}`,
    },
    step1: {
      title: 'Set up your restaurant',
      subtitle: "Basic info — you can change it anytime from Settings.",
      nameLabel: 'Restaurant name *',
      namePlaceholder: 'The Golden Fork',
      cityLabel: 'City',
      cityPlaceholder: 'Manchester',
      slugLabel: 'Public menu URL',
      slugPrefix: 'menuvia.ro/m/',
      slugPlaceholder: 'the-golden-fork',
      nameRequiredError: 'Restaurant name is required.',
      unknownError: 'Unknown error',
      slugTakenError: 'This URL is already taken. Choose another one.',
      savingBtn: 'Creating...',
      continueBtn: 'Continue →',
    },
    step2: {
      title: 'Add your first product',
      subtitle: 'One product is enough for now. Add the rest from the dashboard.',
      categoryLabel: 'Category',
      quickCats: [
        { name: 'Starters', emoji: '🥗' },
        { name: 'Main Courses', emoji: '🍽️' },
        { name: 'Pizza', emoji: '🍕' },
        { name: 'Pasta', emoji: '🍝' },
        { name: 'Desserts', emoji: '🍰' },
        { name: 'Drinks', emoji: '🥤' },
      ],
      defaultCatName: 'Main Courses',
      defaultCatEmoji: '🍽️',
      catEmojiAriaLabel: 'Category emoji',
      catNamePlaceholder: 'Main Courses',
      productLabel: 'Product *',
      prodEmojiAriaLabel: 'Product emoji',
      prodNamePlaceholder: 'Grilled Chicken Sandwich',
      priceLabel: 'Price (RON) *',
      pricePlaceholder: '32',
      categoryNameRequiredError: 'Category name is required.',
      productNameRequiredError: 'Product name is required.',
      priceError: 'Price must be a positive number.',
      savingBtn: 'Saving...',
      saveContinueBtn: 'Save and continue →',
      skipBtn: 'Skip this step →',
    },
    step3: {
      title: 'How many tables does your restaurant have?',
      subtitle:
        "We'll create automatically numbered tables (Table 1, Table 2...) with QR codes ready to print. You can rename them from the dashboard.",
      tableName: (n: number) => `Table ${n}`,
      tableSlug: (n: number) => `table-${n}`,
      decreaseAria: 'Decrease table count',
      increaseAria: 'Increase table count',
      tablesUnit: 'tables',
      planHintPrefix: 'Your plan includes up to ',
      planHintTables: (n: number) => `${n} tables`,
      planHintSuffix: '. You can add more anytime with an upgrade.',
      createsTablesPrefix: 'This creates ',
      createsTablesBold: (n: number) => `${n} tables`,
      createsTablesSuffix: ' with unique QR codes',
      pdfPrefix: 'PDF ready to print from the ',
      pdfTabName: 'Tables & QR',
      renameAnytime: 'Rename or delete them anytime',
      tableCountRangeError: (cap: number) => `The number of tables must be between 1 and ${cap}.`,
      planLimitKnownError: (maxTables: number) =>
        `Your plan allows a maximum of ${maxTables} tables. Choose fewer or upgrade for more.`,
      planLimitUnknownError:
        "Your plan doesn't allow that many tables. Choose fewer or upgrade for more.",
      createTablesGenericError: "We couldn't create the tables. Try again.",
      pickupActivateError: "We couldn't enable pickup mode. Try again.",
      creatingTablesBtn: (count: number) => `Creating ${count} tables...`,
      createTablesBtn: (count: number) => `Create ${count} tables →`,
      skipBtn: 'Skip this step →',
      pickupOnlyBtn: 'No tables — pickup only (food truck) →',
      pickupHint:
        'Pickup orders require the 🛎 Menu + Orders plan — the general QR menu still works on your current plan.',
    },
    step4: {
      title: "You're all set!",
      subtitle: 'Your restaurant is set up and live.',
      achievements: [
        { icon: 'home' as IconName, title: 'Restaurant created' },
        { icon: 'menu' as IconName, title: 'Menu set up' },
        { icon: 'table' as IconName, title: 'Tables and QR codes' },
        { icon: 'qr' as IconName, title: 'Ready for orders' },
      ],
      achievementDoneLabel: 'done',
      menuLinkLabel: 'Public menu link',
      copyBtnAriaLabel: 'Copy the menu link',
      copiedLabel: 'Copied!',
      copyLabel: 'Copy',
      nextStepsTitle: 'Next steps in the dashboard:',
      nextStepAddProducts: 'Add the rest of your menu items',
      nextStepPrintQr: 'Print the QR codes from the Tables & QR tab',
      nextStepInviteTeam: 'Invite your team from Settings → Team (from the Menu + Orders plan)',
      nextStepTrackOrders: 'Track live orders from the Kitchen',
      finishingBtn: 'Opening...',
      doneBtn: 'Open the dashboard →',
    },
  },
} as const

const t = S[lang]

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
  // Touch target ≥44px (onboarding-ul se face tipic de pe telefon)
  minHeight: 44,
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
          {t.common.progressLabel(step, total)}
        </span>
        <span style={{ fontSize: '0.75rem', color: D.t3 }}>
          {Math.round((step / total) * 100)}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step}
        aria-label={t.common.progressLabel(step, total)}
        style={{ height: 4, background: D.s3, borderRadius: 2, overflow: 'hidden' }}
      >
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
      {/* Step dots — pur decorative; informația e deja în „Pas X din Y" */}
      <div
        aria-hidden="true"
        style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}
      >
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
      setError(t.step1.nameRequiredError)
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
      const msg = err instanceof Error ? err.message : t.step1.unknownError
      setError(msg.includes('slug') ? t.step1.slugTakenError : msg)
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
        {t.step1.title}
      </h1>
      <p style={{ color: D.t2, fontSize: '0.85rem', marginBottom: 24, lineHeight: 1.6 }}>
        {t.step1.subtitle}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label htmlFor="ob-name" style={label}>
            {t.step1.nameLabel}
          </label>
          <input
            id="ob-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setSlug(slugify(e.target.value))
            }}
            placeholder={t.step1.namePlaceholder}
            style={inp}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="ob-city" style={label}>
            {t.step1.cityLabel}
          </label>
          <input
            id="ob-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={t.step1.cityPlaceholder}
            style={inp}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
        </div>
        <div>
          <label htmlFor="ob-slug" style={label}>
            {t.step1.slugLabel}
          </label>
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
              {t.step1.slugPrefix}
            </span>
            <input
              id="ob-slug"
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value))}
              placeholder={t.step1.slugPlaceholder}
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
          {saving ? t.step1.savingBtn : t.step1.continueBtn}
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
  // <string> explicit: fără el, tipurile React inferează LITERALUL din
  // `as const` („Feluri principale" | „Main Courses") → setCatName(e.target.value)
  // pică pe Netlify cu TS2345 (invizibil pe tsc-ul standalone — capcana din
  // CLAUDE.md cu erorile dependente de tipurile React).
  const [catName, setCatName] = useState<string>(t.step2.defaultCatName)
  const [catEmoji, setCatEmoji] = useState<string>(t.step2.defaultCatEmoji)
  const [prodName, setProdName] = useState('')
  const [prodPrice, setProdPrice] = useState('')
  const [prodEmoji, setProdEmoji] = useState('🍕')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Categoria creată se reține între încercări: pe retry după eșecul produsului,
  // NU mai inserăm o categorie nouă (duplicat), refolosim id-ul deja creat.
  const createdCatId = useRef<string | null>(null)

  const QUICK_CATS = t.step2.quickCats

  const handleSave = async () => {
    if (!catName.trim()) {
      setError(t.step2.categoryNameRequiredError)
      return
    }
    if (!prodName.trim()) {
      setError(t.step2.productNameRequiredError)
      return
    }
    const price = parseFloat(prodPrice)
    if (!prodPrice || isNaN(price) || price <= 0) {
      setError(t.step2.priceError)
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
        {t.step2.title}
      </h1>
      <p style={{ color: D.t2, fontSize: '0.85rem', marginBottom: 24, lineHeight: 1.6 }}>
        {t.step2.subtitle}
      </p>

      {/* Quick cat select */}
      <div style={{ marginBottom: 14 }}>
        <label htmlFor="ob-cat-name" style={label}>
          {t.step2.categoryLabel}
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {QUICK_CATS.map((c) => (
            <button
              key={c.name}
              onClick={() => {
                setCatName(c.name)
                setCatEmoji(c.emoji)
              }}
              aria-pressed={catName === c.name}
              style={{
                padding: '5px 11px',
                minHeight: 44,
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
            aria-label={t.step2.catEmojiAriaLabel}
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
            id="ob-cat-name"
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            placeholder={t.step2.catNamePlaceholder}
            style={{ ...inp, flex: 1 }}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
        </div>
      </div>

      <div style={{ height: 1, background: D.border, margin: '18px 0' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
        <div>
          <label htmlFor="ob-prod-name" style={label}>
            {t.step2.productLabel}
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={prodEmoji}
              onChange={(e) => setProdEmoji(e.target.value)}
              aria-label={t.step2.prodEmojiAriaLabel}
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
              id="ob-prod-name"
              value={prodName}
              onChange={(e) => setProdName(e.target.value)}
              placeholder={t.step2.prodNamePlaceholder}
              style={{ ...inp, flex: 1 }}
              autoFocus
              onFocus={(e) => (e.target.style.borderColor = D.gold)}
              onBlur={(e) => (e.target.style.borderColor = D.border)}
            />
          </div>
        </div>
        <div>
          <label htmlFor="ob-prod-price" style={label}>
            {t.step2.priceLabel}
          </label>
          <input
            id="ob-prod-price"
            value={prodPrice}
            onChange={(e) => setProdPrice(e.target.value)}
            placeholder={t.step2.pricePlaceholder}
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
          {saving ? t.step2.savingBtn : t.step2.saveContinueBtn}
        </button>
        <button onClick={onSkip} style={btnSecondary}>
          {t.step2.skipBtn}
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
      setError(t.step3.tableCountRangeError(cap))
      return
    }
    setSaving(true)
    setError(null)

    // Create N tables named "Masa 1"/"Table 1"... (limba fluxului de onboarding)
    const tables = Array.from({ length: count }, (_, i) => ({
      restaurant_id: restaurantId,
      name: t.step3.tableName(i + 1),
      slug: t.step3.tableSlug(i + 1),
      seats: 4,
      is_active: true,
    }))
    const { data: createdTables, error: tErr } = await supabase
      .from('tables')
      .insert(tables)
      .select('id')
    if (tErr || !createdTables) {
      // Nu expunem textul brut Postgres; mapăm cazurile cunoscute.
      // Când limita planului nu e cunoscută (fetch features eșuat → maxTables null),
      // NU interpolăm plafonul implicit de UI (50) — ar afișa un maxim fals.
      const m = tErr?.message || ''
      setError(
        /limit|maxim|plan/i.test(m)
          ? maxTables !== null
            ? t.step3.planLimitKnownError(maxTables)
            : t.step3.planLimitUnknownError
          : t.step3.createTablesGenericError,
      )
      setSaving(false)
      return
    }

    // Create qr_tokens for each table. Verificăm eroarea: dacă eșuează, NU marcăm
    // qr_generated ca să nu raportăm o stare inconsistentă (mese fără QR).
    const tokens = createdTables.map((tbl) => ({ restaurant_id: restaurantId, table_id: tbl.id }))
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
      setError(t.step3.pickupActivateError)
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
        {t.step3.title}
      </h1>
      <p style={{ color: D.t2, fontSize: '0.85rem', marginBottom: 28, lineHeight: 1.6 }}>
        {t.step3.subtitle}
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
          aria-label={t.step3.decreaseAria}
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
          <div style={{ fontSize: '0.78rem', color: D.t3, marginTop: 4 }}>{t.step3.tablesUnit}</div>
        </div>
        <button
          onClick={() => setCount((c) => Math.min(cap, c + 1))}
          aria-label={t.step3.increaseAria}
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
          {t.step3.planHintPrefix}
          <strong style={{ color: D.t2 }}>{t.step3.planHintTables(maxTables)}</strong>
          {t.step3.planHintSuffix}
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
            aria-pressed={count === n}
            style={{
              padding: '5px 13px',
              minHeight: 44,
              minWidth: 44,
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
              {t.step3.createsTablesPrefix}
              <strong style={{ color: D.t1 }}>{t.step3.createsTablesBold(count)}</strong>
              {t.step3.createsTablesSuffix}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={14} color={D.green} />
            <span>
              {t.step3.pdfPrefix}
              <strong style={{ color: D.t1 }}>{t.step3.pdfTabName}</strong>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={14} color={D.green} />
            <span>{t.step3.renameAnytime}</span>
          </div>
        </div>
      </div>

      {error && <ErrorBox msg={error} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={handleCreate} disabled={saving} style={saving ? btnDisabled : btnPrimary}>
          {saving ? t.step3.creatingTablesBtn(count) : t.step3.createTablesBtn(count)}
        </button>
        <button onClick={onSkip} style={btnSecondary}>
          {t.step3.skipBtn}
        </button>
        {/* Food truck / tejghea (E3): activează pickup + modul „doar ridicare"
            — fără mese; QR-ul general /m/:slug devine QR-ul principal. */}
        <button onClick={handlePickupOnly} disabled={saving} style={btnSecondary}>
          {t.step3.pickupOnlyBtn}
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
            {t.step3.pickupHint}
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

  // Feedback de salvare pe CTA-ul final — fără el, pe conexiune lentă butonul
  // părea mort și invita la double-click.
  const [finishing, setFinishing] = useState(false)
  const handleDone = async () => {
    if (finishing) return
    setFinishing(true)
    await supabase
      .from('onboarding_state')
      .update({ completed_at: new Date().toISOString() })
      .eq('restaurant_id', restaurantId)
    onComplete()
  }

  const achievements: { icon: IconName; title: string; done: boolean }[] = t.step4.achievements.map(
    (a) => ({ ...a, done: true }),
  )

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
          {t.step4.title}
        </h1>
        <p style={{ color: D.t2, fontSize: '0.85rem', lineHeight: 1.6 }}>{t.step4.subtitle}</p>
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
            <Icon name="check" size={16} color={D.green} label={t.step4.achievementDoneLabel} />
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
          {t.step4.menuLinkLabel}
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
            aria-label={t.step4.copyBtnAriaLabel}
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
            {copied ? t.step4.copiedLabel : t.step4.copyLabel}
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
            {t.step4.nextStepsTitle}
          </strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="orders" size={15} color={D.t3} />
              <span>{t.step4.nextStepAddProducts}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="printer" size={15} color={D.t3} />
              <span>{t.step4.nextStepPrintQr}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="users" size={15} color={D.t3} />
              <span>{t.step4.nextStepInviteTeam}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="chart" size={15} color={D.t3} />
              <span>{t.step4.nextStepTrackOrders}</span>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={() => void handleDone()}
        disabled={finishing}
        style={finishing ? btnDisabled : btnPrimary}
      >
        {finishing ? t.step4.finishingBtn : t.step4.doneBtn}
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
