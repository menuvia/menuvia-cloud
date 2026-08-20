// src/pages/LegalPage.tsx
// ─────────────────────────────────────────────────────────────────
// Pagini legale (Termeni, Confidențialitate, Cookies, DPA).
//
// AUDIT AUG 2026: paginile erau placeholder „Versiune în pregătire" deși
// draft-urile complete existau în menuvia-pack/ — orice text real e mai
// apărabil juridic decât o pagină goală. Acum draft-urile se importă ?raw
// (Vite) și se randează cu un mini-renderer markdown SIGUR (fără
// dangerouslySetInnerHTML — totul e JSX), cu bannerul DRAFT păstrat până la
// avizul avocatului. Documentul final de la avocat înlocuiește fișierul din
// menuvia-pack/ și pagina se actualizează singură.
// ─────────────────────────────────────────────────────────────────
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { D } from '../lib/constants'
import LegalFooter from '../components/LegalFooter'
import Icon from '../components/ui/Icon'
import termsRaw from '../../menuvia-pack/02-DRAFT-TERMENI.md?raw'
import privacyRaw from '../../menuvia-pack/03-DRAFT-CONFIDENTIALITATE.md?raw'
import cookiesRaw from '../../menuvia-pack/04-DRAFT-COOKIES.md?raw'
import dpaRaw from '../../menuvia-pack/05-DRAFT-DPA.md?raw'

export type LegalDoc = 'terms' | 'privacy' | 'cookies' | 'dpa'

const TITLES: Record<LegalDoc, string> = {
  terms: 'Termeni și Condiții',
  privacy: 'Politica de Confidențialitate',
  cookies: 'Politica de Cookies',
  dpa: 'Acord de Prelucrare a Datelor (DPA)',
}

const DOCS: Record<LegalDoc, string> = {
  terms: termsRaw,
  privacy: privacyRaw,
  cookies: cookiesRaw,
  dpa: dpaRaw,
}

// ── Mini-renderer markdown (sigur: doar JSX, zero HTML injectat) ──────────────
// Acoperă exact ce folosesc draft-urile: titluri #/##/###, blockquote >, liste
// - , tabele | (randate monospace cu scroll orizontal), --- , bold **x**,
// cod `x`, linkuri [t](u). Orice altceva rămâne text simplu — un renderer
// complet (dependență nouă) nu se justifică pentru 4 documente statice.
function inline(text: string, key: number): ReactNode {
  // Split pe bold / cod / link, păstrând ordinea.
  const parts: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      parts.push(
        <strong key={`b${key}-${i}`} style={{ color: D.t1 }}>
          {tok.slice(2, -2)}
        </strong>,
      )
    } else if (tok.startsWith('`')) {
      parts.push(
        <code key={`c${key}-${i}`} style={{ fontSize: '0.9em', color: D.goldL }}>
          {tok.slice(1, -1)}
        </code>,
      )
    } else {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)
      if (lm) {
        parts.push(
          <a
            key={`l${key}-${i}`}
            href={lm[2]}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: D.gold }}
          >
            {lm[1]}
          </a>,
        )
      } else {
        parts.push(tok)
      }
    }
    last = m.index + tok.length
    i++
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function renderMarkdown(md: string): ReactNode[] {
  const out: ReactNode[] = []
  const lines = md.split('\n')
  let para: string[] = []
  let list: string[] = []
  let quote: string[] = []
  let table: string[] = []
  let k = 0

  const flushPara = () => {
    if (para.length === 0) return
    out.push(
      <p key={`p${k++}`} style={{ margin: '0 0 14px', lineHeight: 1.7 }}>
        {inline(para.join(' '), k)}
      </p>,
    )
    para = []
  }
  const flushList = () => {
    if (list.length === 0) return
    out.push(
      <ul key={`u${k++}`} style={{ margin: '0 0 14px', paddingLeft: 22, lineHeight: 1.7 }}>
        {list.map((li, j) => (
          <li key={j} style={{ marginBottom: 4 }}>
            {inline(li, k * 100 + j)}
          </li>
        ))}
      </ul>,
    )
    list = []
  }
  const flushQuote = () => {
    if (quote.length === 0) return
    out.push(
      <div
        key={`q${k++}`}
        style={{
          borderLeft: `3px solid ${D.gold}`,
          background: 'rgba(200,150,60,0.06)',
          padding: '10px 14px',
          margin: '0 0 14px',
          borderRadius: '0 8px 8px 0',
          lineHeight: 1.6,
          fontSize: '0.92em',
        }}
      >
        {quote.map((q, j) => (
          <p key={j} style={{ margin: j === 0 ? 0 : '8px 0 0' }}>
            {inline(q, k * 100 + j)}
          </p>
        ))}
      </div>,
    )
    quote = []
  }
  const flushTable = () => {
    if (table.length === 0) return
    // Tabelele markdown se păstrează monospace cu scroll — corecte și lizibile
    // fără un parser de tabele; documentul e DRAFT, forma finală vine în HTML
    // de la avocat sau rămâne așa.
    out.push(
      <pre
        key={`t${k++}`}
        style={{
          overflowX: 'auto',
          background: D.s2,
          border: `1px solid ${D.border}`,
          borderRadius: 8,
          padding: 12,
          fontSize: 12,
          lineHeight: 1.6,
          margin: '0 0 14px',
        }}
      >
        {table.join('\n')}
      </pre>,
    )
    table = []
  }
  const flushAll = () => {
    flushPara()
    flushList()
    flushQuote()
    flushTable()
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const hm = /^(#{1,4})\s+(.*)$/.exec(line)
    if (hm) {
      flushAll()
      const level = hm[1].length
      const sizes: Record<number, number> = { 1: 26, 2: 21, 3: 17, 4: 15 }
      out.push(
        <div
          key={`h${k++}`}
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: sizes[level] ?? 15,
            color: D.t1,
            fontWeight: 700,
            margin: level <= 2 ? '30px 0 12px' : '22px 0 10px',
          }}
        >
          {inline(hm[2], k)}
        </div>,
      )
      continue
    }
    if (/^-{3,}$/.test(line)) {
      flushAll()
      out.push(
        <hr key={`r${k++}`} style={{ border: 0, borderTop: `1px solid ${D.border}`, margin: '22px 0' }} />,
      )
      continue
    }
    if (line.startsWith('|')) {
      flushPara()
      flushList()
      flushQuote()
      table.push(line)
      continue
    }
    if (line.startsWith('> ') || line === '>') {
      flushPara()
      flushList()
      flushTable()
      quote.push(line.replace(/^>\s?/, ''))
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara()
      flushQuote()
      flushTable()
      list.push(line.replace(/^[-*]\s+/, ''))
      continue
    }
    if (line.trim() === '') {
      flushAll()
      continue
    }
    flushList()
    flushQuote()
    flushTable()
    para.push(line)
  }
  flushAll()
  return out
}

export default function LegalPage({ doc }: { doc: LegalDoc }) {
  useEffect(() => {
    const prevTitle = document.title
    document.title = `${TITLES[doc]} — Menuvia`
    return () => {
      document.title = prevTitle
    }
  }, [doc])

  return (
    <div style={{ minHeight: '100vh', background: D.bg, fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '60px 24px' }}>
        <a
          href="/"
          style={{
            color: D.gold,
            textDecoration: 'none',
            fontSize: 13,
            marginBottom: 24,
            display: 'inline-block',
          }}
        >
          ← Înapoi la pagina principală
        </a>

        <div
          style={{
            background: 'rgba(200, 150, 60, 0.08)',
            border: '1px solid rgba(200, 150, 60, 0.3)',
            borderRadius: 10,
            padding: 16,
            margin: '24px 0 8px',
            fontSize: 13,
            color: D.t2,
            lineHeight: 1.6,
          }}
        >
          <strong
            style={{
              color: D.gold,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name="alert" size={15} color={D.gold} />
            Versiune de lucru (DRAFT).
          </strong>{' '}
          Documentul de mai jos este versiunea de lucru completă, în curs de avizare de către un
          consultant juridic specializat. Pentru orice întrebare scrieți-ne la{' '}
          <a href="mailto:contact@menuvia.ro" style={{ color: D.gold }}>
            contact@menuvia.ro
          </a>
          .
        </div>

        <div style={{ color: D.t2, fontSize: 15 }}>{renderMarkdown(DOCS[doc])}</div>

        <LegalFooter />
      </div>
    </div>
  )
}
