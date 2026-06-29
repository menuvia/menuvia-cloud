import type { CSSProperties, HTMLAttributes } from 'react'

// Primitivă Section — container centrat cu lățime maximă + gutter responsiv.
// Unifică ritmul orizontal pe paginile lungi (marketing/dashboard).
interface SectionProps extends HTMLAttributes<HTMLElement> {
  maxWidth?: number
  padded?: boolean
}

export function Section({
  maxWidth = 1100,
  padded = true,
  className = '',
  style,
  children,
  ...rest
}: SectionProps) {
  const base: CSSProperties = {
    width: '100%',
    maxWidth: `${maxWidth}px`,
    marginInline: 'auto',
    paddingInline: padded ? 'clamp(16px, 5vw, 32px)' : undefined,
    ...style,
  }
  return (
    <section className={className} style={base} {...rest}>
      {children}
    </section>
  )
}
