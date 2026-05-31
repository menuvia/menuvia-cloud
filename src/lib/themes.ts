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

// Calcul WCAG relative luminance. Întoarce true pentru teme cu background
// "dark" (fineDining în prezent), unde overlay-urile glass trebuie să fie
// inversate (negru semi-transparent pe text alb) ca să rămână lizibile.
export function isDarkTheme(theme: MenuTheme): boolean {
  const hex = theme.colors.bg.replace('#', '')
  if (hex.length < 6) return false
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return luminance < 0.4
}

// ── Custom theme override ────────────────────────────────────
// User can override `accent` color on Growth+ — others stay theme-default
export interface ThemeSettings {
  preset_id: string // one of THEMES ids
  accent_override?: string | null // hex color override (Growth+)
}

export function resolveTheme(settings: ThemeSettings | null | undefined): MenuTheme {
  const base = getTheme(settings?.preset_id)
  if (settings?.accent_override == null) return base
  // Override accent + accentSoft (auto-derived as 0.12 alpha)
  return {
    ...base,
    colors: {
      ...base.colors,
      accent: settings.accent_override,
      // Soft = same color with 12% alpha — works on light AND dark themes
      accentSoft: settings.accent_override + '22',
    },
  }
}
