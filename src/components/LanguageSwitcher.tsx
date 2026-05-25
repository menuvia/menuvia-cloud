// src/components/LanguageSwitcher.tsx
// Toggle compact RO/EN. Vine în colțul dreapta sus pe paginile publice (QR menu, plată).
import { useLanguage } from '../lib/i18n'

interface Props {
  variant?: 'light' | 'dark'
  position?: 'top-right' | 'inline'
}

export default function LanguageSwitcher({ variant = 'dark', position = 'top-right' }: Props) {
  const { lang, setLang } = useLanguage()

  const isDark = variant === 'dark'
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 10px',
    background: isDark ? 'rgba(0,0,0,0.5)' : '#FFFFFF',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : '#E8DFD0'}`,
    borderRadius: 999,
    color: isDark ? '#F0EAE0' : '#1A1208',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'DM Sans, sans-serif',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  }

  const positionStyle: React.CSSProperties =
    position === 'top-right'
      ? {
          position: 'fixed',
          top: 12,
          right: 12,
          zIndex: 400,
        }
      : {}

  function toggleLang() {
    setLang(lang === 'ro' ? 'en' : 'ro')
  }

  return (
    <button
      onClick={toggleLang}
      style={{ ...baseStyle, ...positionStyle }}
      aria-label={`Schimbă limba (curent: ${lang.toUpperCase()})`}
    >
      <span style={{ fontSize: 14 }}>{lang === 'ro' ? '🇷🇴' : '🇬🇧'}</span>
      <span>{lang === 'ro' ? 'RO' : 'EN'}</span>
    </button>
  )
}
