// src/lib/i18n.ts
// ─────────────────────────────────────────────────────────────────
// i18n minimal — RO/EN fără biblioteci externe.
//
// Folosire în componente:
//   import { t, useLanguage } from '../lib/i18n'
//   const { lang, setLang } = useLanguage()
//   return <div>{t('paid.title', lang)}</div>
//
// Persistență: localStorage. Default: 'ro'.
// ─────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'

export type Lang = 'ro' | 'en'

const STORAGE_KEY = 'menuvia_lang'

const STRINGS = {
  // Plată confirmată screen
  'paid.title': { ro: 'Plată confirmată!', en: 'Payment confirmed!' },
  'paid.subtitle': {
    ro: 'Personalul restaurantului știe deja că masa a fost plătită.\nÎți mulțumim pentru vizită!',
    en: 'The restaurant staff already knows your table has been paid.\nThank you for your visit!',
  },
  'paid.subtotal': { ro: 'Subtotal', en: 'Subtotal' },
  'paid.tips': { ro: 'Bacșiș', en: 'Tip' },
  'paid.fastPayFee': { ro: 'Comision plată rapidă', en: 'Fast pay fee' },
  'paid.total': { ro: 'Total', en: 'Total' },
  'paid.needFiscalReceipt': { ro: 'Am nevoie de bonul fiscal', en: 'I need the fiscal receipt' },
  'paid.fiscalRequested': { ro: 'Bonul fiscal a fost cerut', en: 'Fiscal receipt requested' },

  // Feedback widget
  'feedback.title': { ro: 'Opinia ta contează', en: 'Your opinion matters' },
  'feedback.thanks': { ro: 'Îți mulțumim pentru feedback', en: 'Thank you for your feedback' },
  'feedback.askPayment': {
    ro: 'Cum a fost experiența de plată?',
    en: 'How was the payment experience?',
  },
  'feedback.askService': { ro: 'Cum a fost servirea?', en: 'How was the service?' },
  'feedback.askFood': { ro: 'Cum a fost mâncarea?', en: 'How was the food?' },
  'feedback.negative': {
    ro: 'Ne pare rău. Ce putem îmbunătăți?',
    en: 'We are sorry. What can we improve?',
  },
  'feedback.negativePlaceholder': { ro: 'Scrie-ne aici...', en: 'Write to us here...' },
  'feedback.send': { ro: 'Trimite', en: 'Send' },
  'feedback.googleCTAText': {
    ro: 'Spune-le și altora despre experiența ta la',
    en: 'Tell others about your experience at',
  },
  'feedback.googleCTAButton': { ro: 'Scrie o recenzie pe Google', en: 'Write a Google review' },

  // QR menu page
  'menu.callWaiter': { ro: '👋 Cheamă ospătarul', en: '👋 Call waiter' },
  'menu.waiterCalled': { ro: '✓ Ospătar chemat', en: '✓ Waiter called' },
  'menu.calling': { ro: 'Se cheamă...', en: 'Calling...' },
  'menu.orderNow': { ro: 'Comandă acum', en: 'Order now' },
  'menu.viewCart': { ro: 'Vezi coșul', en: 'View cart' },
  'menu.empty': { ro: 'Coș gol', en: 'Empty cart' },

  // Order tracker
  'tracker.orderNumber': { ro: 'Comanda #', en: 'Order #' },
  'tracker.step.new': { ro: 'Trimisă', en: 'Sent' },
  'tracker.step.confirmed': { ro: 'Confirmată', en: 'Confirmed' },
  'tracker.step.preparing': { ro: 'În preparare', en: 'Preparing' },
  'tracker.step.ready': { ro: 'Gata de servit', en: 'Ready to serve' },
  'tracker.step.served': { ro: 'Servită', en: 'Served' },
  'tracker.cancelled': { ro: 'Comanda a fost anulată', en: 'Order cancelled' },
  'tracker.addMore': { ro: '+ Adaugă produse', en: '+ Add more' },
  'tracker.close': { ro: 'Închide sesiunea', en: 'Close session' },
  'tracker.newOrder': { ro: 'Comandă nouă', en: 'New order' },
  'tracker.now': { ro: 'Acum', en: 'Now' },

  // Generic
  'common.lei': { ro: 'lei', en: 'lei' },
  'common.poweredBy': { ro: 'Powered by', en: 'Powered by' },
} as const

export type StringKey = keyof typeof STRINGS

/**
 * Obține string-ul tradus pentru cheia + limba dată.
 * Fallback: dacă limba nu e RO/EN, returnează cheia.
 */
export function t(key: StringKey, lang: Lang = 'ro'): string {
  const entry = STRINGS[key]
  if (!entry) return String(key)
  return entry[lang] ?? entry.ro ?? String(key)
}

/**
 * Detectează limba inițială:
 * 1. localStorage menuvia_lang
 * 2. URL ?lang=
 * 3. navigator.language
 * 4. fallback 'ro'
 */
export function detectInitialLang(): Lang {
  if (typeof window === 'undefined') return 'ro'

  try {
    // Din URL
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('lang')
    if (fromUrl === 'ro' || fromUrl === 'en') return fromUrl

    // Din localStorage
    const fromStorage = localStorage.getItem(STORAGE_KEY)
    if (fromStorage === 'ro' || fromStorage === 'en') return fromStorage

    // Din browser
    const navLang = navigator.language?.toLowerCase().split('-')[0]
    if (navLang === 'en') return 'en'
  } catch {
    /* silent */
  }

  return 'ro'
}

/**
 * Hook pentru folosire în componente. Reactiv la schimbarea limbii.
 */
export function useLanguage(): { lang: Lang; setLang: (l: Lang) => void } {
  const [lang, setLangState] = useState<Lang>(() => detectInitialLang())

  // Sync cross-tab + cross-component
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && (e.newValue === 'ro' || e.newValue === 'en')) {
        setLangState(e.newValue)
      }
    }
    function onLangChange(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail === 'ro' || detail === 'en') setLangState(detail)
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('menuvia-lang-changed', onLangChange)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('menuvia-lang-changed', onLangChange)
    }
  }, [])

  function setLang(newLang: Lang) {
    try {
      localStorage.setItem(STORAGE_KEY, newLang)
    } catch {
      /* silent */
    }
    setLangState(newLang)
    window.dispatchEvent(new CustomEvent('menuvia-lang-changed', { detail: newLang }))
    // Actualizez <html lang="...">
    if (typeof document !== 'undefined') {
      document.documentElement.lang = newLang
    }
  }

  return { lang, setLang }
}
