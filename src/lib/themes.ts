// ─────────────────────────────────────────────────────────────
// themes.ts — Preset themes for QR menu (telefon-first)
//
// 8 themes ready-to-use, plus 'custom' option for color override.
// Owner picks one from Dashboard Settings; menu re-renders.
// ─────────────────────────────────────────────────────────────

export interface MenuTheme {
  id: string
  name: string
  emoji: string
  description: string
  colors: {
    bg: string // page background
    surface: string // card background
    surface2: string // subtle differentiation
    text: string // primary text
    text2: string // body text
    text3: string // muted text
    border: string // subtle borders
    borderStrong: string // emphasis borders
    accent: string // primary CTA + price
    accentSoft: string // CTA backgrounds
    accentGradient: string // emoji fallback gradient
    success: string
    warning: string
    error: string
  }
  fonts: {
    heading: string // titles, prices
    body: string // descriptions, labels
  }
  radius: number // border radius global (in px)
}

// ── Theme: Editorial coral (default) ──────────────────────────
// Paletă inspirată din concept-uri editorial modern café —
// cremă warm + accent coral + ramat de borduri subtile. Folosită
// de meniul public ca temă default; combinată cu fonturi serif
// italic Fraunces dă aspectul "Tinctura".
const cafe: MenuTheme = {
  id: 'cafe',
  name: 'Editorial coral',
  emoji: '☕',
  description: 'Cremă warm + coral. Editorial, primitor, tipografie serif italic.',
  colors: {
    bg: '#F8F3EB',
    surface: '#FDF8F2',
    surface2: '#F5F1EA',
    text: '#2A1F18',
    text2: '#6B5C45',
    text3: '#9A8C7A',
    border: '#E8DCC9',
    borderStrong: '#D4C8B8',
    accent: '#C56B5A',
    accentSoft: '#F4D9D2',
    accentGradient: 'linear-gradient(135deg, #E89E8E 0%, #C56B5A 100%)',
    success: '#4CAF6E',
    warning: '#E0A050',
    error: '#C0392B',
  },
  fonts: { heading: 'Fraunces, Georgia, serif', body: 'DM Sans, sans-serif' },
  radius: 10,
}

// ── Theme: Pizzerie italiană ──────────────────────────────────
const pizzeria: MenuTheme = {
  id: 'pizzeria',
  name: 'Pizzerie italiană',
  emoji: '🍕',
  description: 'Roșu + alb + verde. Vesel, energic, fonturi italienești.',
  colors: {
    bg: '#FFFAF5',
    surface: '#FFFFFF',
    surface2: '#FFF5EE',
    text: '#1F1410',
    text2: '#5A3D2E',
    text3: '#A08070',
    border: '#F0DCC8',
    borderStrong: '#D8B898',
    accent: '#C8412C', // tomato red
    accentSoft: '#FBE8E0',
    accentGradient: 'linear-gradient(135deg, #FFEEE0 0%, #FFD8C0 100%)',
    success: '#3B7A3D',
    warning: '#E0A050',
    error: '#C0392B',
  },
  fonts: { heading: 'Fraunces, Georgia, serif', body: 'DM Sans, sans-serif' },
  radius: 12,
}

// ── Theme: Fine dining ────────────────────────────────────────
const fineDining: MenuTheme = {
  id: 'fine-dining',
  name: 'Fine dining',
  emoji: '🥂',
  description: 'Negru + auriu elegant. Sofisticat, minimalist, serif clasic.',
  colors: {
    bg: '#0F0E0C',
    surface: '#1A1814',
    surface2: '#252319',
    text: '#F5F1E8',
    text2: '#C8BFA8',
    text3: '#8A7F65',
    border: '#2E2A20',
    borderStrong: '#3D3828',
    accent: '#D4AF6F', // muted gold
    accentSoft: 'rgba(212, 175, 111, 0.12)',
    accentGradient: 'linear-gradient(135deg, #2A2418 0%, #1A1612 100%)',
    success: '#7BAA7E',
    warning: '#D4A050',
    error: '#C77665',
  },
  fonts: { heading: 'Fraunces, Georgia, serif', body: 'DM Sans, sans-serif' },
  radius: 8,
}

// ── Theme: Pub / Bar ──────────────────────────────────────────
const pub: MenuTheme = {
  id: 'pub',
  name: 'Pub & Bar',
  emoji: '🍻',
  description: 'Verde închis + ambră. Robust, masculin, fonturi industriale.',
  colors: {
    bg: '#F2EFE8',
    surface: '#FAF8F2',
    surface2: '#EAE5DA',
    text: '#1A1F18',
    text2: '#3F4838',
    text3: '#7A8270',
    border: '#D8D2C2',
    borderStrong: '#B8B0A0',
    accent: '#7B5828', // amber/dark wood
    accentSoft: '#F5EBD8',
    accentGradient: 'linear-gradient(135deg, #E8DCC0 0%, #C8B080 100%)',
    success: '#5A7A45',
    warning: '#D4A050',
    error: '#A03828',
  },
  fonts: { heading: 'Fraunces, Georgia, serif', body: 'DM Sans, sans-serif' },
  radius: 10,
}

// ── Theme: Mexican / Fast food ────────────────────────────────
const mexican: MenuTheme = {
  id: 'mexican',
  name: 'Mexican / Fast',
  emoji: '🌮',
  description: 'Culori vii — roșu + galben. Vesel, energic, atrăgător.',
  colors: {
    bg: '#FFF8E8',
    surface: '#FFFFFF',
    surface2: '#FFF0D0',
    text: '#2A1810',
    text2: '#5C3D28',
    text3: '#A88870',
    border: '#F5DDA8',
    borderStrong: '#E0BC78',
    accent: '#E84A28', // bright red-orange
    accentSoft: '#FFE0D5',
    accentGradient: 'linear-gradient(135deg, #FFE8C0 0%, #FFC880 100%)',
    success: '#5AA850',
    warning: '#E0A028',
    error: '#C0291C',
  },
  fonts: { heading: 'Fraunces, Georgia, serif', body: 'DM Sans, sans-serif' },
  radius: 16,
}

// ── Theme: Asian / Sushi ──────────────────────────────────────
const asian: MenuTheme = {
  id: 'asian',
  name: 'Asian & Sushi',
  emoji: '🍱',
  description: 'Alb minimalist + roșu Japan. Curat, ordonat, atemporal.',
  colors: {
    bg: '#FAFAF8',
    surface: '#FFFFFF',
    surface2: '#F0F0EC',
    text: '#0F0F0D',
    text2: '#3F3F3D',
    text3: '#8F8F8B',
    border: '#E5E5E0',
    borderStrong: '#C8C8C0',
    accent: '#BC2C2C', // Japan red
    accentSoft: '#FBE5E5',
    accentGradient: 'linear-gradient(135deg, #F5F5F0 0%, #E0E0DC 100%)',
    success: '#3A8A50',
    warning: '#D49028',
    error: '#A02020',
  },
  fonts: { heading: 'Fraunces, Georgia, serif', body: 'DM Sans, sans-serif' },
  radius: 6,
}

// ── Theme: Healthy / Vegan ────────────────────────────────────
const healthy: MenuTheme = {
  id: 'healthy',
  name: 'Healthy & Vegan',
  emoji: '🌿',
  description: 'Verde + crem natural. Curat, fresh, fonturi rotunde.',
  colors: {
    bg: '#F5F8F0',
    surface: '#FCFEF8',
    surface2: '#EAF0E0',
    text: '#1A2418',
    text2: '#3D5238',
    text3: '#7A8F70',
    border: '#D8E5C8',
    borderStrong: '#B8CCA0',
    accent: '#5A8A3C', // fresh green
    accentSoft: '#E8F2D8',
    accentGradient: 'linear-gradient(135deg, #E8F2D8 0%, #C8D8A8 100%)',
    success: '#4A9A4A',
    warning: '#D4A028',
    error: '#C04040',
  },
  fonts: { heading: 'Fraunces, Georgia, serif', body: 'DM Sans, sans-serif' },
  radius: 16,
}

// ── Theme: Mediteranean ──────────────────────────────────────
const mediterranean: MenuTheme = {
  id: 'mediterranean',
  name: 'Mediteranean',
  emoji: '☀️',
  description: 'Albastru + alb Santorini. Aerat, luminos, vacanță.',
  colors: {
    bg: '#F8FBFE',
    surface: '#FFFFFF',
    surface2: '#EDF3F8',
    text: '#0F1A24',
    text2: '#2E4258',
    text3: '#7090A8',
    border: '#D0E0EC',
    borderStrong: '#9CB8D0',
    accent: '#1E5C8A', // santorini blue
    accentSoft: '#E0EDF8',
    accentGradient: 'linear-gradient(135deg, #E5F0F8 0%, #C0D8EC 100%)',
    success: '#3A8A4A',
    warning: '#E0A028',
    error: '#C03838',
  },
  fonts: { heading: 'Fraunces, Georgia, serif', body: 'DM Sans, sans-serif' },
  radius: 12,
}

// ── Export all themes ────────────────────────────────────────
export const THEMES: MenuTheme[] = [
  cafe,
  pizzeria,
  fineDining,
  pub,
  mexican,
  asian,
  healthy,
  mediterranean,
]

export const DEFAULT_THEME_ID = 'cafe'

export function getTheme(id: string | null | undefined): MenuTheme {
  if (id == null) return cafe
  return THEMES.find((t) => t.id === id) ?? cafe
}

// Acceptă atât '#rrggbb' cât și '#rgb' (CSS short-hex). Întoarce
// `[r, g, b]` (0–255) sau null dacă input-ul nu e un hex valid.
function parseHexColor(input: string): [number, number, number] | null {
  const hex = input.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ]
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return [
      parseInt(hex[0]! + hex[0]!, 16),
      parseInt(hex[1]! + hex[1]!, 16),
      parseInt(hex[2]! + hex[2]!, 16),
    ]
  }
  return null
}

// Calcul WCAG relative luminance. Întoarce true pentru teme cu background
// "dark" (fineDining în prezent), unde overlay-urile glass trebuie să fie
// inversate (negru semi-transparent pe text alb) ca să rămână lizibile.
export function isDarkTheme(theme: MenuTheme): boolean {
  const parsed = parseHexColor(theme.colors.bg)
  if (!parsed) return false
  const [r255, g255, b255] = parsed
  const r = r255 / 255
  const g = g255 / 255
  const b = b255 / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return luminance < 0.4
}

// Validare strictă pentru hex override din DB / Settings form. Acceptă doar
// '#rrggbb' (6 hex digits) — short-hex respins ca să nu producem accentSoft
// invalid când îl concatenăm cu '22'.
export function isValidHexColor(s: string | null | undefined): s is string {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)
}

// ── Layout de meniu ──────────────────────────────────────────
// Aspectul listei de produse pe meniul client (digital + QR), separat de temă
// (culori/fonturi). Restaurantul îl alege din dashboard.
//  • 'list'     → listă cu poză mică stânga + text (implicit, actual)
//  • 'grid'     → galerie foto: 2 coloane cu poze mari (vizual)
//  • 'minimal'  → text elegant, majuscule spațiate, fără poze (rapid/clasic)
//  • 'photo'    → foto-first: poze mari full-width cu numele/prețul PE poză;
//                 produsele fără poză cad pe rând compact (nu carduri goale)
//  • 'flipbook' → paginile meniului ca imagini răsfoibile (tip carte) — vezi
//                 `flipbook_pages`; fără pagini încărcate, meniul cade pe 'list'
export type MenuLayout = 'list' | 'grid' | 'minimal' | 'photo' | 'flipbook'

const MENU_LAYOUTS: readonly MenuLayout[] = ['list', 'grid', 'minimal', 'photo', 'flipbook']

// ── Elemente opționale de meniu ──────────────────────────────
// Bucăți din hero-ul meniului client pe care restaurantul le poate ascunde.
// Toate implicit ON = comportamentul actual păstrat pentru meniurile existente.
//  • cover     → imaginea de copertă din hero (fallback: gradient de accent)
//  • tagline   → sloganul restaurantului
//  • status    → pastila deschis/închis
//  • amenities → pile WiFi / opțiuni vegan
//  • social    → pile social (Instagram/TikTok/Facebook/Website)
export interface MenuElements {
  cover: boolean // imaginea de copertă din hero
  tagline: boolean // sloganul restaurantului
  status: boolean // pastila deschis/închis
  amenities: boolean // pile WiFi / opțiuni vegan
  social: boolean // pile social (Instagram/TikTok/Facebook/Website)
}

// ── Custom theme override ────────────────────────────────────
// accent_override e disponibil pe TOATE planurile — nu există niciun gate pe
// plan (plans.ts nu-l vinde ca feature, SettingsTab nu-l gate-uiește, iar
// resolveTheme validează doar formatul hex). Dacă vreodată devine feature
// plătit, gate-ul trebuie aplicat server-side (RPC/RLS), nu doar în UI sau
// în comentarii. Celelalte culori rămân theme-default.
export interface ThemeSettings {
  preset_id: string // one of THEMES ids
  accent_override?: string | null // override culoare accent (hex) — toate planurile
  menu_layout?: MenuLayout | null // aspectul listei de produse (implicit 'list')
  elements?: Partial<MenuElements> | null // elemente vizibile în hero (implicit toate ON)
  // Paginile meniului ca imagini (layout 'flipbook'), în ordinea de răsfoire.
  // Doar URL-uri https, maxim FLIPBOOK_MAX_PAGES — vezi resolveFlipbookPages.
  flipbook_pages?: string[] | null
}

// Layout-ul de meniu ales, cu fallback sigur la 'list' pentru valori
// vechi/absente/necunoscute (backward-compatible cu setările existente).
export function resolveMenuLayout(settings: ThemeSettings | null | undefined): MenuLayout {
  const l = settings?.menu_layout
  return l != null && MENU_LAYOUTS.includes(l) ? l : 'list'
}

// Plafon dur pe numărul de pagini de flipbook — aliniat între resolver (citire)
// și uploader-ul din Setări (scriere), ca să nu poată diverge.
export const FLIPBOOK_MAX_PAGES = 30

// Paginile de flipbook validate din setări: doar URL-uri https (jsonb-ul poate
// conține orice — nu injectăm `javascript:`/`data:` în src), plafonate la
// FLIPBOOK_MAX_PAGES. Valori absente/malformate → [] (fallback-ul de layout
// cade pe 'list' în pagini, nu pe ecran gol).
export function resolveFlipbookPages(settings: ThemeSettings | null | undefined): string[] {
  const raw = settings?.flipbook_pages
  if (!Array.isArray(raw)) return []
  return raw
    .filter((p): p is string => typeof p === 'string' && /^https:\/\//i.test(p.trim()))
    .map((p) => p.trim())
    .slice(0, FLIPBOOK_MAX_PAGES)
}

// Elementele opționale ale meniului, cu default `true` per câmp (comportament
// actual păstrat pentru setările existente), suprascris de `settings.elements`.
export function resolveMenuElements(settings: ThemeSettings | null | undefined): MenuElements {
  const e = settings?.elements
  return {
    cover: e?.cover ?? true,
    tagline: e?.tagline ?? true,
    status: e?.status ?? true,
    amenities: e?.amenities ?? true,
    social: e?.social ?? true,
  }
}

export function resolveTheme(settings: ThemeSettings | null | undefined): MenuTheme {
  const base = getTheme(settings?.preset_id)
  // Override doar dacă-i un '#rrggbb' valid — altfel cad înapoi pe paleta temei
  // (în loc să producem accentSoft invalid din concatenare cu '22').
  if (!isValidHexColor(settings?.accent_override)) return base
  const accent = settings.accent_override
  return {
    ...base,
    colors: {
      ...base.colors,
      accent,
      // Soft = same color with 12% alpha — works on light AND dark themes
      accentSoft: accent + '22',
    },
  }
}

// Luminanța WCAG relativă a unui hex ('#rgb' sau '#rrggbb'); null pe input
// neparsabil. Un singur calcul, refolosit de `isDarkTheme`/`readableTextOn`.
function relativeLuminance(color: string): number | null {
  const parsed = parseHexColor(color)
  if (!parsed) return null
  const [r255, g255, b255] = parsed
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r255) + 0.7152 * lin(g255) + 0.0722 * lin(b255)
}

// Alege culoarea textului (deschis vs. închis) care are contrast bun peste un
// fundal dat — folosit pentru text/iconuri PESTE `accent`, fiindcă accentele
// deschise (galben/lime/gold) pică AA cu albul. Acceptă '#rgb' și '#rrggbb'; pe
// input neparsabil cade pe alb (comportament conservator). Helper partajat de
// meniu (ProductCard, MenuStates, MenuHeader) — un singur calcul WCAG.
//
// IMPORTANT: `darkText` e pasat de obicei ca `PUB.text` (textul primar al temei).
// Pe TEME DARK `PUB.text` e el însuși deschis (ex. fine-dining `#F5F1E8`), deci
// pe un accent deschis (gold) ar produce alb-pe-galben (contrast ~1.8, sub AA).
// De aceea, când fundalul e deschis dar `darkText` NU e suficient de întunecat,
// cădem pe un near-black garantat lizibil în loc să respectăm orbește tokenul.
export function readableTextOn(bg: string, darkText: string): string {
  const luminance = relativeLuminance(bg)
  if (luminance == null) return '#FFFFFF'
  // Prag ~0.45: peste el fundalul e prea deschis pentru text alb (AA).
  if (luminance <= 0.45) return '#FFFFFF'
  // Fundal deschis → vrem text închis. Dacă `darkText` e chiar deschis (temă
  // dark), fallback pe near-black ca să nu picăm AA cu un „dark text" fals.
  const darkLum = relativeLuminance(darkText)
  if (darkLum == null || darkLum > 0.4) return '#1A1A1A'
  return darkText
}
