// src/i18n/useChromeLang.ts — limba cromului comun (chrome.ts) urmează
// `<html lang>` în timp real. Paginile oaspetelui schimbă atributul când
// oaspetele schimbă limba meniului (useDocumentLang), deci bannerul de cookies
// deja deschis trebuie să se re-randeze, nu să rămână în limba de la montare.
// Un singur MutationObserver pentru toți abonații.
import { useSyncExternalStore } from 'react'
import { documentChromeLang, type ChromeLang } from './chrome'

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
