import { useRef, useEffect, useState, lazy, Suspense } from 'react'
import { supabase } from '../lib/supabase'
import { D, PLAN_LABELS } from '../lib/constants'
import { createRestaurant } from '../lib/restaurants'
import { consumeOnboardingPreset } from '../lib/onboardingPreset'
import { Icon } from '../components/ui/Icon'
import type { IconName } from '../components/ui/Icon'
import { fetchRestaurantFeatures, getLimit, getLimitDetailed, hasFeature } from '../lib/features'
import { track } from '../lib/analytics'
import { browserSite, publicBaseUrl, siteHost } from '../lib/domain'
import { COUNTRIES, restaurantCountryPatch } from '../lib/countries'
import { clearPendingCountry, storePendingCountry } from '../lib/pendingCountry'
import { slugify } from '../lib/slug'
import type { PlanIntentId } from '../lib/planIntent'
import { useSuppressPwaPrompts } from '../lib/pwaGate'
import {
  onboardingSummary,
  printableTables,
  type MenuOutcome,
  type SummaryItem,
  type SummaryKey,
  type TablesOutcome,
} from '../lib/onboardingSummary'
import { toUserMessage } from '../lib/userMessages'
import { FunnelLangProvider } from '../i18n/UiLangContext'
import { useT } from '../i18n/useT'
import { commonNs } from '../i18n/ns/common'
import { describeStaffError } from '../i18n/staffErrors'
import type { Translator } from '../i18n/core'
import { onboardingNs } from '../i18n/ns/onboarding'
import type onboardingRo from '../i18n/ns/onboarding/ro'

// Lazy ca în ProductsTab: modalul de import AI nu intră în chunk-ul de
// onboarding decât dacă userul chiar apasă butonul de import din poză.
const AiMenuImport = lazy(() => import('../components/AiMenuImport'))

// ─── Limbă UI ────────────────────────────────────────────────
// Textele stau în namespace-ul `onboarding` (src/i18n/ns/onboarding, lotul
// L2b), iar limba o alege `FunnelLangProvider`, ca pe /auth: `?lang=` → limba
// contului → `menuvia_ui_lang` → site-ul, pe `FUNNEL_LANGS`. Citită o dată, la
// montare — nu se schimbă la mijlocul fluxului.
const site = browserSite()
const askCountry = site === 'com'

type OnbT = Translator<typeof onboardingRo>

// Categoriile rapide de la pasul 2: emoji-ul e al codului, numele al limbii.
const QUICK_CAT_EMOJIS = ['🥗', '🍽️', '🍕', '🍝', '🍰', '🥤'] as const
const QUICK_CAT_KEYS = [
  'step2_cat1',
  'step2_cat2',
  'step2_cat3',
  'step2_cat4',
  'step2_cat5',
  'step2_cat6',
] as const
const DEFAULT_CAT_EMOJI = '🍽️'

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
// Linkul spre meniul demo (Skip-ul din Pasul 2): chip lat, discret — nu
// concurează vizual cu importul din poză și cu salvarea manuală.
const linkDemo: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  boxSizing: 'border-box',
  background: D.s3,
  color: D.t2,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '10px 12px',
  minHeight: 44,
  fontFamily: 'DM Sans,sans-serif',
  fontSize: '0.82rem',
  textDecoration: 'none',
}
const label: React.CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  color: D.t2,
  marginBottom: 6,
}

// Accentul cu care se creează restaurantul (Pasul 1) și se tipăresc QR-urile (Pasul 4).
const ONBOARDING_ACCENT = '#C8963C'

function markOnboarding(restaurantId: string, fields: Record<string, boolean | string | null>) {
  return supabase.from('onboarding_state').update(fields).eq('restaurant_id', restaurantId)
}

// ─── Progress bar ─────────────────────────────────────────────
function Progress({ step, total = 4 }: { step: number; total?: number }) {
  const { t } = useT(onboardingNs)
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
          {t('common_progressLabel', { step, total })}
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
        aria-label={t('common_progressLabel', { step, total })}
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
function Step1Restaurant({
  onNext,
}: {
  onNext: (restaurantId: string, slug: string, name: string) => void
}) {
  const { t } = useT(onboardingNs)
  const tc = useT(commonNs)
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Restaurantul deja creat într-o încercare anterioară a cărei salvare a
  // țării a picat: la reîncercare NU mai creăm un al doilea restaurant.
  const createdRef = useRef<{ restaurant_id: string; restaurant_slug: string } | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) {
      setError(t('step1_nameRequiredError'))
      return
    }
    if (askCountry && !country) {
      setError(t('step1_countryRequiredError'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created =
        createdRef.current ??
        (await createRestaurant({
          name: name.trim(),
          city: city.trim() || null,
          slug: slugify(name),
          primaryColor: ONBOARDING_ACCENT,
        }))
      createdRef.current = created
      // Țara (mig 296) + moneda/fusul propuse pentru ea. Pe 'RO' patch-ul e
      // null → zero apeluri în plus. Owner-ul tocmai a creat restaurantul,
      // deci trece de trg_restaurants_country_owner_only.
      const patch = askCountry ? restaurantCountryPatch(country) : null
      if (patch) {
        // Intenția se păstrează ÎNAINTE de UPDATE și se șterge DOAR pe succes:
        // dacă UPDATE-ul pică și omul face reload (onboarding-ul e sărit,
        // restaurantul există), dashboard-ul owner-ului o reîncearcă
        // (lib/pendingCountry.ts) — altfel localul rămânea tăcut pe 'RO'.
        storePendingCountry(created.restaurant_id, patch.country)
        const { error: countryErr } = await supabase
          .from('restaurants')
          .update(patch)
          .eq('id', created.restaurant_id)
        if (countryErr) {
          console.warn('[onboarding] salvarea țării a eșuat:', countryErr)
          setError(t('step1_countrySaveError'))
          setSaving(false)
          return
        }
        clearPendingCountry(created.restaurant_id)
      }
      // Preset „Menuvia Rezervări" (setat pe /rezervari, supraviețuiește
      // redirectului de auth): activăm modulul + auto-confirmarea din prima,
      // ca linkul de Google să fie funcțional imediat. BEST-EFFORT: un eșec
      // aici nu avortează onboarding-ul (userul poate porni manual din tab).
      // Rândul reservation_settings EXISTĂ deja (trigger la INSERT-ul
      // restaurantului, mig 057) → UPDATE simplu, nu upsert.
      if (consumeOnboardingPreset() === 'rezervari') {
        try {
          const { error: modErr } = await supabase.rpc('set_restaurant_module', {
            p_restaurant_id: created.restaurant_id,
            p_module_key: 'reservations',
            p_enabled: true,
          })
          if (modErr) throw modErr
          const { error: setErr } = await supabase
            .from('reservation_settings')
            .update({ auto_confirm: true })
            .eq('restaurant_id', created.restaurant_id)
          if (setErr) throw setErr
        } catch (presetErr) {
          console.warn('[onboarding] preset rezervari eșuat (continuăm):', presetErr)
        }
      }
      onNext(created.restaurant_id, created.restaurant_slug, name.trim())
    } catch (err) {
      // Mesajul brut e doar un SEMNAL (alocarea slug-ului), nu se afișează:
      // `create_restaurant` refuză cu text românesc (plafonul de locații), iar
      // clientul supabase cu text englezesc („Failed to fetch”). În română,
      // `describeStaffError` dă exact `toUserMessage`; în altă limbă clasa
      // erorii sau textul de rezervă, fără mesajul serverului (recenzia
      // CodeRabbit pe #360, OL4).
      const raw =
        err !== null && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : ''
      setError(
        raw.includes('slug')
          ? t('step1_slugAllocError')
          : describeStaffError(err, tc, { fallback: t('step1_unknownError') }),
      )
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
        {t('step1_title')}
      </h1>
      <p style={{ color: D.t2, fontSize: '0.85rem', marginBottom: 24, lineHeight: 1.6 }}>
        {t('step1_subtitle')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label htmlFor="ob-name" style={label}>
            {t('step1_nameLabel')}
          </label>
          <input
            id="ob-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('step1_namePlaceholder')}
            style={inp}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
        </div>
        <div>
          <label htmlFor="ob-city" style={label}>
            {t('step1_cityLabel')}
          </label>
          <input
            id="ob-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={t('step1_cityPlaceholder')}
            style={inp}
            onFocus={(e) => (e.target.style.borderColor = D.gold)}
            onBlur={(e) => (e.target.style.borderColor = D.border)}
          />
        </div>
        {/* Doar previzualizare: linkul se creează din nume, fără diacritice
            rupte („Casa Țărănească” → casa-taraneasca). Cel REAL (eventual cu
            sufix, dacă numele e luat) apare pe ecranul final. */}
        {name.trim() && (
          <div style={{ fontSize: '0.78rem', color: D.t3, lineHeight: 1.5 }}>
            {t('step1_linkPreviewLabel')}{' '}
            <span data-testid="ob-link-preview" style={{ color: D.t2, wordBreak: 'break-all' }}>
              {`${siteHost()}/m/`}
              {slugify(name)}
            </span>
            <div>{t('step1_linkPreviewHint')}</div>
          </div>
        )}
        {askCountry && (
          <div>
            <label htmlFor="ob-country" style={label}>
              {t('step1_countryLabel')}
            </label>
            <select
              id="ob-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              style={inp}
            >
              <option value="">{t('step1_countryPlaceholder')}</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && <ErrorBox msg={error} />}
        <button
          onClick={handleCreate}
          disabled={saving || !name.trim() || (askCountry && !country)}
          style={saving || !name.trim() || (askCountry && !country) ? btnDisabled : btnPrimary}
        >
          {saving ? t('step1_savingBtn') : t('step1_continueBtn')}
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
  onNext: (outcome: MenuOutcome) => void
  onSkip: () => void
}) {
  const { t } = useT(onboardingNs)
  // <string> explicit: fără el, tipurile React inferează LITERALUL din
  // `as const` („Feluri principale" | „Main Courses") → setCatName(e.target.value)
  // pică pe Netlify cu TS2345 (invizibil pe tsc-ul standalone — capcana din
  // CLAUDE.md cu erorile dependente de tipurile React).
  const [catName, setCatName] = useState<string>(t('step2_defaultCatName'))
  const [catEmoji, setCatEmoji] = useState<string>(DEFAULT_CAT_EMOJI)
  const [prodName, setProdName] = useState('')
  const [prodPrice, setProdPrice] = useState('')
  const [prodEmoji, setProdEmoji] = useState('🍕')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Categoria creată se reține între încercări: pe retry după eșecul produsului,
  // NU mai inserăm o categorie nouă (duplicat), refolosim id-ul deja creat.
  const createdCatId = useRef<string | null>(null)
  // Import din poză (audit aug 2026): 4/4 utilizatori reali au murit la
  // „introdu meniul" — cine are meniul în mână îl fotografiază, nu îl tastează.
  const [aiImportOpen, setAiImportOpen] = useState(false)
  // Nr. produse importate — setat de AiMenuImport la succes; la închiderea
  // modalului decide dacă pasul e gata (avansăm) sau doar închidem.
  const importedCountRef = useRef(0)
  // Plafonul de produse al planului, ca importul AI să-l știe ÎNAINTE de salvare:
  // fără el, pe planul gratuit (15) un meniu real de 25 de produse pica în bloc
  // cu „Nimic nu a fost salvat” (inserarea e atomică). Restaurantul a fost creat
  // la Pasul 1, iar pasul ăsta avansează la primul produs salvat, deci aici are 0
  // produse: locurile rămase = plafonul. Necunoscut (RPC picat) sau nelimitat →
  // undefined: decide serverul, ca înainte.
  const [productSlots, setProductSlots] = useState<number | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    void fetchRestaurantFeatures(restaurantId)
      .then((f) => {
        if (cancelled || !f) return
        const lim = getLimitDetailed(f, 'max_products')
        if (lim.kind === 'limited') setProductSlots(Math.max(0, lim.n))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [restaurantId])

  const handleImportClosed = async () => {
    setAiImportOpen(false)
    if (importedCountRef.current > 0) {
      track('product_imported_ai', { count: importedCountRef.current, source: 'onboarding' })
      await markOnboarding(restaurantId, { menu_created: true })
      onNext({ kind: 'products', count: importedCountRef.current })
    }
  }

  const QUICK_CATS = QUICK_CAT_KEYS.map((key, i) => ({ name: t(key), emoji: QUICK_CAT_EMOJIS[i] }))

  const handleSave = async () => {
    if (!catName.trim()) {
      setError(t('step2_categoryNameRequiredError'))
      return
    }
    if (!prodName.trim()) {
      setError(t('step2_productNameRequiredError'))
      return
    }
    const price = parseFloat(prodPrice)
    if (!prodPrice || isNaN(price) || price <= 0) {
      setError(t('step2_priceError'))
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
        setError(toUserMessage(catErr))
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
      setError(toUserMessage(prodErr))
      setSaving(false)
      return
    }
    // Telemetria funelului (audit aug 2026) — no-op fără consimțământ, zero PII.
    track('product_created', { source: 'onboarding' })

    // Mark onboarding
    await markOnboarding(restaurantId, { menu_created: true })
    onNext({ kind: 'products', count: 1 })
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
        {t('step2_title')}
      </h1>
      <p style={{ color: D.t2, fontSize: '0.85rem', marginBottom: 24, lineHeight: 1.6 }}>
        {t('step2_subtitle')}
      </p>

      {/* Importul din poză = acțiunea PRIMARĂ (audit aug 2026): 4/4 utilizatori
          reali au abandonat la introducerea manuală a meniului. Formularul
          manual rămâne dedesubt, sub separator. */}
      <button onClick={() => setAiImportOpen(true)} style={{ ...btnPrimary, marginBottom: 4 }}>
        {t('step2_photoImportBtn')}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 16px' }}>
        <div style={{ flex: 1, height: 1, background: D.border }} />
        <span style={{ fontSize: '0.75rem', color: D.t3 }}>{t('step2_orManualDivider')}</span>
        <div style={{ flex: 1, height: 1, background: D.border }} />
      </div>

      {/* Quick cat select */}
      <div style={{ marginBottom: 14 }}>
        <label htmlFor="ob-cat-name" style={label}>
          {t('step2_categoryLabel')}
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
            aria-label={t('step2_catEmojiAriaLabel')}
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
            placeholder={t('step2_catNamePlaceholder')}
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
            {t('step2_productLabel')}
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={prodEmoji}
              onChange={(e) => setProdEmoji(e.target.value)}
              aria-label={t('step2_prodEmojiAriaLabel')}
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
              placeholder={t('step2_prodNamePlaceholder')}
              style={{ ...inp, flex: 1 }}
              autoFocus
              onFocus={(e) => (e.target.style.borderColor = D.gold)}
              onBlur={(e) => (e.target.style.borderColor = D.border)}
            />
          </div>
        </div>
        <div>
          <label htmlFor="ob-prod-price" style={label}>
            {t('step2_priceLabel')}
          </label>
          <input
            id="ob-prod-price"
            value={prodPrice}
            onChange={(e) => setProdPrice(e.target.value)}
            placeholder={t('step2_pricePlaceholder')}
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
          {saving ? t('step2_savingBtn') : t('step2_saveContinueBtn')}
        </button>
        <button onClick={onSkip} style={btnSecondary}>
          {t('step2_skipBtn')}
        </button>
        {/* Alternativa la Skip: meniul demo public, într-o filă nouă (nu
            pierde pasul curent) — omul vede cum arată un meniu fără ca în
            restaurantul lui să apară produse false. */}
        <div style={{ fontSize: '0.78rem', color: D.t3, textAlign: 'center', marginTop: 4 }}>
          {t('step2_demoLead')}
        </div>
        <a href="/demo" target="_blank" rel="noopener noreferrer" style={linkDemo}>
          {t('step2_demoLink')}
        </a>
        <div style={{ fontSize: '0.72rem', color: D.t3, textAlign: 'center' }}>
          {t('step2_demoHint')}
        </div>
      </div>

      {aiImportOpen && (
        <Suspense fallback={null}>
          <AiMenuImport
            restaurantId={restaurantId}
            remainingSlots={productSlots}
            onImported={(count) => {
              importedCountRef.current = count
            }}
            // „Adaugă produsele manual" din bannerul de eroare AI: formularul
            // manual e chiar sub modal — doar închidem.
            onFallbackManual={() => setAiImportOpen(false)}
            onClose={() => void handleImportClosed()}
          />
        </Suspense>
      )}
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
  onNext: (outcome: TablesOutcome) => void
  onSkip: () => void
}) {
  const { t, tp } = useT(onboardingNs)
  // Limita de mese a planului (free=3). Citim de la server ca să nu trimitem
  // by-default mai multe mese decât permite planul — altfel trigger-ul (mig 114)
  // făcea rollback cu eroare brută și onboarding-ul standard pica pentru free.
  const [maxTables, setMaxTables] = useState<number | null>(null)
  const [count, setCount] = useState(5)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Comenzile pentru ridicare sunt growth+ (Gate A). TRISTATE: `null` = planul
  // nu e (încă) cunoscut. Pe un plan fără `pickup_orders` flag-ul nu aduce
  // nimic oaspeților (din mig 309 pagina publică nu arată ridicarea, iar
  // `create_order` o refuză), dar ar rămâne „pornit” în Setări, cu avertisment
  // (lib/pickupCopy.ts). Deci pe tier 1 nu se pornește nimic, iar pe necunoscut
  // nu se pornește până nu e verificat.
  const [hasPickup, setHasPickup] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchRestaurantFeatures(restaurantId)
      .then((f) => {
        // `null` = RPC picat: NU e „plan fără mese și fără ridicare” — lăsăm
        // plafonul necunoscut (UI pe 50, serverul e plasa) și ridicarea nedecisă.
        // Înainte, getLimit(null) dădea 0 → „între 1 și 0 mese”, imposibil.
        if (cancelled || !f) return
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
  const quickPicks = [4, 8, 12, 20, 30].filter((n) => cap >= n)

  const handleCreate = async () => {
    if (count < 1 || cap < count) {
      setError(t('step3_tableCountRangeError', { cap: cap }))
      return
    }
    setSaving(true)
    setError(null)

    // Create N tables named "Masa 1"/"Table 1"... (limba fluxului de onboarding)
    const tables = Array.from({ length: count }, (_, i) => ({
      restaurant_id: restaurantId,
      name: t('step3_tableName', { n: i + 1 }),
      slug: t('step3_tableSlug', { n: i + 1 }),
      seats: 4,
      is_active: true,
    }))
    const { data: createdTables, error: tErr } = await supabase
      .from('tables')
      .insert(tables)
      .select('id, name')
    if (tErr || !createdTables) {
      // Nu expunem textul brut Postgres; mapăm cazurile cunoscute.
      // Când limita planului nu e cunoscută (fetch features eșuat → maxTables null),
      // NU interpolăm plafonul implicit de UI (50) — ar afișa un maxim fals.
      const m = tErr?.message || ''
      setError(
        /limit|maxim|plan/i.test(m)
          ? maxTables !== null
            ? tp('step3_planLimitKnownError', maxTables)
            : t('step3_planLimitUnknownError')
          : t('step3_createTablesGenericError'),
      )
      setSaving(false)
      return
    }

    // Create qr_tokens for each table. Verificăm eroarea: dacă eșuează, NU marcăm
    // qr_generated ca să nu raportăm o stare inconsistentă (mese fără QR).
    // Token-urile se întorc (select), ca ecranul final să dea PDF-ul de tipărit
    // fără încă o citire; o masă fără token apare acolo „de făcut”.
    const rows = createdTables as Array<{ id: string; name: string }>
    const tokens = rows.map((tbl) => ({ restaurant_id: restaurantId, table_id: tbl.id }))
    const { data: tokenRows, error: qrErr } = await supabase
      .from('qr_tokens')
      .insert(tokens)
      .select('table_id, token')
    const tokenByTable = new Map<string, string>()
    for (const row of (tokenRows ?? []) as Array<{ table_id: string; token: string }>) {
      tokenByTable.set(row.table_id, row.token)
    }

    await markOnboarding(restaurantId, { table_created: true, qr_generated: !qrErr })
    onNext({
      kind: 'tables',
      qrOk: !qrErr,
      tables: rows.map((tbl) => ({ name: tbl.name, token: tokenByTable.get(tbl.id) ?? null })),
    })
  }

  // Ramura „fără mese". Cu `pickup_orders` (verificat, nu presupus): activăm
  // pickup + pickup_only (UPDATE direct e permis — pickup_settings are grant
  // column-level 096B + e în RESTAURANT_UPDATE_FIELDS) și marcăm pașii de
  // mese/QR ca rezolvați semantic (QR-ul general = slug-ul). Fără el: doar
  // QR-ul general, ridicarea rămâne oprită.
  const handleNoTables = async () => {
    setSaving(true)
    setError(null)
    let pickup = hasPickup
    if (pickup === null) {
      // Încă necunoscut (citire în curs sau picată): îl citim acum, o dată.
      const f = await fetchRestaurantFeatures(restaurantId).catch(() => null)
      pickup = f ? hasFeature(f, 'pickup_orders') : null
      setHasPickup(pickup)
      if (pickup === null) {
        setError(t('step3_planUnknownError'))
        setSaving(false)
        return
      }
      if (!pickup) {
        // Butonul devine „QR-ul general”, cu explicația planului dedesubt:
        // omul a cerut ridicare, deci nu-l ducem mai departe fără să vadă de ce.
        setSaving(false)
        return
      }
    }
    if (!pickup) {
      await markOnboarding(restaurantId, { qr_generated: true })
      onNext({ kind: 'general-qr' })
      return
    }
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
      setError(t('step3_pickupActivateError'))
      setSaving(false)
      return
    }
    await markOnboarding(restaurantId, { table_created: true, qr_generated: true })
    onNext({ kind: 'pickup' })
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
        {t('step3_title')}
      </h1>
      <p style={{ color: D.t2, fontSize: '0.85rem', marginBottom: 28, lineHeight: 1.6 }}>
        {t('step3_subtitle')}
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
          aria-label={t('step3_decreaseAria')}
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
          <div style={{ fontSize: '0.78rem', color: D.t3, marginTop: 4 }}>{t('step3_tablesUnit')}</div>
        </div>
        <button
          onClick={() => setCount((c) => Math.min(cap, c + 1))}
          aria-label={t('step3_increaseAria')}
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
          {t('step3_planHintPrefix')}
          <strong style={{ color: D.t2 }}>{tp('step3_planHintTables', maxTables)}</strong>
          {t('step3_planHintSuffix')}
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
              {t('step3_createsTablesPrefix')}
              <strong style={{ color: D.t1 }}>{tp('step3_createsTablesBold', count)}</strong>
              {t('step3_createsTablesSuffix')}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={14} color={D.green} />
            <span>
              {t('step3_pdfPrefix')}
              <strong style={{ color: D.t1 }}>{t('step3_pdfTabName')}</strong>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={14} color={D.green} />
            <span>{t('step3_renameAnytime')}</span>
          </div>
        </div>
      </div>

      {error && <ErrorBox msg={error} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={handleCreate} disabled={saving} style={saving ? btnDisabled : btnPrimary}>
          {saving ? tp('step3_creatingTablesBtn', count) : tp('step3_createTablesBtn', count)}
        </button>
        <button onClick={onSkip} style={btnSecondary}>
          {t('step3_skipBtn')}
        </button>
        {/* Food truck / tejghea (E3): activează pickup + modul „doar ridicare"
            — fără mese; QR-ul general /m/:slug devine QR-ul principal. */}
        <button onClick={() => void handleNoTables()} disabled={saving} style={btnSecondary}>
          {hasPickup === false ? t('step3_generalQrBtn') : t('step3_pickupOnlyBtn')}
        </button>
        {hasPickup === false && (
          <div
            style={{
              fontSize: '0.74rem',
              color: D.t3,
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            {t('step3_pickupHint')}
          </div>
        )}
      </div>
    </Shell>
  )
}

// ═══════════════════════════════════════════════════════════════
// STEP 4 — Gata!
// ═══════════════════════════════════════════════════════════════
// Iconița fiecărei bife de pe ecranul final.
const SUMMARY_ICONS: Record<SummaryKey, IconName> = {
  restaurant: 'home',
  'menu-products': 'menu',
  'menu-empty': 'menu',
  'tables-qr': 'table',
  'tables-no-qr': 'table',
  pickup: 'table',
  'general-qr': 'qr',
  'tables-skipped': 'table',
  'orders-ready': 'qr',
  'menu-qr-ready': 'qr',
}

function summaryLabel(item: SummaryItem, { t, tp }: OnbT): string {
  const n = item.count ?? 0
  switch (item.key) {
    case 'restaurant':
      return t('step4_summaryRestaurant')
    case 'menu-products':
      return tp('step4_summaryMenuProducts', n)
    case 'menu-empty':
      return t('step4_summaryMenuEmpty')
    case 'tables-qr':
      return tp('step4_summaryTablesQr', n)
    case 'tables-no-qr':
      return t('step4_summaryTablesNoQr')
    case 'pickup':
      return t('step4_summaryPickup')
    case 'general-qr':
      return t('step4_summaryGeneralQr')
    case 'tables-skipped':
      return t('step4_summaryTablesSkipped')
    case 'orders-ready':
      return t('step4_ordersReady')
    case 'menu-qr-ready':
      return t('step4_menuQrReady')
  }
}

function Step4Done({
  restaurantId,
  slug,
  restaurantName,
  menu,
  tables,
  pendingPlan,
  onComplete,
}: {
  restaurantId: string
  slug: string
  restaurantName: string
  menu: MenuOutcome
  tables: TablesOutcome
  pendingPlan: PlanIntentId | null
  onComplete: () => void
}) {
  const tr = useT(onboardingNs)
  const { t, tp } = tr
  // Linkul de distribuit urmează politica de domeniu (D3): pe un host .com NU
  // trimitem spre un domeniu care nu ne aparține. Aceeași bază ca QR-urile
  // meselor din Mese & QR (TablesManager).
  const publicBase = publicBaseUrl(
    window.location.hostname,
    import.meta.env.VITE_APP_URL,
    window.location.origin,
  )
  const menuUrl = `${publicBase}/m/${slug}`
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

  // „Gata de comenzi" doar dacă planul chiar permite comenzi prin QR; necunoscut
  // sau eroare de citire → fail-closed pe formularea adevărată în orice plan.
  const [canOrder, setCanOrder] = useState(false)
  useEffect(() => {
    let cancelled = false
    void fetchRestaurantFeatures(restaurantId)
      .then((f) => {
        if (!cancelled) setCanOrder(hasFeature(f, 'order_qr'))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [restaurantId])

  // Bifele din ce s-a întâmplat REAL în pașii 2–3 (lib/onboardingSummary.ts).
  const summary = onboardingSummary(menu, tables, canOrder)
  const allDone = summary.every((item) => item.done)
  const hasMenu = menu.kind === 'products' && menu.count > 0

  // PDF-ul de tipărit, direct de aici: mesele create (grilă 6/A4) sau, fără
  // mese cu QR, posterul cu QR-ul meniului general. lib/qrPdf (și jsPDF) se
  // încarcă abia la apăsare.
  const printable = printableTables(tables)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState(false)
  const downloadQr = async () => {
    if (pdfBusy) return
    setPdfBusy(true)
    setPdfError(false)
    try {
      const { downloadQrPdf } = await import('../lib/qrPdf')
      await downloadQrPdf(
        printable.length > 0
          ? {
              restaurantName,
              primaryColor: ONBOARDING_ACCENT,
              cards: printable.map((tb) => ({
                label: tb.name,
                url: `${publicBase}/q/${tb.token}`,
              })),
              format: 'grid',
              canOrder,
              brandHost: siteHost(),
            }
          : {
              restaurantName,
              primaryColor: ONBOARDING_ACCENT,
              cards: [{ label: t('step4_qrMenuCardLabel'), url: menuUrl }],
              format: 'poster',
              // QR-ul general deschide meniul; comenzile de la masă cer QR-ul mesei.
              canOrder: false,
              brandHost: siteHost(),
              filePrefix: 'QR-Meniu',
            },
      )
    } catch (e) {
      console.error('[onboarding] PDF-ul cu QR-uri a eșuat:', e)
      setPdfError(true)
    } finally {
      setPdfBusy(false)
    }
  }

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
          {allDone ? t('step4_title') : t('step4_titlePending')}
        </h1>
        <p style={{ color: D.t2, fontSize: '0.85rem', lineHeight: 1.6 }}>
          {allDone ? t('step4_subtitle') : t('step4_subtitlePending')}
        </p>
      </div>

      {/* Bifele: din ce s-a întâmplat real, nu hard-codate */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
        {summary.map((item) => (
          <div
            key={item.key}
            data-testid={`ob-summary-${item.key}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: D.s2,
              borderRadius: 10,
              padding: '10px 14px',
              border: `1px solid ${item.done ? D.border : `${D.gold}55`}`,
            }}
          >
            <Icon name={SUMMARY_ICONS[item.key]} size={18} color={item.done ? D.gold : D.t3} />
            <span style={{ fontSize: '0.875rem', color: item.done ? D.t1 : D.t2, flex: 1 }}>
              {summaryLabel(item, tr)}
            </span>
            {item.done ? (
              <Icon name="check" size={16} color={D.green} label={t('step4_achievementDoneLabel')} />
            ) : (
              <span
                style={{
                  fontSize: '0.7rem',
                  color: D.goldL,
                  background: D.goldA,
                  borderRadius: 6,
                  padding: '3px 8px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {t('step4_achievementPendingLabel')}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* QR-ul de tipărit, chiar de aici (înainte: încă 4 apăsări până în Mese & QR) */}
      <div
        style={{
          background: D.s2,
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 22,
          border: `1px solid ${D.gold}55`,
        }}
      >
        <div style={{ fontSize: '0.9rem', color: D.t1, fontWeight: 600, marginBottom: 4 }}>
          {printable.length > 0 ? t('step4_qrTablesTitle') : t('step4_qrMenuTitle')}
        </div>
        <div style={{ fontSize: '0.78rem', color: D.t2, lineHeight: 1.5, marginBottom: 12 }}>
          {printable.length > 0 ? tp('step4_qrTablesHint', printable.length) : t('step4_qrMenuHint')}
        </div>
        <button
          onClick={() => void downloadQr()}
          disabled={pdfBusy}
          style={{
            width: '100%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            minHeight: 44,
            background: D.goldA,
            color: D.goldL,
            border: `1px solid ${D.gold}`,
            borderRadius: 9,
            fontFamily: 'DM Sans,sans-serif',
            fontSize: '0.88rem',
            fontWeight: 700,
            cursor: pdfBusy ? 'not-allowed' : 'pointer',
            opacity: pdfBusy ? 0.7 : 1,
          }}
        >
          <Icon name="printer" size={16} />
          {pdfBusy
            ? t('step4_qrBusyBtn')
            : printable.length > 0
              ? t('step4_qrTablesBtn')
              : t('step4_qrMenuBtn')}
        </button>
        {pdfError && (
          <div role="alert" style={{ marginTop: 10 }}>
            <ErrorBox msg={t('step4_qrError')} />
          </div>
        )}
        <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 10, lineHeight: 1.5 }}>
          {t('step4_qrOtherFormats')}
        </div>
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
          {t('step4_menuLinkLabel')}
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
            aria-label={t('step4_copyBtnAriaLabel')}
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
            {copied ? t('step4_copiedLabel') : t('step4_copyLabel')}
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
            {t('step4_nextStepsTitle')}
          </strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="orders" size={15} color={D.t3} />
              <span>
                {hasMenu ? t('step4_nextStepAddProducts') : t('step4_nextStepAddFirstProducts')}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="users" size={15} color={D.t3} />
              <span>{t('step4_nextStepInviteTeam')}</span>
            </div>
            {canOrder && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="chart" size={15} color={D.t3} />
                <span>{t('step4_nextStepTrackOrders')}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={() => void handleDone()}
        disabled={finishing}
        style={finishing ? btnDisabled : btnPrimary}
      >
        {finishing
          ? t('step4_finishingBtn')
          : pendingPlan
            ? t('step4_continuePlanBtn', { plan: PLAN_LABELS[pendingPlan] ?? pendingPlan })
            : t('step4_doneBtn')}
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
  name: string
  // Rezultatele REALE ale pașilor 2 și 3 (ecranul final bifează după ele).
  menu: MenuOutcome
  tables: TablesOutcome
}

function OnboardingFlow({
  onComplete,
  pendingPlan = null,
}: {
  onComplete: () => void
  // Planul ales înainte de cont (lib/planIntent.ts): după onboarding, App duce
  // omul la activarea lui. Aici doar numește pasul următor pe butonul final.
  pendingPlan?: PlanIntentId | null
}) {
  // Fără carduri PWA peste butoanele pașilor (lib/pwaGate.ts): „Instalează
  // Menuvia” apărea la 30 s exact în mijlocul onboarding-ului.
  useSuppressPwaPrompts()
  const [state, setState] = useState<OnboardingState>({
    step: 1,
    restaurantId: null,
    slug: null,
    name: '',
    menu: { kind: 'skipped' },
    tables: { kind: 'skipped' },
  })

  // Telemetria funelului de activare (audit aug 2026): 4/4 utilizatori reali
  // au murit la „introdu meniul" și nu am aflat din date. track e no-op fără
  // consimțământul de analytics (GDPR) și nu primește niciun PII.
  useEffect(() => {
    track('onboarding_started')
  }, [])
  const completeStep = (step: 1 | 2 | 3, skipped = false) =>
    track('onboarding_step_completed', { step, skipped })

  if (state.step === 1) {
    return (
      <Step1Restaurant
        onNext={(restaurantId, slug, name) => {
          completeStep(1)
          setState((s) => ({ ...s, step: 2, restaurantId, slug, name }))
        }}
      />
    )
  }

  if (state.step === 2) {
    return (
      <Step2Menu
        restaurantId={state.restaurantId!}
        onNext={(outcome) => {
          completeStep(2)
          setState((s) => ({ ...s, step: 3, menu: outcome }))
        }}
        onSkip={() => {
          completeStep(2, true)
          setState((s) => ({ ...s, step: 3, menu: { kind: 'skipped' } }))
        }}
      />
    )
  }

  if (state.step === 3) {
    return (
      <Step3Table
        restaurantId={state.restaurantId!}
        onNext={(outcome) => {
          completeStep(3)
          setState((s) => ({ ...s, step: 4, tables: outcome }))
        }}
        onSkip={() => {
          completeStep(3, true)
          setState((s) => ({ ...s, step: 4, tables: { kind: 'skipped' } }))
        }}
      />
    )
  }

  return (
    <Step4Done
      restaurantId={state.restaurantId!}
      slug={state.slug!}
      restaurantName={state.name}
      menu={state.menu}
      tables={state.tables}
      pendingPlan={pendingPlan}
      onComplete={() => {
        track('onboarding_completed')
        onComplete()
      }}
    />
  )
}

export default function OnboardingPage(props: Parameters<typeof OnboardingFlow>[0]) {
  return (
    <FunnelLangProvider>
      <OnboardingFlow {...props} />
    </FunnelLangProvider>
  )
}
