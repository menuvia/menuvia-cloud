// =============================================================
// Menuvia — src/components/PWAPrompt.tsx
// Banner discret pentru install + notificare update SW.
// Apare doar pe device-uri eligibile, după 30s pe site.
//
// Ambele carduri sunt `role="dialog"` FIXATE JOS (zIndex 9999) — pe telefon
// stau exact peste bara de navigare a dashboard-ului. De aceea AMBELE se pot
// închide: instalarea definitiv (localStorage, lib/pwa.ts), actualizarea pe
// SESIUNEA de navigare („Mai târziu": userul alege CÂND, cum promite sw.js — înainte cardul
// nu avea nicio ieșire în afară de reload, adică fix reload-ul forțat mid-tură
// pe care politica fără skipWaiting voia să-l evite). E2E-ul pre-setează
// ambele chei în `prepPage` (e2e/helpers.ts) — un test care dura >30 s
// devenea roșu din cauza cardului, nu a ce verifica.
//
// Textele (lotul L4d) stau în `chrome.ts` și urmează limba PAGINII
// (`<html lang>`): cardurile apar pe panou, la Ospătar și în Bucătărie — adică
// pe tabletele comune —, unde `StaffDocumentLang` pune limba personalului. În
// română sunt EXACT cele de dinainte (E2E-ul și PA1–PA5 le caută).
// =============================================================
import { useEffect, useState } from 'react'
import { D } from '../lib/constants'
import { chromeT } from '../i18n/chrome'
import { useChrome } from '../i18n/useChromeLang'
import { usePWAInstall, useSWUpdate } from '../lib/pwa'
import { pwaPromptAllowedNow } from '../lib/pwaGate'

/** Cheia de amânare a cardului de actualizare — per sesiune de navigare (sessionStorage): supraviețuiește unui reload în același tab, dispare la închiderea tab-ului / a PWA-ului. */
export const PWA_UPDATE_SNOOZE_KEY = 'pwa-update-snoozed'

/** Citește amânarea din sessionStorage; orice eroare (Safari privat) = neamânat. */
function readUpdateSnoozed(): boolean {
  try {
    return sessionStorage.getItem(PWA_UPDATE_SNOOZE_KEY) === '1'
  } catch {
    return false
  }
}

export default function PWAPrompt() {
  const { canInstall, install, dismiss } = usePWAInstall()
  const { updateAvailable, applyUpdate } = useSWUpdate()
  const [show, setShow] = useState(false)
  const [updateSnoozed, setUpdateSnoozed] = useState<boolean>(readUpdateSnoozed)
  const { lang, fallback } = useChrome()

  // Show install prompt after 30s of session (not annoying immediately)
  useEffect(() => {
    if (!canInstall) {
      setShow(false)
      return
    }
    const t = setTimeout(() => setShow(true), 30_000)
    return () => clearTimeout(t)
  }, [canInstall])

  // Update prompt takes priority. „Mai târziu" amână pe SESIUNEA de navigare
  // (sessionStorage: supraviețuiește unui reload în același tab, dispare la
  // închiderea tab-ului / a PWA-ului din app switcher). SW-ul rămâne în
  // `waiting`; la următoarea deschidere REALĂ nu mai are clienți vechi și se
  // activează singur — actualizarea se aplică FĂRĂ card. Cardul reapare doar
  // dacă alt tab ține SW-ul vechi în viață. Userul nu poate ocoli actualizarea
  // la nesfârșit, doar o mută în afara turei (recenzie adversarială #246: prima
  // formulare, „reapare la următoarea deschidere", descria un mecanism inexistent).
  //
  // Ruta se verifică și AICI, la fiecare randare (lib/pwaGate.ts): App montează
  // cardul doar unde are voie, dar o rută schimbată prin replaceState fără anunț
  // (ex. /dashboard → /auth) n-ar re-randa montarea — cardul care apare la 30 s
  // citește ruta de ACUM, nu pe cea de la montare.
  if (!pwaPromptAllowedNow()) return null

  if (updateAvailable && !updateSnoozed) {
    return (
      <PromptCard
        lang={fallback}
        title={chromeT(lang, 'pwa_update_title')}
        message={chromeT(lang, 'pwa_update_body')}
        actionLabel={chromeT(lang, 'pwa_update_action')}
        onAction={applyUpdate}
        dismissLabel={chromeT(lang, 'pwa_update_later')}
        closeLabel={chromeT(lang, 'pwa_close')}
        onDismiss={() => {
          try {
            sessionStorage.setItem(PWA_UPDATE_SNOOZE_KEY, '1')
          } catch {
            /* Safari privat: fără persistență — starea locală ajunge pentru pagina curentă */
          }
          setUpdateSnoozed(true)
        }}
      />
    )
  }

  if (!show || !canInstall) return null

  return (
    <PromptCard
      lang={fallback}
      title={chromeT(lang, 'pwa_install_title')}
      message={chromeT(lang, 'pwa_install_body')}
      actionLabel={chromeT(lang, 'pwa_install_action')}
      closeLabel={chromeT(lang, 'pwa_close')}
      onAction={async () => {
        await install()
      }}
      onDismiss={dismiss}
    />
  )
}

/** Cardul fix de jos; `dismissLabel` înlocuiește „×" cu un text (ex. „Mai târziu").
 *  `closeLabel` = numele accesibil al lui „×”; `lang` = limba de declarat când
 *  tabelul cromului a căzut pe altă limbă decât a paginii (chromeFallbackLang). */
function PromptCard({
  title,
  message,
  actionLabel,
  onAction,
  onDismiss,
  dismissLabel,
  closeLabel,
  lang,
}: {
  title: string
  message: string
  actionLabel: string
  onAction: () => void
  onDismiss?: () => void
  dismissLabel?: string
  closeLabel: string
  lang?: string
}) {
  return (
    <div
      role="dialog"
      lang={lang}
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
              fontSize: dismissLabel ? 12 : 18,
              fontWeight: dismissLabel ? 600 : 400,
              cursor: 'pointer',
              padding: '4px 8px',
              lineHeight: 1,
              fontFamily: 'DM Sans, sans-serif',
              whiteSpace: 'nowrap',
            }}
            aria-label={dismissLabel ?? closeLabel}
          >
            {dismissLabel ?? '×'}
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
