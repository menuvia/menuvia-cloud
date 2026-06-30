// EmptyState — zero-state îngrijit, tokenizat (consumă empty-state.css).
// Înlocuiește emoji-empty (🍽/🍳/✓) + „nicio dată" hand-rolled din suprafețe.
import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import '../../styles/components/empty-state.css'

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: IconName
  title: string
  description?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={compact ? 'empty-state empty-state--compact' : 'empty-state'}>
      {icon && (
        <div className="empty-state__icon">
          <Icon name={icon} size={compact ? 28 : 40} />
        </div>
      )}
      <div className="empty-state__title">{title}</div>
      {description && <p className="empty-state__desc">{description}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  )
}

export default EmptyState
