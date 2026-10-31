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
    // Text secundar (etichete, note, prețuri barate). AA ≥4.5:1 pe bg, surface ȘI
    // surface2 în toate temele — clichet în __tests__/themes-contrast.test.ts.
    text3: string
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
    text3: '#776A5C',
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
    text3: '#866A5D',
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
    text3: '#958A72',
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
    text3: '#616859',
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
    text3: '#826653',
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
    text3: '#6C6C69',
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
    text3: '#5D6F56',
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
    text3: '#567084',
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

// Întoarce true pentru teme cu background "dark" (fineDining în prezent), unde
// overlay-urile glass trebuie să fie inversate (negru semi-transparent pe text
// alb) ca să rămână lizibile. Același calcul WCAG ca `readableTextOn`
// (`relativeLuminance`, mai jos) — nu o a doua copie a formulei.
export function isDarkTheme(theme: MenuTheme): boolean {
  const luminance = relativeLuminance(theme.colors.bg)
  return luminance != null && luminance < 0.4
}

// Validare strictă pentru hex override din DB / Settings form. Acceptă doar
// '#rrggbb' (6 hex digits) — short-hex respins ca să nu producem accentSoft
// invalid când îl concatenăm cu '22'. Intern: singurul apelant e resolveTheme
// (exportul nu avea niciun consumator).
function isValidHexColor(s: string | null | undefined): s is string {
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
  // Ascunde badge-ul „Creat cu Menuvia" de pe meniul public (E1, buclă virală).
  // Default FALSE (badge vizibil); dezactivarea e beneficiu de la Plan 2 în sus
  // (plan_features.remove_branding, growth+ din mig 028 — gating-ul de scriere
  // se face în UI-ul de Setări, citirea e liberă).
  hide_branding?: boolean | null
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

// Layout-ul EFECTIV al meniului public: 'flipbook' FĂRĂ pagini valide cade pe
// 'list' (fallback VIZIBIL, nu ecran gol). Sursa UNICĂ a regulii, citită de
// paginile oaspetelui (PublicMenuPage, QrMenuPage) ȘI de textele de staff
// despre comenzi (SettingsTab, TablesManager → lib/pickupCopy.ts): pe flipbook
// nu există carduri, coș sau ridicare, deci panoul nu are voie să promită
// comenzi exact acolo. O copie a regulii în altă parte ar diverge tăcut — un
// staff care ar citi doar `menu_layout` ar spune „fără comenzi” pentru un
// flipbook fără pagini, pe care oaspetele îl vede ca listă, cu coș (EL2).
export function resolveEffectiveMenuLayout(settings: ThemeSettings | null | undefined): MenuLayout {
  const layout = resolveMenuLayout(settings)
  return layout === 'flipbook' && resolveFlipbookPages(settings).length === 0 ? 'list' : layout
}

// Badge-ul de branding e vizibil implicit; doar `true` explicit îl ascunde.
export function resolveHideBranding(settings: ThemeSettings | null | undefined): boolean {
  return settings?.hide_branding === true
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
// neparsabil. Un singur calcul, refolosit de `isDarkTheme`, `readableTextOn` și
// `legibleOn`.
function relativeLuminance(color: string): number | null {
  const parsed = parseHexColor(color)
  return parsed ? rgbLuminance(parsed) : null
}

function rgbLuminance([r255, g255, b255]: readonly [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r255) + 0.7152 * lin(g255) + 0.0722 * lin(b255)
}

// Raportul de contrast WCAG 2.x între două luminanțe (1:1 … 21:1).
function contrastOfLuminances(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function toHexColor(rgb: readonly [number, number, number]): string {
  return (
    '#' +
    rgb
      .map((c) => Math.round(c).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

// Pragul AA pentru text normal (WCAG 1.4.3). Butoanele și etichetele oaspetelui
// au 11–16px, deci NU se pot baza pe pragul de 3:1 al textului mare.
const AA_TEXT = 4.5
const NEAR_BLACK = '#1A1A1A'

// Alege culoarea textului (și a iconițelor) PESTE un fundal plin — de regulă
// `accent`, care vine din Setări (`primary_color`, 7 culori) sau din temă.
// Garanția: rezultatul are ÎNTOTDEAUNA ≥4.5:1 pe un fundal hex valid.
//
// Vechiul prag fix (luminanță ≤ 0.45 → alb) dădea alb pe TOATE cele 7 culori din
// Setări: alb pe auriul implicit #C8963C = 2.66:1, pe turcoaz 2.24:1 — punctul de
// echilibru real dintre alb și negru e la luminanța ~0.18, nu 0.45. Acum se
// compară contrastele efective:
//   1. `darkText` (textul temei) dacă trece AA și bate albul — păstrăm tokenul;
//   2. altfel alb, dacă trece AA;
//   3. altfel near-black, dacă trece AA (ex. pe teme dark `darkText` e DESCHIS);
//   4. altfel extrema mai bună dintre negru și alb — una dintre ele are mereu
//      ≥4.58:1 (minimul se atinge exact la punctul de echilibru).
// Input neparsabil → alb (comportamentul conservator de dinainte).
export function readableTextOn(bg: string, darkText: string): string {
  const bgLum = relativeLuminance(bg)
  if (bgLum == null) return '#FFFFFF'
  const onWhite = contrastOfLuminances(1, bgLum)
  const darkLum = relativeLuminance(darkText)
  const onDark = darkLum == null ? 0 : contrastOfLuminances(darkLum, bgLum)
  if (onDark >= AA_TEXT && onDark >= onWhite) return darkText
  if (onWhite >= AA_TEXT) return '#FFFFFF'
  const nearBlackLum = relativeLuminance(NEAR_BLACK) ?? 0
  if (contrastOfLuminances(nearBlackLum, bgLum) >= AA_TEXT) return NEAR_BLACK
  return contrastOfLuminances(0, bgLum) >= onWhite ? '#000000' : '#FFFFFF'
}

// O culoare folosită ca TEXT pe un fundal dat (accentul ca etichetă/preț/link,
// roșul unei erori): o întoarce neschimbată dacă are deja ≥4.5:1, altfel o
// amestecă treptat spre negru (fundal deschis) sau spre alb (fundal închis)
// până trece pragul. Nuanța rămâne recognoscibilă — auriul devine bronz, nu gri.
// Input neparsabil (ex. `rgba(...)`) → culoarea neschimbată.
export function legibleOn(color: string, bg: string): string {
  const fg = parseHexColor(color)
  const bgLum = relativeLuminance(bg)
  if (!fg || bgLum == null) return color
  if (contrastOfLuminances(rgbLuminance(fg), bgLum) >= AA_TEXT) return color
  const towardBlack = contrastOfLuminances(0, bgLum) >= contrastOfLuminances(1, bgLum)
  const target = towardBlack ? 0 : 255
  for (let step = 1; step <= 20; step++) {
    const t = step / 20
    const mixed: [number, number, number] = [
      Math.round(fg[0] + (target - fg[0]) * t),
      Math.round(fg[1] + (target - fg[1]) * t),
      Math.round(fg[2] + (target - fg[2]) * t),
    ]
    if (contrastOfLuminances(rgbLuminance(mixed), bgLum) >= AA_TEXT) return toHexColor(mixed)
  }
  return towardBlack ? '#000000' : '#FFFFFF'
}
