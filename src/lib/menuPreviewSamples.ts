// src/lib/menuPreviewSamples.ts — textele-mostră ale previzualizării meniului
// din Setări → Aspect (MenuPreview): numele de rezervă al localului, sloganul
// și cele trei produse, în fiecare dintre cele 7 limbi ale meniului
// (MENU_LANGS). Previzualizarea arată ce vede oaspetele implicit, deci limba e
// cea de BAZĂ a meniului (precondiția B6 a activării limbilor personalului).
// Româna e textul de dinainte; o limbă necunoscută cade pe română, ca
// `menuBaseLang`. Numele produselor rămân nume de feluri (Bruschette, Tiramisu).

export interface PreviewSample {
  name: string
  tagline: string
  products: readonly [string, string][]
}
const RO: PreviewSample = {
  name: 'Bistro Exemplu',
  tagline: 'Bucătărie de sezon',
  products: [
    ['Bruschette', 'Roșii coapte, busuioc, ulei de măsline extravirgin'],
    ['Risotto cu ciuperci', 'Orez carnaroli, ciuperci de pădure, parmezan'],
    ['Tiramisu', 'Mascarpone, cafea espresso, cacao'],
  ],
}
const SAMPLES: Readonly<Record<string, PreviewSample>> = {
  ro: RO,
  en: {
    name: 'Sample Bistro',
    tagline: 'Seasonal cooking',
    products: [
      ['Bruschette', 'Roasted tomatoes, basil, extra virgin olive oil'],
      ['Mushroom risotto', 'Carnaroli rice, wild mushrooms, parmesan'],
      ['Tiramisu', 'Mascarpone, espresso, cocoa'],
    ],
  },
  de: {
    name: 'Beispiel-Bistro',
    tagline: 'Saisonale Küche',
    products: [
      ['Bruschette', 'Geröstete Tomaten, Basilikum, natives Olivenöl extra'],
      ['Pilzrisotto', 'Carnaroli-Reis, Waldpilze, Parmesan'],
      ['Tiramisu', 'Mascarpone, Espresso, Kakao'],
    ],
  },
  fr: {
    name: 'Bistro Exemple',
    tagline: 'Cuisine de saison',
    products: [
      ['Bruschette', 'Tomates rôties, basilic, huile d’olive vierge extra'],
      ['Risotto aux champignons', 'Riz carnaroli, champignons des bois, parmesan'],
      ['Tiramisu', 'Mascarpone, café expresso, cacao'],
    ],
  },
  it: {
    name: 'Bistrò Esempio',
    tagline: 'Cucina di stagione',
    products: [
      ['Bruschette', 'Pomodori arrostiti, basilico, olio extravergine d’oliva'],
      ['Risotto ai funghi', 'Riso carnaroli, funghi di bosco, parmigiano'],
      ['Tiramisù', 'Mascarpone, caffè espresso, cacao'],
    ],
  },
  hu: {
    name: 'Minta Bisztró',
    tagline: 'Szezonális konyha',
    products: [
      ['Bruschette', 'Sült paradicsom, bazsalikom, extra szűz olívaolaj'],
      ['Gombás rizottó', 'Carnaroli rizs, erdei gomba, parmezán'],
      ['Tiramisu', 'Mascarpone, eszpresszó, kakaó'],
    ],
  },
  es: {
    name: 'Bistró Ejemplo',
    tagline: 'Cocina de temporada',
    products: [
      ['Bruschette', 'Tomates asados, albahaca, aceite de oliva virgen extra'],
      ['Risotto de setas', 'Arroz carnaroli, setas silvestres, parmesano'],
      ['Tiramisú', 'Mascarpone, café espresso, cacao'],
    ],
  },
}

export function previewSample(lang: string): PreviewSample {
  return SAMPLES[lang] ?? RO
}

