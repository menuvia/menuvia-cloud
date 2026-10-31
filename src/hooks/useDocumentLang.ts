import { useEffect } from 'react'

// `<html lang>` urmează limba în care e afișată pagina oaspetelui (WCAG 3.1.1,
// audit oct 2026, a11y-guest-html-lang). index.html are `lang="ro"` fix, deci
// un meniu afișat în germană era citit de screen reader cu vocea și regulile de
// pronunție românești. Hook-ul setează limba cât e montată pagina și o REFACE
// la demontare (navigarea SPA înapoi pe landing / dashboard nu moștenește
// limba meniului). `null`/gol → nu atinge nimic (limba încă necunoscută).
export function useDocumentLang(lang: string | null | undefined): void {
  useEffect(() => {
    if (typeof document === 'undefined' || !lang) return
    const el = document.documentElement
    const prev = el.getAttribute('lang')
    el.setAttribute('lang', lang)
    return () => {
      if (prev == null) el.removeAttribute('lang')
      else el.setAttribute('lang', prev)
    }
  }, [lang])
}

export default useDocumentLang
