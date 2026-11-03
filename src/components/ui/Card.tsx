import type { CSSProperties, HTMLAttributes } from 'react'
import { D } from '../../lib/constants'

// Primitivă Card — suprafață + bordură + UN SINGUR radius și UN SINGUR padding,
// din token-uri (lotul V, nov 2026). Înainte fiecare apelant își alegea perechea
// („18px 20px"/14, „22px 24px"/16, „16px 18px"/14…), deci cardurile de pe
// aceeași pagină nu se aliniau. Raza și padding-ul se aplică DUPĂ `style`:
// `style` rămâne pentru layout (flex, înălțime minimă, accent de bordură), nu
// poate reintroduce o a doua rază. `flush` = fără padding (liste care își
// au propriul padding pe rând).
type CardVariant = 'flat' | 'raised' | 'inset'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
  interactive?: boolean
  flush?: boolean
}

const SURFACE: Record<CardVariant, string> = {
  flat: D.s2,
  raised: D.s3,
  inset: D.s1,
}

const CARD_RADIUS = 'var(--radius-lg)'
const CARD_PADDING = 'var(--space-5)'

export function Card({
  variant = 'flat',
  interactive = false,
  flush = false,
  className = '',
  style,
  children,
  ...rest
}: CardProps) {
  const base: CSSProperties = {
    background: SURFACE[variant],
    border: `1px solid ${D.border}`,
    boxShadow: variant === 'raised' ? 'var(--shadow-md)' : 'none',
    ...style,
    borderRadius: CARD_RADIUS,
    padding: flush ? 0 : CARD_PADDING,
  }
  const cls = [interactive ? 'hover-lift pressable' : '', className].filter(Boolean).join(' ')
  return (
    <div className={cls} style={base} {...rest}>
      {children}
    </div>
  )
}
