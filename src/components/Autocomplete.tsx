// ─────────────────────────────────────────────────────────────
// Autocomplete — input cu sugestii filtrate dintr-o listă
//
// Folosire:
//   <Autocomplete
//     value={name}
//     onChange={setName}
//     options={suppliers.map(s => s.name)}
//     placeholder="Nume furnizor"
//     onSelect={(idx, val) => useExisting(suppliers[idx])}
//   />
//
// Funcționalitate:
// - Match case-insensitive prefix → substring (prefix first)
// - Navigare cu ↑↓ și Enter pentru selecție rapidă
// - Esc închide dropdown-ul
// - Click în afara componentei închide
// - Free text permis (nu strict la listă) → util pentru "creează nou"
// - Mobile-friendly (touch-friendly hit zones)
// ─────────────────────────────────────────────────────────────
import { useState, useRef, useEffect, useMemo } from 'react'
import { D } from '../lib/constants'

interface Props {
  value: string
  onChange: (val: string) => void
  options: string[] // listă opțiuni disponibile
  placeholder?: string
  onSelect?: (index: number, value: string) => void // chemată când user selectează din listă
  maxResults?: number // default 8
  style?: React.CSSProperties // pentru input
  autoFocus?: boolean
  disabled?: boolean
  emptyHint?: string // hint sub input dacă lista e goală
}

interface Match {
  index: number // index în options array
  text: string
  score: number // 100=exact, 80=prefix, 60=substring, 40=fuzzy
}

// ── Fuzzy matcher ────────────────────────────────────────────
function fuzzyMatch(query: string, options: string[], maxResults: number): Match[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    // Fără query: afișează primele N opțiuni (sort alfabetic)
    return options
      .map((text, index) => ({ index, text, score: 0 }))
      .sort((a, b) => a.text.localeCompare(b.text, 'ro'))
      .slice(0, maxResults)
  }
  const matches: Match[] = []
  for (let i = 0; i < options.length; i++) {
    const text = options[i]!
    const lower = text.toLowerCase()
    let score = 0
    if (lower === q) score = 100
    else if (lower.startsWith(q)) score = 80
    else if (lower.includes(q)) score = 60
    else {
      // Fuzzy: toate caracterele din q apar în text în ordine
      let qi = 0
      for (let ti = 0; ti < lower.length && qi < q.length; ti++) {
        if (lower[ti] === q[qi]) qi++
      }
      if (qi === q.length) score = 40
    }
    if (score > 0) matches.push({ index: i, text, score })
  }
  return matches
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text, 'ro'))
    .slice(0, maxResults)
}

// ── Component ────────────────────────────────────────────────
export default function Autocomplete({
  value,
  onChange,
  options,
  placeholder,
  onSelect,
  maxResults = 8,
  style,
  autoFocus,
  disabled,
  emptyHint,
}: Props) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Filtered matches
  const matches = useMemo(
    () => fuzzyMatch(value, options, maxResults),
    [value, options, maxResults],
  )

  // Reset active idx when matches change
  useEffect(() => {
    setActiveIdx(0)
  }, [value])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function pickMatch(m: Match) {
    onChange(m.text)
    onSelect?.(m.index, m.text)
    setOpen(false)
    inputRef.current?.blur()
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setOpen(true)
        e.preventDefault()
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIdx((i) => Math.min(matches.length - 1, i + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIdx((i) => Math.max(0, i - 1))
        break
      case 'Enter':
        if (matches[activeIdx]) {
          e.preventDefault()
          pickMatch(matches[activeIdx]!)
        }
        break
      case 'Escape':
        setOpen(false)
        break
    }
  }

  const defaultInp: React.CSSProperties = {
    width: '100%',
    background: D.s3,
    border: `1px solid ${D.border}`,
    borderRadius: 9,
    padding: '10px 12px',
    fontSize: '0.92rem',
    color: D.t1,
    outline: 'none',
    height: 42,
    fontFamily: 'DM Sans,sans-serif',
    boxSizing: 'border-box',
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        autoComplete="off"
        style={{ ...defaultInp, ...style }}
      />

      {open && matches.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: D.s1,
            border: `1px solid ${D.border}`,
            borderRadius: 9,
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            maxHeight: 280,
            overflowY: 'auto',
            zIndex: 100,
          }}
        >
          {matches.map((m, i) => (
            <button
              key={m.index}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                pickMatch(m)
              }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                display: 'block',
                width: '100%',
                padding: '10px 14px',
                background: i === activeIdx ? D.goldA : 'transparent',
                color: D.t1,
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
                fontSize: '0.9rem',
                textAlign: 'left',
                borderBottom: i < matches.length - 1 ? `1px solid ${D.border}` : 'none',
              }}
            >
              {/* Highlight matched portion */}
              {renderHighlighted(m.text, value)}
            </button>
          ))}
        </div>
      )}

      {open && matches.length === 0 && value.trim().length > 0 && emptyHint && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: D.s1,
            border: `1px solid ${D.border}`,
            borderRadius: 9,
            padding: '10px 14px',
            color: D.t3,
            fontSize: '0.85rem',
            zIndex: 100,
          }}
        >
          {emptyHint}
        </div>
      )}
    </div>
  )
}

// Highlight matched portion in bold
function renderHighlighted(text: string, query: string): React.ReactNode {
  const q = query.trim().toLowerCase()
  if (!q) return text
  const lower = text.toLowerCase()
  const idx = lower.indexOf(q)
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <strong style={{ color: D.gold }}>{text.slice(idx, idx + q.length)}</strong>
      {text.slice(idx + q.length)}
    </>
  )
}
