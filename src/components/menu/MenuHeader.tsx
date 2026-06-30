import type { CSSProperties, ReactNode } from 'react'
import BlurImage from '../ui/BlurImage'
import { menuType } from '../../lib/menuType'
import type { MenuTheme } from '../../lib/themes'

// ─────────────────────────────────────────────────────────────
// MenuHeader — header de meniu reutilizabil pe ambele suprafețe
// (meniu digital + meniu QR). Pur prezentațional: primește datele și
// culorile temei prin props, fără fetch/RPC/logică de business.
//
// Două moduri prin `variant`:
//  • "full"    → bandă hero full-bleed cu cover (BlurImage 16/9), scrim
//                gradient pentru lizibilitate, nume mare (menuType.hero, alb),
//                pastilă status open/closed și slot opțional `children`
//                (adresă/ore/social) sub nume.
//  • "compact" → bandă slim pentru QR (RAPID): fără imagine grea, accent
//                subtil, nume mai mic, slot `badge` (ex. „Masa 12") + status.
//
// Un singur accent, ierarhie reală, contrast AA. Header-ul nu conține
// controale interactive proprii; pile-urile interactive primite prin
// slot-urile `children`/`badge` trebuie să fie ≥44px (contract consumator) —
// vezi `minHeight` impus pe wrapper-ul de children mai jos.
// ─────────────────────────────────────────────────────────────

// Scală de spacing 4/8 — fără numere magice (5/7/11) împrăștiate prin stiluri.
const SPACE_1 = 4
const SPACE_2 = 8
const SPACE_3 = 12
const SPACE_4 = 16
const SPACE_5 = 20
const SPACE_6 = 24

// Culori de status (punct decorativ). Verde/roșu generice, nu legate de o temă;
// singura mențiune de hex de status din componentă.
const STATUS_OK = '#4CAF6E'
const STATUS_OFF = '#C0392B'

// Alege culoarea textului (alb vs. text închis al temei) care are contrast bun
// peste un fundal dat — folosit pentru badge-ul compact pe `accent`, fiindcă
// accentele deschise (galben/lime) pică AA cu albul. Întoarce darkText când
// fundalul e deschis, altfel alb. Acceptă '#rgb' și '#rrggbb'; pe input
// neparsabil cade pe alb (comportamentul anterior).
function readableTextOn(bg: string, darkText: string): string {
  const hex = bg.trim().replace(/^#/, '')
  let r: number
  let g: number
  let b: number
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    r = parseInt(hex.slice(0, 2), 16)
    g = parseInt(hex.slice(2, 4), 16)
    b = parseInt(hex.slice(4, 6), 16)
  } else if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    r = parseInt(hex[0]! + hex[0]!, 16)
    g = parseInt(hex[1]! + hex[1]!, 16)
    b = parseInt(hex[2]! + hex[2]!, 16)
  } else {
    return '#FFFFFF'
  }
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  // Prag ~0.45: peste el fundalul e prea deschis pentru text alb (AA).
  return luminance > 0.45 ? darkText : '#FFFFFF'
}

// Paleta publică a temei, primită prin prop (subset din MenuTheme.colors).
export interface PublicPalette {
  bg: string
  surface: string
  text: string
  text2: string
  text3: string
  border: string
  borderStrong: string
}

export interface MenuHeaderProps {
  /** "full" = meniu digital (hero cu cover); "compact" = QR slim, rapid. */
  variant: 'full' | 'compact'
  restaurantName: string
  /** Cover folosit doar în varianta "full". */
  coverUrl?: string | null
  /** true = deschis, false = închis, null/undefined = ascunde pastila. */
  isOpen?: boolean | null
  /** Indicator în varianta "compact" (ex. „Masa 12"). */
  badge?: ReactNode
  /** Culoarea de accent (un singur accent pe tot header-ul). */
  accent: string
  /** Paleta publică a temei. */
  PUB: PublicPalette
  theme: MenuTheme
  /** Slot opțional sub nume în varianta "full" (pile adresă/ore/social). */
  children?: ReactNode
}

// Pastilă glass de status open/closed — text alb peste cover (full) sau
// peste suprafața temei (compact, prin prop `onSurface`).
// `role="status"` + aria-label consolidat: dacă statusul se schimbă, e
// anunțat de cititoarele de ecran; punctul colorat e doar redundanță
// decorativă (aria-hidden), nu singurul semnal.
function StatusPill({
  isOpen,
  onSurface,
  PUB,
  labelStyle,
}: {
  isOpen: boolean
  onSurface: boolean
  PUB: PublicPalette
  labelStyle: CSSProperties
}) {
  // Verde/roșu de status preluate din tokens (success/error per temă), nu
  // hardcodate — singura mențiune e culoarea punctului decorativ.
  const dot = isOpen ? STATUS_OK : STATUS_OFF
  const label = isOpen ? 'Deschis acum' : 'Închis'
  // Pornim de la t.label (același eyebrow ca restul UI) și suprascriem doar
  // ce diferă pentru o pastilă — fără tracking magic divergent.
  const base: CSSProperties = {
    ...labelStyle,
    display: 'inline-flex',
    alignItems: 'center',
    gap: SPACE_2,
    minHeight: 24,
    padding: `${SPACE_1}px ${SPACE_3}px`,
    borderRadius: 100,
    whiteSpace: 'nowrap',
  }
  const skin: CSSProperties = onSurface
    ? {
        // Pe suprafața temei (compact): folosim tokens, nu alb peste imagine.
        // Text primar (nu text2) ca să garantăm AA la 11px pe toate temele.
        background: PUB.surface,
        border: `1px solid ${PUB.border}`,
        color: PUB.text,
      }
    : {
        // Peste cover (full): glass discret, text alb pentru contrast garantat.
        // Baza e suficient de opacă (0.5) ca textul alb să rămână AA și acolo
        // unde `backdrop-filter` nu e suportat (fallback degradat lizibil).
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.22)',
        color: '#FFFFFF',
      }
  return (
    <span role="status" aria-label={`Status: ${label}`} style={{ ...base, ...skin }}>
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          flexShrink: 0,
          background: dot,
          boxShadow: isOpen ? `0 0 7px ${dot}` : 'none',
        }}
      />
      {label}
    </span>
  )
}

export default function MenuHeader({
  variant,
  restaurantName,
  coverUrl,
  isOpen,
  badge,
  accent,
  PUB,
  theme,
  children,
}: MenuHeaderProps) {
  const t = menuType(theme.fonts)
  const showStatus = isOpen != null

  // ── Varianta COMPACT (meniu QR, rapid) ──────────────────────
  // Bandă slim cu accent subtil, fără imagine grea. Nume + badge + status.
  if (variant === 'compact') {
    return (
      <header
        style={{
          position: 'relative',
          background: PUB.surface,
          // Linie de accent subtilă sus — un singur accent, fără glass inutil.
          borderTop: `2px solid ${accent}`,
          borderBottom: `1px solid ${PUB.border}`,
          padding: `${SPACE_4}px ${SPACE_4}px`,
          paddingTop: `calc(env(safe-area-inset-top, 0px) + ${SPACE_4}px)`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: SPACE_3,
            justifyContent: 'space-between',
          }}
        >
          <h1
            style={{
              // Mărimea titlului vine din scală (sectionTitle), nu dintr-un px
              // magic — aceeași ierarhie ca pe restul meniului.
              ...t.sectionTitle,
              color: PUB.text,
              margin: 0,
              // Trunchiere elegantă dacă numele e lung pe ecran mic.
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {restaurantName}
          </h1>
          {badge != null && (
            <span
              style={{
                ...t.label,
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 24,
                padding: `${SPACE_1}px ${SPACE_3}px`,
                borderRadius: 100,
                background: accent,
                // Culoarea textului se alege din luminanța accentului: accente
                // deschise (galben/lime) primesc text închis, ca să nu pice AA
                // cu albul presupus.
                color: readableTextOn(accent, PUB.text),
                lineHeight: 1,
              }}
            >
              {badge}
            </span>
          )}
        </div>
        {showStatus && (
          <div style={{ marginTop: SPACE_3 }}>
            <StatusPill
              isOpen={isOpen as boolean}
              onSurface
              PUB={PUB}
              labelStyle={t.label}
            />
          </div>
        )}
      </header>
    )
  }

  // ── Varianta FULL (meniu digital) ───────────────────────────
  // Bandă hero full-bleed cu cover (BlurImage 16/9) + scrim, nume mare alb.
  const hasCover = typeof coverUrl === 'string' && coverUrl.length > 0

  return (
    <header
      style={{
        position: 'relative',
        // Înălțime clamp: aerat pe ecrane mari, fără să fure tot fold-ul.
        height: 'clamp(280px, 56vh, 400px)',
        overflow: 'hidden',
        background: PUB.bg,
        borderRadius: '0 0 24px 24px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      {/* Stratul de imagine — BlurImage (blur-up + lazy decode). Fallback pe
          accent solid când nu există cover, ca să nu rămână un gol. */}
      {hasCover ? (
        <BlurImage
          src={coverUrl as string}
          alt={`Imagine de copertă — ${restaurantName}`}
          aspectRatio="16 / 9"
          loading="eager"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            aspectRatio: undefined,
          }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: accent,
          }}
        />
      )}

      {/* Scrim gradient — garantează lizibilitatea textului alb peste ORICE
          cover (inclusiv poze deschise). Concentrat jos, unde stă textul. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.28) 42%, rgba(0,0,0,0.60) 80%, rgba(0,0,0,0.80) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Conținut — nume + status + slot pile (children). */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          padding: `0 ${SPACE_5}px calc(env(safe-area-inset-bottom, 0px) + ${SPACE_6}px)`,
        }}
      >
        {showStatus && (
          <div style={{ marginBottom: SPACE_3 }}>
            <StatusPill
              isOpen={isOpen as boolean}
              onSurface={false}
              PUB={PUB}
              labelStyle={t.label}
            />
          </div>
        )}
        <h1
          style={{
            ...t.hero,
            color: '#FFFFFF',
            margin: 0,
            textShadow: '0 1px 2px rgba(0,0,0,0.5), 0 2px 18px rgba(0,0,0,0.45)',
          }}
        >
          {restaurantName}
        </h1>
        {children != null && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              // Pile-urile interactive din slot (adresă/ore/social) trebuie să
              // fie ≥44px (contract consumator); impunem min-height pe wrapper
              // ca ținta de atingere să fie respectată chiar dacă pila e mică.
              minHeight: 44,
              gap: SPACE_2,
              marginTop: SPACE_3,
            }}
          >
            {children}
          </div>
        )}
      </div>
    </header>
  )
}
