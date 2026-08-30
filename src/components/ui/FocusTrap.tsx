// src/components/ui/FocusTrap.tsx
// Capcană de focus pentru dialogurile aria-modal (audit a11y aug 2026):
// fără ea, Tab-ul dintr-un sheet/dialog pleca în pagina de sub backdrop —
// utilizatorii de tastatură/screen reader „cădeau" din modal.
//
// Comportament: Tab/Shift+Tab ciclează DOAR prin elementele focusabile ale
// dialogului; focusul inițial intră pe container (nu pe primul input — ar
// deschide tastatura pe mobil; autoFocus-ul existent, ex. ConfirmDialog, are
// prioritate); la închidere focusul se ÎNTOARCE la elementul care a deschis
// dialogul. Stivuire (sheet peste sheet): doar vârful stivei impune capcana.
//
// Folosire: `<FocusTrap />` ca prim copil al elementului cu role="dialog" —
// se auto-atașează prin closest(), fără ref-uri de cablat în fiecare dialog
// (precedentul PairingPopupScrollLock din QrMenuPage: componentă-copil montată
// doar cât timp dialogul există).

import { useEffect, useRef, useState } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Stiva modalelor active — ca lockCount din useBodyScrollLock, dar cu
// identitate: la dialoguri suprapuse, doar ULTIMUL deschis capturează Tab-ul.
const trapStack: HTMLElement[] = []

function focusables(container: HTMLElement): HTMLElement[] {
  const all = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
  // getClientRects, nu offsetParent: sheet-urile sunt position:fixed, iar
  // offsetParent e null pe ele — ar goli lista degeaba.
  const visible = all.filter((el) => el.getClientRects().length > 0)
  // jsdom (vitest) nu are layout → getClientRects e gol pe ORICE element;
  // fallback-ul pe lista nefiltrată ține capcana funcțională și acolo.
  return visible.length > 0 ? visible : all
}

export function FocusTrap() {
  const markerRef = useRef<HTMLSpanElement>(null)
  const [container, setContainer] = useState<HTMLElement | null>(null)

  // Pas 1: markerul (span invizibil) își găsește dialogul-gazdă în DOM.
  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return
    setContainer((marker.closest('[role="dialog"]') as HTMLElement | null) ?? marker.parentElement)
  }, [])

  // Pas 2: capcana propriu-zisă, legată de viața containerului.
  useEffect(() => {
    if (!container) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    trapStack.push(container)

    if (!container.contains(document.activeElement)) {
      if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1')
      container.focus({ preventScroll: true })
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (trapStack[trapStack.length - 1] !== container) return
      const list = focusables(container)
      if (list.length === 0) {
        e.preventDefault()
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && container.contains(active)
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (!inside || active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    // Capture pe document: prinde Tab-ul chiar dacă focusul a scăpat deja
    // în afara dialogului (ex. click pe backdrop care nu închide).
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      const idx = trapStack.lastIndexOf(container)
      if (idx >= 0) trapStack.splice(idx, 1)
      // Focusul se întoarce la deschizător (dacă mai există în DOM) — pentru
      // dialoguri stivuite, „deschizătorul" e un element din dialogul de sub.
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [container])

  return <span ref={markerRef} hidden />
}

export default FocusTrap
