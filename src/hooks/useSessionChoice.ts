// src/hooks/useSessionChoice.ts — o alegere de ecran (perioada unui raport)
// care supraviețuiește DEMONTĂRII filei, cât ține sesiunea de navigare (lotul
// C6a). Filele mari din panou sunt leneșe și se montează condiționat, deci la
// fiecare întoarcere pe Vânzări/Statistici starea locală pornea iar de la
// „Azi”/„30 de zile”, iar un interval personalizat se pierdea. Pattern-ul
// leneș rămâne; doar alegerea stă în `sessionStorage`.
// Stocarea poate ARUNCA la orice acces (Safari cu cookie-urile blocate,
// RESID-15), deci citirea și scrierea sunt în try/catch, fail-open: fără
// stocare, ecranul pornește de la implicit, ca înainte. Valoarea citită e
// VALIDATĂ (`parse`): o cheie veche sau stricată dă implicitul, nu o stare
// imposibilă în ecran.
import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

/** Valoarea salvată sub `key`, trecută prin `parse`; lipsă, JSON invalid,
 *  stocare inaccesibilă sau `parse` → null dau null. */
export function readSessionChoice<T>(key: string, parse: (raw: unknown) => T | null): T | null {
  try {
    const stored = window.sessionStorage.getItem(key)
    if (stored == null) return null
    return parse(JSON.parse(stored))
  } catch {
    return null
  }
}

/** Scrie alegerea; o stocare care aruncă se ignoră (fail-open). */
export function writeSessionChoice(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* stocare indisponibilă — alegerea rămâne doar în memorie */
  }
}

/** `useState` a cărui valoare se restaurează la montare din `sessionStorage`
 *  (validată de `parse`, altfel `fallback()`) și se salvează la fiecare
 *  schimbare. O cheie per ecran. */
export function useSessionChoice<T>(
  key: string,
  fallback: () => T,
  parse: (raw: unknown) => T | null,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readSessionChoice(key, parse) ?? fallback())
  useEffect(() => {
    writeSessionChoice(key, value)
  }, [key, value])
  return [value, setValue]
}
