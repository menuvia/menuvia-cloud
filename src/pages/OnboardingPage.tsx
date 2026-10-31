import { useRef, useEffect, useState, lazy, Suspense } from 'react'
import { supabase } from '../lib/supabase'
import { D, PLAN_LABELS } from '../lib/constants'
import { createRestaurant } from '../lib/restaurants'
import { consumeOnboardingPreset } from '../lib/onboardingPreset'
import { Icon } from '../components/ui/Icon'
import type { IconName } from '../components/ui/Icon'
import { fetchRestaurantFeatures, getLimit, getLimitDetailed, hasFeature } from '../lib/features'
import { track } from '../lib/analytics'
import { browserSite, defaultUiLang, publicBaseUrl, siteHost } from '../lib/domain'
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

// Lazy ca în ProductsTab: modalul de import AI nu intră în chunk-ul de
// onboarding decât dacă userul chiar apasă butonul de import din poză.
const AiMenuImport = lazy(() => import('../components/AiMenuImport'))

// ─── Limbă UI ────────────────────────────────────────────────
// Citită o singură dată, la încărcarea modulului — nu e state, nu se
// schimbă mid-flow. Convenția: cheia localStorage 'menuvia_ui_lang'
// ('ro' | 'en'), setată de /auth prin ?lang=en. Fără alegere explicită,
// default-ul vine din SITE (lib/domain.ts): 'ro' peste tot, 'en' doar pe
// hostul .com — pe .ro rezultatul e identic cu cel de dinainte.
const site = browserSite()
function readUiLang(): 'ro' | 'en' {
  try {
    const stored = localStorage.getItem('menuvia_ui_lang')
    if (stored === 'en' || stored === 'ro') return stored
  } catch {
    /* storage blocat (Safari „Block All Cookies") — cădem pe default-ul site-ului */
  }
  return defaultUiLang(site)
}
const lang: 'ro' | 'en' = readUiLang()
// Țara se ALEGE doar pe un host .com; pe .ro restaurantul rămâne pe default-ul
// din DB ('RO', mig 296) și nu apare niciun câmp nou.
const askCountry = site === 'com'

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
      // Linkul NU mai e un câmp: se creează din nume (lib/slug.ts), iar
      // coliziunile le rezolvă serverul cu sufix (mig 221). Omul îl vede doar.
      linkPreviewLabel: 'Linkul meniului:',
      slugPrefix: `${siteHost()}/m/`,
      linkPreviewHint: 'Se creează din nume. Îl poți schimba oricând din Setări.',
      nameRequiredError: 'Numele restaurantului este obligatoriu.',
      unknownError: 'Eroare necunoscută',
      slugAllocError: 'Nu am putut genera linkul meniului. Reîncearcă.',
      countryLabel: 'Țara *',
      countryPlaceholder: 'Alege țara',
      countryRequiredError: 'Alege țara restaurantului.',
      countrySaveError: 'Restaurantul a fost creat, dar țara nu s-a salvat. Reîncearcă.',
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
      photoImportBtn: '📸 Ai meniul tipărit? Fotografiază-l și îl importăm noi',
      orManualDivider: 'sau adaugă manual primul produs',
      // Meniul demo e cel PUBLIC (/demo), nu produse inserate în restaurantul
      // omului: presetul „Tip local” umplea plafonul gratuit (cafenea = 15/15)
      // și publica pe QR produse și prețuri false.
      demoLead: 'Nu ai meniul la tine? Vezi întâi cum arată un meniu Menuvia:',
      demoLink: 'Deschide meniul demo ↗',
      demoHint: 'Se deschide într-o filă nouă și nu adaugă nimic în restaurantul tău.',
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
      pdfPrefix: 'PDF gata de printat ',
      pdfTabName: 'imediat, pe ecranul următor',
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
      // Planul fără `pickup_orders`: ridicarea NU se pornește (serverul ar
      // respinge toate comenzile oaspeților), rămâne QR-ul general al meniului.
      generalQrBtn: 'Nu am mese — folosesc QR-ul general al meniului →',
      pickupHint:
        'Comenzile pentru ridicare necesită planul 🛎 Meniu + Comenzi — meniul QR general funcționează și pe planul curent.',
      planUnknownError: 'Nu am putut verifica planul restaurantului. Reîncearcă.',
    },
    step4: {
      title: 'Ești gata!',
      titlePending: 'Aproape gata!',
      subtitle: 'Restaurantul tău e configurat și live.',
      subtitlePending: 'Restaurantul tău e creat. Ce mai e de făcut e marcat mai jos.',
      // Bifele se calculează din ce s-a întâmplat REAL (lib/onboardingSummary.ts),
      // nu mai sunt hard-codate. A patra depinde și de PLAN: comenzile prin QR
      // există de la Meniu + Comenzi; pe Meniu Digital QR-ul deschide doar meniul.
      summaryRestaurant: 'Restaurant creat',
      summaryMenuProducts: (n: number) => (n === 1 ? 'Meniu: 1 produs' : `Meniu: ${n} produse`),
      summaryMenuEmpty: 'Meniul e încă gol — adaugi produsele din dashboard',
      summaryTablesQr: (n: number) => (n === 1 ? '1 masă cu QR' : `${n} mese cu QR-uri`),
      summaryTablesNoQr: 'Mesele sunt create, dar QR-urile nu — le generezi din Mese & QR',
      summaryPickup: 'Ridicare activată — QR-ul meniului e QR-ul principal',
      summaryGeneralQr: 'Fără mese — folosești QR-ul general al meniului',
      summaryTablesSkipped: 'Mesele nu sunt create încă — le adaugi din Mese & QR',
      ordersReady: 'Gata de comenzi',
      menuQrReady: 'Meniu public cu QR',
      achievementDoneLabel: 'finalizat',
      achievementPendingLabel: 'de făcut',
      // QR-ul se descarcă de AICI (înainte: încă patru apăsări până în Mese & QR).
      qrTablesTitle: 'Tipărește QR-urile meselor',
      qrTablesHint: (n: number) =>
        `PDF A4 cu ${n === 1 ? 'un card' : `${n} carduri`}, câte 6 pe pagină — gata de lipit pe mese.`,
      qrTablesBtn: 'Descarcă PDF-ul cu QR-urile',
      qrMenuTitle: 'Tipărește QR-ul meniului',
      qrMenuHint: 'Un poster A4 cu QR-ul meniului public — pentru vitrină, tejghea sau flyere.',
      qrMenuBtn: 'Descarcă QR-ul meniului (PDF)',
      qrMenuCardLabel: 'Meniu',
      qrBusyBtn: 'Se generează PDF-ul...',
      qrError: 'Nu am putut genera PDF-ul. Reîncearcă sau descarcă-l din tab-ul Mese & QR.',
      qrOtherFormats: 'Cardurile pliabile și posterele A4 le găsești oricând în tab-ul Mese & QR.',
      menuLinkLabel: 'Link meniu public',
      copyBtnAriaLabel: 'Copiază link-ul meniului',
      copiedLabel: 'Copiat!',
      copyLabel: 'Copiază',
      nextStepsTitle: 'Următorii pași în dashboard:',
      nextStepAddProducts: 'Adaugă restul produselor din meniu',
      nextStepAddFirstProducts: 'Adaugă produsele din meniu (tab-ul Produse)',
      nextStepInviteTeam: 'Invită echipa din Setări → Echipă (de la planul Meniu + Comenzi)',
      nextStepTrackOrders: 'Urmărește comenzile live din Bucătărie',
      finishingBtn: 'Se deschide...',
      doneBtn: 'Deschide dashboard-ul →',
      // Planul ales pe landing/pricing înainte de cont: întâi restaurantul,
      // apoi planul — CTA-ul final duce la activarea lui (/pricing).
      continuePlanBtn: (plan: string) => `Continuă cu planul ${plan} →`,
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
      linkPreviewLabel: 'Menu link:',
      slugPrefix: `${siteHost()}/m/`,
      linkPreviewHint: 'Generated from the name. You can change it anytime in Settings.',
      nameRequiredError: 'Restaurant name is required.',
      unknownError: 'Unknown error',
      slugAllocError: "We couldn't create the menu link. Try again.",
      countryLabel: 'Country *',
      countryPlaceholder: 'Select a country',
      countryRequiredError: 'Select the country of your restaurant.',
      countrySaveError: 'Your restaurant was created, but the country was not saved. Try again.',
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
      photoImportBtn: '📸 Have a printed menu? Snap a photo and we import it',
      orManualDivider: 'or add your first product manually',
      demoLead: "Don't have the menu with you? See what a Menuvia menu looks like first:",
      demoLink: 'Open the demo menu ↗',
      demoHint: 'Opens in a new tab and adds nothing to your restaurant.',
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
      pdfPrefix: 'PDF ready to print ',
      pdfTabName: 'right on the next screen',
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
      generalQrBtn: 'No tables — I use the general menu QR →',
      pickupHint:
        'Pickup orders require the 🛎 Menu + Orders plan — the general QR menu still works on your current plan.',
      planUnknownError: "We couldn't check your restaurant's plan. Try again.",
    },
    step4: {
      title: "You're all set!",
      titlePending: 'Almost there!',
      subtitle: 'Your restaurant is set up and live.',
      subtitlePending: 'Your restaurant is created. What is left to do is marked below.',
      summaryRestaurant: 'Restaurant created',
      summaryMenuProducts: (n: number) => (n === 1 ? 'Menu: 1 item' : `Menu: ${n} items`),
      summaryMenuEmpty: 'The menu is still empty — add your items from the dashboard',
      summaryTablesQr: (n: number) =>
        n === 1 ? '1 table with a QR code' : `${n} tables with QR codes`,
      summaryTablesNoQr:
        'Tables are created, but their QR codes are not — generate them in Tables & QR',
      summaryPickup: 'Pickup enabled — the menu QR is your main QR',
      summaryGeneralQr: 'No tables — you use the general menu QR',
      summaryTablesSkipped: 'No tables yet — add them in Tables & QR',
      ordersReady: 'Ready for orders',
      menuQrReady: 'Public menu with QR',
      achievementDoneLabel: 'done',
      achievementPendingLabel: 'to do',
      qrTablesTitle: 'Print your table QR codes',
      qrTablesHint: (n: number) =>
        `A4 PDF with ${n === 1 ? 'one card' : `${n} cards`}, 6 per page — ready to stick on the tables.`,
      qrTablesBtn: 'Download the QR codes (PDF)',
      qrMenuTitle: 'Print your menu QR code',
      qrMenuHint: 'An A4 poster with your public menu QR — for the window, the counter or flyers.',
      qrMenuBtn: 'Download the menu QR (PDF)',
      qrMenuCardLabel: 'Menu',
      qrBusyBtn: 'Generating the PDF...',
      qrError: "We couldn't generate the PDF. Try again or download it from the Tables & QR tab.",
      qrOtherFormats: 'Folded table cards and posters are always in the Tables & QR tab.',
      menuLinkLabel: 'Public menu link',
      copyBtnAriaLabel: 'Copy the menu link',
      copiedLabel: 'Copied!',
      copyLabel: 'Copy',
      nextStepsTitle: 'Next steps in the dashboard:',
      nextStepAddProducts: 'Add the rest of your menu items',
      nextStepAddFirstProducts: 'Add your menu items (Products tab)',
      nextStepInviteTeam: 'Invite your team from Settings → Team (from the Menu + Orders plan)',
      nextStepTrackOrders: 'Track live orders from the Kitchen',
      finishingBtn: 'Opening...',
      doneBtn: 'Open the dashboard →',
      continuePlanBtn: (plan: string) => `Continue with the ${plan} plan →`,
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
function Step1Restaurant({
  onNext,
}: {
  onNext: (restaurantId: string, slug: string, name: string) => void
}) {
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
      setError(t.step1.nameRequiredError)
      return
    }
    if (askCountry && !country) {
      setError(t.step1.countryRequiredError)
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
          setError(t.step1.countrySaveError)
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
      const msg = err instanceof Error ? err.message : t.step1.unknownError
      setError(msg.includes('slug') ? t.step1.slugAllocError : msg)
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
            onChange={(e) => setName(e.target.value)}
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
        {/* Doar previzualizare: linkul se creează din nume, fără diacritice
            rupte („Casa Țărănească” → casa-taraneasca). Cel REAL (eventual cu
            sufix, dacă numele e luat) apare pe ecranul final. */}
        {name.trim() && (
          <div style={{ fontSize: '0.78rem', color: D.t3, lineHeight: 1.5 }}>
            {t.step1.linkPreviewLabel}{' '}
            <span data-testid="ob-link-preview" style={{ color: D.t2, wordBreak: 'break-all' }}>
              {t.step1.slugPrefix}
              {slugify(name)}
            </span>
            <div>{t.step1.linkPreviewHint}</div>
          </div>
        )}
        {askCountry && (
          <div>
            <label htmlFor="ob-country" style={label}>
              {t.step1.countryLabel}
            </label>
            <select
              id="ob-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              style={inp}
            >
              <option value="">{t.step1.countryPlaceholder}</option>
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
  onNext: (outcome: MenuOutcome) => void
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
        {t.step2.title}
      </h1>
      <p style={{ color: D.t2, fontSize: '0.85rem', marginBottom: 24, lineHeight: 1.6 }}>
        {t.step2.subtitle}
      </p>

      {/* Importul din poză = acțiunea PRIMARĂ (audit aug 2026): 4/4 utilizatori
          reali au abandonat la introducerea manuală a meniului. Formularul
          manual rămâne dedesubt, sub separator. */}
      <button onClick={() => setAiImportOpen(true)} style={{ ...btnPrimary, marginBottom: 4 }}>
        {t.step2.photoImportBtn}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 16px' }}>
        <div style={{ flex: 1, height: 1, background: D.border }} />
        <span style={{ fontSize: '0.75rem', color: D.t3 }}>{t.step2.orManualDivider}</span>
        <div style={{ flex: 1, height: 1, background: D.border }} />
      </div>

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
        {/* Alternativa la Skip: meniul demo public, într-o filă nouă (nu
            pierde pasul curent) — omul vede cum arată un meniu fără ca în
            restaurantul lui să apară produse false. */}
        <div style={{ fontSize: '0.78rem', color: D.t3, textAlign: 'center', marginTop: 4 }}>
          {t.step2.demoLead}
        </div>
        <a href="/demo" target="_blank" rel="noopener noreferrer" style={linkDemo}>
          {t.step2.demoLink}
        </a>
        <div style={{ fontSize: '0.72rem', color: D.t3, textAlign: 'center' }}>
          {t.step2.demoHint}
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
  // Limita de mese a planului (free=3). Citim de la server ca să nu trimitem
  // by-default mai multe mese decât permite planul — altfel trigger-ul (mig 114)
  // făcea rollback cu eroare brută și onboarding-ul standard pica pentru free.
  const [maxTables, setMaxTables] = useState<number | null>(null)
  const [count, setCount] = useState(5)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Comenzile pentru ridicare sunt growth+ (Gate A). TRISTATE: `null` = planul
  // nu e (încă) cunoscut. Flag-ul NU e inert: cu `pickup_settings.enabled`,
  // meniul public oferă ridicarea oaspeților, iar pe un plan fără
  // `pickup_orders` serverul le respinge TOATE comenzile. Deci pe tier 1 nu se
  // pornește nimic, iar pe necunoscut nu se pornește până nu e verificat.
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
      .select('id, name')
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
        setError(t.step3.planUnknownError)
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
      setError(t.step3.pickupActivateError)
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
        <button onClick={() => void handleNoTables()} disabled={saving} style={btnSecondary}>
          {hasPickup === false ? t.step3.generalQrBtn : t.step3.pickupOnlyBtn}
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

function summaryLabel(item: SummaryItem): string {
  const n = item.count ?? 0
  switch (item.key) {
    case 'restaurant':
      return t.step4.summaryRestaurant
    case 'menu-products':
      return t.step4.summaryMenuProducts(n)
    case 'menu-empty':
      return t.step4.summaryMenuEmpty
    case 'tables-qr':
      return t.step4.summaryTablesQr(n)
    case 'tables-no-qr':
      return t.step4.summaryTablesNoQr
    case 'pickup':
      return t.step4.summaryPickup
    case 'general-qr':
      return t.step4.summaryGeneralQr
    case 'tables-skipped':
      return t.step4.summaryTablesSkipped
    case 'orders-ready':
      return t.step4.ordersReady
    case 'menu-qr-ready':
      return t.step4.menuQrReady
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
              cards: [{ label: t.step4.qrMenuCardLabel, url: menuUrl }],
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
          {allDone ? t.step4.title : t.step4.titlePending}
        </h1>
        <p style={{ color: D.t2, fontSize: '0.85rem', lineHeight: 1.6 }}>
          {allDone ? t.step4.subtitle : t.step4.subtitlePending}
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
              {summaryLabel(item)}
            </span>
            {item.done ? (
              <Icon name="check" size={16} color={D.green} label={t.step4.achievementDoneLabel} />
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
                {t.step4.achievementPendingLabel}
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
          {printable.length > 0 ? t.step4.qrTablesTitle : t.step4.qrMenuTitle}
        </div>
        <div style={{ fontSize: '0.78rem', color: D.t2, lineHeight: 1.5, marginBottom: 12 }}>
          {printable.length > 0 ? t.step4.qrTablesHint(printable.length) : t.step4.qrMenuHint}
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
            ? t.step4.qrBusyBtn
            : printable.length > 0
              ? t.step4.qrTablesBtn
              : t.step4.qrMenuBtn}
        </button>
        {pdfError && (
          <div role="alert" style={{ marginTop: 10 }}>
            <ErrorBox msg={t.step4.qrError} />
          </div>
        )}
        <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 10, lineHeight: 1.5 }}>
          {t.step4.qrOtherFormats}
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
              <span>
                {hasMenu ? t.step4.nextStepAddProducts : t.step4.nextStepAddFirstProducts}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="users" size={15} color={D.t3} />
              <span>{t.step4.nextStepInviteTeam}</span>
            </div>
            {canOrder && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="chart" size={15} color={D.t3} />
                <span>{t.step4.nextStepTrackOrders}</span>
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
          ? t.step4.finishingBtn
          : pendingPlan
            ? t.step4.continuePlanBtn(PLAN_LABELS[pendingPlan] ?? pendingPlan)
            : t.step4.doneBtn}
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

export default function OnboardingPage({
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
