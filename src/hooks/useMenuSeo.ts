// ─────────────────────────────────────────────────────────────
// useMenuSeo — SEO dinamic pentru meniul public /m/:slug
// ─────────────────────────────────────────────────────────────
// index.html are SEO STATIC (marketing Menuvia). Meniul public al unui
// restaurant e un SPA client-rendered, deci fără injecție runtime Google ar
// indexa titlul generic „Menuvia", nu „<Restaurant> — Meniu", și fără rich
// results. Googlebot execută JS și citește meta/JSON-LD injectate la runtime,
// deci setarea lor din client îmbunătățește real discovery-ul.
//
// Setează: document.title, meta description, Open Graph (+ og:locale și
// og:locale:alternate), Twitter card, canonical, `<link rel=alternate hreflang>`
// per limbă oferită și JSON-LD schema.org Restaurant + hasMenu — TOATE în limba
// AFIȘATĂ (lotul C8e; calculul e pur, în lib/menuSeo.ts). Restaurează la
// unmount (SPA: revenirea la marketing nu lasă meta stale).
//
// Rezidual consemnat: crawlerele de previzualizare (WhatsApp, Facebook) NU
// rulează JS, deci văd tot tag-urile statice din index.html — o injecție pe
// server (edge) ar fi un pas separat.
import { useEffect } from 'react'
import type { Restaurant, Category } from '../lib/qr'
import type { MenuCurrency } from '../lib/currency'
import { publicBaseUrl } from '../lib/domain'
import { buildMenuSeo } from '../lib/menuSeo'
import type { MenuSeo } from '../lib/menuSeo'

// Marcajul elementelor CREATE de hook (alternate hreflang, og:locale:alternate):
// sunt mai multe cu același `rel`/`property`, deci nu se pot regăsi după cheie.
const SEO_ATTR = 'data-menuvia-menu-seo'
const JSONLD_ID = 'menuvia-menu-jsonld'

function upsertMeta(attr: 'name' | 'property', key: string, content: string): boolean {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  const created = el == null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
  return created
}

function upsertLink(rel: string, href: string): { el: HTMLLinkElement; created: boolean } {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  const created = el == null
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
  return { el, created }
}

/** Aplică `seo` în <head>; întoarce funcția care reface starea de dinainte. */
function applyMenuSeo(seo: MenuSeo): () => void {
  const prevTitle = document.title
  document.title = seo.title

  // Meta-urile pe care le CREĂM (nu existau) le ștergem la cleanup; pe cele
  // existente (din index.html) doar le-am suprascris — le restaurăm din snapshot.
  const created: Array<{ attr: 'name' | 'property'; key: string }> = []
  const restore: Array<{ el: HTMLMetaElement; content: string }> = []
  const setMeta = (attr: 'name' | 'property', key: string, content: string) => {
    const existing = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
    if (existing) restore.push({ el: existing, content: existing.getAttribute('content') ?? '' })
    if (upsertMeta(attr, key, content)) created.push({ attr, key })
  }
  const url = seo.canonical ?? window.location.href
  setMeta('name', 'description', seo.description)
  setMeta('property', 'og:title', seo.title)
  setMeta('property', 'og:description', seo.description)
  setMeta('property', 'og:type', 'website')
  setMeta('property', 'og:url', url)
  setMeta('property', 'og:locale', seo.ogLocale)
  if (seo.image) setMeta('property', 'og:image', seo.image)
  setMeta('name', 'twitter:title', seo.title)
  setMeta('name', 'twitter:description', seo.description)
  if (seo.image) setMeta('name', 'twitter:image', seo.image)

  const canonical = seo.canonical ? upsertLink('canonical', seo.canonical) : null

  // Elementele multiple (o intrare per limbă): create de la zero, marcate.
  document.head.querySelectorAll(`[${SEO_ATTR}]`).forEach((el) => el.remove())
  for (const alt of seo.alternates) {
    const link = document.createElement('link')
    link.setAttribute('rel', 'alternate')
    link.setAttribute('hreflang', alt.hreflang)
    link.setAttribute('href', alt.href)
    link.setAttribute(SEO_ATTR, '')
    document.head.appendChild(link)
  }
  for (const loc of seo.ogLocaleAlternates) {
    const meta = document.createElement('meta')
    meta.setAttribute('property', 'og:locale:alternate')
    meta.setAttribute('content', loc)
    meta.setAttribute(SEO_ATTR, '')
    document.head.appendChild(meta)
  }

  // JSON-LD (rich results). Un singur nod, id-uit ca să-l putem înlocui/curăța.
  const script = document.createElement('script')
  script.type = 'application/ld+json'
  script.id = JSONLD_ID
  script.textContent = JSON.stringify(seo.jsonLd)
  document.head.querySelector(`#${JSONLD_ID}`)?.remove()
  document.head.appendChild(script)

  return () => {
    document.title = prevTitle
    for (const c of created) {
      document.head.querySelector(`meta[${c.attr}="${c.key}"]`)?.remove()
    }
    for (const r of restore) r.el.setAttribute('content', r.content)
    if (canonical?.created) canonical.el.remove()
    document.head.querySelectorAll(`[${SEO_ATTR}]`).forEach((el) => el.remove())
    document.getElementById(JSONLD_ID)?.remove()
  }
}

export function useMenuSeo(
  restaurant: Restaurant | null | undefined,
  /** Categoriile AFIȘATE (traduse în `lang`). */
  categories: Category[],
  currency: MenuCurrency,
  /** Limba afișată a meniului. */
  lang: string,
  /** Limbile oferite în plus față de bază (`availableMenuLangs`, memoizat). */
  availableLangs: readonly string[],
): void {
  useEffect(() => {
    if (!restaurant) return
    const seo = buildMenuSeo({
      restaurant,
      categories,
      currency,
      lang,
      availableLangs,
      baseUrl: publicBaseUrl(window.location.hostname, import.meta.env.VITE_APP_URL, window.location.origin),
    })
    return applyMenuSeo(seo)
  }, [restaurant, categories, currency, lang, availableLangs])
}
