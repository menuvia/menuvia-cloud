// src/components/LegalFooter.tsx
// Footer cu link-uri legale obligatorii (GDPR, ANPC).
// Folosit pe TOATE paginile publice și autentificate.
import { D } from '../lib/constants'

export default function LegalFooter() {
  const year = new Date().getFullYear()
  return (
    <footer
      style={{
        borderTop: `1px solid ${D.border}`,
        padding: '32px 16px 40px',
        textAlign: 'center',
        fontSize: 12,
        color: D.t3,
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      <div style={{ marginBottom: 12, fontSize: 13, color: D.t2 }}>
        © {year} <span style={{ color: D.t1 }}>MENUVIA SRL</span>
        {' · '}
        <span style={{ opacity: 0.7 }}>CUI: în curs de înregistrare</span>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 16,
          justifyContent: 'center',
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <a href="/termeni" style={linkStyle}>
          Termeni
        </a>
        <a href="/confidentialitate" style={linkStyle}>
          Confidențialitate
        </a>
        <a href="/cookies" style={linkStyle}>
          Cookies
        </a>
        <a href="/dpa" style={linkStyle}>
          DPA
        </a>
        <a href="mailto:contact@menuvia.ro" style={linkStyle}>
          Contact
        </a>
        <a href="https://anpc.ro" target="_blank" rel="noopener noreferrer" style={linkStyle}>
          ANPC
        </a>
        <a
          href="https://ec.europa.eu/consumers/odr"
          target="_blank"
          rel="noopener noreferrer"
          style={linkStyle}
        >
          SOL
        </a>
      </div>
      <div style={{ fontSize: 11, color: D.t3, opacity: 0.7 }}>
        Făcut în România · Date pe servere UE
      </div>
    </footer>
  )
}

const linkStyle: React.CSSProperties = {
  color: D.t3,
  textDecoration: 'none',
  fontSize: 12,
  transition: 'color 0.15s',
}
