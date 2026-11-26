// ─────────────────────────────────────────────────────────────
// menuSeo — ce află Google și previzualizările despre meniul public /m/:slug,
// calculat PUR (lotul C8e). `useMenuSeo` doar aplică rezultatul în <head>.
//
// Înainte: titlul și descrierea erau fixe în română („— Meniu”, „Meniul lui …”)
// și pe un meniu cu altă limbă de bază sau afișat în engleză; canonicul era
// mereu `/m/slug`, fără `hreflang`, `og:locale` rămânea `ro_RO` din index.html,
// iar JSON-LD-ul se construia din categoriile NETRADUSE, fără `inLanguage`. Un
// meniu tradus avea deci o singură adresă indexabilă, în limba greșită.
//
// Regula adreselor (aceeași în sitemap.js):
//   • limba de BAZĂ   → `<bază>/m/<slug>`            (și `x-default`)
//   • altă limbă      → `<bază>/m/<slug>?lang=<cod>`
// Adresele sunt ABSOLUTE pe `publicBaseUrl` (lib/domain.ts) — baza linkurilor
// publice tipărite —, nu pe `window.location.origin` (un deploy preview sau un
// host .com și-ar fi declarat propria origine drept canonică).
// ─────────────────────────────────────────────────────────────
import type { Restaurant, Category } from './qr'
import type { MenuCurrency } from './currency'
import { Tf, guestLocale } from './guestI18n'
import { MENU_LANGS, menuBaseLang } from './i18nMenu'

export interface MenuSeoAlternate {
  /** Cod de limbă (`ro`, `en`, …) sau `x-default`. */
  hreflang: string
  href: string
}

export interface MenuSeo {
  /** Limba descrisă — cea afișată, dacă meniul chiar o oferă; altfel baza. */
  lang: string
  title: string
  description: string
  /** Coperta sau logo-ul (og:image / twitter:image); `''` fără imagine. */
  image: string
  /** `null` fără slug (nicio adresă publică stabilă de declarat). */
  canonical: string | null
  /** Un `<link rel=alternate hreflang>` per limbă oferită + `x-default`; gol
   *  când meniul are o singură limbă (adnotarea n-ar spune nimic). */
  alternates: MenuSeoAlternate[]
  ogLocale: string
  ogLocaleAlternates: string[]
  jsonLd: Record<string, unknown>
}

function trimTo(s: string | null | undefined, max: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

/** `ro` → `ro_RO`, `en` → `en_GB` (forma Open Graph), pe tabela `guestLocale`. */
export function ogLocaleOf(lang: string): string {
  return guestLocale(lang).replace('-', '_')
}

/** Adresa meniului într-o limbă: baza fără parametru, restul cu `?lang=`. */
export function menuLangUrl(baseUrl: string, slug: string, lang: string, baseLang: string): string {
  const root = `${baseUrl.replace(/\/+$/, '')}/m/${slug}`
  return lang === baseLang ? root : `${root}?lang=${lang}`
}

/** Limbile meniului (baza prima, apoi cele oferite, în ordinea MENU_LANGS). */
function menuLangs(baseLang: string, availableLangs: readonly string[]): string[] {
  const extra = MENU_LANGS.map((l) => l.code).filter((c) => c !== baseLang && availableLangs.includes(c))
  return [baseLang, ...extra]
}

function buildJsonLd(
  restaurant: Restaurant,
  categories: readonly Category[],
  currency: MenuCurrency,
  lang: string,
  isBase: boolean,
  canonical: string | null,
  reservationUrl: string | null,
): Record<string, unknown> {
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
  // Sloganul și descrierea localului NU au traduceri: în altă limbă decât baza
  // ar fi text în limba greșită sub `inLanguage` — se omit.
  const about = isBase ? trimTo(restaurant.tagline || restaurant.description, 300) : ''
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: restaurant.name,
    ...(about ? { description: about } : {}),
    ...(restaurant.cover_url || restaurant.logo_url
      ? { image: restaurant.cover_url || restaurant.logo_url }
      : {}),
    ...(restaurant.address ? { address: restaurant.address } : {}),
    ...(restaurant.phone ? { telephone: restaurant.phone } : {}),
    ...(canonical ? { url: canonical } : {}),
    // Semnalul de rezervare pentru Google: pagina publică /rezervare/:slug, în
    // limba meniului (pagina citește `?lang=`, lotul C8e). Dacă modulul e OFF,
    // pagina răspunde curat — semnalul rămâne inofensiv.
    ...(reservationUrl ? { acceptsReservations: reservationUrl } : {}),
    ...(sections.length > 0
      ? {
          hasMenu: {
            '@type': 'Menu',
            // `inLanguage` stă pe Menu (CreativeWork), nu pe Restaurant, unde
            // schema.org nu-l definește.
            inLanguage: lang,
            hasMenuSection: sections,
          },
        }
      : {}),
  }
}

export function buildMenuSeo(input: {
  restaurant: Restaurant
  /** Categoriile AFIȘATE (deja traduse în `lang`). */
  categories: readonly Category[]
  currency: MenuCurrency
  /** Limba afișată a meniului. */
  lang: string
  /** Limbile oferite în plus față de bază (`availableMenuLangs`). */
  availableLangs: readonly string[]
  /** Baza adreselor publice (`publicBaseUrl`). */
  baseUrl: string
}): MenuSeo {
  const { restaurant, categories, currency, availableLangs, baseUrl } = input
  const baseLang = menuBaseLang(restaurant.language)
  const langs = menuLangs(baseLang, availableLangs)
  // O limbă pe care meniul n-o oferă nu primește adresă proprie: conținutul e
  // al bazei (pagina revine oricum pe bază), deci și SEO-ul.
  const lang = langs.includes(input.lang) ? input.lang : baseLang
  const isBase = lang === baseLang
  const slug = restaurant.slug ?? ''
  const root = baseUrl.replace(/\/+$/, '')
  const canonical = slug ? menuLangUrl(root, slug, lang, baseLang) : null
  const multi = slug !== '' && langs.length > 1
  const alternates: MenuSeoAlternate[] = multi
    ? [
        ...langs.map((code) => ({ hreflang: code, href: menuLangUrl(root, slug, code, baseLang) })),
        { hreflang: 'x-default', href: menuLangUrl(root, slug, baseLang, baseLang) },
      ]
    : []
  const reservationUrl = slug ? `${root}/rezervare/${slug}${isBase ? '' : `?lang=${lang}`}` : null

  const own = isBase ? trimTo(restaurant.tagline || restaurant.description, 160) : ''
  const description =
    own ||
    trimTo(
      restaurant.address
        ? Tf(lang, 'seo_menu_desc_addr', { name: restaurant.name, address: restaurant.address })
        : Tf(lang, 'seo_menu_desc', { name: restaurant.name }),
      160,
    )

  return {
    lang,
    title: Tf(lang, 'seo_menu_title', { name: restaurant.name }),
    description,
    image: restaurant.cover_url || restaurant.logo_url || '',
    canonical,
    alternates,
    ogLocale: ogLocaleOf(lang),
    ogLocaleAlternates: langs.length > 1 ? langs.filter((c) => c !== lang).map(ogLocaleOf) : [],
    jsonLd: buildJsonLd(restaurant, categories, currency, lang, isBase, canonical, reservationUrl),
  }
}
