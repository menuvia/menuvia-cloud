// src/i18n/useChromeLang.ts — limba cromului comun (chrome.ts) urmează
// `<html lang>` în timp real. Paginile oaspetelui schimbă atributul când
// oaspetele schimbă limba meniului (useDocumentLang), deci bannerul de cookies
// deja deschis trebuie să se re-randeze, nu să rămână în limba de la montare.
// Un singur MutationObserver pentru toți abonații.
import { useSyncExternalStore } from 'react'
import { chromeFallbackLang, chromeLangOf, documentChromeLang, type ChromeLang } from './chrome'

const listeners = new Set<() => void>()
let observer: MutationObserver | null = null

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  if (!observer && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    observer = new MutationObserver(() => {
      for (const l of listeners) l()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0 && observer) {
      observer.disconnect()
      observer = null
    }
  }
}

export function useChromeLang(): ChromeLang {
  return useSyncExternalStore(subscribe, documentChromeLang, () => 'ro' as ChromeLang)
}

function documentLangAttr(): string {
  if (typeof document === 'undefined') return ''
  return document.documentElement.getAttribute('lang') ?? ''
}

/**
 * Limba cromului plus limba de declarat pe etichetele lui când diferă de a
 * paginii (`fallback`, vezi chromeFallbackLang). Pentru componentele care
 * amestecă text al paginii (titlul unui Confirm, mesajul unui Toast) cu
 * etichete ale cromului: doar etichetele primesc `lang`.
 */
export function useChrome(): { lang: ChromeLang; fallback: ChromeLang | undefined; pageLang: string } {
  const pageLang = useSyncExternalStore(subscribe, documentLangAttr, () => '')
  const lang = chromeLangOf(pageLang)
  return { lang, fallback: chromeFallbackLang(pageLang, lang), pageLang }
}
