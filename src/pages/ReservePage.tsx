// =============================================================
// ReservePage — pagina publică de rezervare de sine stătătoare (/r/:slug).
//
// PIESA DECISIVĂ a wedge-ului „Menuvia Rezervări": linkul care intră în
// Google Business Profile (Profil → Rezervări). Un restaurant rezervări-first
// NU are meniu — /m/:slug ar ateriza pe un meniu gol; pagina asta duce
// clientul DIRECT în fluxul de rezervare (harta sălii, auto-confirmare).
//
// Refolosește integral motorul existent: get_restaurant_by_slug (proiecția
// publică fără secrete, mig 148→217), ReservationSheet (hartă + sloturi +
// create_reservation_public), tema restaurantului (resolveTheme + PUB).
// Modulul reservations OFF → RPC-ul de submit respinge cu mesaj prietenos
// (maparea `module_disabled` există în ReservationSheet); pagina rămâne
// curată, nu crapă.
// =============================================================
import { useEffect, useMemo, useState, Suspense, lazy } from 'react'
import { fetchRestaurantBySlug } from '../lib/qr'
import type { Restaurant } from '../lib/qr'
import { resolveTheme } from '../lib/themes'
import { PageSpinner } from '../components/PageLoader'

const ReservationSheet = lazy(() => import('../components/ReservationSheet'))

export default function ReservePage({
  slug,
  navigate,
}: {
  slug: string
  navigate: (p: string) => void
}) {
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  // Sheet-ul e DESCHIS din prima — ăsta e scopul paginii. onClose nu închide
  // într-un ecran mort: rămâne hero-ul cu buton de redeschidere + link meniu.
  const [sheetOpen, setSheetOpen] = useState(true)

  // Limba: doar pentru textele ReservationSheet (ro/en) — fără chrome de meniu.
  const lang =
    typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ro')
      ? 'ro'
      : 'en'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    fetchRestaurantBySlug(slug)
      .then((row) => {
        if (cancelled) return
        if (row == null) setNotFound(true)
        else setRestaurant(row as unknown as Restaurant)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setNotFound(true)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    const prev = document.title
    if (restaurant) {
      document.title =
        lang === 'ro'
          ? `Rezervă o masă — ${restaurant.name}`
          : `Book a table — ${restaurant.name}`
    }
    return () => {
      document.title = prev
    }
  }, [restaurant, lang])

  const theme = useMemo(() => resolveTheme(restaurant?.theme_settings), [restaurant])
  const PUB = useMemo(
    () => ({
      bg: theme.colors.bg,
      surface: theme.colors.surface,
      text: theme.colors.text,
      text2: theme.colors.text2,
      text3: theme.colors.text3,
      border: theme.colors.border,
      borderStrong: theme.colors.borderStrong,
    }),
    [theme],
  )
  const accent = restaurant?.primary_color ?? theme.colors.accent

  if (loading) return <PageSpinner />

  if (notFound || !restaurant) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#0A0908',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'DM Sans, sans-serif',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div>
          <div style={{ color: '#F0EAE0', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            {lang === 'ro' ? 'Restaurantul nu a fost găsit' : 'Restaurant not found'}
          </div>
          <div style={{ color: '#9A9590', fontSize: 14 }}>
            {lang === 'ro'
              ? 'Verifică linkul sau caută restaurantul pe menuvia.ro.'
              : 'Check the link or search for the restaurant on menuvia.ro.'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: PUB.bg,
        color: PUB.text,
        fontFamily: theme.fonts.body,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      {restaurant.logo_url && (
        <img
          src={restaurant.logo_url}
          alt=""
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            objectFit: 'cover',
            marginBottom: 16,
            border: `2px solid ${PUB.border}`,
          }}
        />
      )}
      <h1
        style={{
          fontFamily: theme.fonts.heading,
          fontSize: 'clamp(26px, 5vw, 40px)',
          fontWeight: 600,
          letterSpacing: '-0.01em',
          margin: '0 0 8px',
        }}
      >
        {restaurant.name}
      </h1>
      {restaurant.address && (
        <div style={{ color: PUB.text2, fontSize: 14, marginBottom: 4 }}>{restaurant.address}</div>
      )}
      <div style={{ color: PUB.text3, fontSize: 13, marginBottom: 28 }}>
        {lang === 'ro' ? 'Rezervare online — confirmare pe loc' : 'Online reservation'}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={() => setSheetOpen(true)}
          style={{
            background: accent,
            color: '#0A0908',
            border: 'none',
            borderRadius: 12,
            padding: '14px 30px',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {lang === 'ro' ? 'Rezervă o masă' : 'Book a table'}
        </button>
        <button
          onClick={() => navigate(`/m/${slug}`)}
          style={{
            background: 'transparent',
            color: PUB.text2,
            border: `1px solid ${PUB.borderStrong}`,
            borderRadius: 12,
            padding: '14px 24px',
            fontSize: 15,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {lang === 'ro' ? 'Vezi meniul →' : 'View menu →'}
        </button>
      </div>

      <div style={{ marginTop: 40, fontSize: 12, color: PUB.text3 }}>
        Powered by{' '}
        <a href="/" style={{ color: accent, textDecoration: 'none', fontWeight: 600 }}>
          Menuvia
        </a>
      </div>

      {sheetOpen && (
        <Suspense fallback={null}>
          <ReservationSheet
            restaurant={restaurant}
            theme={theme}
            accent={accent}
            PUB={PUB}
            lang={lang}
            onClose={() => setSheetOpen(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
