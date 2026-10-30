// src/components/afiliat/Collapsible.tsx
// Secțiune pliată a panoului de vânzări („Detalii plăți”, „Cum vând”): un buton
// cu aria-expanded și conținutul randat DOAR cât e deschisă. Nu `<details>`:
// copiii unui `<details>` închis se montează oricum, iar formularul de plată
// și-ar face citirea din bază pentru un panou pe care omul nu l-a deschis.
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { D } from '../../lib/constants'

export default function Collapsible({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState<boolean>(false)
  const regionId = useId()
  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? regionId : undefined}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          background: 'transparent',
          border: 'none',
          padding: '16px 20px',
          minHeight: 44,
          color: D.t1,
          cursor: 'pointer',
          fontFamily: D.fontBody,
          textAlign: 'left',
        }}
      >
        <span>
          <span style={{ display: 'block', fontWeight: 600, fontSize: '0.95rem' }}>{title}</span>
          {hint ? (
            <span style={{ display: 'block', color: D.t2, fontSize: '0.76rem', marginTop: 2 }}>
              {hint}
            </span>
          ) : null}
        </span>
        <span aria-hidden="true" style={{ color: D.gold, fontSize: '1.1rem' }}>
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? (
        <div
          id={regionId}
          style={{ padding: '0 20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
