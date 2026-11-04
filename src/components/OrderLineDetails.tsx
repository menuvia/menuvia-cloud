// Detaliile unei linii de comandă pentru personal (lotul O2a): opțiunile,
// extra-urile plătite și nota de preparare. O singură componentă pentru
// Bucătărie, cardul ospătarului, „Gata de servit", editarea comenzii și coșul
// ospătarului — înainte fiecare ecran afișa altceva, iar extra-urile nu
// apăreau nicăieri (bucătarul gătea un burger fără bacon pe care oaspetele îl
// plătise). Fără prețuri: e informație de preparare, nu de casă.
//
//   variant="list"   — câte un rând pe opțiune/extra (Bucătărie)
//   variant="inline" — opțiuni și extra pe un singur rând, despărțite prin „·"
import { D } from '../lib/constants'
import { orderItemExtraNames, orderItemOptionNames, type OrderItem } from '../lib/orders'

type LineLike = Pick<OrderItem, 'selected_modifiers' | 'notes'> & {
  extras_added?: OrderItem['extras_added']
}

interface OrderLineDetailsProps {
  item: LineLike
  variant?: 'list' | 'inline'
  /** Nota liniei („fără ceapă"). Implicit da. */
  showNotes?: boolean
}

export function OrderLineDetails({ item, variant = 'inline', showNotes = true }: OrderLineDetailsProps) {
  const options = orderItemOptionNames(item)
  const extras = orderItemExtraNames(item)
  const note = showNotes && typeof item.notes === 'string' ? item.notes.trim() : ''
  if (options.length === 0 && extras.length === 0 && note === '') return null

  if (variant === 'list') {
    return (
      <>
        {options.map((name, i) => (
          <div key={`o${i}`} style={{ fontSize: 12, color: D.t2, paddingLeft: 12 }}>
            + {name}
          </div>
        ))}
        {extras.map((name, i) => (
          <div
            key={`e${i}`}
            data-testid="line-extra"
            style={{ fontSize: 12, color: D.t1, fontWeight: 600, paddingLeft: 12 }}
          >
            + {name}
          </div>
        ))}
        {note !== '' && (
          <div style={{ fontSize: 12, color: D.amber, fontStyle: 'italic', paddingLeft: 12 }}>
            ✎ {note}
          </div>
        )}
      </>
    )
  }

  const addons = [...options, ...extras.map((n) => `+ ${n}`)]
  return (
    <>
      {addons.length > 0 && (
        <div style={{ fontSize: 11, color: D.t3, marginTop: 2 }}>{addons.join(' · ')}</div>
      )}
      {note !== '' && (
        <div style={{ fontSize: 11, color: D.amber, marginTop: 2, fontStyle: 'italic' }}>
          ✎ {note}
        </div>
      )}
    </>
  )
}
