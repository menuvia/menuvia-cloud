// Badge — chip semantic tokenizat (consumă badge.css).
// Înlocuiește badge-urile cu hex literale + emoji din suprafețe.
import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import '../../styles/components/badge.css'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'gold'
export type BadgeSize = 'sm' | 'md'

export function Badge({
  tone = 'neutral',
  size = 'md',
  icon,
  children,
  className = '',
}: {
  tone?: BadgeTone
  size?: BadgeSize
  icon?: IconName
  children: ReactNode
  className?: string
}) {
  return (
    <span className={`badge badge--${size} badge--${tone} ${className}`.trim()}>
      {icon && <Icon name={icon} size={size === 'sm' ? 12 : 14} />}
      {children}
    </span>
  )
}

export default Badge
