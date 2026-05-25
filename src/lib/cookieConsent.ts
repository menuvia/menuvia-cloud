const STORAGE_KEY = 'menuvia_cookie_consent'

export type ConsentState = {
  necessary: true
  performance: boolean
  functional: boolean
  timestamp: number
}

export function getConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ConsentState
  } catch {
    return null
  }
}

export function hasConsent(category: keyof Omit<ConsentState, 'timestamp'>): boolean {
  const consent = getConsent()
  if (!consent) return false
  return !!consent[category]
}

export function saveConsent(state: ConsentState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  window.dispatchEvent(new CustomEvent('consent-updated', { detail: state }))
}
