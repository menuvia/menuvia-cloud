// src/i18n/fillNodes.tsx — un text tradus cu locuri `{x}` care devin ELEMENTE
// (linkuri), nu șiruri: „Am citit și accept {terms} și {privacy}”. Ordinea
// cuvintelor diferă de la o limbă la alta (germana pune verbul la final), deci
// propoziția nu se poate tăia în bucăți fixe „prefix + link + și + link”.
// Un loc fără element rămâne VIZIBIL (`{x}`), ca la `interpolate`.
import { Fragment, type ReactNode } from 'react'

type NodeMap = Readonly<Record<string, ReactNode>>
type Filled = ReactNode[]

export function fillNodes(template: string, nodes: NodeMap): Filled {
  const out: Filled = []
  const re = /\{(\w+)\}/g
  let last = 0
  let i = 0
  for (let m = re.exec(template); m; m = re.exec(template)) {
    if (m.index > last) out.push(template.slice(last, m.index))
    const key = m[1] ?? ''
    out.push(
      Object.prototype.hasOwnProperty.call(nodes, key) ? <Fragment key={`n${i++}`}>{nodes[key]}</Fragment> : m[0],
    )
    last = re.lastIndex
  }
  if (last < template.length) out.push(template.slice(last))
  return out
}
