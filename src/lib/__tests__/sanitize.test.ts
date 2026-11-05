// Test pentru sanitize-ul payload-ului de UPDATE pe `restaurants`.
//
// Acoperă obligația post-096B (PR 1B): `slug` este OMIS din whitelist —
// schimbarea slug-ului trece exclusiv prin RPC-ul `change_restaurant_slug`.
// Dacă cineva re-adaugă `slug` în `RESTAURANT_UPDATE_FIELDS`, testul ăsta
// pică imediat și prinde regresia înainte ca PostgREST să returneze 42501.
//
// La fel `floor_layout` (mig 322): harta se scrie DOAR prin `save_floor_layout`,
// iar salvarea din Setări (rândul întreg, încărcat la montare) o rescria cu
// copia VECHE.
//   FL1  whitelist-ul NU conține floor_layout (mutația care pică: 'floor_layout'
//        readus în RESTAURANT_UPDATE_FIELDS — pică și lista exactă de 24).
//   FL2  un payload vechi din Setări pierde harta, dar păstrează restul
//        (wifi_password = controlul pozitiv din același apel; aceeași mutație).

import { describe, it, expect } from 'vitest'
import type { Product, Restaurant } from '../../hooks/useData'
import {
  PRODUCT_INSERT_FIELDS,
  PRODUCT_UPDATE_FIELDS,
  RESTAURANT_UPDATE_FIELDS,
  pickAllowed,
} from '../sanitize'

describe('RESTAURANT_UPDATE_FIELDS', () => {
  it('does NOT contain slug (handled by change_restaurant_slug RPC after PR 1B)', () => {
    expect((RESTAURANT_UPDATE_FIELDS as readonly string[]).includes('slug')).toBe(false)
  })

  it('FL1: does NOT contain floor_layout (written only by save_floor_layout RPC, mig 322)', () => {
    expect((RESTAURANT_UPDATE_FIELDS as readonly string[]).includes('floor_layout')).toBe(false)
  })

  it('does NOT contain ownership / billing / entitlement fields', () => {
    const forbidden = ['id', 'owner_id', 'created_at', 'updated_at', 'qr_token', 'is_active']
    for (const f of forbidden) {
      expect((RESTAURANT_UPDATE_FIELDS as readonly string[]).includes(f)).toBe(false)
    }
  })

  it('contains exactly the 24 columns granted UPDATE (mig 096B + menu_languages mig 197 + currency mig 205 + country mig 296 + language mig 298 − floor_layout mig 322)', () => {
    expect(RESTAURANT_UPDATE_FIELDS.length).toBe(24)
    expect([...RESTAURANT_UPDATE_FIELDS].sort()).toEqual(
      [
        'name',
        'tagline',
        'city',
        'description',
        'address',
        'phone',
        'hours',
        'hours_structured',
        'timezone',
        'wifi_password',
        'primary_color',
        'logo_url',
        'cover_url',
        // `floor_layout` scos în mig 322 (doar prin save_floor_layout).
        'socials',
        'amenities',
        'checkout_suggestion_settings',
        'theme_settings',
        'pickup_settings',
        'google_place_id',
        'google_review_url',
        // mig 197 — meniu multilingv: grant update (menu_languages) pe restaurants.
        'currency',
        'menu_languages',
        // mig 296 — țara restaurantului (owner-only, trg_restaurants_country_owner_only).
        'country',
        // mig 298 — limba de bază a meniului (CHECK pe cele 7 limbi).
        'language',
      ].sort(),
    )
  })
})

describe('pickAllowed', () => {
  it('strips slug from a payload that includes it (post-096B guarantee)', () => {
    // Anotăm explicit ca `Partial<Restaurant>` ca TypeScript să nu îngusteze
    // generic-ul T la literal-ul anonim (altfel `RESTAURANT_UPDATE_FIELDS`
    // ar conține mai multe chei decât `T` și inferența ar respinge apelul).
    const dirty: Partial<Restaurant> = {
      name: 'X',
      slug: 'attacker-owned',
      primary_color: '#000',
    }
    const safe = pickAllowed(dirty, RESTAURANT_UPDATE_FIELDS)
    expect(safe).toEqual({ name: 'X', primary_color: '#000' })
    expect((safe as Record<string, unknown>).slug).toBeUndefined()
  })

  it('FL2: strips floor_layout from a stale Settings payload, keeps the rest', () => {
    const staleSettings: Partial<Restaurant> = {
      name: 'X',
      wifi_password: 'w',
      floor_layout: { floors: [] },
    }
    const safe = pickAllowed(staleSettings, RESTAURANT_UPDATE_FIELDS)
    expect(safe).toEqual({ name: 'X', wifi_password: 'w' })
    expect(Object.prototype.hasOwnProperty.call(safe, 'floor_layout')).toBe(false)
  })

  it('strips owner_id even if injected in the payload', () => {
    const dirty: Partial<Restaurant> = {
      name: 'X',
      owner_id: '00000000-0000-0000-0000-aaaaaaaaaaaa',
    }
    const safe = pickAllowed(dirty, RESTAURANT_UPDATE_FIELDS)
    expect(safe).toEqual({ name: 'X' })
  })

  it('keeps only allowed keys present in the input', () => {
    // Pentru cazul cu cheie sintetică nedeclarată în Restaurant, castăm la
    // `unknown` apoi la `Partial<Restaurant>` ca să oglindim ce poate ajunge
    // în production prin payload-uri rău-intenționate trecute de tipuri.
    const dirty = {
      name: 'X',
      tagline: 'Y',
      address: 'Str. Test 1',
      attacker_field: 'ignored',
    } as unknown as Partial<Restaurant>
    const safe = pickAllowed(dirty, RESTAURANT_UPDATE_FIELDS)
    expect(safe).toEqual({ name: 'X', tagline: 'Y', address: 'Str. Test 1' })
  })

  it('returns an empty object when no allowed keys are present', () => {
    const dirty = { attacker_field: 'x' } as unknown as Partial<Restaurant>
    expect(pickAllowed(dirty, RESTAURANT_UPDATE_FIELDS)).toEqual({})
  })

  it('preserves explicit null values for allowed keys (not skipped)', () => {
    const dirty: Partial<Restaurant> = { name: 'X', tagline: null }
    const safe = pickAllowed(dirty, RESTAURANT_UPDATE_FIELDS)
    expect(safe).toEqual({ name: 'X', tagline: null })
  })
})

// mig 313: „Epuizat” se schimbă DOAR prin comutator / RPC. Formularul de produs
// pornește din lista încărcată la deschidere; dacă stocul a epuizat produsul
// între timp, PATCH-ul unei simple editări de descriere trimitea
// `is_sold_out:false`, iar baza îl consemna ca deblocare MANUALĂ.
//   PU1  editarea altui câmp nu trimite is_sold_out (mutația care pică:
//        'is_sold_out' readus în PRODUCT_UPDATE_FIELDS).
//   PU2  la CREARE starea inițială aleasă în formular e permisă.
describe('PRODUCT_UPDATE_FIELDS — „Epuizat” nu pleacă în PATCH-ul formularului', () => {
  it('PU1 editarea descrierii nu trimite is_sold_out (date vechi din listă)', () => {
    const staleForm: Partial<Product> = {
      name: 'Supă',
      description: 'Descriere nouă',
      price: 15,
      is_sold_out: false,
    }
    const payload = pickAllowed(staleForm, PRODUCT_UPDATE_FIELDS)
    expect(Object.prototype.hasOwnProperty.call(payload, 'is_sold_out')).toBe(false)
    expect(payload).toEqual({ name: 'Supă', description: 'Descriere nouă', price: 15 })
    expect((PRODUCT_UPDATE_FIELDS as readonly string[]).includes('is_sold_out')).toBe(false)
  })

  it('PU2 la creare starea inițială „Epuizat” trece; restul câmpurilor sunt aceleași', () => {
    const payload = pickAllowed({ name: 'Nou', is_sold_out: true } as Partial<Product>, PRODUCT_INSERT_FIELDS)
    expect(payload).toEqual({ name: 'Nou', is_sold_out: true })
    expect([...PRODUCT_INSERT_FIELDS].sort()).toEqual([...PRODUCT_UPDATE_FIELDS, 'is_sold_out'].sort())
  })
})
