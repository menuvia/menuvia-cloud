// ─────────────────────────────────────────────────────────────
// Reîmprospătarea meniului QR (mig 313) — piese PURE, testabile fără pagină.
//
// `createLatestGate`: refetch-ul meniului poate porni suprapus (revenirea în
// tab + eroarea `product_sold_out` la trimitere). Fiecare pornire ia un jeton;
// doar CEL MAI NOU jeton are voie să scrie starea — un răspuns mai vechi,
// sosit după unul mai nou, nu-l mai suprascrie. `invalidate()` anulează toate
// cererile în zbor (schimbarea token-ului QR = alt restaurant).
//
// `localizeProduct` / `freshActiveProduct`: foaia de produs deschisă primește
// rândul proaspăt (ca „Adaugă” să știe de epuizare), dar LOCALIZAT în limba
// curentă — rândul brut de la server e în română, iar foaia trecea înapoi
// în română la fiecare reîmprospătare.
// ─────────────────────────────────────────────────────────────
import { trName, trDesc } from './i18nMenu'
import type { Category, Product } from './qr'

export interface LatestGate {
  /** Pornește o cerere; funcția întoarsă spune dacă ea e încă cea mai nouă. */
  begin: () => () => boolean
  /** Toate cererile în zbor devin depășite. */
  invalidate: () => void
}

export function createLatestGate(): LatestGate {
  let seq = 0
  return {
    begin: () => {
      const mine = ++seq
      return () => mine === seq
    },
    invalidate: () => {
      seq++
    },
  }
}

/** Numele/descrierea în limba aleasă; pe `ro` aceeași referință. */
export function localizeProduct(p: Product, lang: string): Product {
  if (lang === 'ro') return p
  return { ...p, name: trName(p, lang), description: trDesc(p, lang) }
}

/**
 * Rândul proaspăt al produsului deschis, localizat; dacă produsul nu mai e în
 * meniu, rămâne cel deschis (foaia nu se închide de sub degetul oaspetelui).
 */
export function freshActiveProduct(prev: Product | null, cats: Category[], lang: string): Product | null {
  if (!prev) return prev
  for (const c of cats) {
    const fresh = c.products?.find((p) => p.id === prev.id)
    if (fresh) return localizeProduct(fresh, lang)
  }
  return prev
}
