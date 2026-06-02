import '../../styles/components/card.css'

type Variant = 'default' | 'elevated' | 'outlined'
type Padding = 'none' | 'sm' | 'md' | 'lg'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: Variant
  padding?: Padding
  /** Adaugă hover (subliniere + ridicare) și cursor pointer. */
  clickable?: boolean
  as?: 'div' | 'article' | 'section'
}

export function Card({
  children,
  variant = 'default',
  padding = 'md',
  clickable = false,
  as: Tag = 'div',
  className = '',
  ...rest
}: CardProps) {
  const cls = [
    'card',
    `card--${variant}`,
    `card--p-${padding}`,
    clickable ? 'card--clickable' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Tag className={cls} {...rest}>
      {children}
    </Tag>
  )
}
