// ─────────────────────────────────────────────────────────────
// Icon — set de iconuri SVG monoline (înlocuiește emoji-ca-icon în chrome)
// ─────────────────────────────────────────────────────────────
// Principii (blueprint design 2026): stroke 1.75, viewBox 24, fill none,
// stroke currentColor → culoarea vine din `color` (ex. D.t2 / D.gold).
// vector-effect non-scaling-stroke ca grosimea să rămână constantă la scale.
// aria-hidden implicit; cu `label` devine role="img" + aria-label.
//
// Emoji rămâne DOAR pentru conținut semantic al userului (categorii, produse),
// niciodată pentru iconografia de interfață.
import type { CSSProperties } from 'react'

export type IconName =
  | 'home'
  | 'menu'
  | 'orders'
  | 'table'
  | 'chart'
  | 'settings'
  | 'users'
  | 'plus'
  | 'edit'
  | 'trash'
  | 'close'
  | 'check'
  | 'refresh'
  | 'link'
  | 'download'
  | 'upload'
  | 'eye'
  | 'star'
  | 'sparkle'
  | 'send'
  | 'camera'
  | 'alert'
  | 'search'
  | 'qr'
  | 'receipt'
  | 'clock'
  | 'chevronRight'
  | 'chevronDown'

// Path-uri (d / elemente) per icon. Toate pe grid 24, fără fill.
const PATHS: Record<IconName, JSX.Element> = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />,
  menu: (
    <>
      <path d="M4 5h16M4 12h16M4 19h16" />
    </>
  ),
  orders: (
    <>
      <path d="M6 2h9l4 4v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M14 2v5h5M8 13h8M8 17h6" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="9" width="18" height="3" rx="1" />
      <path d="M6 12v8M18 12v8M5 9V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
    </>
  ),
  chart: <path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.8 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.6a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1-2.7l-.1-.1A2 2 0 1 1 6.7 4l.1.1A1.6 1.6 0 0 0 9 3.5 2 2 0 1 1 13 3.5a1.6 1.6 0 0 0 2.7 1.1l.1-.1A2 2 0 1 1 18.6 7l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.2Z" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.2a3.2 3.2 0 0 1 0 6M17.5 20a5.5 5.5 0 0 0-2.5-4.6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17v3ZM14.5 6.5l3 3" />,
  trash: <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="M5 12.5 10 17.5 19.5 6.5" />,
  refresh: <path d="M20 11a8 8 0 1 0-.6 4M20 5v6h-6" />,
  link: <path d="M9 15l6-6M10.5 6.5 13 4a4 4 0 0 1 6 6l-2.5 2.5M13.5 17.5 11 20a4 4 0 0 1-6-6l2.5-2.5" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  upload: <path d="M12 20V9M7 13l5-5 5 5M5 4h14" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />,
  send: <path d="M4.5 12 20 4l-5 16-3.5-6.5L4.5 12Z" />,
  camera: (
    <>
      <path d="M3 8.5a2 2 0 0 1 2-2h2l1.2-2h5.6L17 6.5h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5Z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  alert: <path d="M12 4 2.5 20h19L12 4ZM12 10v4M12 17.5h.01" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  qr: <path d="M4 4h6v6H4V4ZM14 4h6v6h-6V4ZM4 14h6v6H4v-6ZM14 14h2v2h-2v-2ZM18 14h2v2h-2v-2ZM14 18h2v2h-2v-2ZM18 18h2v2h-2v-2Z" />,
  receipt: <path d="M5 3l1.2 1.2L7.5 3l1.3 1.2L10 3l1.3 1.2L12.5 3l1.2 1.2L15 3l1.3 1.2L17.5 3v18l-1.2-1.2L15 21l-1.3-1.2L12.5 21l-1.2-1.2L10 21l-1.2-1.2L7.5 21l-1.3-1.2L5 21V3ZM8 8h6M8 12h6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
}

export function Icon({
  name,
  size = 20,
  color = 'currentColor',
  strokeWidth = 1.75,
  label,
  style,
  className,
}: {
  name: IconName
  size?: number
  color?: string
  strokeWidth?: number
  label?: string
  style?: CSSProperties
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, display: 'block', ...style }}
      vectorEffect="non-scaling-stroke"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {PATHS[name]}
    </svg>
  )
}

export default Icon
