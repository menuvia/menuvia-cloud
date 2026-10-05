// Badge-ul de brand din subsolul meniului public (/m/:slug și /q/:token).
// Pe domeniile Menuvia: linkul discret „Meniu digital creat cu Menuvia" (E1,
// buclă virală). Pe un domeniu de AGENȚIE (white-label v1, mig 236): numele +
// logo-ul agenției, FĂRĂ link spre Menuvia — meniul e vitrina agenției.
// Vizibilitatea per-restaurant rămâne controlată de hide_branding în pagini.
import { useEffect, useState } from 'react'
import {
  fetchAgencyBranding,
  isCustomDomain,
  type AgencyBranding,
} from '../../lib/whiteLabel'
import { T } from '../../lib/publicMenuStrings'
import { Tf } from '../../lib/guestI18n'

interface Props {
  utmSource: 'menu' | 'qr'
  color: string
  fontFamily: string
  padding: string
  /** Limba aleasă de oaspete — default 'ro'. */
  lang?: string
}

export function MenuBrandBadge({ utmSource, color, fontFamily, padding, lang = 'ro' }: Props) {
  const custom = isCustomDomain()
  const [agency, setAgency] = useState<AgencyBranding | null>(null)
  // Pe domeniu custom nu randăm NIMIC până nu știm brandingul — altfel
  // badge-ul Menuvia ar clipi o clipă pe site-ul agenției.
  const [resolved, setResolved] = useState(!custom)

  useEffect(() => {
    if (!custom) return
    let alive = true
    void fetchAgencyBranding().then((b) => {
      if (!alive) return
      setAgency(b)
      setResolved(true)
    })
    return () => {
      alive = false
    }
  }, [custom])

  if (!resolved) return null

  if (agency) {
    return (
      <div style={{ textAlign: 'center', padding }}>
        <span
          style={{
            fontSize: 11,
            color,
            fontFamily,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '12px 16px',
          }}
        >
          {agency.logoUrl && (
            <img
              src={agency.logoUrl}
              alt=""
              height={16}
              style={{ maxWidth: 120, objectFit: 'contain', display: 'block' }}
            />
          )}
          {Tf(lang, 'brand_agency', { name: agency.name })}
        </span>
      </div>
    )
  }

  return (
    <div style={{ textAlign: 'center', padding }}>
      <a
        href={`https://menuvia.netlify.app/?utm_source=${utmSource}&utm_medium=badge`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontSize: 11,
          color,
          textDecoration: 'none',
          fontFamily,
          display: 'inline-block',
          padding: '12px 16px',
        }}
      >
        {T(lang, 'brand_menuvia')}
      </a>
    </div>
  )
}
