import { useId } from 'react'
import '../../styles/components/field.css'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  /** Mesaj sub câmp pentru context (ex. "Min 8 caractere"). */
  helper?: string
  /** Când e prezent, schimbă bordura pe danger + afișează mesajul în locul helperului. */
  error?: string
  /** Iconiță SVG poziționată în interior, la stânga. */
  iconLeft?: React.ReactNode
  /** Element în interior, la dreapta (ex. buton clear, eye toggle). */
  iconRight?: React.ReactNode
}

export function Input({
  label,
  helper,
  error,
  iconLeft,
  iconRight,
  id,
  className = '',
  ...rest
}: InputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const describedById = error || helper ? `${inputId}-msg` : undefined
  const hasError = Boolean(error)

  const inputCls = [
    'field__input',
    iconLeft ? 'field__input--has-left' : '',
    iconRight ? 'field__input--has-right' : '',
    hasError ? 'field__input--error' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="field">
      {label && (
        <label htmlFor={inputId} className="field__label">
          {label}
        </label>
      )}
      <div className="field__wrap">
        {iconLeft && <span className="field__icon field__icon--left">{iconLeft}</span>}
        <input
          id={inputId}
          className={inputCls}
          aria-invalid={hasError || undefined}
          aria-describedby={describedById}
          {...rest}
        />
        {iconRight && <span className="field__icon field__icon--right">{iconRight}</span>}
      </div>
      {(error || helper) && (
        <span
          id={describedById}
          className={`field__msg ${hasError ? 'field__msg--error' : ''}`}
        >
          {error || helper}
        </span>
      )}
    </div>
  )
}
