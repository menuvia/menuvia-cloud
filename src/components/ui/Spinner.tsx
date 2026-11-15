import '../../styles/components/spinner.css'
import { chromeT } from '../../i18n/chrome'
import { useChrome } from '../../i18n/useChromeLang'

type Size = 'sm' | 'md' | 'lg'

interface SpinnerProps {
  size?: Size
  /** Suprascrie culoarea liniei (default: currentColor — preia textul părintelui). */
  color?: string
  /** Etichetă pentru cititoare de ecran. Implicit „Se încarcă” în limba PAGINII
   *  (`<html lang>`, lotul L4d) — Spinner-ul e randat de ORICE `Button` cu
   *  `loading`, deci numele lui accesibil e crom comun. */
  label?: string
}

export function Spinner({ size = 'md', color, label }: SpinnerProps) {
  const { lang, fallback } = useChrome()
  return (
    <span
      className={`spinner spinner--${size}`}
      style={color ? { borderTopColor: color } : undefined}
      role="status"
      aria-label={label ?? chromeT(lang, 'spinner_label')}
      lang={label == null ? fallback : undefined}
    />
  )
}
