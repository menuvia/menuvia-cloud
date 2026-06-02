import '../../styles/components/spinner.css'

type Size = 'sm' | 'md' | 'lg'

interface SpinnerProps {
  size?: Size
  /** Suprascrie culoarea liniei (default: currentColor — preia textul părintelui). */
  color?: string
  /** Etichetă pentru cititoare de ecran. */
  label?: string
}

export function Spinner({ size = 'md', color, label = 'Se încarcă' }: SpinnerProps) {
  return (
    <span
      className={`spinner spinner--${size}`}
      style={color ? { borderTopColor: color } : undefined}
      role="status"
      aria-label={label}
    />
  )
}
