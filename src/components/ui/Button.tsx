import { Spinner } from './Spinner'
import '../../styles/components/button.css'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
  icon?: React.ReactNode
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  icon,
  disabled,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = ['btn', `btn--${variant}`, `btn--${size}`, fullWidth ? 'btn--full' : '', className]
    .filter(Boolean)
    .join(' ')

  // Spinner mic în variantele compacte, mediu altfel.
  const spinnerSize = size === 'sm' ? 'sm' : 'md'

  return (
    <button type={type} className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner size={spinnerSize} /> : icon}
      {children}
    </button>
  )
}
