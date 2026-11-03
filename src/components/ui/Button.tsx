import { forwardRef } from 'react'
import { Spinner } from './Spinner'
import '../../styles/components/button.css'

// Primitiva Button — SURSA UNICĂ pentru butoanele de acțiune din panou (lotul V,
// nov 2026). Patru variante (primary / secondary / ghost / danger), mărimi
// sm / md (lg rămâne pentru CTA-urile mari), înălțime minimă `--tap-min`
// (button.css), focus vizibil prin inelul global `:focus-visible` + offset.
//  - `type="button"` implicit: într-un <form> un buton fără tip e SUBMIT.
//  - `loading` dezactivează butonul (fără dublu-submit) și pune `aria-busy`;
//    spinner-ul e `aria-hidden`, deci numele accesibil rămâne textul butonului.
//  - `ref` ajunge pe <button> (forwardRef): declanșatoarele de meniu își
//    readuc focusul pe el la Escape.
//  - `style` rămâne pentru LAYOUT (flex, lățime, margini) — culorile, raza și
//    înălțimea vin din variantă; un buton colorat de mână e exact ce clichetul
//    `tests/functions/ui-button-ratchet.test.js` numără.
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
  icon?: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
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
  },
  ref,
) {
  const cls = ['btn', `btn--${variant}`, `btn--${size}`, fullWidth ? 'btn--full' : '', className]
    .filter(Boolean)
    .join(' ')

  // Spinner mic în variantele compacte, mediu altfel.
  const spinnerSize = size === 'sm' ? 'sm' : 'md'

  return (
    <button
      ref={ref}
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="btn__spinner" aria-hidden="true">
          <Spinner size={spinnerSize} />
        </span>
      ) : (
        icon
      )}
      {children}
    </button>
  )
})
