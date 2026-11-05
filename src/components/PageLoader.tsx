import { Component, ReactNode, CSSProperties } from 'react'
import { D } from '../lib/constants'
import { toUserMessage, userErrorKind } from '../lib/userMessages'
import { chromeT, documentChromeLang, type ChromeLang } from '../i18n/chrome'
import { useChrome } from '../i18n/useChromeLang'

const center: CSSProperties = {
  minHeight: '100vh',
  background: D.bg,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  fontFamily: 'DM Sans, system-ui, sans-serif',
}
const spinKeyframes = `@keyframes mvia-spin{to{transform:rotate(360deg)}}`

export function PageSpinner({ label }: { label?: string }) {
  // Fallback-ul de Suspense al paginilor leneșe, deci și al meniului QR: în
  // limba paginii (`<html lang>`, lotul L1), nu mereu „Se încarcă…”.
  const { lang, fallback } = useChrome()
  return (
    <div style={center}>
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: `3px solid ${D.gold}`,
            borderTopColor: 'transparent',
            animation: 'mvia-spin 0.8s linear infinite',
            margin: '0 auto 16px',
          }}
        />
        <div style={{ color: D.t3, fontSize: 14 }} lang={label == null ? fallback : undefined}>
          {label ?? chromeT(lang, 'loading')}
        </div>
      </div>
      <style>{spinKeyframes}</style>
    </div>
  )
}

export function InlineSpinner({ label }: { label?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 0',
        gap: 12,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          border: `2px solid ${D.gold}`,
          borderTopColor: 'transparent',
          animation: 'mvia-spin 0.8s linear infinite',
        }}
      />
      {label && <span style={{ color: D.t3, fontSize: 13 }}>{label}</span>}
      <style>{spinKeyframes}</style>
    </div>
  )
}

export function QueryError({
  message,
  onRetry,
  retryLabel,
}: {
  message: string
  onRetry?: () => void
  /** Eticheta butonului — implicit „Reîncearcă” (în limba paginii); altă acțiune = alt text. */
  retryLabel?: string
}) {
  const { lang, fallback } = useChrome()
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>&#x26a0;&#xfe0f;</div>
      <div style={{ color: D.t2, fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            background: D.s2,
            border: `1px solid ${D.border}`,
            borderRadius: 8,
            color: D.gold,
            padding: '8px 20px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {retryLabel ?? <span lang={fallback}>{chromeT(lang, 'retry')}</span>}
        </button>
      )}
    </div>
  )
}

export function ConfigError() {
  const missing: string[] = []
  if (!import.meta.env.VITE_SUPABASE_URL) missing.push('VITE_SUPABASE_URL')
  if (!import.meta.env.VITE_SUPABASE_ANON_KEY) missing.push('VITE_SUPABASE_ANON_KEY')
  return (
    <div style={center}>
      <div
        style={{
          maxWidth: 480,
          background: D.s1,
          border: `1px solid ${D.border}`,
          borderRadius: 16,
          padding: '40px 32px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 16 }}>&#x1f527;</div>
        <h1
          style={{
            fontFamily: 'Georgia, serif',
            fontSize: 22,
            color: D.gold,
            marginBottom: 12,
            fontWeight: 700,
          }}
        >
          Menuvia &mdash; configurare necesară
        </h1>
        <p style={{ color: D.t2, fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
          Variabilele de mediu lipsesc. Setează-le &icirc;n{' '}
          <strong style={{ color: '#E2B472' }}>
            Netlify &rarr; Site config &rarr; Environment variables
          </strong>
          , apoi retrigger deploy-ul.
        </p>
        <div style={{ background: D.s2, borderRadius: 8, padding: '16px 20px', textAlign: 'left' }}>
          {missing.map((key) => (
            <div
              key={key}
              style={{ fontFamily: 'monospace', fontSize: 13, color: D.red, padding: '4px 0' }}
            >
              &#x2717; {key}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface EBProps {
  children: ReactNode
}
interface EBState {
  error: Error | null
  /** Limba paginii în CLIPA erorii. Citită aici, în faza de randare: la
   *  commit pagina căzută se demontează, iar `useDocumentLang` reface
   *  `<html lang>` la „ro” — un oaspete german ar fi primit ecranul de eroare
   *  în română (lotul L1). */
  lang: ChromeLang
}

export class ErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { error: null, lang: 'ro' }
  static getDerivedStateFromError(error: Error): EBState {
    return { error, lang: documentChromeLang() }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Menuvia] Unhandled error:', error, info)
    // OPT-7: Sentry se încarcă DINAMIC doar la prima eroare — importul static
    // trăgea chunk-ul (~25-40KB gz) în calea critică de startup, deși main.tsx
    // documentează explicit că Sentry trebuie să rămână lazy. Best-effort:
    // dacă chunk-ul nu se poate încărca (offline/ad-blocker), console.error-ul
    // de mai sus rămâne singura urmă — exact ca înainte de Sentry.
    void import('@sentry/react')
      .then((S) => S.captureException(error, { extra: { componentStack: info.componentStack } }))
      .catch(() => {})
  }
  render() {
    if (this.state.error) {
      const { lang } = this.state
      // Textul tehnic al excepției (în engleză) nu ajunge la om. Îl învelim
      // într-un Error simplu ca `isNetworkError` să decidă DOAR pe text: un
      // chunk lazy care n-a putut fi descărcat („Failed to fetch dynamically
      // imported module") e rețea, dar un TypeError dintr-un bug nu e „fără
      // conexiune". În română, exact ca înainte (toUserMessage); în celelalte
      // limbi, același verdict (userErrorKind), cu textul din tabel.
      const plain = new Error(this.state.error.message)
      const body =
        lang === 'ro'
          ? toUserMessage(plain, chromeT('ro', 'err_generic'))
          : chromeT(lang, userErrorKind(plain).kind === 'network' ? 'err_network' : 'err_generic')
      return (
        <div style={center} lang={lang}>
          <div style={{ textAlign: 'center', maxWidth: 480 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#x26a0;&#xfe0f;</div>
            <div
              style={{ color: D.red, fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 8 }}
            >
              {chromeT(lang, 'err_title')}
            </div>
            <div style={{ color: D.t2, fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              {body}
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: D.gold,
                color: '#000',
                border: 'none',
                borderRadius: 8,
                padding: '10px 24px',
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {chromeT(lang, 'err_reload')}
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
