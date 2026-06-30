import type { CSSProperties } from 'react'
import { Skeleton } from '../ui/Skeleton'
import { Icon } from '../ui/Icon'
import { readableTextOn } from '../../lib/themes'

// ─────────────────────────────────────────────────────────────
// Stări pentru MENIU (client) — skeleton la încărcare + eroare premium,
// theme-aware (primesc culorile PUB ale temei restaurantului). Înlocuiesc
// „Se încarcă..." text gol (scor 4/10 în audit) cu un schelet care imită
// structura cardurilor → percepție de viteză + zero salt de layout.
// Stările goale/no-results folosesc `EmptyState` din ui/ direct.
// ─────────────────────────────────────────────────────────────

interface PubColors {
  bg: string
  surface: string
  text: string
  text2: string
  text3: string
  border: string
  borderStrong: string
}

/** Un rând de card-skeleton: thumbnail + 2 linii de text. */
function CardSkeletonRow({ PUB }: { PUB: PubColors }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        alignItems: 'center',
        padding: 14,
        borderRadius: 14,
        background: PUB.surface,
        border: `1px solid ${PUB.border}`,
      }}
    >
      <Skeleton variant="card" width={88} height={88} style={{ borderRadius: 12, flexShrink: 0 }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton variant="title" width="65%" />
        <Skeleton variant="text" width="90%" />
        <Skeleton variant="text" width="35%" />
      </div>
    </div>
  )
}

/** Listă de skeletoane (n carduri) — folosită cât se încarcă meniul. */
export function MenuListSkeleton({ PUB, count = 5 }: { PUB: PubColors; count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeletonRow key={i} PUB={PUB} />
      ))}
    </div>
  )
}

/** Ecran de încărcare full-height cu schelet de listă (mobile-first). */
export function MenuLoading({ PUB }: { PUB: PubColors }) {
  return (
    <div
      // Skeleton-urile sunt aria-hidden → fără asta, cititoarele de ecran n-ar
      // anunța nimic la încărcare. role=status + aria-busy + mesaj vizual-ascuns.
      role="status"
      aria-busy="true"
      style={{
        minHeight: '100vh',
        background: PUB.bg,
        maxWidth: 480,
        margin: '0 auto',
        padding: '16px 14px',
      }}
    >
      <span className="visually-hidden">Se încarcă meniul…</span>
      <Skeleton variant="title" width="55%" height={26} style={{ marginBottom: 18 }} />
      <MenuListSkeleton PUB={PUB} count={5} />
    </div>
  )
}

/** Eroare de încărcare — icon + titlu + mesaj + reîncercare, themed. */
export function MenuError({
  PUB,
  accent,
  fonts,
  onRetry,
  title = 'Nu am putut încărca meniul',
  message = 'Verifică conexiunea și încearcă din nou.',
}: {
  PUB: PubColors
  accent: string
  fonts: { heading: string; body: string }
  onRetry?: () => void
  title?: string
  message?: string
}) {
  const titleStyle: CSSProperties = {
    fontFamily: fonts.heading,
    fontSize: 20,
    fontWeight: 600,
    color: PUB.text,
    margin: '14px 0 6px',
  }
  return (
    <div
      style={{
        minHeight: '100vh',
        background: PUB.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 24,
        gap: 4,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: PUB.surface,
          border: `1px solid ${PUB.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="alert" size={28} color={accent} />
      </div>
      <div style={titleStyle}>{title}</div>
      <div style={{ fontFamily: fonts.body, fontSize: 14, color: PUB.text2, maxWidth: 320, lineHeight: 1.5 }}>
        {message}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="pressable"
          style={{
            marginTop: 16,
            background: accent,
            // Text lizibil pe accent (alb pică AA pe accente deschise).
            color: readableTextOn(accent, PUB.text),
            border: 'none',
            borderRadius: 12,
            padding: '12px 28px',
            fontFamily: fonts.body,
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            minHeight: 44,
          }}
        >
          Reîncearcă
        </button>
      )}
    </div>
  )
}
