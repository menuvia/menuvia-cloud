import { useId } from 'react'
import '../../styles/components/field.css'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  helper?: string
  error?: string
  /** Maxim caractere afișat sub câmp (alături de helper). */
  showCount?: boolean
}

export function Textarea({
  label,
  helper,
  error,
  showCount,
  id,
  className = '',
  maxLength,
  value,
  defaultValue,
  ...rest
}: TextareaProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const describedById = error || helper ? `${fieldId}-msg` : undefined
  const hasError = Boolean(error)

  // Numărător: folosește valoarea controlată dacă există, altfel defaultValue.
  const len = typeof value === 'string' ? value.length : String(defaultValue ?? '').length

  const cls = [
    'field__input',
    'field__input--textarea',
    hasError ? 'field__input--error' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="field">
      {label && (
        <label htmlFor={fieldId} className="field__label">
          {label}
        </label>
      )}
      <textarea
        id={fieldId}
        className={cls}
        aria-invalid={hasError || undefined}
        aria-describedby={describedById}
        maxLength={maxLength}
        value={value}
        defaultValue={defaultValue}
        {...rest}
      />
      {(error || helper || (showCount && maxLength)) && (
        <span
          id={describedById}
          className={`field__msg ${hasError ? 'field__msg--error' : ''}`}
        >
          <span>{error || helper}</span>
          {showCount && maxLength && (
            <span className="field__count">
              {len}/{maxLength}
            </span>
          )}
        </span>
      )}
    </div>
  )
}
