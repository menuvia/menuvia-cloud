// =============================================================
// Menuvia — src/lib/pwa.ts
// PWA install prompt management and SW update notifications.
//
// Folosire:
//   - PWAInstallPrompt component → afișează banner "Instalează"
//     pe device-uri eligibile (Chrome Android, Edge desktop, etc.)
//   - useSWUpdate hook → notifică user când e disponibilă o versiune nouă
// =============================================================

import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    window.dispatchEvent(new CustomEvent('pwa-installable'))
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    window.dispatchEvent(new CustomEvent('pwa-installed'))
  })
}

const INSTALL_DISMISSED_KEY = 'pwa-install-dismissed'

/**
 * Citește amânarea instalării; orice eroare = „neamânat" (fail-open).
 *
 * RESID-15: garda de dinainte era `typeof localStorage === 'undefined'`, care
 * acoperă DOAR cazul SSR (obiectul lipsește). În Safari cu „Block All Cookies"
 * obiectul EXISTĂ și `getItem` ARUNCĂ `SecurityError` — iar apelul e în
 * inițializatorul de `useState`, deci throw-ul urca până la `ErrorBoundary`-ul
 * din App.tsx, care înfășoară TOT arborele. `PWAPrompt` e montat global
 * (App.tsx), deci asta lovea inclusiv meniul QR al unui oaspete.
 * Aceeași semantică fail-open ca `readUpdateSnoozed` din PWAPrompt.tsx.
 */
function readInstallDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Hook to detect if the app can be installed as PWA.
 * Returns { canInstall, install, dismiss } where install() triggers
 * the native install prompt.
 */
export function usePWAInstall() {
  const [canInstall, setCanInstall] = useState(false)
  const [dismissed, setDismissed] = useState(readInstallDismissed)

  useEffect(() => {
    if (deferredPrompt && !dismissed) setCanInstall(true)

    const onInstallable = () => {
      if (!dismissed) setCanInstall(true)
    }
    const onInstalled = () => setCanInstall(false)

    window.addEventListener('pwa-installable', onInstallable)
    window.addEventListener('pwa-installed', onInstalled)
    return () => {
      window.removeEventListener('pwa-installable', onInstallable)
      window.removeEventListener('pwa-installed', onInstalled)
    }
  }, [dismissed])

  async function install() {
    if (!deferredPrompt) return false
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    deferredPrompt = null
    setCanInstall(false)
    return outcome === 'accepted'
  }

  function dismiss() {
    setDismissed(true)
    setCanInstall(false)
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, '1')
    } catch {
      /* Safari privat: fără persistență — starea locală ajunge pentru sesiunea curentă */
    }
  }

  return { canInstall, install, dismiss }
}

/**
 * Hook to detect when a new SW version is available.
 * Returns { updateAvailable, applyUpdate } — applyUpdate reloads with new SW.
 */
export function useSWUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return

      // Check for waiting worker right now
      if (reg.waiting) {
        setWaitingWorker(reg.waiting)
        setUpdateAvailable(true)
      }

      // Listen for new installations
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing
        if (!nw) return
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            setWaitingWorker(nw)
            setUpdateAvailable(true)
          }
        })
      })
    })

    // Detect controller change (after applyUpdate).
    // La PRIMA vizită pagina nu are controller: SW-ul se instalează, face
    // clients.claim() → `controllerchange` — fără gardă asta însemna un reload
    // complet la 1–5 s după primul paint pe meniul QR, cu coșul în memorie
    // pierdut (audit v3 FC-03). Prima preluare doar marchează pagina drept
    // controlată; DOAR o schimbare ULTERIOARĂ (update aplicat) reîncarcă.
    let controlled = navigator.serviceWorker.controller != null
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!controlled) {
        controlled = true
        return
      }
      if (refreshing) return
      refreshing = true
      window.location.reload()
    })

    return () => {
      /* no-op cleanup */
    }
  }, [])

  function applyUpdate() {
    if (!waitingWorker) return
    waitingWorker.postMessage({ type: 'SKIP_WAITING' })
  }

  return { updateAvailable, applyUpdate }
}
