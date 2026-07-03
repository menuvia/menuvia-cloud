import { useRef, useState, type CSSProperties } from 'react'
import type { MenuTheme } from '../../lib/themes'
import { useReducedMotion } from '../../lib/motion'

// ─────────────────────────────────────────────────────────────
// FlipbookViewer — meniul ca pe o carte (stil Zvon Cafe): paginile meniului
// sunt imagini răsfoibile orizontal. ZERO dependențe noi — pager cu CSS
// scroll-snap nativ (o pagină pe ecran), indicator „pagina X/Y", săgeți
// discrete pe desktop (doar pointer fin), lazy loading pe imagini.
//
// Gesturi native păstrate: NU setăm touch-action — pinch-zoom-ul browserului
// pe pagină rămâne funcțional (esențial pentru poze de meniu cu text mic).
// Reduced-motion: săgețile sar instant (behavior 'auto') în loc de smooth.
//
// Pur prezentațional: primește lista de pagini (deja validată prin
// resolveFlipbookPages — doar https, max 30) + tokens de temă. Stare goală
// prietenoasă când nu există pagini (consumatorii fac oricum fallback pe
// layout 'list' în meniul public — vezi PublicMenuPage/QrMenuPage).
// ─────────────────────────────────────────────────────────────

interface PublicColors {
  bg: string
  surface: string
  text: string
  text2: string
  text3: string
  border: string
  borderStrong: string
}

interface FlipbookViewerProps {
  pages: string[]
  theme: MenuTheme
  PUB: PublicColors
  /** Înălțimea zonei de pagină (default plin-ecran-ish pe mobil). */
  pageHeight?: number | string
}

// Detectare one-shot „pointer fin" (mouse/trackpad) — pe touch săgețile ar
// acoperi degeaba marginile paginii; swipe-ul e gestul natural acolo.
function hasFinePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: fine)').matches
}

export default function FlipbookViewer({
  pages,
  theme,
  PUB,
  pageHeight = 'min(72vh, 640px)',
}: FlipbookViewerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(0)
  const [finePointer] = useState(hasFinePointer)
  const reducedMotion = useReducedMotion()

  // Stare goală prietenoasă — fără ecran gol.
  if (pages.length === 0) {
    return (
      <div
        data-testid="flipbook-empty"
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          border: `1px dashed ${PUB.border}`,
          borderRadius: 14,
          background: PUB.surface,
        }}
      >
        <div
          style={{
            fontFamily: theme.fonts.heading,
            fontStyle: 'italic',
            fontSize: 18,
            color: PUB.text,
            marginBottom: 8,
          }}
        >
          Meniul nu are încă pagini încărcate
        </div>
        <div style={{ fontFamily: theme.fonts.body, fontSize: 13, color: PUB.text2, lineHeight: 1.6 }}>
          Paginile meniului vor apărea aici de îndată ce restaurantul le încarcă.
        </div>
      </div>
    )
  }

  function scrollToPage(idx: number): void {
    const el = scrollerRef.current
    if (!el) return
    const clamped = Math.max(0, Math.min(pages.length - 1, idx))
    el.scrollTo({
      left: clamped * el.clientWidth,
      behavior: reducedMotion ? 'auto' : 'smooth',
    })
  }

  function handleScroll(): void {
    const el = scrollerRef.current
    if (!el || el.clientWidth === 0) return
    const idx = Math.round(el.scrollLeft / el.clientWidth)
    const clamped = Math.max(0, Math.min(pages.length - 1, idx))
    if (clamped !== page) setPage(clamped)
  }

  const arrowStyle = (side: 'left' | 'right'): CSSProperties => ({
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    ...(side === 'left' ? { left: 8 } : { right: 8 }),
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.38)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.25)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    lineHeight: 1,
    zIndex: 3,
    fontFamily: theme.fonts.body,
  })

  return (
    <div data-testid="flipbook-viewer" style={{ position: 'relative' }}>
      {/* Pager orizontal cu scroll-snap — o pagină pe ecran. Fără touch-action:
          swipe-ul orizontal și pinch-zoom-ul nativ rămân la browser. */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        aria-label={`Paginile meniului, ${pages.length} pagini. Glisează orizontal pentru a răsfoi.`}
        style={{
          display: 'flex',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none',
          borderRadius: Math.min(theme.radius, 14),
          background: PUB.bg,
        }}
      >
        {pages.map((url, i) => (
          <div
            key={`${i}-${url}`}
            style={{
              flex: '0 0 100%',
              width: '100%',
              scrollSnapAlign: 'center',
              scrollSnapStop: 'always',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: pageHeight,
            }}
          >
            <img
              src={url}
              alt={`Pagina ${i + 1} din meniu`}
              loading="lazy"
              decoding="async"
              style={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: '100%',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                margin: '0 auto',
              }}
            />
          </div>
        ))}
      </div>

      {/* Săgeți discrete — doar pe desktop (pointer fin) și doar cu >1 pagină. */}
      {finePointer && pages.length > 1 && page > 0 && (
        <button
          type="button"
          onClick={() => scrollToPage(page - 1)}
          aria-label="Pagina anterioară"
          style={arrowStyle('left')}
        >
          <span aria-hidden>‹</span>
        </button>
      )}
      {finePointer && pages.length > 1 && page < pages.length - 1 && (
        <button
          type="button"
          onClick={() => scrollToPage(page + 1)}
          aria-label="Pagina următoare"
          style={arrowStyle('right')}
        >
          <span aria-hidden>›</span>
        </button>
      )}

      {/* Indicator „pagina X/Y" — pastilă glass, jos-centru. */}
      {pages.length > 1 && (
        <div
          aria-live="polite"
          style={{
            position: 'absolute',
            bottom: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.5)',
            color: '#fff',
            fontFamily: theme.fonts.body,
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: '0.04em',
            padding: '4px 12px',
            borderRadius: 100,
            border: '1px solid rgba(255,255,255,0.22)',
            pointerEvents: 'none',
            zIndex: 3,
            whiteSpace: 'nowrap',
          }}
        >
          pagina {page + 1}/{pages.length}
        </div>
      )}
    </div>
  )
}
