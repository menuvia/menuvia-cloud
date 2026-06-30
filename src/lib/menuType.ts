import type { CSSProperties } from 'react'

// ─────────────────────────────────────────────────────────────
// Scală tipografică pentru MENIU (client) — un singur set coerent de stiluri,
// mapat pe fonturile temei (Fraunces heading + DM Sans body). Înlocuiește
// px-urile ad-hoc împrăștiate prin PublicMenuPage/QrMenuPage, ca ierarhia să
// fie consistentă pe ambele meniuri și pe toate cele 8 teme.
//
// Folosire: `const t = menuType(theme.fonts)` → `style={t.cardTitle}`.
// Toate dimensiunile sunt fluide unde contează (hero), restul fixe mobile-first.
// ─────────────────────────────────────────────────────────────

interface MenuFonts {
  heading: string
  body: string
}

export interface MenuTypeScale {
  hero: CSSProperties
  sectionTitle: CSSProperties
  cardTitle: CSSProperties
  cardDesc: CSSProperties
  price: CSSProperties
  /** eyebrow all-caps, tracking — etichete de secțiune */
  label: CSSProperties
  body: CSSProperties
}

export function menuType(fonts: MenuFonts): MenuTypeScale {
  const heading = fonts.heading
  const body = fonts.body
  return {
    hero: {
      fontFamily: heading,
      fontSize: 'clamp(30px, 8vw, 48px)',
      fontWeight: 600,
      lineHeight: 1.1,
      letterSpacing: '-0.02em',
    },
    sectionTitle: {
      fontFamily: heading,
      fontSize: 22,
      fontWeight: 600,
      lineHeight: 1.2,
      letterSpacing: '-0.015em',
    },
    cardTitle: {
      fontFamily: heading,
      fontSize: 16.5,
      fontWeight: 600,
      lineHeight: 1.25,
      letterSpacing: '-0.01em',
    },
    cardDesc: {
      fontFamily: heading,
      fontStyle: 'italic',
      fontSize: 12.5,
      lineHeight: 1.5,
    },
    price: {
      fontFamily: heading,
      fontSize: 17,
      fontWeight: 700,
      letterSpacing: '-0.01em',
    },
    label: {
      fontFamily: body,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
    },
    body: {
      fontFamily: body,
      fontSize: 14,
      lineHeight: 1.55,
    },
  }
}

export default menuType
