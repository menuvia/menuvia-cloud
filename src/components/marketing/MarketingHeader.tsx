import type { CSSProperties } from 'react'
import { MKT } from '../../lib/marketing'
import { useIsMobile } from '../../hooks/useIsMobile'

// ─────────────────────────────────────────────────────────────
// MarketingHeader — header sticky reutilizabil pe paleta MKT
// (landing, pricing, pagini de marketing). Logo „Menuvia" (Fraunces),
// nav-uri opționale prin props, CTA opțional, variantă „back"
// (← Înapoi + logo). Pe mobil (<720px) nav-urile se ascund —
// rămân logo + CTA + linkurile marcate keepOnMobile (ex. login).
// ─────────────────────────────────────────────────────────────

export interface MarketingNavLink {
  label: string
  /** Ancoră în pagină (ex. „#functii") sau URL. Alternativ: onClick. */
  href?: string
  onClick?: () => void
  /** Rămâne vizibil și pe mobil (ex. „Intră în cont" — altfel clientul
      existent n-are nicio cale de login din header pe telefon). */
  keepOnMobile?: boolean
}

const navLinkStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: MKT.text2,
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  padding: '8px 10px',
  fontFamily: 'DM Sans,sans-serif',
  textDecoration: 'none',
  display: 'inline-block',
}

export default function MarketingHeader({
  links,
  cta,
  onBack,
}: {
  links?: MarketingNavLink[]
  cta?: { label: string; onClick: () => void }
  /** Prezent → varianta „back": buton ← Înapoi lângă logo, fără nav-uri. */
  onBack?: () => void
}) {
  const isMobile = useIsMobile(720)

  // Ancorele interne primesc scroll lin (păstrăm href-ul pentru a11y/SEO).
  const smoothScroll = (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    const el = document.getElementById(href.slice(1))
    if (!el) return
    e.preventDefault()
    el.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'rgba(250,249,246,0.92)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: `1px solid ${MKT.border}`,
      }}
    >
      <div
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onBack && (
            <button
              onClick={onBack}
              className="lp-nav-link"
              aria-label="Înapoi"
              style={{ ...navLinkStyle, paddingLeft: 0 }}
            >
              ← Înapoi
            </button>
          )}
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 24,
              color: MKT.accent,
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            Menuvia
          </div>
        </div>

        <nav style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {!onBack &&
            links
              ?.filter((l) => !isMobile || l.keepOnMobile)
              .map((l) =>
                l.href != null ? (
                  <a
                    key={l.label}
                    href={l.href}
                    className="lp-nav-link"
                    onClick={l.href.startsWith('#') ? smoothScroll(l.href) : undefined}
                    style={navLinkStyle}
                  >
                    {l.label}
                  </a>
                ) : (
                  <button
                    key={l.label}
                    onClick={l.onClick}
                    className="lp-nav-link"
                    style={navLinkStyle}
                  >
                    {l.label}
                  </button>
                ),
              )}
          {cta && (
            <button
              onClick={cta.onClick}
              className="pressable"
              style={{
                background: MKT.accent,
                color: MKT.onAccent,
                border: 'none',
                borderRadius: 10,
                padding: '9px 18px',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
                marginLeft: 6,
              }}
            >
              {cta.label}
            </button>
          )}
        </nav>
      </div>
    </header>
  )
}
