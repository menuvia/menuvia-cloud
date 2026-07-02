import { useInView, revealStyle } from '../../lib/motion'

// Wrapper mic pentru reveal per-element dintr-o listă: hook-ul useInView NU
// poate fi apelat în .map(), așa că îl izolăm într-un component dedicat.
// `revealStyle` e vizibil by-default sub reduced-motion/headless — nu ascunde.
export function RevealItem({
  children,
  delay = 0,
  y = 14,
  style,
}: {
  children: React.ReactNode
  delay?: number
  y?: number
  style?: React.CSSProperties
}) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div ref={ref} style={{ ...revealStyle(inView, { delay, y }), ...style }}>
      {children}
    </div>
  )
}
