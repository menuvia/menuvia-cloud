import type { CSSProperties } from 'react'
import { MKT } from '../../lib/marketing'

// ─────────────────────────────────────────────────────────────
// MarketingFooter — footer comun pentru paginile de marketing,
// pe paleta MKT. 3 coloane (Produs / Companie / Legal), stack pe
// mobil prin auto-fit. Linkurile legale oglindesc LegalFooter.tsx.
// Linkul de parteneriat e INTENȚIONAT discret — aceeași tipografie
// ca vecinii, fără badge sau accent.
// ─────────────────────────────────────────────────────────────

interface FooterLink {
  label: string
  href: string
  external?: boolean
}

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Produs',
    links: [
      { label: 'Funcții', href: '/#functii' },
      { label: 'De ce Menuvia', href: '/comparatie' },
      { label: 'Prețuri', href: '/pricing' },
      { label: 'Demo live', href: '/demo' },
    ],
  },
  {
    title: 'Companie',
    links: [
      { label: 'Contact', href: 'mailto:contact@menuvia.ro' },
      { label: 'Program pilot', href: '/recrutare' },
      { label: 'Program de parteneriat', href: '/afiliat' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Termeni', href: '/termeni' },
      { label: 'Confidențialitate', href: '/confidentialitate' },
      { label: 'Cookies', href: '/cookies' },
      { label: 'DPA', href: '/dpa' },
      { label: 'ANPC', href: 'https://anpc.ro', external: true },
      { label: 'SOL', href: 'https://ec.europa.eu/consumers/odr', external: true },
    ],
  },
]

const linkStyle: CSSProperties = {
  color: MKT.text3,
  textDecoration: 'none',
  fontSize: 13,
  lineHeight: 1.4,
}

export default function MarketingFooter() {
  const year = new Date().getFullYear()
  return (
    <footer
      style={{
        borderTop: `1px solid ${MKT.border}`,
        background: MKT.bg,
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 1040,
          margin: '0 auto',
          padding: '48px 24px 20px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 32,
            marginBottom: 40,
          }}
        >
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: MKT.text2,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 14,
                }}
              >
                {col.title}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {col.links.map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    style={linkStyle}
                    {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            borderTop: `1px solid ${MKT.border}`,
            paddingTop: 20,
            fontSize: 12,
            color: MKT.text3,
            textAlign: 'center',
          }}
        >
          © {year} MENUVIA · Făcut în România · Date pe servere UE
        </div>
      </div>
    </footer>
  )
}
