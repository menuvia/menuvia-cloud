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
import { resolveHideBranding, resolveTheme } from '../lib/themes'
import { PageSpinner } from '../components/PageLoader'
import { T } from '../lib/publicMenuStrings'
import { Tf, browserGuestLang } from '../lib/guestI18n'
import {
  MENU_LANGS,
  browserIsCrawler,
  initialReservePageLang,
  langFromSearch,
  menuBaseLang,
  replaceUrlLang,
} from '../lib/i18nMenu'
import { menuType } from '../lib/menuType'
import { LangSwitcher } from '../components/menu/MenuHeader'
import { useDocumentLang } from '../hooks/useDocumentLang'

// Chunk-ul sheet-ului e cerut ÎN PARALEL cu RPC-ul restaurantului (perf-guest-5):
// pagina îl deschide oricum din prima, iar înainte cascada era RPC → randare →
// abia apoi descărcarea chunk-ului. Aceeași funcție de import servește și `lazy`,
// deci modulul se descarcă o singură dată.
const loadReservationSheet = () => import('../components/ReservationSheet')
const ReservationSheet = lazy(loadReservationSheet)

// Toate cele 7 limbi (lotul C8e): textele paginii, ale SMS-ului și ale emailului
// de confirmare există în toate (mig 328); LangSwitcher pune baza prima.
const RESERVE_LANGS: string[] = MENU_LANGS.map((l) => l.code)

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
  // Eroare de TRANSPORT (rețea / timeout) — distinctă de „restaurant negăsit":
  // înainte, semnalul slab spunea „restaurantul nu a fost găsit" fără nicio
  // ieșire (ux-guest-1). `reloadNonce` re-rulează încărcarea la „Reîncearcă".
  const [loadError, setLoadError] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  // Adresa de la sosire, citită O DATĂ: `?lang=` se rescrie la alegerea limbii
  // (replaceState), iar `?cancel=` nu are voie să depindă de acea rescriere.
  const [initialSearch] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.search : '',
  )
  // Limba paginii (lotul C8e) — și a confirmării: ReservationSheet o trimite ca
  // `guest_language` (mig 328), deci SMS-ul și emailul pleacă în ea. Pornirea:
  // `?lang=` (linkul de anulare, un link distribuit), apoi preferințele
  // browserului (toată lista `navigator.languages`, prima din cele 7), apoi
  // limba de BAZĂ a localului; pastilele o schimbă. Înainte era doar limba browserului,
  // fără selector: un român cu telefonul în engleză primea SMS-uri în engleză.
  const [pickedLang, setPickedLang] = useState<string | null>(null)
  const baseLang = menuBaseLang(restaurant?.language)
  const startLang = useMemo(
    () =>
      initialReservePageLang({
        search: initialSearch,
        browserLang: browserGuestLang(),
        crawler: browserIsCrawler(),
        base: baseLang,
      }),
    [initialSearch, baseLang],
  )
  const lang = pickedLang ?? startLang
  // Limba ALEASĂ explicit: din pastile sau sosită în adresă (`?lang=`). Doar ea
  // merge mai departe la meniu — una ghicită din browser ar opri auto-detectul
  // meniului (`?lang=` e o cerere, iar o limbă neoferită fixează baza), deși el
  // știe ce limbi oferă meniul tradus și ar găsi una potrivită.
  const explicitLang = pickedLang ?? langFromSearch(initialSearch)
  useDocumentLang(lang)
  const pickLang = (code: string) => {
    setPickedLang(code)
    // Adresa poartă alegerea: un refresh sau linkul copiat rămân în limba ei.
    replaceUrlLang(code)
  }
  // Anulare pe cod (mig 256/257): ?cancel=COD deschide cardul cu codul
  // pre-completat (linkul din emailuri/ecranul de succes); linkul discret de
  // sub butoane îl deschide manual. Sheet-ul de REZERVARE nu se deschide
  // peste fluxul de anulare.
  const initialCancel = new URLSearchParams(initialSearch).get('cancel') ?? ''
  const [cancelOpen, setCancelOpen] = useState<boolean>(initialCancel !== '')
  const [cancelCode, setCancelCode] = useState<string>(initialCancel)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelDone, setCancelDone] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  // Sheet-ul e DESCHIS din prima — ăsta e scopul paginii. onClose nu închide
  // într-un ecran mort: rămâne hero-ul cu buton de redeschidere + link meniu.
  const opensSheet = initialCancel === ''
  const [sheetOpen, setSheetOpen] = useState(opensSheet)

  async function submitCancel() {
    const code = cancelCode.trim()
    if (!code) {
      setCancelError(T(lang, 'rp_enter_code'))
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
      setCancelError(T(lang, 'rp_cancel_failed'))
      return
    }
    if (res.ok) {
      setCancelDone(true)
      return
    }
    if (res.hint === 'not_cancellable') {
      setCancelError(T(lang, 'rp_not_cancellable'))
    } else if (res.hint === 'rate_limited') {
      setCancelError(T(lang, 'rp_rate_limited'))
    } else {
      setCancelError(T(lang, 'err_invalid_code'))
    }
  }

  // Prefetch-ul chunk-ului, în același commit cu efectul de încărcare de mai
  // jos (deci în paralel cu RPC-ul). Pe fluxul de anulare (?cancel=) sheet-ul
  // nu se deschide, deci nu-l cerem degeaba.
  useEffect(() => {
    if (opensSheet) void loadReservationSheet().catch(() => undefined)
  }, [opensSheet])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    setLoadError(false)
    fetchRestaurantBySlug(slug)
      .then((row) => {
        if (cancelled) return
        if (row == null) setNotFound(true)
        else setRestaurant(row as unknown as Restaurant)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.warn('[ReservePage] încărcarea restaurantului a eșuat:', err)
        setLoadError(true)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug, reloadNonce])

  useEffect(() => {
    const prev = document.title
    if (restaurant) {
      document.title = Tf(lang, 'rp_doc_title', { name: restaurant.name })
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
  // Eticheta pastilelor de limbă: aceeași scală ca pe meniuri (LangSwitcher).
  const typo = useMemo(() => menuType(theme.fonts), [theme])

  if (loading) return <PageSpinner />

  // Rețea slabă: același ecran neutru ca „negăsit", dar spune adevărul și are
  // ieșire („Reîncearcă"). Tema restaurantului nu e cunoscută încă.
  if (loadError) {
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
          <div role="alert">
            <div style={{ color: '#F0EAE0', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              {T(lang, 'net_weak_title')}
            </div>
            <div style={{ color: '#9A9590', fontSize: 14, marginBottom: 18 }}>
              {T(lang, 'err_menu_conn')}
            </div>
          </div>
          <button
            onClick={() => setReloadNonce((n) => n + 1)}
            style={{
              background: 'transparent',
              color: '#F0EAE0',
              border: '1px solid #F0EAE0',
              borderRadius: 12,
              padding: '12px 24px',
              minHeight: 44,
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {T(lang, 'retry')}
          </button>
        </div>
      </div>
    )
  }

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
            {T(lang, 'err_restaurant_not_found')}
          </div>
          <div style={{ color: '#9A9590', fontSize: 14 }}>
            {T(lang, 'rp_not_found_hint')}
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
      <div style={{ color: PUB.text3, fontSize: 13, marginBottom: 20 }}>
        {T(lang, 'rp_tagline')}
      </div>
      <div style={{ width: '100%', maxWidth: 420, marginBottom: 24 }}>
        <LangSwitcher
          center
          languages={RESERVE_LANGS}
          baseLang={baseLang}
          activeLang={lang}
          onLangChange={pickLang}
          accent={accent}
          PUB={PUB}
          labelStyle={typo.label}
          ariaLabel={T(lang, 'rp_lang_switch_aria')}
        />
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
                {T(lang, 'rp_cancelled')}
              </div>
              <div style={{ color: PUB.text2, fontSize: 14, lineHeight: 1.5 }}>
                {T(lang, 'rp_cancelled_sub')}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
                {T(lang, 'rp_cancel_title')}
              </div>
              <input
                value={cancelCode}
                onChange={(e) => setCancelCode(e.target.value.toUpperCase())}
                placeholder={T(lang, 'rp_code_ph')}
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
                // role="alert": cititorul de ecran anunță refuzul (codul greșit,
                // plafonul), nu doar o culoare care apare sub câmp. Culoarea vine
                // din tema localului, nu un roșu fix (a11y-reservation-chips-errors).
                <div
                  role="alert"
                  style={{ color: theme.colors.error, fontSize: 13, marginBottom: 10 }}
                >
                  {cancelError}
                </div>
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
                  ? T(lang, 'rp_cancelling')
                  : T(lang, 'rp_cancel_btn')}
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
          {T(lang, 'reserve_cta')}
        </button>
        {/* Meniul se deschide în limba ALEASĂ (`?lang=`, semantica O6c: o
            limbă pe care meniul nu o oferă lasă baza). Fără alegere, nimic:
            meniul își face singur auto-detectul pe limbile traduse — un francez
            cu engleza a doua, pe un meniu tradus doar în engleză, primește
            engleza, nu baza fixată de un `?lang=fr` pe care nu l-a cerut. */}
        <button
          onClick={() =>
            navigate(explicitLang != null ? `/m/${slug}?lang=${explicitLang}` : `/m/${slug}`)
          }
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
          {T(lang, 'rp_view_menu')}
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
          {T(lang, 'rp_have_reservation')}
        </button>
      )}

      {/* „Fără branding" (mig 281 — gate-ul de plan e la CITIRE, în proiecția
          publică): aceeași regulă ca badge-ul de pe /m/:slug și QR. */}
      {!resolveHideBranding(restaurant.theme_settings) && (
        <div style={{ marginTop: 40, fontSize: 12, color: PUB.text3 }}>
          {T(lang, 'powered_by')}{' '}
          {/* `noreferrer`, ca badge-ul de pe /m/ și QR: pagina site-ului nu
              primește adresa rezervării (cu `?cancel=` în ea) drept proveniență. */}
          <a
            href="/"
            rel="noreferrer"
            style={{ color: accent, textDecoration: 'none', fontWeight: 600 }}
          >
            Menuvia
          </a>
        </div>
      )}

      {sheetOpen && (
        <Suspense fallback={null}>
          <ReservationSheet
            restaurant={restaurant}
            theme={theme}
            accent={accent}
            PUB={PUB}
            lang={lang}
            onClose={() => setSheetOpen(false)}
            langSwitch={
              <>
                <LangSwitcher
                  languages={RESERVE_LANGS}
                  baseLang={baseLang}
                  activeLang={lang}
                  onLangChange={pickLang}
                  accent={accent}
                  PUB={PUB}
                  labelStyle={typo.label}
                  ariaLabel={T(lang, 'rp_lang_switch_aria')}
                />
                <div style={{ marginTop: 6, fontSize: 12, color: PUB.text3 }}>
                  {T(lang, 'rp_lang_hint')}
                </div>
              </>
            }
          />
        </Suspense>
      )}
    </div>
  )
}
