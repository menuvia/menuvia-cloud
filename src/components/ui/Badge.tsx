import '../../styles/components/badge.css'

type Variant = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'gold'
type Size = 'sm' | 'md'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant
  size?: Size
  /** Animație de puls pentru indicatori „live". */
  pulse?: boolean
  /** Iconiță (SVG / emoji) lipită la stânga. */
  icon?: React.ReactNode
}

export function Badge({
  children,
  variant = 'neutral',
  size = 'sm',
  pulse = false,
  icon,
  className = '',
  ...rest
}: BadgeProps) {
  const cls = [
    'badge',
    `badge--${variant}`,
    `badge--${size}`,
    pulse ? 'badge--live' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span className={cls} {...rest}>
      {icon}
      {children}
    </span>
  )
}
