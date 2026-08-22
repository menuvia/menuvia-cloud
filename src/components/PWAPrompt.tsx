// =============================================================
// Menuvia — src/components/PWAPrompt.tsx
// Banner discret pentru install + notificare update SW.
// Apare doar pe device-uri eligibile, după 30s pe site.
// =============================================================
import { useEffect, useState } from 'react'
import { D } from '../lib/constants'
import { usePWAInstall, useSWUpdate } from '../lib/pwa'

export default function PWAPrompt() {
  const { canInstall, install, dismiss } = usePWAInstall()
  const { updateAvailable, applyUpdate } = useSWUpdate()
  const [show, setShow] = useState(false)

  // Show install prompt after 30s of session (not annoying immediately)
  useEffect(() => {
    if (!canInstall) {
      setShow(false)
      return
    }
    const t = setTimeout(() => setShow(true), 30_000)
    return () => clearTimeout(t)
  }, [canInstall])

  // Update prompt takes priority
  if (updateAvailable) {
    return (
      <PromptCard
        title="Actualizare disponibilă"
        message="O versiune nouă a aplicației e gata."
        actionLabel="Actualizează"
        onAction={applyUpdate}
        onDismiss={() => {
          /* update can't be dismissed, must reload eventually */
        }}
      />
    )
  }

  if (!show || !canInstall) return null

  return (
    <PromptCard
      title="Instalează Menuvia"
      message="Folosește aplicația direct de pe ecranul principal."
      actionLabel="Instalează"
      onAction={async () => {
        await install()
      }}
      onDismiss={dismiss}
    />
  )
}

function PromptCard({
  title,
  message,
  actionLabel,
  onAction,
  onDismiss,
}: {
  title: string
  message: string
  actionLabel: string
  onAction: () => void
  onDismiss?: () => void
}) {
  return (
    <div
      role="dialog"
      aria-labelledby="pwa-prompt-title"
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0) + 16px)',
        left: 16,
        right: 16,
        maxWidth: 420,
        margin: '0 auto',
        background: D.s2 || '#15130F',
        border: `1px solid ${D.gold}`,
        borderRadius: 14,
        padding: 16,
        boxShadow: '0 10px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(200,150,60,0.1)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: 'linear-gradient(135deg, rgba(200,150,60,0.2), rgba(200,150,60,0.05))',
          border: '1px solid rgba(200,150,60,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontSize: 22,
        }}
      >
        📲
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          id="pwa-prompt-title"
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 15,
            fontWeight: 600,
            color: D.t1 || '#FAF8F2',
            marginBottom: 2,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 12, color: D.t2 || '#A8A39A', lineHeight: 1.4 }}>{message}</div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: 'transparent',
              border: 'none',
              color: D.t3 || '#6E6862',
              fontSize: 18,
              cursor: 'pointer',
              padding: '4px 8px',
              lineHeight: 1,
            }}
            aria-label="Închide"
          >
            ×
          </button>
        )}
        <button
          onClick={onAction}
          style={{
            background: D.gold,
            color: '#0A0908',
            border: 'none',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'DM Sans, sans-serif',
          }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  )
}
