import type { CSSProperties, ReactNode } from 'react'
import { D } from '../../lib/constants'
import { Icon, type IconName } from './Icon'

// PageHeader — antetul de pagină/ecran al panoului (lotul V, nov 2026): titlu +
// descriere opțională + acțiuni, cu UN SINGUR stil de titlu. Înainte fiecare
// ecran își scria titlul (Fraunces 1.5rem / 18px bold / 1.05rem 400…), deci
// trecerea de la un tab la altul schimba tipografia.
//  - `as`: nivelul semantic (`h1` pe titlul paginii din panou, `h2` pe un ecran
//    care stă sub un h1 existent) — stilul e același.
//  - `actions`: butoanele principale ale ecranului, aliniate la dreapta; pe
//    ecrane înguste coboară sub titlu (wrap), nu se înghesuie.
//  - `style` doar pentru spațierea containerului (margini), nu pentru titlu.
//  - `compact`: antetul ecranelor de personal (Bucătărie / Ospătar), unde la
//    375px titlul trebuie să CEDEZE primul, pe un singur rând cu „…”, nu să
//    împingă bara pe trei rânduri (recenzia #336): `--text-lg`, `nowrap` +
//    ellipsis, iar textul întreg rămâne în `title` (hover) și în numele
//    accesibil.
//  - container `<div>`, nu `<header>`: în afara lui <main> un <header> devine
//    reperul „banner” al paginii, iar ecranele de staff au deja bara lor.
const PAGE_TITLE_STYLE: CSSProperties = {
  fontFamily: D.fontDisplay,
  fontSize: '1.5rem',
  fontWeight: 600,
  lineHeight: 1.2,
  letterSpacing: '-0.02em',
  color: D.t1,
  margin: 0,
  minWidth: 0,
  overflowWrap: 'anywhere',
}

// Ellipsis pe un singur rând: cere `min-width: 0` pe tot lanțul de flex
// (blocul de titlu îl are deja), altfel textul împinge containerul.
const COMPACT_TITLE_STYLE: CSSProperties = {
  ...PAGE_TITLE_STYLE,
  fontSize: 'var(--text-lg, 1.125rem)',
  overflowWrap: 'normal',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const ELLIPSIS: CSSProperties = {
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

export function PageHeader({
  title,
  description,
  actions,
  icon,
  as = 'h2',
  compact = false,
  style,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  icon?: IconName
  as?: 'h1' | 'h2'
  compact?: boolean
  style?: CSSProperties
}) {
  const Heading = as
  const titleStyle = compact ? COMPACT_TITLE_STYLE : PAGE_TITLE_STYLE
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        ...style,
      }}
    >
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <Heading
          title={compact && typeof title === 'string' ? title : undefined}
          style={{
            ...titleStyle,
            display: icon ? 'flex' : undefined,
            alignItems: icon ? 'center' : undefined,
            gap: icon ? 10 : undefined,
          }}
        >
          {icon && <Icon name={icon} size={compact ? 18 : 22} color={D.gold} />}
          {/* Cu iconiță titlul e un flex: ellipsis-ul trebuie pe textul însuși. */}
          {compact && icon ? <span style={ELLIPSIS}>{title}</span> : title}
        </Heading>
        {description && (
          <p style={{ color: D.t2, fontSize: '0.85rem', lineHeight: 1.5, margin: '6px 0 0' }}>
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {actions}
        </div>
      )}
    </div>
  )
}
