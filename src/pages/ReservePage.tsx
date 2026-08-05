// =============================================================
// ReservePage — pagina publică de rezervare de sine stătătoare (/rezervare/:slug).
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
import { supabase } from '../lib/supabase'
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
  // Anulare pe cod (mig 256/257): ?cancel=COD deschide cardul cu codul
  // pre-completat (linkul din emailuri/ecranul de succes); linkul discret de
  // sub butoane îl deschide manual. Sheet-ul de REZERVARE nu se deschide
  // peste fluxul de anulare.
  const initialCancel =
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('cancel') ?? '')
      : ''
  const [cancelOpen, setCancelOpen] = useState<boolean>(initialCancel !== '')
  const [cancelCode, setCancelCode] = useState<string>(initialCancel)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelDone, setCancelDone] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  // Sheet-ul e DESCHIS din prima — ăsta e scopul paginii. onClose nu închide
  // într-un ecran mort: rămâne hero-ul cu buton de redeschidere + link meniu.
  const [sheetOpen, setSheetOpen] = useState(initialCancel === '')

  async function submitCancel() {
    const code = cancelCode.trim()
    if (!code) {
      setCancelError(lang === 'ro' ? 'Introdu codul de confirmare' : 'Enter the confirmation code')
      return
    }
    setCancelBusy(true)
    setCancelError(null)
    const { data, error: rpcErr } = await supabase.rpc('cancel_reservation_by_code', {
      p_slug: slug,
      p_code: code,
    })
    setCancelBusy(false)
    const res = (data ?? null) as { ok?: boolean; hint?: string } | null
    if (rpcErr || !res) {
      setCancelError(
        lang === 'ro'
          ? 'Nu am putut procesa anularea. Încearcă din nou sau sună restaurantul.'
          : 'Could not process the cancellation. Try again or call the restaurant.',
      )
      return
    }
    if (res.ok) {
      setCancelDone(true)
      return
    }
    if (res.hint === 'not_cancellable') {
      setCancelError(
        lang === 'ro'
          ? 'Rezervarea nu mai poate fi anulată online (a trecut ora sau e deja anulată). Sună restaurantul.'
          : 'This reservation can no longer be cancelled online. Please call the restaurant.',
      )
    } else if (res.hint === 'rate_limited') {
      setCancelError(
        lang === 'ro' ? 'Prea multe încercări. Reîncearcă în câteva minute.' : 'Too many attempts. Try again in a few minutes.',
      )
    } else {
      setCancelError(
        lang === 'ro' ? 'Cod de confirmare invalid.' : 'Invalid confirmation code.',
      )
    }
  }

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

      {cancelOpen && (
        <div
          style={{
            width: '100%',
            maxWidth: 420,
            background: PUB.surface,
            border: `1px solid ${PUB.borderStrong}`,
            borderRadius: 14,
            padding: '20px 18px',
            marginBottom: 24,
            textAlign: 'left',
          }}
        >
          {cancelDone ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
                {lang === 'ro' ? 'Rezervarea a fost anulată ✓' : 'Reservation cancelled ✓'}
              </div>
              <div style={{ color: PUB.text2, fontSize: 14, lineHeight: 1.5 }}>
                {lang === 'ro'
                  ? 'Restaurantul a fost anunțat. Te așteptăm altă dată!'
                  : 'The restaurant has been notified.'}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
                {lang === 'ro' ? 'Anulează o rezervare' : 'Cancel a reservation'}
              </div>
              <input
                value={cancelCode}
                onChange={(e) => setCancelCode(e.target.value.toUpperCase())}
                placeholder={lang === 'ro' ? 'Codul de confirmare (ex. A1B2C3D4)' : 'Confirmation code'}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: PUB.bg,
                  border: `1px solid ${PUB.borderStrong}`,
                  borderRadius: 10,
                  padding: '12px 14px',
                  fontSize: 16,
                  letterSpacing: '0.12em',
                  color: PUB.text,
                  fontFamily: 'inherit',
                  marginBottom: 10,
                }}
              />
              {cancelError && (
                <div style={{ color: '#E05555', fontSize: 13, marginBottom: 10 }}>{cancelError}</div>
              )}
              <button
                onClick={() => void submitCancel()}
                disabled={cancelBusy}
                style={{
                  width: '100%',
                  background: '#E05555',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  padding: '12px 0',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: cancelBusy ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                  opacity: cancelBusy ? 0.7 : 1,
                }}
              >
                {cancelBusy
                  ? lang === 'ro' ? 'Se anulează…' : 'Cancelling…'
                  : lang === 'ro' ? 'Anulează rezervarea' : 'Cancel reservation'}
              </button>
            </>
          )}
        </div>
      )}

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

      {!cancelOpen && (
        <button
          onClick={() => setCancelOpen(true)}
          style={{
            marginTop: 18,
            background: 'none',
            border: 'none',
            color: PUB.text3,
            fontSize: 13,
            textDecoration: 'underline',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {lang === 'ro' ? 'Ai deja o rezervare? Anuleaz-o aici' : 'Need to cancel a reservation?'}
        </button>
      )}

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
