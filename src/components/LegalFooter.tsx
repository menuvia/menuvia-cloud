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
        <a
          href="/termeni"
          style={linkStyle}
          onMouseEnter={handleLinkEnter}
          onMouseLeave={handleLinkLeave}
        >
          Termeni
        </a>
        <a
          href="/confidentialitate"
          style={linkStyle}
          onMouseEnter={handleLinkEnter}
          onMouseLeave={handleLinkLeave}
        >
          Confidențialitate
        </a>
        <a
          href="/cookies"
          style={linkStyle}
          onMouseEnter={handleLinkEnter}
          onMouseLeave={handleLinkLeave}
        >
          Cookies
        </a>
        <a
          href="/dpa"
          style={linkStyle}
          onMouseEnter={handleLinkEnter}
          onMouseLeave={handleLinkLeave}
        >
          DPA
        </a>
        <a
          href="mailto:contact@menuvia.ro"
          style={linkStyle}
          onMouseEnter={handleLinkEnter}
          onMouseLeave={handleLinkLeave}
        >
          Contact
        </a>
        <a
          href="https://anpc.ro"
          target="_blank"
          rel="noopener noreferrer"
          style={linkStyle}
          onMouseEnter={handleLinkEnter}
          onMouseLeave={handleLinkLeave}
        >
          ANPC
        </a>
        {/* SOL/ODR (ec.europa.eu/consumers/odr) a fost desființată în iulie 2025 —
            linkul mort a fost înlocuit cu SAL (ANPC). */}
        <a
          href="https://anpc.ro/ce-este-sal/"
          target="_blank"
          rel="noopener noreferrer"
          style={linkStyle}
          onMouseEnter={handleLinkEnter}
          onMouseLeave={handleLinkLeave}
        >
          SAL
        </a>
        {/* Redeschide bannerul de cookies (promisiunea din /cookies: retragerea
            consimțământului „prin banner"). */}
        <button
          onClick={() => window.dispatchEvent(new Event('menuvia:open-cookie-settings'))}
          style={{
            ...linkStyle,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'DM Sans, sans-serif',
          }}
          onMouseEnter={handleLinkEnter}
          onMouseLeave={handleLinkLeave}
        >
          Setări cookies
        </button>
      </div>
      <div style={{ fontSize: 11, color: D.t3, opacity: 0.7 }}>
        Făcut în România · Date pe servere UE
      </div>
    </footer>
  )
}

const linkStyle: React.CSSProperties = {
  color: D.t3,
  // Underline subtil — diferențiator vizual real (WCAG 1.4.1), nu doar culoarea
  // textului din jur.
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
  fontSize: 12,
  transition: 'color 0.15s',
  // Țintă de touch ≥44px fără să schimbe layout-ul vizual (padding + margin negativ).
  display: 'inline-block',
  padding: '14px 8px',
  margin: '-14px -8px',
}

// Hover: culoare mai deschisă (D.t2), ca tranziția să aibă efectiv ce anima.
function handleLinkEnter(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.color = D.t2
}
function handleLinkLeave(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.color = D.t3
}
