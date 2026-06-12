// ─────────────────────────────────────────────────────────────
// RestaurantLinksBar — link-urile restaurantului pe pagina de meniu
// (Google Maps, Instagram, Facebook, TikTok, Website, WhatsApp, Telefon,
// Recenzie Google). Toate OPȚIONALE: se randează doar cele completate.
//
// Două moduri (decizie user, „aceleași QR-uri pe ambele planuri"):
//   prominent=true  → Meniu Digital (read-only) + meniul public /m/slug:
//                     pill-uri vizibile — link-urile sunt valoarea paginii
//   prominent=false → Meniu + Comenzi: rând mic, discret, să NU concureze
//                     cu Adaugă în coș / Cheamă ospătar / Cere nota
// ─────────────────────────────────────────────────────────────
import type { Socials } from '../lib/qr'
import { socialUrl } from '../lib/qr'

interface Props {
  socials?: Socials | null
  phone?: string | null
  googleReviewUrl?: string | null
  accent: string
  textColor: string
  borderColor: string
  prominent: boolean
}

interface LinkItem {
  key: string
  icon: string
  label: string
  href: string
}

function buildLinks({
  socials,
  phone,
  googleReviewUrl,
}: Pick<Props, 'socials' | 'phone' | 'googleReviewUrl'>): LinkItem[] {
  const items: LinkItem[] = []
  const s = socials ?? {}

  // Google Maps (locație) ≠ Google Review — chei separate, deliberat.
  if (s.google_maps?.trim()) {
    items.push({ key: 'maps', icon: '📍', label: 'Locație', href: s.google_maps.trim() })
  }
  if (s.instagram?.trim()) {
    items.push({
      key: 'instagram',
      icon: '📸',
      label: 'Instagram',
      href: socialUrl('instagram', s.instagram),
    })
  }
  if (s.facebook?.trim()) {
    items.push({
      key: 'facebook',
      icon: '👍',
      label: 'Facebook',
      href: socialUrl('facebook', s.facebook),
    })
  }
  if (s.tiktok?.trim()) {
    items.push({ key: 'tiktok', icon: '🎵', label: 'TikTok', href: socialUrl('tiktok', s.tiktok) })
  }
  if (s.website?.trim()) {
    items.push({ key: 'website', icon: '🌐', label: 'Website', href: socialUrl('website', s.website) })
  }
  if (s.whatsapp?.trim()) {
    const num = s.whatsapp.replace(/[^\d]/g, '')
    if (num) items.push({ key: 'whatsapp', icon: '💬', label: 'WhatsApp', href: `https://wa.me/${num}` })
  }
  if (phone?.trim()) {
    items.push({ key: 'phone', icon: '📞', label: 'Telefon', href: `tel:${phone.replace(/\s+/g, '')}` })
  }
  if (googleReviewUrl?.trim()) {
    items.push({ key: 'review', icon: '⭐', label: 'Lasă o recenzie', href: googleReviewUrl.trim() })
  }
  return items
}

export default function RestaurantLinksBar({
  socials,
  phone,
  googleReviewUrl,
  accent,
  textColor,
  borderColor,
  prominent,
}: Props) {
  const links = buildLinks({ socials, phone, googleReviewUrl })
  if (links.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: prominent ? 'wrap' : 'nowrap',
        overflowX: prominent ? 'visible' : 'auto',
        gap: 8,
        padding: prominent ? '12px 16px 4px' : '8px 16px',
        justifyContent: prominent ? 'center' : 'flex-start',
      }}
    >
      {links.map((l) => (
        <a
          key={l.key}
          href={l.href}
          target={l.href.startsWith('tel:') ? undefined : '_blank'}
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
            border: `1px solid ${prominent ? accent + '55' : borderColor}`,
            background: prominent ? accent + '14' : 'transparent',
            color: prominent ? textColor : textColor + 'BB',
            borderRadius: 100,
            padding: prominent ? '8px 14px' : '5px 11px',
            fontSize: prominent ? 13 : 12,
            fontWeight: 600,
            textDecoration: 'none',
            fontFamily: 'DM Sans, sans-serif',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: prominent ? 15 : 13 }}>{l.icon}</span>
          {l.label}
        </a>
      ))}
    </div>
  )
}
