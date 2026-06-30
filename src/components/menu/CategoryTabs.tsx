import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { MenuTheme } from '../../lib/themes'
import { menuType } from '../../lib/menuType'
import { MOTION, useReducedMotion } from '../../lib/motion'

// ─────────────────────────────────────────────────────────────
// CategoryTabs — bară de navigare categorii, sticky sus, orizontală
// scrollabilă. Underline animat pe tabul activ (transform/opacity),
// auto-center al tabului activ la schimbare, badge opțional cu numărul
// de produse și fade de scroll pe marginea dreaptă (semnal „mai sunt
// taburi"). Pur prezentațională: primește date + onSelect prin props.
//
// Accesibilitate: role="tablist"/"tab" + aria-selected; touch ≥44px.
// Motion: doar transform/opacity, reduced-motion respectat.
// ─────────────────────────────────────────────────────────────

interface PubColors {
  bg: string
  surface: string
  text: string
  text2: string
  text3: string
  border: string
  borderStrong: string
}

interface CategoryTabItem {
  id: string
  name: string
  /** numărul de produse din categorie — afișat ca badge dacă e prezent */
  count?: number
}

interface CategoryTabsProps {
  items: CategoryTabItem[]
  activeId: string | null
  onSelect: (id: string) => void
  accent: string
  PUB: PubColors
  theme: MenuTheme
}

// Geometria underline-ului activ — poziție + lățime în px relativ la track.
interface UnderlineRect {
  left: number
  width: number
}

// Geometrie tab (px) — extrasă în constante numite (fără magic numbers inline).
const TAB_GAP = 7 // spațiu nume ↔ badge
const TAB_PAD_X = 10 // padding orizontal real pe buton → lățime de tap ≥44px
const FADE_WIDTH = 36 // lățimea gradientului de fade din dreapta

export function CategoryTabs({ items, activeId, onSelect, accent, PUB, theme }: CategoryTabsProps) {
  const t = menuType(theme.fonts)
  const reduced = useReducedMotion()

  const trackRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  // Reține dacă efectul de auto-scroll a rulat deja — la mount nu auto-scroll-ăm
  // (evităm deplasarea barei la prima randare când activul nu e primul tab).
  const didInitialScroll = useRef(false)

  // Underline animat: un singur element care alunecă peste tabul activ.
  const [underline, setUnderline] = useState<UnderlineRect | null>(null)
  // Fade dreapta vizibil doar cât mai există conținut de scrollat la dreapta.
  const [showFade, setShowFade] = useState(false)

  // Recalculează poziția underline-ului relativ la track-ul scrollabil.
  function measureUnderline() {
    const track = trackRef.current
    const el = activeId != null ? tabRefs.current.get(activeId) : undefined
    if (!track || !el) {
      setUnderline(null)
      return
    }
    setUnderline({ left: el.offsetLeft, width: el.offsetWidth })
  }

  // Actualizează vizibilitatea fade-ului din dreapta în funcție de scroll.
  function updateFade() {
    const track = trackRef.current
    if (!track) return
    const remaining = track.scrollWidth - track.clientWidth - track.scrollLeft
    setShowFade(remaining > 1)
  }

  // Navigare cu tastatura conform pattern-ului WAI-ARIA tablist: săgeți
  // stânga/dreapta mută focusul + selecția între taburi (cu wrap), Home/End
  // sar la primul/ultimul. Activarea (selecția) urmează focusul.
  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (index + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next == null) return
    e.preventDefault()
    const target = items[next]
    if (!target) return
    tabRefs.current.get(target.id)?.focus()
    onSelect(target.id)
  }

  // La schimbarea tabului activ: re-măsoară underline, auto-center tabul.
  // La PRIMUL mount nu auto-scroll-ăm — doar la schimbări ulterioare (selecție
  // efectivă), ca bara să nu sară inutil dacă activul inițial nu e primul tab.
  useEffect(() => {
    measureUnderline()
    updateFade()
    if (!didInitialScroll.current) {
      didInitialScroll.current = true
      return
    }
    const el = activeId != null ? tabRefs.current.get(activeId) : undefined
    if (el) {
      el.scrollIntoView({
        // reduced-motion: salt instant; altfel smooth nativ (gest inițiat de user).
        behavior: reduced ? 'auto' : 'smooth',
        inline: 'center',
        block: 'nearest',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, items, reduced])

  // Re-măsoară la resize + când fonturile web (Fraunces/DM Sans) se încarcă
  // (lățimea fallback diferă → underline ar fi poziționat greșit până la resize).
  // ResizeObserver pe track prinde și schimbările de conținut (count async/filtrare).
  useEffect(() => {
    function remeasure() {
      measureUnderline()
      updateFade()
    }
    window.addEventListener('resize', remeasure)

    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (fonts?.ready) void fonts.ready.then(remeasure)

    const track = trackRef.current
    let ro: ResizeObserver | undefined
    if (track && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(remeasure)
      ro.observe(track)
    }

    return () => {
      window.removeEventListener('resize', remeasure)
      ro?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const wrapStyle: CSSProperties = {
    position: 'sticky',
    top: 'env(safe-area-inset-top, 0px)',
    zIndex: 20,
    background: PUB.bg,
    borderBottom: `1px solid ${PUB.border}`,
    flexShrink: 0,
  }

  // Track scrollabil — ascundem scrollbar-ul, păstrăm scroll-ul nativ.
  const trackStyle: CSSProperties = {
    position: 'relative',
    display: 'flex',
    alignItems: 'stretch',
    // spațiu vizual între taburi; lățimea de tap vine din padding-ul butonului.
    gap: 8,
    overflowX: 'auto',
    overflowY: 'hidden',
    scrollbarWidth: 'none',
    padding: '12px 12px 0',
    WebkitOverflowScrolling: 'touch',
  }

  // Underline glisant: animă transform (translateX) + width pentru o
  // tranziție lină; opacity ascunde starea „niciun tab activ".
  const underlineStyle: CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 2,
    width: underline ? underline.width : 0,
    background: accent,
    borderRadius: 2,
    transform: `translateX(${underline ? underline.left : 0}px)`,
    opacity: underline ? 1 : 0,
    transition: reduced
      ? 'none'
      : `transform ${MOTION.normal}ms ${MOTION.easeOut}, width ${MOTION.normal}ms ${MOTION.easeOut}, opacity ${MOTION.fast}ms linear`,
    willChange: 'transform, width',
    pointerEvents: 'none',
  }

  return (
    <div style={wrapStyle}>
      <div style={{ position: 'relative' }}>
        <div
          ref={trackRef}
          role="tablist"
          aria-label="Categorii meniu"
          onScroll={updateFade}
          style={trackStyle}
          data-testid="category-tabs"
        >
          {items.map((item, index) => {
            const active = item.id === activeId
            // roving tabindex: tabul activ e singurul focusabil cu Tab; dacă
            // niciun tab nu e activ (activeId null), primul rămâne accesibil
            // ca tablist-ul să nu iasă complet din ordinea de tabulare.
            const focusable = active || (activeId == null && index === 0)
            // aria-label include numărul de produse (badge-ul vizual e aria-hidden),
            // ca screen-reader-ul să anunțe „Vin, 12 produse".
            const ariaLabel =
              item.count != null
                ? `${item.name}, ${item.count} ${item.count === 1 ? 'produs' : 'produse'}`
                : item.name
            return (
              <button
                key={item.id}
                ref={(el) => {
                  if (el) tabRefs.current.set(item.id, el)
                  else tabRefs.current.delete(item.id)
                }}
                type="button"
                role="tab"
                id={`category-tab-${item.id}`}
                aria-selected={active}
                aria-controls={`category-panel-${item.id}`}
                aria-label={ariaLabel}
                // roving tabindex: doar tabul activ e în ordinea de tab; restul
                // se accesează cu săgeți (pattern WAI-ARIA tablist).
                tabIndex={focusable ? 0 : -1}
                className="pressable"
                onClick={() => onSelect(item.id)}
                onKeyDown={(e) => onTabKeyDown(e, index)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: TAB_GAP,
                  background: 'none',
                  border: 'none',
                  // touch target ≥44px: înălțime prin padding vertical, lățime
                  // prin padding orizontal real (nu doar gap) — și taburile scurte
                  // („Vin") au zonă de tap ≥44px lățime.
                  minHeight: 44,
                  padding: `0 ${TAB_PAD_X}px 11px`,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  // contrast AA: inactiv = text2 (text2 e lizibil), nu text3 (hint).
                  color: active ? PUB.text : PUB.text2,
                  transition: reduced ? 'none' : `color ${MOTION.fast}ms ${MOTION.standard}`,
                }}
              >
                <span
                  style={{
                    ...t.tab,
                    // fontWeight constant (600): activul iese în evidență prin
                    // culoare + underline, NU prin bold — bold-ul ar schimba
                    // lățimea tabului la fiecare selecție (layout shift / jitter).
                    fontWeight: 600,
                  }}
                >
                  {item.name}
                </span>
                {item.count != null && (
                  <span
                    aria-hidden="true"
                    style={{
                      ...t.badge,
                      padding: '3px 6px',
                      borderRadius: 999,
                      // contrast AA la 10.5px: NU folosim `accent` pe tintul de
                      // accent (pică AA pe teme light/gold). Textul rămâne pe
                      // tokenul de text al temei; emfaza „activ" vine din fundalul
                      // tintat + border-ul de accent, nu din culoarea cifrei.
                      color: active ? PUB.text : PUB.text2,
                      background: active ? accent + '1A' : PUB.surface,
                      border: `1px solid ${active ? accent + '40' : PUB.border}`,
                      transition: reduced
                        ? 'none'
                        : `color ${MOTION.fast}ms ${MOTION.standard}, background ${MOTION.fast}ms ${MOTION.standard}`,
                    }}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            )
          })}
          <div style={underlineStyle} aria-hidden="true" />
        </div>

        {/* Fade dreapta — gradient către PUB.bg ca semnal că mai sunt taburi. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: FADE_WIDTH,
            pointerEvents: 'none',
            background: `linear-gradient(to right, ${PUB.bg}00, ${PUB.bg})`,
            opacity: showFade ? 1 : 0,
            transition: reduced ? 'none' : `opacity ${MOTION.fast}ms linear`,
          }}
        />
      </div>
    </div>
  )
}

export default CategoryTabs
