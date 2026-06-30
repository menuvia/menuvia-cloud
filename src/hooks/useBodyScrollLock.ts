import { useEffect } from 'react'

// Blochează scroll-ul pe <body> cât timp un modal/sheet e deschis.
// global.css are deja `body[data-modal-open]{overflow:hidden}` — singura piesă
// lipsă era setarea atributului. Fără asta, pe mobil pagina din spate rămânea
// scrollabilă și sheet-urile păreau deplasate / cereau scroll.
//
// Ref-counted la nivel de modul: mai multe modale stivuite pot fi deschise
// simultan; atributul se curăță DOAR când toate s-au închis (contorul ajunge 0).
let lockCount = 0

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    lockCount += 1
    document.body.setAttribute('data-modal-open', 'true')
    return () => {
      lockCount = Math.max(0, lockCount - 1)
      if (lockCount === 0) {
        document.body.removeAttribute('data-modal-open')
      }
    }
  }, [active])
}

export default useBodyScrollLock
