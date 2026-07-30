// ─────────────────────────────────────────────────────────────
// useMenuSeo — SEO dinamic pentru meniul public /m/:slug
// ─────────────────────────────────────────────────────────────
// index.html are SEO STATIC (marketing Menuvia). Meniul public al unui
// restaurant e un SPA client-rendered, deci fără injecție runtime Google ar
// indexa titlul generic „Menuvia", nu „<Restaurant> — Meniu", și fără rich
// results. Googlebot execută JS și citește meta/JSON-LD injectate la runtime,
// deci setarea lor din client îmbunătățește real discovery-ul.
//
// Setează: document.title, meta description, Open Graph, Twitter card, canonical,
// și JSON-LD schema.org Restaurant + hasMenu (rich results). Restaurează la
// unmount (SPA: revenirea la marketing nu lasă meta stale).
import { useEffect } from 'react'
import type { Restaurant, Category } from '../lib/qr'
import type { MenuCurrency } from '../lib/currency'

// Upsert un <meta> după (attr, key): îl găsește sau îl creează, îi setează
// content. Întoarce true dacă l-a CREAT (ca să-l putem șterge la cleanup).
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

function trimTo(s: string | null | undefined, max: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

// JSON-LD schema.org: Restaurant + hasMenu (secțiuni + iteme cu preț).
function buildJsonLd(restaurant: Restaurant, categories: Category[], currency: MenuCurrency): object {
  const sections = categories
    .filter((c) => (c.products?.length ?? 0) > 0)
    .map((c) => ({
      '@type': 'MenuSection',
      name: c.name,
      hasMenuItem: c.products.map((p) => ({
        '@type': 'MenuItem',
        name: p.name,
        ...(p.description ? { description: trimTo(p.description, 300) } : {}),
        offers: {
          '@type': 'Offer',
          price: Number(p.price).toFixed(2),
          priceCurrency: currency,
        },
      })),
    }))

  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: restaurant.name,
    ...(restaurant.tagline || restaurant.description
      ? { description: trimTo(restaurant.tagline || restaurant.description, 300) }
      : {}),
    ...(restaurant.cover_url || restaurant.logo_url
      ? { image: restaurant.cover_url || restaurant.logo_url }
      : {}),
    ...(restaurant.address ? { address: restaurant.address } : {}),
    ...(restaurant.phone ? { telephone: restaurant.phone } : {}),
    ...(restaurant.slug
      ? { url: `${window.location.origin}/m/${restaurant.slug}` }
      : {}),
    ...(sections.length > 0
      ? { hasMenu: { '@type': 'Menu', hasMenuSection: sections } }
      : {}),
  }
}

const JSONLD_ID = 'menuvia-menu-jsonld'

export function useMenuSeo(
  restaurant: Restaurant | null | undefined,
  categories: Category[],
  currency: MenuCurrency,
): void {
  useEffect(() => {
    if (!restaurant) return
    const prevTitle = document.title

    const title = `${restaurant.name} — Meniu`
    const desc =
      trimTo(restaurant.tagline || restaurant.description, 160) ||
      `Meniul lui ${restaurant.name}${restaurant.address ? `, ${restaurant.address}` : ''}. Vezi preparatele și prețurile.`
    const image = restaurant.cover_url || restaurant.logo_url || ''
    const url = restaurant.slug ? `${window.location.origin}/m/${restaurant.slug}` : window.location.href

    document.title = title

    // Meta-urile pe care le CREĂM (nu existau) le ștergem la cleanup; pe cele
    // existente (din index.html) doar le-am suprascris — le restaurăm din snapshot.
    const created: Array<{ attr: 'name' | 'property'; key: string }> = []
    const restore: Array<{ el: HTMLMetaElement; content: string }> = []
    const setMeta = (attr: 'name' | 'property', key: string, content: string) => {
      const existing = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
      if (existing) restore.push({ el: existing, content: existing.getAttribute('content') ?? '' })
      const wasCreated = upsertMeta(attr, key, content)
      if (wasCreated) created.push({ attr, key })
    }

    setMeta('name', 'description', desc)
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:description', desc)
    setMeta('property', 'og:type', 'website')
    setMeta('property', 'og:url', url)
    if (image) setMeta('property', 'og:image', image)
    setMeta('name', 'twitter:title', title)
    setMeta('name', 'twitter:description', desc)
    if (image) setMeta('name', 'twitter:image', image)

    const canonical = upsertLink('canonical', url)

    // JSON-LD (rich results). Un singur nod, id-uit ca să-l putem înlocui/curăța.
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.id = JSONLD_ID
    script.textContent = JSON.stringify(buildJsonLd(restaurant, categories, currency))
    document.head.querySelector(`#${JSONLD_ID}`)?.remove()
    document.head.appendChild(script)

    return () => {
      document.title = prevTitle
      // Ștergem ce am creat, restaurăm ce am suprascris.
      for (const c of created) {
        document.head.querySelector(`meta[${c.attr}="${c.key}"]`)?.remove()
      }
      for (const r of restore) r.el.setAttribute('content', r.content)
      if (canonical.created) canonical.el.remove()
      document.getElementById(JSONLD_ID)?.remove()
    }
  }, [restaurant, categories, currency])
}
