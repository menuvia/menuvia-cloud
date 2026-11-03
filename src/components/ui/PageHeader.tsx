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

export function PageHeader({
  title,
  description,
  actions,
  icon,
  as = 'h2',
  style,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  icon?: IconName
  as?: 'h1' | 'h2'
  style?: CSSProperties
}) {
  const Heading = as
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
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <Heading
          style={{
            ...PAGE_TITLE_STYLE,
            display: icon ? 'flex' : undefined,
            alignItems: icon ? 'center' : undefined,
            gap: icon ? 10 : undefined,
          }}
        >
          {icon && <Icon name={icon} size={22} color={D.gold} />}
          {title}
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
