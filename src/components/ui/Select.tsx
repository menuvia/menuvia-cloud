import { useId } from 'react'
import '../../styles/components/field.css'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string
  helper?: string
  error?: string
  options: SelectOption[]
  /** Opțiune placeholder la început (valoare goală). */
  placeholder?: string
}

export function Select({
  label,
  helper,
  error,
  options,
  placeholder,
  id,
  className = '',
  ...rest
}: SelectProps) {
  const autoId = useId()
  const selectId = id ?? autoId
  const describedById = error || helper ? `${selectId}-msg` : undefined
  const hasError = Boolean(error)

  const cls = [
    'field__input',
    'field__input--select',
    hasError ? 'field__input--error' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="field">
      {label && (
        <label htmlFor={selectId} className="field__label">
          {label}
        </label>
      )}
      <div className="field__wrap">
        <select
          id={selectId}
          className={cls}
          aria-invalid={hasError || undefined}
          aria-describedby={describedById}
          {...rest}
        >
          {placeholder !== undefined && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="field__chevron" aria-hidden="true">
          ▾
        </span>
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
