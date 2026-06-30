import { Component, ReactNode, CSSProperties } from 'react'
import * as Sentry from '@sentry/react'
import { D } from '../lib/constants'

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

export function PageSpinner({ label = 'Se încarcă…' }: { label?: string }) {
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
        <div style={{ color: D.t3, fontSize: 14 }}>{label}</div>
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

export function QueryError({ message, onRetry }: { message: string; onRetry?: () => void }) {
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
          Reîncearcă
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
}

export class ErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { error: null }
  static getDerivedStateFromError(error: Error): EBState {
    return { error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Menuvia] Unhandled error:', error, info)
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } })
  }
  render() {
    if (this.state.error) {
      return (
        <div style={center}>
          <div style={{ textAlign: 'center', maxWidth: 480 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#x26a0;&#xfe0f;</div>
            <div
              style={{ color: D.red, fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 8 }}
            >
              Ceva nu a mers bine
            </div>
            <div style={{ color: D.t2, fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              {this.state.error.message}
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
              Re&icirc;ncarcă pagina
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
