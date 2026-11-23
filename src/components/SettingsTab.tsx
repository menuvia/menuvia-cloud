import { useState, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { changeRestaurantSlug } from '../lib/restaurants'
import { D, PLAN_LABELS, AMENITIES, type AmenityId } from '../lib/constants'
import { THEMES, FLIPBOOK_MAX_PAGES, resolveEffectiveMenuLayout } from '../lib/themes'
import { MENU_LANGS, menuBaseLang } from '../lib/i18nMenu'
import { MENU_CURRENCIES, resolveMenuCurrency } from '../lib/currency'
import type { PlanSurface } from '../lib/planSurface'
import { pickupSettingsCopyT } from '../lib/pickupCopy'
import { encodeForUpload } from '../lib/imageEncode'
import VatRatesEditor from './VatRatesEditor'
import OnlinePaymentsCard from './OnlinePaymentsCard'
import LoyaltySettingsCard from './LoyaltySettingsCard'
import MfaCard from './MfaCard'
import UiLanguageCard from './UiLanguageCard'
import GdprCard from './GdprCard'
import AddLocationCard, { type AddLocationProps } from './AddLocationCard'
import { SubscriptionCard } from './_dashboard/SubscriptionCard'
import SmsNotificationsCard from './SmsNotificationsCard'
import MenuPreview from './menu/MenuPreview'
import type { Restaurant } from '../hooks/useData'
import type { useRestaurantModules } from '../hooks/useRestaurantModules'
import { useToast, Toast, Inp, Sel, Toggle, AutoSaveHint } from './_dashboard/sharedUI'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { ACCENT_SWATCHES } from '../lib/accentPalette'
import { useIsMobile } from '../hooks/useIsMobile'
import { Icon, type IconName } from './ui/Icon'
import type { SettingsSection } from '../lib/dashboardNav'
import { confirm } from './ui/confirm'
import { browserSite, siteHost } from '../lib/domain'
import { COUNTRIES, countrySettingVisible, followCountryDefaults, timeZoneOptions } from '../lib/countries'
import { clearPendingCountry } from '../lib/pendingCountry'
import { useT } from '../i18n/useT'
import { fillNodes } from '../i18n/fillNodes'
import { describeStaffError } from '../i18n/staffErrors'
import { settingsNs } from '../i18n/ns/settings'
import { settingsCardsNs } from '../i18n/ns/settingsCards'
import { commonNs } from '../i18n/ns/common'
import { translationsNs } from '../i18n/ns/translations'
import { homeNs } from '../i18n/ns/home'
import { menuLangTitle } from '../lib/translationMessages'
import {
  checkoutSuggestionDefaultMessage,
  WEEK_DAY_KEYS,
  accentName,
  amenityLabel,
  countryLabel,
  themeDescription,
  themeName,
  weekDayLabel,
  type WeekDayKey,
} from '../lib/settingsLang'

// ── Constants for hours_structured editor ──
// Zilele (`WEEK_DAY_KEYS`) și etichetele lor stau în lib/settingsLang.ts
// (lotul L6b): în română EXACT `WEEK_DAY_LABELS` de dinainte, mutat acolo ca
// oracol; în celelalte limbi cheile `day_*` din namespace-ul `settings`.

interface DayHoursForm {
  open: string
  close: string
  closed: boolean
}

// Valorile implicite pentru pickup_settings — baza peste care se aplică
// valoarea curentă din form + patch-ul editat (vezi updPickup din componentă).
const PICKUP_DEFAULTS: NonNullable<Restaurant['pickup_settings']> = {
  enabled: false,
  min_lead_time_minutes: 20,
  slot_interval_minutes: 15,
  open_hours: { start: '09:00', end: '21:00' },
  instructions: null,
  pickup_only: false,
}

// ── Secțiunile de setări sunt sub-tab-uri REALE ale panoului (lotul R2):
// Restaurant / Aspect meniu / Comenzi & plăți / Abonament & cont stau în
// NAV_GROUPS (lib/dashboardNav.ts), lângă Echipă, Casă și Asistent AI. Fostele
// pastile interne au ieșit; numele secțiunii după plan („Meniu QR" / „Comenzi" /
// „Comenzi & plăți", fost `sectionLabel`) e acum eticheta sub-tab-ului
// (`subTabLabel`). Formularul rămâne UNUL: DashboardPage îl ține montat între
// cele patru secțiuni, deci modificările nesalvate nu se pierd la trecere.

// Card cu chrome consistent (surface + border + header cu icon/titlu/descriere).
// Înlocuiește cele ~18 div-uri hand-rolled identice — un singur stil premium,
// ușor de întreținut. `right` ține un buton sau un Toggle în antet.
// `autoSave`: cardul se salvează la fiecare comutare (nu prin „Salvează") —
// marcat discret, DOAR unde e adevărat (lotul R2).
function SettingsCard({
  icon,
  title,
  desc,
  right,
  autoSave = false,
  children,
}: {
  icon?: IconName
  title: string
  desc?: ReactNode
  right?: ReactNode
  autoSave?: boolean
  children?: ReactNode
}) {
  return (
    <Card variant="flat">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: desc != null ? 6 : 14,
        }}
      >
        {/* Antetul secțiunii: h2 sub titlul paginii (h1 din panou), un singur
            stil pentru toate cardurile de setări (lotul V). */}
        <h2
          style={{
            fontFamily: D.fontBody,
            fontSize: '0.92rem',
            fontWeight: 600,
            color: D.t1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            margin: 0,
          }}
        >
          {icon && <Icon name={icon} size={16} color={D.gold} />}
          {title}
          {autoSave && <AutoSaveHint />}
        </h2>
        {right}
      </div>
      {desc != null && (
        <div style={{ fontSize: '0.75rem', color: D.t2, marginBottom: 14, lineHeight: 1.5 }}>
          {desc}
        </div>
      )}
      {children}
    </Card>
  )
}

// Încărcările de fișier sunt un <label> peste un <input type=file>: arată ca
// butonul secundar (aceleași clase ca <Button variant="secondary">).
const UPLOAD_LABEL_CLASS = 'btn btn--secondary btn--md'
// Butoanele doar-iconiță: pătrat de 44px (ținta tactilă).
const ICON_BTN: CSSProperties = { width: 44, minWidth: 44, padding: 0 }
// Prefixul adresei de recenzie Google din previzualizare — un URL, nu text.
const REVIEW_URL_PREVIEW_PREFIX = 'search.google.com/local/writereview?placeid='
// Un Place ID de exemplu (placeholder-ul câmpului) — un identificator, nu text.
const PLACE_ID_EXAMPLE = 'ChIJN1t_tDeuEmsRUsoyG83frY4'

// ── SettingsTab — lifted from DashboardPage.tsx (identical behavior) ──

export default function SettingsTab({
  section,
  isOwner = false,
  onDirtyChange,
  planLoadError = false,
  onRetryPlan,
  restaurant,
  onUpdate,
  plan,
  onSignOut,
  onPricing,
  modulesState,
  founderView = false,
  surface,
  addLocation,
}: {
  // Secțiunea formularului = sub-tab-ul panoului (lib/dashboardNav.ts).
  section: SettingsSection
  // Abonamentul e pe contul PROPRIETARULUI (managerul n-are client Stripe, iar
  // fondatorul în vizită nu e proprietar). Fail-closed: fără valoare, cardul nu apare.
  isOwner?: boolean
  // Formularul are modificări nesalvate — DashboardPage întreabă înainte să
  // părăsească Setările (ieșirea demontează formularul).
  onDirtyChange?: (dirty: boolean) => void
  // Citirea planului a EȘUAT (nu doar „se încarcă"): „Plan curent" spune asta,
  // cu „Reîncearcă", în loc de un „Se verifică…" fără sfârșit (recenzia #335).
  planLoadError?: boolean
  onRetryPlan?: () => void
  restaurant: Restaurant
  onUpdate: (id: string, f: Partial<Restaurant>) => Promise<{ error: Error | null }>
  // Doar pentru eticheta „Plan curent" (Cont). Ce vede planul vine din
  // `surface`; fostul `planKnown` (comutatorul de ridicare pe `unknown`) a ieșit
  // odată cu stările comutatorului (recenzia #334) — `surface: null` e acum
  // singurul „nu știu".
  plan: string
  onSignOut: () => void
  // Calea „Vezi planurile" a cardului de abonament, când serverul răspunde
  // `no_customer` (proprietar fără client Stripe). Obligatoriu: fără el,
  // cardul ar redeveni o fundătură.
  onPricing: () => void
  modulesState?: ReturnType<typeof useRestaurantModules>
  // Fondatorul în vizită: acțiunile pe care serverul le leagă de membership-ul
  // REAL (conectarea Stripe) nu i se arată.
  founderView?: boolean
  // Ce vede planul (lib/planSurface.ts, lotul P): planurile inferioare nu văd
  // nimic din cele superioare — nici funcția, nici un lacăt. Obligatoriu:
  // `null` = planul necunoscut, deci nicio funcție dependentă de plan.
  surface: PlanSurface | null
  // „Adaugă o locație" (lotul A). DashboardPage îl trimite DOAR când limita
  // planului e CUNOSCUTĂ și mai mare decât localurile deținute (canAddLocation,
  // lib/locations.ts). Lipsă = cardul nu apare (fail-closed, ca `isOwner`).
  addLocation?: AddLocationProps
}) {
  // Limba personalului (lotul L6b): `settings` + cardurile montate static
  // (`settingsCards`, același chunk) + `common` + `translations` (numele
  // limbilor meniului) + `home` (SubscriptionCard din „Abonament & cont”: fila
  // Acasă e leneșă, deci `home` nu e garantat încărcat când se deschide direct
  // această secțiune) — toate cerute SUS, necondiționat, ca prima randare într-o
  // limbă nouă să încarce dicționarele filei sub Suspense-ul ei, nu card cu card
  // la schimbarea secțiunii (o suspendare atunci ar goli fila). `dashboard`
  // (UiLanguageCard) e cerut deja de DashboardPage, deasupra filei.
  // Traducătorul se numește `st`: `t` e deja tema curentă din bucla THEMES.
  const st = useT(settingsNs)
  useT(settingsCardsNs)
  const tc = useT(commonNs)
  const trTr = useT(translationsNs)
  useT(homeNs)
  const { user } = useAuth()
  // Mobile-first: pe telefon stivuim coloanele (altfel layout-ul 2-col se taie lateral).
  const isMobile = useIsMobile()
  const [form, setForm] = useState({ ...restaurant })
  const [saving, setSaving] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingPages, setUploadingPages] = useState(false)
  const { toasts, toast } = useToast()
  const upd = (k: keyof Restaurant, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  // Merge order: DEFAULTS → valoarea curentă din form → patch. Identic cu
  // spread-urile inline anterioare; patch-ul are mereu ultimul cuvânt.
  const updPickup = (patch: Partial<NonNullable<Restaurant['pickup_settings']>>) =>
    upd('pickup_settings', { ...PICKUP_DEFAULTS, ...(form.pickup_settings ?? {}), ...patch })
  // Păstrează cheile existente + garantează preset_id (fallback 'cafe'); patch
  // suprascrie. Oglindește spread-urile theme_settings folosite anterior.
  const updTheme = (patch: Partial<NonNullable<Restaurant['theme_settings']>>) =>
    upd('theme_settings', {
      ...(form.theme_settings ?? {}),
      preset_id: form.theme_settings?.preset_id ?? 'cafe',
      ...patch,
    })
  // Re-sincronizează formularul când prop-ul restaurant se schimbă (ex. după salvarea
  // slug-ului prin RPC, care întoarce slug-ul normalizat) — altfel form-ul rămâne stale.
  useEffect(() => {
    setForm({ ...restaurant })
  }, [restaurant])

  async function uploadImage(
    file: File,
    kind: 'cover' | 'logo' | 'menu-pages',
  ): Promise<string | null> {
    if (!user) return null
    const setBusy =
      kind === 'cover' ? setUploadingCover : kind === 'logo' ? setUploadingLogo : setUploadingPages
    setBusy(true)
    try {
      const canvas = document.createElement('canvas')
      const ctx2d = canvas.getContext('2d')
      if (!ctx2d) throw new Error('canvas ctx unavailable')
      const img = new Image()
      const url = URL.createObjectURL(file)
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('image load failed'))
        img.src = url
      })
      // Paginile de meniu au text mic → aceeași lățime maximă ca la cover.
      const maxW = kind === 'logo' ? 400 : 1600
      const scale = img.width > maxW ? maxW / img.width : 1
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      // WebP unde se poate; pe Safari (iPhone) JPEG pentru cover/pagini și PNG
      // pentru logo (păstrează transparența). Extensia + Content-Type vin din ce
      // a codat EFECTIV browserul — înainte, Safari urca PNG sub nume `.webp`,
      // iar cover-ul de 1600 px (LCP-ul meniului public) ajungea la câțiva MB.
      const encoded = await encodeForUpload(canvas, { quality: 0.85, alpha: kind === 'logo' })
      const path =
        user.id + '/' + restaurant.id + '/' + kind + '/' + crypto.randomUUID() + '.' + encoded.ext
      const { error } = await supabase.storage
        .from('product-images')
        .upload(path, encoded.blob, { contentType: encoded.contentType })
      if (error) throw error
      const { data } = supabase.storage.from('product-images').getPublicUrl(path)
      return data.publicUrl
    } catch (e) {
      console.error(`${kind} upload failed`, e)
      toast(st.t('toast_uploadFailed'), 'error')
      return null
    } finally {
      setBusy(false)
    }
  }

  function toggleAmenity(id: AmenityId) {
    const current = (form.amenities ?? []) as string[]
    const next = current.includes(id) ? current.filter((a) => a !== id) : [...current, id]
    upd('amenities', next)
  }

  // Limbile în care clientul poate vedea meniul (fără 'ro', care e mereu baza).
  function toggleMenuLang(code: string) {
    const current = (form.menu_languages ?? []) as string[]
    const next = current.includes(code)
      ? current.filter((c) => c !== code)
      : [...current, code]
    upd('menu_languages', next)
  }

  // ── Flipbook: pagini de meniu ca imagini (theme_settings.flipbook_pages) ──
  // Salvate prin ACELAȘI flux de save al formularului (theme_settings e în
  // whitelist-ul RESTAURANT_UPDATE_FIELDS) — fără migrații, fără RPC nou.
  const flipbookPages: string[] = form.theme_settings?.flipbook_pages ?? []

  function setFlipbookPages(pages: string[]) {
    updTheme({ flipbook_pages: pages })
  }

  function moveFlipbookPage(idx: number, delta: -1 | 1) {
    const j = idx + delta
    if (j < 0 || j >= flipbookPages.length) return
    const next = [...flipbookPages]
    const a = next[idx]
    const b = next[j]
    if (a === undefined || b === undefined) return
    next[idx] = b
    next[j] = a
    setFlipbookPages(next)
  }

  function removeFlipbookPage(idx: number) {
    setFlipbookPages(flipbookPages.filter((_, i) => i !== idx))
  }

  async function uploadFlipbookPages(files: File[]) {
    if (files.length === 0) return
    const room = FLIPBOOK_MAX_PAGES - flipbookPages.length
    if (room <= 0) {
      toast(st.t('fb_full', { max: FLIPBOOK_MAX_PAGES }), 'error')
      return
    }
    if (room < files.length) {
      toast(st.tp('fb_partial', room, { max: FLIPBOOK_MAX_PAGES }), 'error')
    }
    const urls: string[] = []
    // Secvențial (nu Promise.all): canvas-ul redimensionează pe rând, iar
    // ordinea paginilor rezultate rămâne ordinea de selecție a fișierelor.
    for (const f of files.slice(0, room)) {
      const url = await uploadImage(f, 'menu-pages')
      if (url) urls.push(url)
    }
    if (urls.length > 0) {
      setFlipbookPages([...flipbookPages, ...urls])
      toast(st.tp('fb_added', urls.length))
    }
  }

  function updHours(day: WeekDayKey, patch: Partial<DayHoursForm>) {
    const current = (form.hours_structured ?? {}) as Record<string, DayHoursForm>
    const today = current[day] ?? { open: '08:00', close: '23:00', closed: false }
    upd('hours_structured', { ...current, [day]: { ...today, ...patch } })
  }

  async function copyMondayToAll() {
    // Acțiune distructivă: suprascrie orarul personalizat din Marți–Duminică.
    // Cerem confirmare explicită înainte, ca un click accidental să nu piardă datele.
    const ok = await confirm({
      title: st.t('hours_confirmTitle'),
      description: st.t('hours_confirmDesc'),
      confirmLabel: st.t('hours_confirmOk'),
      cancelLabel: tc.t('cancel'),
      destructive: true,
    })
    if (!ok) return
    const current = (form.hours_structured ?? {}) as Record<string, DayHoursForm>
    const mon = current.mon ?? { open: '08:00', close: '23:00', closed: false }
    const next: Record<string, DayHoursForm> = {}
    for (const d of WEEK_DAY_KEYS) next[d] = { ...mon }
    upd('hours_structured', next)
  }
  // La TASTARE: normalizare lejeră FĂRĂ strip de cratime la capete — slugify-ul
  // complet aplicat pe fiecare keystroke ștergea separatorul imediat ce era tastat
  // („pizza-" → „pizza"), deci un slug cu cratimă era imposibil de scris manual.
  // Curățarea capetelor o face RPC-ul change_restaurant_slug la salvare.
  const slugifyWhileTyping = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-')

  const saveHints: Readonly<Record<string, string>> | undefined =
    tc.lang === 'ro' ? undefined : { country_owner_only: st.t('country_ownerOnly') }

  const handleSave = async () => {
    setSaving(true)
    // Slug-ul are flux separat (RPC change_restaurant_slug — PR 1B 096B revocă
    // UPDATE column-level pe restaurants.slug). Rulăm slug-ul ÎNAINTE: dacă
    // eșuează (slug ocupat), abortăm și nu mai trimitem celelalte câmpuri.
    const slugChanged =
      typeof form.slug === 'string' && form.slug.trim() !== '' && form.slug !== restaurant.slug
    if (slugChanged) {
      try {
        const r = await changeRestaurantSlug({
          restaurantId: restaurant.id,
          newSlug: form.slug as string,
        })
        if (!r.ok) {
          toast(st.t('slug_taken', { slug: r.slug }), 'error')
          setSaving(false)
          return
        }
      } catch (e) {
        toast(describeStaffError(e, tc, { fallback: st.t('err_slug') }), 'error')
        setSaving(false)
        return
      }
    }

    // Restul câmpurilor (fără slug) prin .update() — gated de RLS + column-level GRANT.
    const { slug: _slug, ...rest } = form
    void _slug
    const { error } = await onUpdate(restaurant.id, rest)
    // În română: EXACT textul de dinainte (`toUserMessage` pe eroare, fără
    // hint-uri — regula 1 din staffErrors ar înlocui textul românesc de azi).
    // În celelalte limbi, refuzul trigger-ului de țară (mig 296) își are
    // textul propriu.
    if (error) toast(describeStaffError(error, tc, { hints: saveHints }), 'error')
    else {
      // Țara aleasă explicit aici înlocuiește orice intenție rămasă de la
      // onboarding (lib/pendingCountry.ts) — altfel ar fi re-aplicată peste ea.
      // Doar când câmpul de țară e VIZIBIL (a fost deci trimis conștient): o
      // salvare cu aceeași țară confirmă alegerea și stinge o intenție veche,
      // care altfel ar fi re-aplicată la următoarea încărcare (recenzie #288).
      if (countrySettingVisible(browserSite(), restaurant.country)) clearPendingCountry(restaurant.id)
      toast(st.t('toast_saved'))
    }
    setSaving(false)
  }

  // Formular „murdar": s-a schimbat ceva față de restaurantul salvat. Ordinea
  // cheilor e stabilă (form pornește ca {...restaurant}), deci comparația JSON
  // e suficientă pentru a decide dacă arătăm bara de salvare de jos.
  // OPT-R2: latura STABILĂ (restaurant) se serializează o singură dată; doar
  // `form` (se schimbă la fiecare tastă) rămâne serializat inline. Înainte se
  // făcea dublu JSON.stringify pe tot restaurantul la fiecare tastă.
  const restaurantJson = useMemo(() => JSON.stringify(restaurant), [restaurant])
  // ~400 de fusuri (Intl.supportedValuesOf): recalculate doar când se schimbă fusul ales.
  const tzOptions = useMemo(() => timeZoneOptions(form.timezone), [form.timezone])
  const dirty = JSON.stringify(form) !== restaurantJson
  // O imagine în curs de încărcare (logo, copertă, pagini Flipbook) e tot muncă
  // nesalvată: URL-ul ei intră în formular abia la final, deci o ieșire în
  // timpul încărcării (altă locație, alt restaurant, /pricing) ar fi trecut de
  // confirmare și ar fi pierdut-o (recenzia CodeRabbit pe #353). Bara de
  // salvare de jos rămâne pe `dirty`: o încărcare în zbor nu are încă ce salva.
  const unsaved = dirty || uploadingCover || uploadingLogo || uploadingPages
  // Starea „nesalvat" urcă spre panou; la demontare formularul nu mai are
  // nimic de pierdut.
  useEffect(() => {
    onDirtyChange?.(unsaved)
    return () => onDirtyChange?.(false)
  }, [unsaved, onDirtyChange])
  // Reîncărcarea / închiderea paginii cu formularul modificat cere confirmarea
  // browserului (recenzia #335) — singura ieșire pe care panoul n-o vede.
  useEffect(() => {
    if (!unsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [unsaved])
  // Cardul de ridicare se montează DOAR pe `planSurface.pickup` (= `pickup_orders`
  // activ, lotul P), deci aici feature-ul e mereu CUNOSCUT și activ: comutatorul
  // e liber, iar textele (lib/pickupCopy.ts) primesc `true`. Stările vechi ale
  // comutatorului (`locked`/`locked_on`/`unknown`, cu nota de sub el) au devenit
  // inaccesibile și au ieșit (recenzia #334) — pe planul fără ridicare cardul nu
  // se arată deloc. Fără `useFeatures` aici: planul vine din DashboardPage
  // (planul RESTAURANTULUI, regula 3).
  // Stilul EFECTIV al meniului (flipbook fără pagini = listă, regula unică din
  // lib/themes), citit din FORMULAR, nu din rândul salvat — ca restul filei:
  // comutatorul de ridicare e și el pe starea nesalvată, iar „Meniu & aspect”
  // arată stilul ales înainte de salvare. Owner-ul care alege Flipbook și trece
  // la „Comenzi & plăți” vede consecința ÎNAINTE să salveze; altfel aceeași
  // pagină ar spune „Flipbook” într-o filă și ar promite comenzi în cealaltă.
  const menuFlipbook = resolveEffectiveMenuLayout(form.theme_settings) === 'flipbook'
  const pickupTexts = pickupSettingsCopyT(st)
  const pickupDesc = pickupTexts.pickupCardDescription(true, menuFlipbook)

  return (
    <div>
      <Toast toasts={toasts} />
      {/* Titlul paginii vine din panou (eticheta sub-tab-ului, lotul R2); aici
          rămâne doar „Salvează" — pe secțiunile care au ce salva. Abonament &
          cont are doar acțiuni cu salvare proprie (MFA, GDPR, portalul). */}
      {section !== 'account' && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginBottom: 18,
          }}
        >
          <Button variant="primary" onClick={handleSave} loading={saving}>
            {saving ? st.t('save_busy') : tc.t('save')}
          </Button>
        </div>
      )}

      {/* Conținutul secțiunii active — o singură coloană lizibilă (pattern premium
          de setări: mai ușor de scanat decât 2 coloane pe lat). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>
        {section === 'restaurant' && (
          <>
            {/* „Agentul tău Menuvia" (mig 303) stă pe Acasă — acolo trimite și
                emailul cererii de acces; aici era a doua copie (lotul R2). */}
            <SettingsCard icon="info" title={st.t('info_title')}>
              {(
                [
                  ['name', 'info_name', 'info_namePh'],
                  ['tagline', 'info_tagline', 'info_taglinePh'],
                  ['city', 'info_city', 'info_cityPh'],
                  ['phone', 'info_phone', 'info_phonePh'],
                  ['hours', 'info_hours', 'info_hoursPh'],
                  ['description', 'info_description', 'info_descriptionPh'],
                ] as const
              ).map(([k, labelKey, phKey]) => {
                const label = st.t(labelKey)
                return (
                  <div key={k} style={{ marginBottom: 13 }}>
                    <label
                      style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}
                    >
                      {label}
                    </label>
                    <Inp
                      label={label.replace(/\s*\*$/, '')}
                      value={String(form[k] || '')}
                      onChange={(v) => upd(k, v)}
                      placeholder={st.t(phKey)}
                    />
                  </div>
                )
              })}
            </SettingsCard>

            {/* Țara (mig 296) — DOAR pe un host .com sau pentru un local deja în
                afara RO (countrySettingVisible): pe .ro, pentru un local RO, UI-ul
                rămâne neschimbat. Editabilă doar de OWNER — trigger-ul
                trg_restaurants_country_owner_only respinge oricum un manager. */}
            {countrySettingVisible(browserSite(), restaurant.country) && (
              <SettingsCard
                icon="info"
                title={st.t('country_title')}
                desc={surface?.vat === true ? st.t('country_descRo') : st.t('country_desc')}
                right={
                  <select
                    aria-label={st.t('country_title')}
                    value={form.country ?? 'RO'}
                    onChange={(e) => {
                      // Moneda și fusul urmează țara cât timp erau încă
                      // default-urile țării vechi (lotul G1); o alegere de mână
                      // rămâne. Totul rămâne în formular până la „Salvează”.
                      const next = e.target.value
                      setForm((f) => ({
                        ...f,
                        country: next,
                        ...followCountryDefaults(f.country, next, { currency: f.currency, timezone: f.timezone }),
                      }))
                    }}
                    disabled={user?.id !== restaurant.owner_id}
                    style={{
                      background: D.s3,
                      border: `1px solid ${D.border}`,
                      borderRadius: 8,
                      color: D.t1,
                      fontFamily: D.fontBody,
                      fontSize: 14,
                      padding: '10px 12px',
                      minHeight: 44,
                      cursor: user?.id !== restaurant.owner_id ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {/* O țară setată de suport în afara listei rămâne selectabilă. */}
                    {form.country &&
                      !COUNTRIES.some((c) => c.code === form.country) && (
                        <option value={String(form.country)}>{String(form.country)}</option>
                      )}
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {countryLabel(c.code, c.name, st.lang)}
                      </option>
                    ))}
                  </select>
                }
              >
                {user?.id !== restaurant.owner_id && (
                  <div style={{ fontSize: '0.75rem', color: D.t2 }}>{st.t('country_ownerOnly')}</div>
                )}
              </SettingsCard>
            )}

            {/* Fusul orar (lotul G1) — sub aceeași regulă ca țara: pe .ro, pentru
                un local RO, rămâne Europe/Bucharest și câmpul nu apare. Ora
                programului, a ridicărilor și a rezervărilor se socotește în el.
                Excepție (recenzia CodeRabbit pe #358): un fus SALVAT diferit de
                cel românesc (local mutat înapoi în RO) rămâne vizibil — altfel ar
                guverna orele fără niciun control prin care să fie schimbat. */}
            {(countrySettingVisible(browserSite(), restaurant.country) ||
              (restaurant.timezone ?? 'Europe/Bucharest') !== 'Europe/Bucharest') && (
              <SettingsCard
                icon="clock"
                title={st.t('tz_title')}
                desc={st.t('tz_desc')}
                right={
                  <select
                    aria-label={st.t('tz_aria')}
                    value={form.timezone ?? 'Europe/Bucharest'}
                    onChange={(e) => upd('timezone', e.target.value)}
                    style={{
                      background: D.s3,
                      border: `1px solid ${D.border}`,
                      borderRadius: 8,
                      color: D.t1,
                      fontFamily: D.fontBody,
                      fontSize: 14,
                      padding: '10px 12px',
                      minHeight: 44,
                      maxWidth: 220,
                      cursor: 'pointer',
                    }}
                  >
                    {tzOptions.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                }
              />
            )}

            {/* PROGRAM DETALIAT — hours_structured per zi */}
            <SettingsCard
              icon="clock"
              title={st.t('hours_title')}
              desc={st.t('hours_desc')}
              right={
                <Button variant="ghost" size="sm" onClick={copyMondayToAll}>
                  {st.t('hours_copyMonday')}
                </Button>
              }
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {WEEK_DAY_KEYS.map((day) => {
                  const dayLabel = weekDayLabel(day, st)
                  const cur = ((form.hours_structured ?? {}) as Record<string, DayHoursForm>)[
                    day
                  ] ?? {
                    open: '08:00',
                    close: '23:00',
                    closed: false,
                  }
                  return (
                    <div
                      key={day}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? '1fr' : '80px 1fr 88px 88px',
                        gap: 8,
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: '0.78rem', color: D.t1 }}>{dayLabel}</span>
                      <label
                        style={{
                          fontSize: '0.72rem',
                          color: D.t2,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!cur.closed}
                          onChange={(e) => updHours(day, { closed: !e.target.checked })}
                        />
                        {st.t('hours_open')}
                      </label>
                      {/* Pe mobil (1 coloană) inputurile de oră stau stivuite fără
                          antet de coloană → mici label-uri „Deschide"/„Închide"
                          deasupra. Pe desktop antetul e implicit; păstrăm doar
                          aria-label pentru screen reader. */}
                      <div>
                        {isMobile && (
                          <label style={{ display: 'block', fontSize: '0.68rem', color: D.t3, marginBottom: 3 }}>
                            {st.t('hours_opensLabel')}
                          </label>
                        )}
                        <input
                          type="time"
                          disabled={cur.closed}
                          value={cur.open}
                          onChange={(e) => updHours(day, { open: e.target.value })}
                          aria-label={st.t('hours_openAria', { day: dayLabel })}
                          style={{
                            background: D.s3,
                            border: `1px solid ${D.border}`,
                            color: D.t1,
                            padding: '6px 8px',
                            borderRadius: 6,
                            fontSize: '0.78rem',
                            opacity: cur.closed ? 0.4 : 1,
                            width: isMobile ? '100%' : undefined,
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                      <div>
                        {isMobile && (
                          <label style={{ display: 'block', fontSize: '0.68rem', color: D.t3, marginBottom: 3 }}>
                            {st.t('hours_closesLabel')}
                          </label>
                        )}
                        <input
                          type="time"
                          disabled={cur.closed}
                          value={cur.close}
                          onChange={(e) => updHours(day, { close: e.target.value })}
                          aria-label={st.t('hours_closeAria', { day: dayLabel })}
                          style={{
                            background: D.s3,
                            border: `1px solid ${D.border}`,
                            color: D.t1,
                            padding: '6px 8px',
                            borderRadius: 6,
                            fontSize: '0.78rem',
                            opacity: cur.closed ? 0.4 : 1,
                            width: isMobile ? '100%' : undefined,
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </SettingsCard>

            {/* LOGO upload — square */}
            <SettingsCard
              icon="tag"
              title={st.t('logo_title')}
              desc={st.t('logo_desc')}
            >
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                {form.logo_url ? (
                  <img
                    src={form.logo_url}
                    alt={st.t('logo_alt')}
                    style={{
                      width: 80,
                      height: 80,
                      objectFit: 'cover',
                      borderRadius: 12,
                      border: `1px solid ${D.border}`,
                      background: D.s3,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: 12,
                      border: `1px dashed ${D.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: D.t3,
                      fontSize: '0.7rem',
                    }}
                  >
                    N/A
                  </div>
                )}
                <label
                  className={UPLOAD_LABEL_CLASS}
                  style={{
                    cursor: uploadingLogo ? 'wait' : 'pointer',
                    opacity: uploadingLogo ? 0.6 : 1,
                  }}
                >
                  {uploadingLogo ? st.t('uploading') : st.t('logo_upload')}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      const url = await uploadImage(f, 'logo')
                      if (url) upd('logo_url', url)
                      e.target.value = ''
                    }}
                  />
                </label>
                {form.logo_url && (
                  <Button variant="ghost" onClick={() => upd('logo_url', null)}>
                    {st.t('logo_remove')}
                  </Button>
                )}
              </div>
            </SettingsCard>

            {/* COVER IMAGE — afișată în hero-ul meniului public */}
            <SettingsCard
              icon="image"
              title={st.t('cover_title')}
              desc={st.t('cover_desc')}
            >
              {form.cover_url ? (
                <div style={{ position: 'relative', marginBottom: 10 }}>
                  <img
                    src={form.cover_url}
                    alt={st.t('cover_alt')}
                    style={{
                      width: '100%',
                      aspectRatio: '16 / 9',
                      objectFit: 'cover',
                      borderRadius: 10,
                      border: `1px solid ${D.border}`,
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => upd('cover_url', null)}
                    style={{ position: 'absolute', top: 8, right: 8 }}
                  >
                    {tc.t('delete')}
                  </Button>
                </div>
              ) : (
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '16 / 9',
                    borderRadius: 10,
                    border: `1px dashed ${D.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: D.t3,
                    fontSize: '0.78rem',
                    marginBottom: 10,
                  }}
                >
                  {st.t('cover_none')}
                </div>
              )}
              <label
                className={UPLOAD_LABEL_CLASS}
                style={{
                  cursor: uploadingCover ? 'wait' : 'pointer',
                  opacity: uploadingCover ? 0.6 : 1,
                }}
              >
                {uploadingCover ? st.t('uploading') : st.t('cover_upload')}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    const url = await uploadImage(f, 'cover')
                    if (url) upd('cover_url', url)
                    e.target.value = ''
                  }}
                />
              </label>
            </SettingsCard>

            {/* AMENITIES toggles */}
            <SettingsCard
              icon="sparkle"
              title={st.t('amen_title')}
              desc={st.t('amen_desc')}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {AMENITIES.map((a) => {
                  const active = (form.amenities ?? []).includes(a.id)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleAmenity(a.id)}
                      aria-pressed={active}
                      style={{
                        background: active ? D.goldA : D.s3,
                        border: `1px solid ${active ? D.gold : D.border}`,
                        color: active ? D.goldL : D.t2,
                        padding: '6px 12px',
                        minHeight: 44,
                        display: 'inline-flex',
                        alignItems: 'center',
                        borderRadius: 100,
                        fontSize: '0.78rem',
                        fontWeight: active ? 600 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {amenityLabel(a, st)}
                    </button>
                  )
                })}
              </div>
            </SettingsCard>

            {/* WiFi password */}
            <SettingsCard
              icon="wifi"
              title={st.t('wifi_title')}
              desc={st.t('wifi_desc')}
            >
              <Inp
                label={st.t('wifi_label')}
                value={form.wifi_password ?? ''}
                onChange={(v) => upd('wifi_password', v.trim() || null)}
                placeholder={st.t('wifi_ph')}
              />
            </SettingsCard>

            {/* Social media */}
            <SettingsCard icon="link" title={st.t('social_title')}>
              {(
                [
                  ['instagram', 'Instagram', '@tinctura.cafe'],
                  ['facebook', 'Facebook', 'facebook.com/tinctura'],
                  ['tiktok', 'TikTok', '@tinctura'],
                  // „Website” e singura etichetă care nu e un nume propriu.
                  ['website', st.t('social_website'), 'https://tinctura.ro'],
                ] as const
              ).map(([k, label, ph]) => {
                const socials = (form.socials ?? {}) as Record<string, string | null | undefined>
                return (
                  <div key={k} style={{ marginBottom: 10 }}>
                    <label
                      style={{ display: 'block', fontSize: '0.74rem', color: D.t2, marginBottom: 5 }}
                    >
                      {label}
                    </label>
                    <Inp
                      label={label}
                      value={socials[k] ?? ''}
                      onChange={(v) =>
                        upd('socials', {
                          ...socials,
                          [k]: v.trim() || null,
                        })
                      }
                      placeholder={ph}
                    />
                  </div>
                )
              })}
            </SettingsCard>

            {/* Google Review CTA settings */}
            <SettingsCard
              icon="star"
              title={st.t('google_title')}
              desc={
                // Fără plată în aplicație (Planurile 1–2), textul nu pomenește plata.
                // Pe `payments` (planul, nu țara): pe Planul 3 nu se schimbă nimic.
                surface?.payments === true ? st.t('google_descPay') : st.t('google_desc')
              }
            >
              <label style={{ display: 'block', fontSize: '0.74rem', color: D.t2, marginBottom: 5 }}>
                {st.t('google_placeId')}
              </label>
              <Inp
                label={st.t('google_placeId')}
                value={form.google_place_id ?? ''}
                onChange={(v) => upd('google_place_id', v.trim() || null)}
                placeholder={PLACE_ID_EXAMPLE}
              />
              <div style={{ fontSize: '0.7rem', color: D.t2, marginTop: 6, lineHeight: 1.5 }}>
                {fillNodes(st.t('google_help'), {
                  link: (
                    <a
                      href="https://developers.google.com/maps/documentation/places/web-service/place-id"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: D.gold }}
                    >
                      {st.t('google_finder')}
                    </a>
                  ),
                })}
              </div>

              {form.google_place_id && (
                <div
                  style={{
                    marginTop: 14,
                    padding: '10px 14px',
                    background: D.s3,
                    borderRadius: 8,
                    fontSize: '0.72rem',
                    color: D.t2,
                  }}
                >
                  <div
                    style={{
                      color: D.green,
                      marginBottom: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Icon name="check" size={13} color={D.green} />
                    {st.t('google_configured')}
                  </div>
                  <div>
                    {fillNodes(st.t('google_preview'), {
                      link: (
                        <a
                          href={`https://search.google.com/local/writereview?placeid=${form.google_place_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: D.gold, wordBreak: 'break-all' }}
                        >
                          {REVIEW_URL_PREVIEW_PREFIX}
                          {form.google_place_id.slice(0, 12)}
                          ...
                        </a>
                      ),
                    })}
                  </div>
                </div>
              )}
            </SettingsCard>
          </>
        )}

        {section === 'menu' && (
          <>
            {/* Previzualizare live — se actualizează instant la orice schimbare de
                temă / layout / elemente (form.theme_settings e state React). O punem
                prima ca userul să vadă efectul modificărilor din secțiune imediat. */}
            <SettingsCard
              icon="eye"
              title={st.t('preview_title')}
              desc={st.t('preview_desc')}
            >
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <MenuPreview
                  themeSettings={form.theme_settings}
                  restaurantName={form.name}
                  // Moneda din STAREA formularului — preview-ul reflectă LIVE
                  // alegerea din selectorul „Moneda meniului", nu valoarea salvată.
                  currency={resolveMenuCurrency(form.currency)}
                  // Limba de BAZĂ a meniului, tot din formular: oaspetele vede
                  // implicit meniul în ea, nu în limba personalului.
                  lang={menuBaseLang(form.language)}
                />
              </div>
            </SettingsCard>

            <SettingsCard icon="qr" title={st.t('url_title')}>
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
                    height: 44,
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {siteHost()}/m/
                </span>
                <Inp
                  label={st.t('url_slugLabel')}
                  value={form.slug || ''}
                  onChange={(v) => upd('slug', slugifyWhileTyping(v))}
                  placeholder={st.t('url_slugPh')}
                />
              </div>
            </SettingsCard>

            <SettingsCard icon="sparkle" title={st.t('accent_title')}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {/* Mostrele sunt DATE (lib/accentPalette.ts) — culoarea aleasă pentru
                    meniul oaspetelui —, nu culori ale panoului. Numele (în limba
                    personalului, `accentName`) = eticheta accesibilă + indicatorul
                    ne-cromatic. */}
                {ACCENT_SWATCHES.map((swatch) => {
                  const c = swatch.hex
                  const name = accentName(swatch, st)
                  const selected = form.primary_color === c
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => upd('primary_color', c)}
                      aria-label={st.t('accent_aria', { name })}
                      aria-pressed={selected}
                      title={name}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: c,
                        border: `3px solid ${selected ? D.onSolid : 'transparent'}`,
                        cursor: 'pointer',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {/* Bifă ne-cromatică: arată selecția independent de culoare. */}
                      {selected && <Icon name="check" size={18} color={D.onSolid} />}
                    </button>
                  )
                })}
              </div>
            </SettingsCard>

            {/* Theme picker — 8 preset themes for QR menu */}
            <SettingsCard
              icon="image"
              title={st.t('theme_title')}
              desc={st.t('theme_desc')}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
                  gap: 8,
                }}
              >
                {THEMES.map((t) => {
                  const isSelected = (form.theme_settings?.preset_id ?? 'cafe') === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        // Păstrăm restul cheilor (menu_layout) când schimbăm tema.
                        updTheme({
                          preset_id: t.id,
                          accent_override: form.theme_settings?.accent_override ?? null,
                        })
                      }
                      aria-pressed={isSelected}
                      style={{
                        padding: '12px 10px',
                        border: `2px solid ${isSelected ? D.gold : D.border}`,
                        background: isSelected ? D.goldA : D.s3,
                        borderRadius: 10,
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: '1.1rem' }}>{t.emoji}</span>
                        <span
                          style={{
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            color: isSelected ? D.gold : D.t1,
                          }}
                        >
                          {themeName(t, st)}
                        </span>
                      </div>
                      {/* Color preview */}
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <div
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            background: t.colors.bg,
                            border: `1px solid ${D.border}`,
                          }}
                          title={st.t('theme_bg')}
                        />
                        <div
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            background: t.colors.accent,
                          }}
                          title={st.t('theme_accent')}
                        />
                        <div
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            background: t.colors.surface,
                            border: `1px solid ${D.border}`,
                          }}
                          title={st.t('theme_surface')}
                        />
                      </div>
                      <div
                        style={{ fontSize: '0.65rem', color: D.t3, lineHeight: 1.3, marginTop: 4 }}
                      >
                        {themeDescription(t, st)}
                      </div>
                    </button>
                  )
                })}
              </div>
              <div
                style={{
                  fontSize: '0.7rem',
                  color: D.t3,
                  marginTop: 12,
                  padding: '8px 10px',
                  background: D.s3,
                  borderRadius: 7,
                  lineHeight: 1.5,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="info" size={13} color={D.t3} />
                  {st.t('theme_note')}
                </span>
              </div>
            </SettingsCard>

            {/* Layout picker — aspectul listei de produse (separat de temă/culori) */}
            <SettingsCard
              icon="menu"
              title={st.t('layout_title')}
              desc={st.t('layout_desc')}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
                  gap: 8,
                }}
              >
                {(
                  [
                    { id: 'list', icon: 'menu', name: 'layout_list', desc: 'layout_listDesc' },
                    { id: 'grid', icon: 'image', name: 'layout_grid', desc: 'layout_gridDesc' },
                    { id: 'minimal', icon: 'minus', name: 'layout_minimal', desc: 'layout_minimalDesc' },
                    { id: 'photo', icon: 'camera', name: 'layout_photo', desc: 'layout_photoDesc' },
                    { id: 'flipbook', icon: 'copy', name: 'layout_flipbook', desc: 'layout_flipbookDesc' },
                  ] as const
                ).map((l) => {
                  const isSelected = (form.theme_settings?.menu_layout ?? 'list') === l.id
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() =>
                        // Păstrăm tema/accentul; schimbăm doar layout-ul.
                        updTheme({ menu_layout: l.id })
                      }
                      aria-pressed={isSelected}
                      style={{
                        padding: '14px 12px',
                        border: `2px solid ${isSelected ? D.gold : D.border}`,
                        background: isSelected ? D.goldA : D.s3,
                        borderRadius: 10,
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon name={l.icon} size={16} color={isSelected ? D.gold : D.t2} />
                        <span
                          style={{
                            fontSize: '0.82rem',
                            fontWeight: 600,
                            color: isSelected ? D.gold : D.t1,
                          }}
                        >
                          {st.t(l.name)}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.68rem', color: D.t3, lineHeight: 1.3 }}>{st.t(l.desc)}</div>
                    </button>
                  )
                })}
              </div>

              {/* Uploader pagini flipbook — vizibil doar când layout-ul e 'flipbook'.
                  Paginile stau în theme_settings.flipbook_pages și se salvează prin
                  butonul „Salvează" al formularului (fluxul existent). */}
              {(form.theme_settings?.menu_layout ?? 'list') === 'flipbook' && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: D.t1, marginBottom: 6 }}>
                    {st.t('fb_pagesTitle', { n: flipbookPages.length, max: FLIPBOOK_MAX_PAGES })}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: D.t2, marginBottom: 12, lineHeight: 1.5 }}>
                    {st.t('fb_help')}
                  </div>

                  {/* Lista de pagini: thumbnail + reordonare ↑↓ + ștergere. */}
                  {flipbookPages.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                      {flipbookPages.map((url, idx) => (
                        <div
                          key={`${idx}-${url}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '6px 8px',
                            background: D.s3,
                            border: `1px solid ${D.border}`,
                            borderRadius: 8,
                          }}
                        >
                          <span style={{ fontSize: '0.72rem', color: D.t3, width: 20, flexShrink: 0 }}>
                            {idx + 1}
                          </span>
                          <img
                            src={url}
                            alt={st.t('fb_pageAlt', { n: idx + 1 })}
                            loading="lazy"
                            style={{
                              width: 56,
                              height: 42,
                              objectFit: 'cover',
                              borderRadius: 5,
                              border: `1px solid ${D.border}`,
                              background: D.s2,
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ flex: 1 }} />
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => moveFlipbookPage(idx, -1)}
                            disabled={idx === 0}
                            aria-label={st.t('fb_moveUp', { n: idx + 1 })}
                            style={ICON_BTN}
                          >
                            <Icon name="chevronUp" size={16} />
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => moveFlipbookPage(idx, 1)}
                            disabled={idx === flipbookPages.length - 1}
                            aria-label={st.t('fb_moveDown', { n: idx + 1 })}
                            style={ICON_BTN}
                          >
                            <Icon name="chevronDown" size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFlipbookPage(idx)}
                            aria-label={st.t('fb_remove', { n: idx + 1 })}
                          >
                            {tc.t('delete')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {flipbookPages.length === 0 && (
                    <div
                      style={{
                        border: `1px dashed ${D.border}`,
                        borderRadius: 8,
                        padding: '16px 12px',
                        textAlign: 'center',
                        fontSize: '0.74rem',
                        color: D.t3,
                        marginBottom: 12,
                        lineHeight: 1.5,
                      }}
                    >
                      {st.t('fb_empty')}
                    </div>
                  )}

                  <label
                    className={UPLOAD_LABEL_CLASS}
                    style={{
                      cursor: uploadingPages ? 'wait' : 'pointer',
                      opacity: uploadingPages ? 0.6 : 1,
                    }}
                  >
                    {uploadingPages ? st.t('uploading') : st.t('fb_upload')}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        const files = Array.from(e.target.files ?? [])
                        e.target.value = ''
                        await uploadFlipbookPages(files)
                      }}
                    />
                  </label>

                  {/* Comanda din meniu nu are carduri pe flipbook — spunem explicit
                      localurilor care AU comenzi active, adică planului cu comenzi.
                      Nota sugerează că pe celelalte stiluri se poate comanda, deci
                      NU se aprinde pe ridicarea pornită a unui plan fără ea: din
                      mig 309 pagina publică n-o arată, iar fără planul cu comenzi
                      nu există nimic de comandat pe niciun stil (PS5). Pe planul
                      necunoscut (surface null) nota tace. */}
                  {surface?.ordering === true && (
                    <div
                      style={{
                        fontSize: '0.7rem',
                        color: D.t3,
                        marginTop: 12,
                        padding: '8px 10px',
                        background: D.s3,
                        borderRadius: 7,
                        lineHeight: 1.5,
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Icon name="info" size={13} color={D.t3} />
                        {st.t('fb_orderNote')}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </SettingsCard>

            {/* Elemente meniu — ce se vede pe hero-ul clienților. Toate ON implicit. */}
            <SettingsCard
              icon="settings"
              title={st.t('el_title')}
              desc={st.t('el_desc')}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(
                  [
                    { key: 'cover', name: 'el_cover', desc: 'el_coverDesc' },
                    { key: 'tagline', name: 'el_tagline', desc: 'el_taglineDesc' },
                    { key: 'status', name: 'el_status', desc: 'el_statusDesc' },
                    { key: 'amenities', name: 'el_amenities', desc: 'el_amenitiesDesc' },
                    { key: 'social', name: 'el_social', desc: 'el_socialDesc' },
                  ] as const
                ).map((el) => {
                  const value = form.theme_settings?.elements?.[el.key] ?? true
                  const elName = st.t(el.name)
                  return (
                    <div
                      key={el.key}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 500, color: D.t1 }}>
                          {elName}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 2 }}>{st.t(el.desc)}</div>
                      </div>
                      <Toggle
                        label={elName}
                        value={value}
                        onChange={(v) =>
                          // Păstrăm tema/accentul/layout-ul; schimbăm doar un element.
                          updTheme({
                            elements: { ...(form.theme_settings?.elements ?? {}), [el.key]: v },
                          })
                        }
                      />
                    </div>
                  )
                })}

                {/* Badge „Creat cu Menuvia" — opt-out de la Plan 2 în sus, aliniat
                    cu plan_features.remove_branding (growth+, mig 028) și cu
                    promisiunea publică de pe cardul „Meniu + Comenzi" din pricing.
                    Citirea în meniuri e gate-uită și în server (mig 281). Lotul P:
                    pe planul fără `remove_branding` rândul nu se arată deloc (fost
                    chip „Plan Meniu + Comenzi" cu lacăt) — upsell-ul e unul, pe Acasă. */}
                {surface?.branding === true && (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                      borderTop: `1px solid ${D.s3}`,
                      paddingTop: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 500, color: D.t1 }}>
                        {st.t('branding_title')}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 2 }}>
                        {st.t('branding_desc')}
                      </div>
                    </div>
                    <Toggle
                      label={st.t('branding_toggle')}
                      value={!(form.theme_settings?.hide_branding ?? false)}
                      onChange={(v) => updTheme({ hide_branding: !v })}
                    />
                  </div>
                )}
              </div>
            </SettingsCard>

            {/* Limbi meniu (lotul O6a): limba în care e SCRIS meniul + limbile
                suplimentare oferite clientului. Înainte româna era presupusă
                peste tot: un meniu scris în franceză apărea „Română”. */}
            <SettingsCard
              icon="info"
              title={st.t('langs_title')}
              desc={st.t('langs_desc')}
            >
              <div style={{ marginBottom: 12, maxWidth: 320 }}>
                <label
                  htmlFor="menu-base-lang"
                  style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}
                >
                  {st.t('langs_base')}
                </label>
                <Sel
                  id="menu-base-lang"
                  label={st.t('langs_base')}
                  value={menuBaseLang(form.language)}
                  onChange={(v) => {
                    upd('language', v)
                    // Limba originală nu mai e și „în plus”.
                    const extra = ((form.menu_languages ?? []) as string[]).filter((c) => c !== v)
                    upd('menu_languages', extra)
                  }}
                >
                  {MENU_LANGS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {menuLangTitle(l.code, trTr, l.label)}
                    </option>
                  ))}
                </Sel>
                <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 5, lineHeight: 1.5 }}>
                  {st.t('langs_baseHelp')}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {MENU_LANGS.filter((l) => l.code !== menuBaseLang(form.language)).map((l) => {
                  const active = (form.menu_languages ?? []).includes(l.code)
                  return (
                    <button
                      key={l.code}
                      type="button"
                      onClick={() => toggleMenuLang(l.code)}
                      aria-pressed={active}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: active ? D.goldA : D.s3,
                        border: `1px solid ${active ? D.gold : D.border}`,
                        color: active ? D.goldL : D.t2,
                        padding: '6px 12px',
                        minHeight: 44,
                        borderRadius: 100,
                        fontSize: '0.78rem',
                        fontWeight: active ? 600 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      <span>{l.flag}</span>
                      {menuLangTitle(l.code, trTr, l.label)}
                    </button>
                  )
                })}
              </div>
            </SettingsCard>

            {/* Moneda meniului (mig 205) — pista internațională, planurile 1-2. */}
            <SettingsCard
              icon="info"
              title={st.t('cur_title')}
              desc={surface?.payments === true ? st.t('cur_descPay') : st.t('cur_desc')}
              right={
                <select
                  aria-label={st.t('cur_title')}
                  value={(form.currency as string) ?? 'RON'}
                  onChange={(e) => upd('currency', e.target.value)}
                  style={{
                    background: D.s3,
                    border: `1px solid ${D.border}`,
                    borderRadius: 8,
                    color: D.t1,
                    fontFamily: D.fontBody,
                    fontSize: 14,
                    padding: '10px 12px',
                    minHeight: 44,
                    cursor: 'pointer',
                  }}
                >
                  {MENU_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c === 'RON' ? st.t('cur_ron') : c}
                    </option>
                  ))}
                </select>
              }
            />
          </>
        )}

        {section === 'orders' && (
          <>
            {/* MODULES toggles — Gate D */}
            {modulesState && (
              <SettingsCard
                icon="sparkle"
                title={st.t('mod_title')}
                // Comutatorul scrie imediat (setModule), fără „Salvează".
                autoSave
                desc={st.t('mod_desc')}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          fontWeight: 500,
                          color: D.t1,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <Icon name="calendar" size={15} color={D.t2} />
                        {st.t('mod_resv')}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 2 }}>
                        {st.t('mod_resvDesc')}
                      </div>
                    </div>
                    <Toggle
                      label={st.t('mod_resv')}
                      value={modulesState.isEnabled('reservations')}
                      onChange={(v) => {
                        modulesState
                          .setModule('reservations', v)
                          .then(() => toast(v ? st.t('mod_resvOn') : st.t('mod_resvOff')))
                          .catch((err) => toast(describeStaffError(err, tc, { fallback: st.t('err_save') })))
                      }}
                    />
                  </div>
                </div>
              </SettingsCard>
            )}

            {/* Plăți online la masă — Etapa 1 (docs/ONLINE_PAYMENT.md). Lotul P:
                doar pe Planul 3 (planSurface.payments); dedesubt nu mai apare
                ca un card blocat — upsell-ul „Plata la masă" e unul, pe Acasă. */}
            {modulesState && surface?.payments === true && (
              <OnlinePaymentsCard
                restaurantId={restaurant.id}
                plan={plan}
                modulesState={modulesState}
                toast={toast}
                founderView={founderView}
              />
            )}

            {/* Fidelizare — Loyalty v1 (mig 226): puncte + prag + recompensă.
                Punctele se acordă pe comenzi, deci doar pe un plan cu comenzi
                (fost card blocat pe Planul 1 — lotul P). */}
            {modulesState && surface?.ordering === true && (
              <LoyaltySettingsCard
                restaurantId={restaurant.id}
                baseLang={menuBaseLang(form.language)}
                plan={plan}
                modulesState={modulesState}
                toast={toast}
              />
            )}

            {/* SMS tranzacționale (mig 228): confirmare rezervare + pickup gata.
                Pe planul care ARE `sms_notifications` (planSurface.sms — de la
                starter, deci și Planul 1, unde un modul pornit trebuie să se
                poată opri); pe free nu apare deloc, nici blocat (lotul P). */}
            {modulesState && surface?.sms === true && (
              <SmsNotificationsCard
                restaurantId={restaurant.id}
                plan={plan}
                modulesState={modulesState}
                toast={toast}
              />
            )}

            {/* Pickup ordering settings — doar pe planul cu `pickup_orders`
                (planSurface.pickup, lotul P). Pe un plan fără ridicare cardul nu
                se mai arată deloc: din mig 309 pagina publică nu arată ridicarea
                oricum, deci o setare rămasă pornită după un downgrade e inertă. */}
            {surface?.pickup === true && (
            <SettingsCard
              icon="box"
              title={st.t('pickup_title')}
              desc={
                <>
                  {pickupDesc.lead}{' '}
                  <span style={{ color: D.gold }}>
                    {siteHost()}/m/{form.slug || 'slug'}
                  </span>
                  {pickupDesc.tail}
                </>
              }
              right={
                <Toggle
                  label={st.t('pickup_toggle')}
                  value={form.pickup_settings?.enabled ?? false}
                  onChange={(v) => updPickup({ enabled: v })}
                />
              }
            >
              {form.pickup_settings?.enabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                  {/* Mod „doar ridicare" (food truck, E3) — pur mod de afișare:
                      ascunde Hartă sală/Rezervări din nav; QR-ul general /m/:slug
                      devine QR-ul principal (card în Mese & QR-uri). Pe planul
                      fără ridicare modul e suspendat (pickupOnlyMode, în
                      DashboardPage), dar acolo cardul nu se mai arată. */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 500, color: D.t1 }}>
                        {st.t('pickupOnly_title')}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 2 }}>
                        {pickupTexts.pickupOnlyToggleDescription(true)}
                      </div>
                    </div>
                    <Toggle
                      label={st.t('pickupOnly_title')}
                      value={form.pickup_settings?.pickup_only ?? false}
                      onChange={(v) => updPickup({ pickup_only: v })}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '0.74rem',
                          color: D.t2,
                          marginBottom: 5,
                        }}
                      >
                        {st.t('pickup_lead')}
                      </label>
                      <Inp
                        label={st.t('pickup_leadAria')}
                        value={String(form.pickup_settings?.min_lead_time_minutes ?? 20)}
                        onChange={(v) => {
                          const n = parseInt(v)
                          if (!isNaN(n) && n >= 5 && n <= 240) updPickup({ min_lead_time_minutes: n })
                        }}
                        type="number"
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '0.74rem',
                          color: D.t2,
                          marginBottom: 5,
                        }}
                      >
                        {st.t('pickup_slot')}
                      </label>
                      <Inp
                        label={st.t('pickup_slotAria')}
                        value={String(form.pickup_settings?.slot_interval_minutes ?? 15)}
                        onChange={(v) => {
                          const n = parseInt(v)
                          if (!isNaN(n) && n >= 5 && n <= 60) updPickup({ slot_interval_minutes: n })
                        }}
                        type="number"
                      />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '0.74rem',
                          color: D.t2,
                          marginBottom: 5,
                        }}
                      >
                        {st.t('pickup_open')}
                      </label>
                      <Inp
                        label={st.t('pickup_openAria')}
                        value={form.pickup_settings?.open_hours?.start ?? '09:00'}
                        onChange={(v) =>
                          updPickup({
                            open_hours: {
                              start: v,
                              end: form.pickup_settings?.open_hours?.end ?? '21:00',
                            },
                          })
                        }
                        placeholder="09:00"
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '0.74rem',
                          color: D.t2,
                          marginBottom: 5,
                        }}
                      >
                        {st.t('pickup_close')}
                      </label>
                      <Inp
                        label={st.t('pickup_closeAria')}
                        value={form.pickup_settings?.open_hours?.end ?? '21:00'}
                        onChange={(v) =>
                          updPickup({
                            open_hours: {
                              start: form.pickup_settings?.open_hours?.start ?? '09:00',
                              end: v,
                            },
                          })
                        }
                        placeholder="21:00"
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      style={{ display: 'block', fontSize: '0.74rem', color: D.t2, marginBottom: 5 }}
                    >
                      {st.t('pickup_instr')}
                    </label>
                    <Inp
                      label={st.t('pickup_instr')}
                      value={form.pickup_settings?.instructions ?? ''}
                      onChange={(v) =>
                        updPickup({ instructions: v.length > 0 ? v : null })
                      }
                      placeholder={st.t('pickup_instrPh')}
                    />
                  </div>
                  <div
                    style={{
                      fontSize: '0.7rem',
                      color: D.t3,
                      padding: '8px 10px',
                      background: D.s3,
                      borderRadius: 7,
                      lineHeight: 1.5,
                    }}
                  >
                    <Icon name="info" size={13} color={D.t3} />{' '}
                    {fillNodes(st.t('pickup_kitchenNote'), {
                      badge: <strong style={{ color: D.gold }}>{st.t('pickup_badge')}</strong>,
                    })}
                  </div>
                </div>
              )}
            </SettingsCard>
            )}

            {/* Checkout suggestion settings — sugestiile apar în COȘ, deci doar pe
                un plan cu comenzi (planSurface.ordering, lotul P). */}
            {surface?.ordering === true && (
            <SettingsCard
              icon="orders"
              title={st.t('sugg_title')}
              desc={st.t('sugg_desc')}
              right={
                <Toggle
                  label={st.t('sugg_title')}
                  value={form.checkout_suggestion_settings?.enabled ?? false}
                  onChange={(v) =>
                    upd('checkout_suggestion_settings', {
                      ...(form.checkout_suggestion_settings ?? {
                        categories: [],
                        max_suggestions: 2,
                        message: checkoutSuggestionDefaultMessage(menuBaseLang(form.language)),
                      }),
                      enabled: v,
                    })
                  }
                />
              }
            >
              {form.checkout_suggestion_settings?.enabled && (
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.74rem',
                      color: D.t2,
                      marginBottom: 5,
                      marginTop: 8,
                    }}
                  >
                    {st.t('sugg_msgLabel')}
                  </label>
                  <Inp
                    label={st.t('sugg_msgAria')}
                    value={form.checkout_suggestion_settings?.message ?? ''}
                    onChange={(v) =>
                      upd('checkout_suggestion_settings', {
                        ...(form.checkout_suggestion_settings ?? {
                          enabled: true,
                          categories: [],
                          max_suggestions: 2,
                          message: '',
                        }),
                        message: v,
                      })
                    }
                    placeholder={st.t('sugg_msgPh')}
                  />
                </div>
              )}
            </SettingsCard>
            )}

            {/* VAT rates configuration — doar pe planul cu bon și raport TVA
                (planSurface.vat, lotul P): pe Planurile 1–2 bonul se emite pe
                casa existentă, deci cotele de aici nu le folosește nimic. */}
            {surface?.vat === true && (
              <SettingsCard
                icon="receipt"
                title={st.t('vat_title')}
                desc={st.t('vat_desc')}
              >
                {/* Ecran fiscal: în română prin lege (lib/fiscalScreens.ts). */}
                <div lang="ro">
                  <VatRatesEditor restaurantId={restaurant.id} />
                </div>
              </SettingsCard>
            )}
          </>
        )}

        {section === 'account' && (
          <>
            {/* Abonament & facturare (mutat de pe Acasă, lotul R2) — ORICE plan:
                deschide Portalul Stripe, destinația CTA-urilor din emailurile de
                facturare (`/dashboard?tab=billing` → aici, cu scroll pe id). Doar
                PROPRIETARUL: managerul n-are client Stripe (abonamentul e pe
                contul proprietarului). Un proprietar FĂRĂ client Stripe
                (`no_customer`) primește „Vezi planurile" → /pricing — contractul
                din lib/billing.ts. */}
            {isOwner && (
              <div id="billing-card">
                <SubscriptionCard onSeePlans={onPricing} />
              </div>
            )}

            {/* Locație nouă (goală) pe contul PROPRIETARULUI: limita de
                restaurante e a contului lui (mig 131), managerul n-are ce crea;
                fără loc liber în plan, cardul nu apare deloc (lotul P). */}
            {isOwner && addLocation && <AddLocationCard {...addLocation} />}

            {/* Limba interfeței (lotul L3b): nu se randează cât timp e activă o
                singură limbă a personalului (ENABLED_STAFF_LANGS). */}
            <UiLanguageCard />

            <MfaCard />

            {/* Drepturile GDPR (Art. 15/17/20) — RPC-urile există din mig 042,
                dar până la auditul din aug 2026 nu erau apelate de NICĂIERI. */}
            <GdprCard />

            <SettingsCard
              icon="star"
              title={st.t('plan_title')}
              right={
                surface == null && planLoadError && onRetryPlan ? (
                  <Button variant="secondary" size="sm" onClick={onRetryPlan}>
                    {tc.t('retry')}
                  </Button>
                ) : undefined
              }
            >
              <span
                style={{
                  padding: '4px 10px',
                  background: D.goldA,
                  border: `1px solid ${D.goldBorder}`,
                  borderRadius: 6,
                  fontSize: '0.78rem',
                  color: D.goldL,
                  fontWeight: 600,
                }}
              >
                {/* Planul necunoscut (`surface` null) nu se afișează ca „gratuit". */}
                {surface != null
                  ? PLAN_LABELS[plan] || plan
                  : planLoadError
                    ? st.t('plan_failed')
                    : st.t('plan_checking')}
              </span>
            </SettingsCard>

            <Button variant="secondary" fullWidth onClick={onSignOut}>
              {st.t('signOut')}
            </Button>
          </>
        )}
      </div>

      {/* Bară de salvare sticky jos — formularul e lung, iar butonul „Salvează"
          de sus iese din ecran. Apare doar când ai modificări nesalvate și
          folosește ACELAȘI handleSave (fără logică duplicată). safe-area pentru
          notch-ul de jos pe mobil. */}
      {dirty && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            marginTop: 16,
            background: D.s1,
            borderTop: `1px solid ${D.border}`,
            padding: '12px 0',
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            zIndex: 10,
            boxShadow: `0 -6px 20px ${D.scrim}`,
          }}
        >
          <span style={{ color: D.t2, fontSize: '0.78rem', marginRight: 'auto' }}>{st.t('unsaved')}</span>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            {saving ? st.t('save_busy') : tc.t('save')}
          </Button>
        </div>
      )}
    </div>
  )
}
