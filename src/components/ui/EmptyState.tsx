import '../../styles/components/empty-state.css'

interface EmptyStateProps {
  /** Iconiță (SVG / emoji / orice ReactNode). */
  icon?: React.ReactNode
  title: string
  description?: string
  /** Buton primar de acțiune (Button / link / orice ReactNode). */
  action?: React.ReactNode
  /** Compact = mai mic vertical, fără padding generos (potrivit în carduri mici). */
  compact?: boolean
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <div className={`empty-state ${compact ? 'empty-state--compact' : ''}`}>
      {icon && <div className="empty-state__icon">{icon}</div>}
      <div className="empty-state__title">{title}</div>
      {description && <div className="empty-state__desc">{description}</div>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  )
}
