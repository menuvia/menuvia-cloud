import type { CSSProperties, HTMLAttributes } from 'react'
import { D } from '../../lib/constants'

// Primitivă Card — surface + bordură + rază consistente, ca să nu mai fie
// fiecare card hand-styled. Variante de elevație + opțiune interactivă
// (hover-lift + pressable din animations.css).
type CardVariant = 'flat' | 'raised' | 'inset'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
  interactive?: boolean
  padding?: number | string
  radius?: number | string
}

const SURFACE: Record<CardVariant, string> = {
  flat: D.s2,
  raised: D.s3,
  inset: D.s1,
}

export function Card({
  variant = 'flat',
  interactive = false,
  padding = 16,
  radius = 16,
  className = '',
  style,
  children,
  ...rest
}: CardProps) {
  const base: CSSProperties = {
    background: SURFACE[variant],
    border: `1px solid ${D.border}`,
    borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
    padding: typeof padding === 'number' ? `${padding}px` : padding,
    boxShadow: variant === 'raised' ? 'var(--shadow-md)' : 'none',
    ...style,
  }
  const cls = [interactive ? 'hover-lift pressable' : '', className].filter(Boolean).join(' ')
  return (
    <div className={cls} style={base} {...rest}>
      {children}
    </div>
  )
}
