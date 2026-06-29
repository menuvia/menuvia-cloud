// ───────────────────────────────────────────────────────────────
// Motion — Menuvia (zero dependențe externe)
// Vocabular comun de micro-interacțiuni: durate/easing aliniate cu
// tokens.css + hook-uri mici peste API-uri native (matchMedia,
// IntersectionObserver). Animă DOAR transform/opacity/filter
// (GPU-friendly). prefers-reduced-motion e respectat: hook-urile
// returnează stare „vizibil/instant", iar global.css zero-uiește
// duratele CSS. Fără librărie de animație → bundle mic pe meniul
// public/QR (mobil).
// ───────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

// Durate (ms) + curbe — oglindesc --transition-* și easing-urile expresive
// din tokens.css. Folosite în `style={{ transition }}` și WAAPI.
export const MOTION = {
  fast: 150,
  normal: 250,
  slow: 400,
  // ease-out „aterizare" lină pentru intrări (impeccable: ease-out la enter)
  easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
  easeOutQuart: 'cubic-bezier(0.25, 1, 0.5, 1)',
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const

// Citește preferința de mișcare redusă (fail-safe pe SSR/headless).
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Hook reactiv la schimbarea preferinței de mișcare.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(prefersReducedMotion)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

interface UseInViewOptions {
  // Declanșează o singură dată (default) sau de fiecare dată la intrare/ieșire.
  once?: boolean
  // Pragul de vizibilitate (0..1) la care se consideră „în viewport".
  amount?: number
  // Margine pe root (ex. declanșează puțin înainte să intre complet).
  rootMargin?: string
}

// Detectează intrarea unui element în viewport pentru reveal-uri la scroll.
// SAFE: dacă lipsește IntersectionObserver sau e reduced-motion, întoarce
// `true` din start → conținutul NU e ascuns niciodată (fără secțiuni goale
// pe headless/reduced-motion — vezi regula impeccable despre reveal).
export function useInView<T extends Element = HTMLDivElement>(
  options: UseInViewOptions = {},
): [RefObject<T>, boolean] {
  const { once = true, amount = 0.15, rootMargin = '0px 0px -10% 0px' } = options
  const ref = useRef<T>(null)
  const [inView, setInView] = useState<boolean>(
    () => prefersReducedMotion() || typeof IntersectionObserver === 'undefined',
  )

  useEffect(() => {
    if (inView) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true)
            if (once) observer.disconnect()
          } else if (!once) {
            setInView(false)
          }
        }
      },
      { threshold: amount, rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [inView, once, amount, rootMargin])

  return [ref, inView]
}

// Stil de reveal reutilizabil (opacity + translateY). Combină cu useInView:
//   const [ref, inView] = useInView()
//   <div ref={ref} style={revealStyle(inView, { delay: 60 })}>
export function revealStyle(
  inView: boolean,
  opts: { y?: number; delay?: number } = {},
): CSSProperties {
  const { y = 12, delay = 0 } = opts
  return {
    opacity: inView ? 1 : 0,
    transform: inView ? 'none' : `translateY(${y}px)`,
    transition: `opacity ${MOTION.normal}ms ${MOTION.easeOut} ${delay}ms, transform ${MOTION.normal}ms ${MOTION.easeOut} ${delay}ms`,
    willChange: 'opacity, transform',
  }
}
